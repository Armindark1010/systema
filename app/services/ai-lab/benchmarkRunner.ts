// ============================================================
// SYSTEMA — Phase 14: the benchmark runner
// ============================================================
// Executes one model against one controlled dataset and produces a
// fully-attributed BenchmarkRun.
//
// The measurement discipline (§13)
// --------------------------------
//   1. Load the model once. That cost is recorded separately and is
//      never folded into inference timings.
//   2. Run warm-up inferences that are measured but DISCARDED. The
//      first inference through any runtime pays for lazy allocation
//      and JIT; including it would inflate the average and make a
//      model look worse than it is.
//   3. Run N measured repetitions per sample and keep every timing,
//      so median and p95 are real order statistics rather than
//      derived from an average.
//
// Failure isolation (§25)
// -----------------------
// One bad sample fails that sample. The run continues and finishes as
// PARTIAL_SUCCESS with the failure and its reason attached. This
// mirrors the Phase 13 worker's contract deliberately: the same rule
// proved correct there, and consistency is worth more than novelty.
//
// What this file must never do
// ----------------------------
// Touch the music library, enqueue background work, or process
// anything not present in the dataset it was handed.
// ============================================================

import type {
  BenchmarkDataset,
  BenchmarkRun,
  BenchmarkSample,
  DeviceInfo,
  ExecutionProviderId,
  Metric,
  ModelDefinition,
  PreprocessingConfig,
  QualityMetrics,
  RunStatus,
  SampleResult,
  SampleStatus,
} from './types'
import { HARNESS_VERSION, measured, notApplicable, unknown } from './types'
import { validateDataset } from './dataset'
import { frameAudio, resolvePreprocessing, synthesiseAudio } from './preprocessing'
import {
  aggregateEmbeddings,
  computeEmbeddingStats,
  cosineSimilarity,
  getRuntime,
  InferenceError,
} from './inferenceRuntime'
import type { InferenceRuntime } from './inferenceRuntime'

export interface BenchmarkOptions {
  model: ModelDefinition
  dataset: BenchmarkDataset
  preprocessing: PreprocessingConfig
  executionProvider: ExecutionProviderId
  device: DeviceInfo
  /** Discarded inferences before measurement begins. */
  warmupRuns?: number
  /** Measured repetitions per sample. */
  measuredRuns?: number
  /** Per-inference ceiling. Guards against a pathological model. */
  timeoutMs?: number
  appVersion?: string
  /** Progress callback for the UI. */
  onProgress?: (completed: number, total: number, label: string) => void
  /** Structured log sink (§24). Defaults to console. */
  log?: (line: string) => void
  /**
   * Overrides the runtime resolved from the model.
   *
   * Dependency injection, used by the test suite to drive the runner
   * with a runtime that fails on a chosen sample — which is the only
   * way to verify failure isolation (§25) without a real model that
   * crashes on demand. Production callers omit it.
   */
  runtime?: InferenceRuntime
  /**
   * Supplies decoded PCM for `device-track` samples.
   *
   * Required whenever the dataset contains real tracks. Without it
   * those samples FAIL rather than falling back to synthetic audio —
   * substituting generated signals for a user's music would produce
   * a number that looks real and means nothing.
   */
  realAudioProvider?: (
    sample: BenchmarkSample,
    preprocessing: PreprocessingConfig,
  ) => Promise<Float32Array>
}

/** Sustained/thermal stability options (§14). */
export interface SustainedOptions extends BenchmarkOptions {
  /** Total inference iterations. Bounded for device safety. */
  iterations: number
}

export const MAX_SUSTAINED_ITERATIONS = 50

/** High-resolution clock, falling back where performance is absent. */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/** Percentile over an unsorted list of timings. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]!
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Reads current JS heap usage where the browser exposes it.
 *
 * Chrome-only and coarse, so it is reported as ESTIMATED. On Android
 * the authoritative figure comes from the native side; this is a
 * best-effort stand-in and is labelled as such rather than presented
 * as a real RSS measurement.
 */
function readHeapMb(): number | null {
  const perf = globalThis.performance as unknown as {
    memory?: { usedJSHeapSize?: number }
  } | undefined
  const used = perf?.memory?.usedJSHeapSize
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return used / (1024 * 1024)
}

function mapErrorToStatus(error: unknown): { status: SampleStatus, code: string, message: string } {
  if (error instanceof InferenceError) {
    switch (error.code) {
      case 'TIMEOUT':
        return { status: 'TIMEOUT', code: error.code, message: error.message }
      case 'OUT_OF_MEMORY':
        return { status: 'OUT_OF_MEMORY', code: error.code, message: error.message }
      case 'UNSUPPORTED_INPUT':
        return { status: 'UNSUPPORTED_INPUT', code: error.code, message: error.message }
      case 'MODEL_NOT_INSTALLED':
      case 'MODEL_LOAD_FAILED':
      case 'RUNTIME_UNAVAILABLE':
      case 'RUNTIME_ERROR':
        return { status: 'RUNTIME_ERROR', code: error.code, message: error.message }
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { status: 'FAILED', code: 'UNKNOWN', message }
}

/** Structured single-line log (§24). Carries no paths or user metadata. */
function logLine(fields: Record<string, string | number>): string {
  const body = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')
  return `[AI-BENCHMARK] ${body}`
}

/**
 * Runs a benchmark.
 *
 * Never throws for a per-sample problem; throws only when the run
 * cannot start at all (invalid dataset, model fails to load), which
 * the caller reports as a FAILED run.
 */
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkRun> {
  const {
    model,
    dataset,
    executionProvider,
    device,
    warmupRuns = 2,
    measuredRuns = 3,
    timeoutMs = 30_000,
    appVersion = '0.14.0',
    onProgress,
    log = (line: string) => console.info(line),
  } = options

  // ---- Gate: the dataset must be legal before anything runs -----
  const datasetProblems = validateDataset(dataset)
  if (datasetProblems.length > 0) {
    throw new Error(`Invalid benchmark dataset: ${datasetProblems.join('; ')}`)
  }

  const { config: preprocessing, differences } = resolvePreprocessing(
    options.preprocessing,
    model,
  )

  const warnings: string[] = []
  if (differences.length > 0) {
    warnings.push(
      `Preprocessing adapted to this model's input contract: ${differences.join('; ')}. `
      + 'Comparisons with models using different preprocessing are not like-for-like.',
    )
  }

  const runtime = options.runtime ?? getRuntime(model.runtime)
  const startedAt = Date.now()
  const runId = `run-${startedAt.toString(36)}-${model.modelId}`

  const baselineMb = readHeapMb()
  let peakMb = baselineMb

  const trackPeak = () => {
    const current = readHeapMb()
    if (current !== null && (peakMb === null || current > peakMb)) peakMb = current
  }

  // ---- Model load, timed separately (§13) -----------------------
  let loaded
  let modelLoadMs: Metric
  try {
    const loadStart = now()
    loaded = await runtime.load(model, executionProvider)
    modelLoadMs = measured(now() - loadStart)
    log(logLine({
      model: model.modelId,
      runtime: model.runtime,
      provider: executionProvider,
      event: 'model_loaded',
      loadMs: modelLoadMs.value!.toFixed(2),
    }))
  } catch (error) {
    const mapped = mapErrorToStatus(error)
    log(logLine({
      model: model.modelId,
      runtime: model.runtime,
      provider: executionProvider,
      event: 'model_load_failed',
      status: mapped.code,
    }))
    // A run that could not load is still a recorded, inspectable
    // result — that is more useful than an exception the UI swallows.
    return failedRun({
      runId, startedAt, model, dataset, device, executionProvider,
      preprocessing, appVersion, warmupRuns, measuredRuns,
      reason: mapped.message, code: mapped.code, warnings,
    })
  }

  // ---- Warm-up: measured, then thrown away ----------------------
  let warmupMs: Metric = notApplicable('No warm-up requested.')
  if (warmupRuns > 0) {
    const warmSample = dataset.samples[0]!
    const warmAudio = synthesiseAudio(warmSample, preprocessing)
    const warmFrame = frameAudio(warmAudio, preprocessing)[0]!
    const warmStart = now()
    let warmOk = true
    for (let i = 0; i < warmupRuns; i++) {
      try {
        await runtime.infer(loaded, warmFrame)
      } catch {
        warmOk = false
        break
      }
    }
    warmupMs = warmOk
      ? measured(now() - warmStart)
      : unknown('Warm-up inference failed; see per-sample results.')
    trackPeak()
  }

  // ---- Measured passes ------------------------------------------
  const sampleResults: SampleResult[] = []
  const allTimings: number[] = []
  let totalAudioSec = 0
  // Kept only for the quality checks below, then dropped.
  const embeddingsBySample = new Map<string, Float32Array>()
  const repeatEmbeddings = new Map<string, Float32Array>()

  let completed = 0
  for (const sample of dataset.samples) {
    onProgress?.(completed, dataset.samples.length, sample.label)

    // A real track must never be silently replaced by synthetic audio.
    //
    // This guard fixes a bug where `device-track` samples were fed
    // generated signals: the run produced real-looking numbers that
    // had nothing to do with the selected music. Measuring the wrong
    // thing invisibly is worse than refusing to measure, so a real
    // sample that cannot be decoded fails loudly instead.
    let audio: Float32Array
    if (sample.kind === 'device-track') {
      const provided = options.realAudioProvider
      if (!provided) {
        sampleResults.push({
          sampleId: sample.sampleId,
          status: 'UNSUPPORTED_INPUT',
          inferenceMs: null,
          audioSec: sample.durationSec,
          errorCode: 'NO_REAL_AUDIO_SOURCE',
          errorMessage:
            'This sample references a real track, but no decoder was supplied. '
            + 'Refusing to substitute synthetic audio, which would produce a '
            + 'measurement that is not about this track.',
        })
        completed++
        continue
      }
      try {
        audio = await provided(sample, preprocessing)
      } catch (error) {
        const mapped = mapErrorToStatus(error)
        sampleResults.push({
          sampleId: sample.sampleId,
          status: mapped.status,
          inferenceMs: null,
          audioSec: sample.durationSec,
          errorCode: mapped.code,
          errorMessage: mapped.message,
        })
        log(logLine({
          model: model.modelId,
          sample: sample.sampleId,
          status: mapped.status,
          error: mapped.code,
        }))
        completed++
        continue
      }
    } else {
      audio = synthesiseAudio(sample, preprocessing)
    }

    const frames = frameAudio(audio, preprocessing)
    const sampleTimings: number[] = []
    let lastEmbedding: Float32Array | null = null
    let firstEmbedding: Float32Array | null = null
    let failure: { status: SampleStatus, code: string, message: string } | null = null

    for (let rep = 0; rep < measuredRuns && !failure; rep++) {
      const repStart = now()
      try {
        const frameEmbeddings: Float32Array[] = []
        for (const frame of frames) {
          const inferStart = now()
          const embedding = await runtime.infer(loaded, frame)
          if (now() - inferStart > timeoutMs) {
            throw new InferenceError('TIMEOUT', `Inference exceeded ${timeoutMs} ms.`)
          }
          frameEmbeddings.push(embedding)
        }
        const aggregated = aggregateEmbeddings(frameEmbeddings, preprocessing.aggregation)
        sampleTimings.push(now() - repStart)
        lastEmbedding = aggregated
        if (rep === 0) firstEmbedding = aggregated
      } catch (error) {
        failure = mapErrorToStatus(error)
      }
      trackPeak()
    }

    if (failure) {
      sampleResults.push({
        sampleId: sample.sampleId,
        status: failure.status,
        inferenceMs: null,
        audioSec: sample.durationSec,
        errorCode: failure.code,
        errorMessage: failure.message,
      })
      log(logLine({
        model: model.modelId,
        runtime: model.runtime,
        sample: sample.sampleId,
        status: failure.status,
        error: failure.code,
      }))
    } else {
      const sampleMedian = median(sampleTimings)!
      allTimings.push(...sampleTimings)
      totalAudioSec += sample.durationSec
      if (lastEmbedding) {
        embeddingsBySample.set(sample.sampleId, lastEmbedding)
        if (firstEmbedding) repeatEmbeddings.set(sample.sampleId, firstEmbedding)
      }
      sampleResults.push({
        sampleId: sample.sampleId,
        status: 'SUCCESS',
        inferenceMs: sampleMedian,
        audioSec: sample.durationSec,
        embeddingStats: lastEmbedding ? computeEmbeddingStats(lastEmbedding) : undefined,
      })
      log(logLine({
        model: model.modelId,
        runtime: model.runtime,
        sample: sample.sampleId,
        inferenceMs: sampleMedian.toFixed(2),
        status: 'SUCCESS',
      }))
    }

    completed++
    onProgress?.(completed, dataset.samples.length, sample.label)
  }

  await runtime.release(loaded)

  // ---- Aggregate metrics ----------------------------------------
  const successful = sampleResults.filter(r => r.status === 'SUCCESS').length
  const failed = sampleResults.length - successful
  const timeouts = sampleResults.filter(r => r.status === 'TIMEOUT').length

  const avg = mean(allTimings)
  const med = median(allTimings)
  const p95 = percentile(allTimings, 0.95)

  // RTF uses the median per-sample time against that sample's audio
  // duration, summed — not wall-clock, which would include warm-up
  // and progress callbacks.
  const totalProcessingMs = sampleResults
    .filter(r => r.status === 'SUCCESS')
    .reduce((acc, r) => acc + (r.inferenceMs ?? 0), 0)
  const realTimeFactor = totalAudioSec > 0
    ? measured(totalProcessingMs / 1000 / totalAudioSec)
    : unknown('No audio was processed successfully.')

  const status: RunStatus = successful === 0
    ? 'FAILED'
    : failed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS'

  const quality = assessQuality(embeddingsBySample, repeatEmbeddings, dataset)

  const memoryNote = 'Browser/WebView JS heap only (performance.memory). '
    + 'Not process RSS — a native measurement is required for a real figure.'

  return {
    id: runId,
    timestamp: startedAt,
    environment: device.platform === 'android' ? 'DEVICE' : 'DESKTOP',
    status,
    modelId: model.modelId,
    modelName: model.modelName,
    modelVersion: model.version,
    device,
    runtime: model.runtime,
    executionProvider,
    datasetId: dataset.datasetId,
    sampleCount: dataset.samples.length,
    performance: {
      modelLoadMs,
      warmupMs,
      averageInferenceMs: avg === null ? unknown('No successful inference.') : measured(avg),
      medianInferenceMs: med === null ? unknown('No successful inference.') : measured(med),
      p95InferenceMs: p95 === null ? unknown('No successful inference.') : measured(p95),
      throughputPerSec: med === null || med <= 0
        ? unknown('No successful inference.')
        : measured(1000 / med),
      totalAudioSec,
      realTimeFactor,
    },
    memory: {
      baselineMb: baselineMb === null
        ? unknown('performance.memory is unavailable in this environment.')
        : { value: baselineMb, confidence: 'ESTIMATED', note: memoryNote },
      peakMb: peakMb === null
        ? unknown('performance.memory is unavailable in this environment.')
        : { value: peakMb, confidence: 'ESTIMATED', note: memoryNote },
      deltaMb: baselineMb === null || peakMb === null
        ? unknown('performance.memory is unavailable in this environment.')
        : { value: Math.max(0, peakMb - baselineMb), confidence: 'ESTIMATED', note: memoryNote },
    },
    cpuUsage: notApplicable(
      'Per-process CPU usage is not readable from the WebView. A native '
      + 'implementation would be required; no figure is invented here.',
    ),
    reliability: {
      successfulSamples: successful,
      failedSamples: failed,
      errorCount: failed,
      timeoutCount: timeouts,
      successRate: sampleResults.length === 0 ? 0 : successful / sampleResults.length,
    },
    quality,
    samples: sampleResults,
    reproducibility: {
      modelId: model.modelId,
      modelVersion: model.version,
      modelChecksum: model.checksum,
      runtime: model.runtime,
      executionProvider,
      datasetId: dataset.datasetId,
      preprocessing,
      appVersion,
      harnessVersion: HARNESS_VERSION,
      warmupRuns,
      measuredRuns,
    },
    warnings,
  }
}

/**
 * Quality signals over the embeddings produced during the run.
 *
 * Explicitly not "accuracy" (§7). These answer three narrow questions:
 * is the model deterministic, does it distinguish different inputs,
 * and does it place a near-duplicate closer than an unrelated sample?
 */
function assessQuality(
  embeddings: Map<string, Float32Array>,
  repeats: Map<string, Float32Array>,
  dataset: BenchmarkDataset,
): QualityMetrics {
  const notes: string[] = []

  // Determinism: the first and last repetition of each sample must
  // agree. Anything below 1.0 means the model is not deterministic.
  const determinismScores: number[] = []
  for (const [id, first] of repeats) {
    const last = embeddings.get(id)
    if (last) determinismScores.push(cosineSimilarity(first, last))
  }
  const determinismMean = mean(determinismScores)

  // Pairwise similarity across different samples. Near 1.0 across the
  // board means the model cannot tell the inputs apart.
  const ids = [...embeddings.keys()]
  const pairwise: number[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairwise.push(cosineSimilarity(embeddings.get(ids[i]!)!, embeddings.get(ids[j]!)!))
    }
  }
  const pairwiseMean = mean(pairwise)

  if (pairwiseMean !== null && pairwiseMean > 0.99) {
    notes.push(
      'Embeddings are nearly identical across clearly different inputs — the model '
      + 'is not discriminating between them.',
    )
  }

  // Nearest-neighbour sanity: the duplicate pair in the synthetic set
  // should be closer to each other than to an unrelated sample.
  let nearestNeighbourSane: boolean | null = null
  const a = embeddings.get('syn-dense-energetic')
  const twin = embeddings.get('syn-dense-energetic-copy')
  const unrelated = embeddings.get('syn-silence') ?? embeddings.get('syn-bright')
  if (a && twin && unrelated) {
    const near = cosineSimilarity(a, twin)
    const far = cosineSimilarity(a, unrelated)
    nearestNeighbourSane = near > far
    notes.push(
      `Nearest-neighbour check: similar pair ${near.toFixed(3)} vs unrelated `
      + `${far.toFixed(3)}.`,
    )
  } else {
    notes.push(
      'Nearest-neighbour check skipped: the dataset contains no known-similar pair.',
    )
  }

  const nonFinite = [...embeddings.values()].some(e => computeEmbeddingStats(e).hasNonFinite)
  if (nonFinite) notes.push('WARNING: at least one embedding contained NaN or Infinity.')

  if (dataset.samples.some(s => s.kind === 'device-track')) {
    notes.push(
      'Quality figures here describe embedding behaviour only. Without labelled '
      + 'ground truth no accuracy claim is possible, and none is made.',
    )
  }

  return {
    determinism: determinismMean === null
      ? unknown('No repeated inference completed.')
      : measured(determinismMean),
    meanPairwiseSimilarity: pairwiseMean === null
      ? unknown('Fewer than two samples embedded successfully.')
      : measured(pairwiseMean),
    nearestNeighbourSane,
    notes,
  }
}

/** Builds a FAILED run for a model that could not even load. */
function failedRun(args: {
  runId: string
  startedAt: number
  model: ModelDefinition
  dataset: BenchmarkDataset
  device: DeviceInfo
  executionProvider: ExecutionProviderId
  preprocessing: PreprocessingConfig
  appVersion: string
  warmupRuns: number
  measuredRuns: number
  reason: string
  code: string
  warnings: string[]
}): BenchmarkRun {
  const { model, dataset, device } = args
  return {
    id: args.runId,
    timestamp: args.startedAt,
    environment: device.platform === 'android' ? 'DEVICE' : 'DESKTOP',
    status: 'FAILED',
    modelId: model.modelId,
    modelName: model.modelName,
    modelVersion: model.version,
    device,
    runtime: model.runtime,
    executionProvider: args.executionProvider,
    datasetId: dataset.datasetId,
    sampleCount: dataset.samples.length,
    performance: {
      modelLoadMs: unknown(args.reason),
      warmupMs: notApplicable('Model never loaded.'),
      averageInferenceMs: notApplicable('Model never loaded.'),
      medianInferenceMs: notApplicable('Model never loaded.'),
      p95InferenceMs: notApplicable('Model never loaded.'),
      throughputPerSec: notApplicable('Model never loaded.'),
      totalAudioSec: 0,
      realTimeFactor: notApplicable('Model never loaded.'),
    },
    memory: {
      baselineMb: notApplicable('Model never loaded.'),
      peakMb: notApplicable('Model never loaded.'),
      deltaMb: notApplicable('Model never loaded.'),
    },
    cpuUsage: notApplicable('Model never loaded.'),
    reliability: {
      successfulSamples: 0,
      failedSamples: dataset.samples.length,
      errorCount: 1,
      timeoutCount: 0,
      successRate: 0,
    },
    quality: {
      determinism: notApplicable('Model never loaded.'),
      meanPairwiseSimilarity: notApplicable('Model never loaded.'),
      nearestNeighbourSane: null,
      notes: [args.reason],
    },
    samples: dataset.samples.map(s => ({
      sampleId: s.sampleId,
      status: 'RUNTIME_ERROR' as SampleStatus,
      inferenceMs: null,
      audioSec: s.durationSec,
      errorCode: args.code,
      errorMessage: args.reason,
    })),
    reproducibility: {
      modelId: model.modelId,
      modelVersion: model.version,
      modelChecksum: model.checksum,
      runtime: model.runtime,
      executionProvider: args.executionProvider,
      datasetId: dataset.datasetId,
      preprocessing: args.preprocessing,
      appVersion: args.appVersion,
      harnessVersion: HARNESS_VERSION,
      warmupRuns: args.warmupRuns,
      measuredRuns: args.measuredRuns,
    },
    warnings: [...args.warnings, args.reason],
  }
}

/**
 * Sustained/thermal stability probe (§14).
 *
 * Repeats one inference many times and reports how latency drifts.
 * Rising latency across the window is the observable signature of
 * thermal throttling — the device temperature itself is not readable
 * from the WebView, so it is not claimed.
 *
 * Iterations are hard-capped: a benchmark must not cook the phone.
 */
export async function runSustainedBenchmark(
  options: SustainedOptions,
): Promise<{
    iterations: number
    timings: number[]
    firstQuartileMs: number | null
    lastQuartileMs: number | null
    driftPercent: number | null
    failures: number
    note: string
  }> {
  const iterations = Math.max(1, Math.min(options.iterations, MAX_SUSTAINED_ITERATIONS))
  const runtime = options.runtime ?? getRuntime(options.model.runtime)
  const { config } = resolvePreprocessing(options.preprocessing, options.model)

  const sample = options.dataset.samples[0]
  if (!sample) throw new Error('Sustained benchmark needs at least one sample.')

  const frame = frameAudio(synthesiseAudio(sample, config), config)[0]!
  const loaded = await runtime.load(options.model, options.executionProvider)

  const timings: number[] = []
  let failures = 0

  for (let i = 0; i < iterations; i++) {
    const start = now()
    try {
      await runtime.infer(loaded, frame)
      timings.push(now() - start)
    } catch {
      failures++
    }
    options.onProgress?.(i + 1, iterations, `iteration ${i + 1}`)
  }

  await runtime.release(loaded)

  const quarter = Math.max(1, Math.floor(timings.length / 4))
  const firstQuartile = mean(timings.slice(0, quarter))
  const lastQuartile = mean(timings.slice(-quarter))
  const drift = firstQuartile && lastQuartile && firstQuartile > 0
    ? ((lastQuartile - firstQuartile) / firstQuartile) * 100
    : null

  return {
    iterations,
    timings,
    firstQuartileMs: firstQuartile,
    lastQuartileMs: lastQuartile,
    driftPercent: drift,
    failures,
    note:
      'Latency drift is the only throttling signal available here. Device '
      + 'temperature is not readable from the WebView and is not claimed. '
      + `Capped at ${MAX_SUSTAINED_ITERATIONS} iterations for device safety.`,
  }
}
