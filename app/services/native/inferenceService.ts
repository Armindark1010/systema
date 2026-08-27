// ============================================================
// SYSTEMA — Inference service (Phase 15)
// ============================================================
// The web layer's only entry point to native inference.
//
// Its job is to make failure LOUD. Every function here either returns
// a real native measurement or throws a typed error. There is no
// browser simulation, no cached last-good result, and above all no
// fallback from ONNX to the reference runtime: if the developer asked
// for ONNX and ONNX is unavailable, they are told so, because a
// silently-substituted runtime would make every number in the
// benchmark lab a lie (§13).
// ============================================================

import {
  InferenceNative,
  isInferenceAvailable,
  type InferenceCapabilities,
  type InferenceEnvironment,
  type InferenceErrorCode,
  type AggregationStrategy,
  type CandidateMatrix,
  type ImportResult,
  type MemoryLifecycleReport,
  type EvaluationReport,
  type ModelContract,
  type QualityEvalStartedEvent,
  type QualityEvalTrackCompletedEvent,
  type QualityEvalTrackStartedEvent,
  type RealAudioResult,
  type SimilarityStats,
  type TrackEvaluation,
  type RuntimeId,
  type TestModelResult,
} from './inferencePlugin'

/** Mirrors the Phase 13 error convention so the UI handles both alike. */
export class InferenceServiceError extends Error {
  constructor(
    public readonly code: InferenceErrorCode | 'PLUGIN_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'InferenceServiceError'
  }
}

/** Hard cap, duplicated from Kotlin so the UI can enforce it early. */
export const MAX_BENCHMARK_TRACKS = 20

/**
 * Hard cap on one quality evaluation, mirroring
 * EmbeddingQualityLab.MAX_TRACKS. Twenty tracks give 190 pairs.
 */
export const MAX_QUALITY_TRACKS = 20

function requirePlugin(): void {
  if (!isInferenceAvailable()) {
    throw new InferenceServiceError(
      'PLUGIN_UNAVAILABLE',
      'Native inference is not available. This runs on the Android build only — ' +
        'there is no browser implementation, and inventing one would produce ' +
        'measurements that mean nothing.',
    )
  }
}

/** Converts a Capacitor rejection into a typed error, preserving the code. */
function toServiceError(e: unknown): InferenceServiceError {
  const err = e as { code?: string, message?: string }
  const code = (err?.code ?? 'MODEL_INFERENCE_FAILED') as InferenceErrorCode
  return new InferenceServiceError(code, err?.message ?? 'Inference failed.')
}

export async function getCapabilities(): Promise<InferenceCapabilities> {
  requirePlugin()
  try {
    return await InferenceNative.getCapabilities()
  } catch (e) {
    throw toServiceError(e)
  }
}

export async function getEnvironment(): Promise<InferenceEnvironment> {
  requirePlugin()
  try {
    return await InferenceNative.getEnvironment()
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Runs the deterministic test model (§8).
 *
 * @param iterations repeated runs, to separate cold load from warm
 *   inference and to prove the runtime holds no state between calls
 */
export async function runTestModel(options: {
  runtimeId: RuntimeId
  input?: number[]
  iterations?: number
}): Promise<TestModelResult> {
  requirePlugin()
  try {
    return await InferenceNative.runTestModel(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Benchmarks explicitly selected tracks.
 *
 * The cap is checked here as well as natively. Two independent gates,
 * because this is the one guarantee that stops a benchmark from
 * becoming a library-wide scan.
 */
export async function runRealAudio(options: {
  runtimeId: RuntimeId
  modelId: string
  tracks: Array<{ trackId: string, uri: string }>
  /**
   * Pooling for the track-level embedding. Defaults to the MEAN
   * baseline natively; passing an unknown value is rejected rather
   * than silently defaulted, so a run is never mislabelled.
   */
  aggregationStrategy?: AggregationStrategy
}): Promise<RealAudioResult> {
  requirePlugin()

  if (options.tracks.length === 0) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      'Select at least one track. The benchmark never chooses tracks for you.',
    )
  }
  if (options.tracks.length > MAX_BENCHMARK_TRACKS) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      `At most ${MAX_BENCHMARK_TRACKS} tracks can be benchmarked at once.`,
    )
  }

  try {
    return await InferenceNative.runRealAudio(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Imports one .onnx file chosen with the Android system file picker.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It takes no path and no directory. The native side opens
 * ACTION_OPEN_DOCUMENT, and only the single file the user taps is
 * read. Nothing scans storage, nothing enumerates the music library,
 * and nothing runs inference as a result of an import.
 *
 * A cancelled picker resolves with `cancelled: true` rather than
 * throwing — dismissing a picker is a normal action, not an error.
 */
export async function pickAndImportModel(): Promise<ImportResult> {
  requirePlugin()
  try {
    return await InferenceNative.pickAndImportModel()
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Declares what an imported model consumes.
 *
 * Only the fields an ONNX graph cannot express: sample rate and input
 * representation. Shapes are read from the file, never entered here.
 * The result is stamped DEVELOPER_DECLARED so nothing downstream can
 * present it as verified by SYSTEMA.
 */
export async function declareModelContract(options: {
  modelId: string
  sampleRate?: number
  inputFormat: string
}): Promise<ModelContract> {
  requirePlugin()

  if (!options.modelId) {
    throw new InferenceServiceError(
      'MODEL_NOT_FOUND',
      'A model must be chosen before its contract can be declared.',
    )
  }
  // A waveform model without a rate is not a contract — it is the
  // same unknown in different words, and letting it through would
  // license a benchmark on arbitrary PCM.
  if (options.inputFormat === 'RAW_WAVEFORM'
    && (!options.sampleRate || options.sampleRate <= 0)) {
    throw new InferenceServiceError(
      'PREPROCESSING_UNAVAILABLE',
      'A raw-waveform model needs its sample rate. YAMNet expects 16000 Hz; ' +
        'feeding it the decoder\'s 22050 Hz would produce believable timings ' +
        'and meaningless embeddings.',
    )
  }

  try {
    return await InferenceNative.declareModelContract(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/** Removes an imported model and its contract. Never the test model. */
export async function deleteImportedModel(modelId: string): Promise<boolean> {
  requirePlugin()
  try {
    const res = await InferenceNative.deleteImportedModel({ modelId })
    return res.deleted
  } catch (e) {
    throw toServiceError(e)
  }
}

/** Bounds on the memory test, duplicated from Kotlin for early feedback. */
export const MAX_MEMORY_CYCLES = 50

/**
 * Runs the native memory lifecycle test (§8).
 *
 * This is the measurement Phase 15 could not make. ONNX Runtime holds
 * its session and weights in native memory, so "unloadModel releases
 * everything" was code-verified only. Here the model is genuinely
 * loaded and unloaded repeatedly with PSS sampled at each boundary.
 *
 * It is manual and explicit. Nothing calls it automatically.
 */
export async function runMemoryLifecycle(options: {
  runtimeId: RuntimeId
  modelId: string
  iterations?: number
  inferencesPerCycle?: number
}): Promise<MemoryLifecycleReport> {
  requirePlugin()

  const iterations = options.iterations ?? 5
  if (iterations < 3) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      'Run at least 3 cycles. One or two cycles cannot distinguish a leak from ' +
        'normal PSS jitter, and reporting a trend from them would be misleading.',
    )
  }
  if (iterations > MAX_MEMORY_CYCLES) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      `At most ${MAX_MEMORY_CYCLES} cycles.`,
    )
  }

  try {
    return await InferenceNative.runMemoryLifecycle(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * The researched candidate matrix.
 *
 * Published specifications only. Callers must not present these as
 * measurements: `measured` is false and the timing fields are null
 * because no candidate model has run on the device.
 */
export async function getCandidates(): Promise<CandidateMatrix> {
  requirePlugin()
  try {
    return await InferenceNative.getCandidates()
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Renders a memory verdict as text, without overstating it.
 *
 * Note what STABLE is NOT allowed to say: "no leak". The test observed
 * N cycles; it did not prove a negative.
 */
export function describeMemoryTrend(report: MemoryLifecycleReport): string {
  const mb = (kb: number) => (kb / 1024).toFixed(1)
  switch (report.trend) {
    case 'STABLE':
      return `Memory returned to near baseline across ${report.iterations} cycles ` +
        `(net ${mb(report.netDeltaKb)} MB). Consistent with unload releasing native ` +
        'memory — not proof that no leak exists.'
    case 'GROWING':
      return `Post-unload memory rose across ${report.iterations} cycles ` +
        `(net ${mb(report.netDeltaKb)} MB). Investigate before trusting unload.`
    default:
      return 'Not enough clean samples to judge a trend. Treat as UNKNOWN.'
  }
}

/**
 * Formats an environment for display next to a result.
 *
 * Screen state leads because it is the single largest confound
 * measured so far: on the Poco X7 Pro the same track took 2.32x
 * longer with the screen off.
 */
export function describeEnvironment(env: InferenceEnvironment): string {
  const parts = [
    env.screenOn ? 'screen ON' : 'screen OFF',
    env.chargingState ? 'charging' : 'on battery',
  ]
  if (env.batteryLevel !== null) parts.push(`${env.batteryLevel}%`)
  if (env.thermalStatus !== 'UNAVAILABLE') parts.push(`thermal ${env.thermalStatus}`)
  return parts.join(' · ')
}


// ============================================================
// Phase 17 — Embedding Quality Lab
// ============================================================

/**
 * Starts an incremental evaluation.
 *
 * Returns as soon as the run is accepted. Subscribe with
 * [onQualityEvalEvents] BEFORE calling this, or the first events can
 * be missed.
 */
export async function runQualityEvaluation(options: {
  runtimeId: RuntimeId
  modelId: string
  tracks: Array<{ trackId: string, uri: string, label?: string }>
  aggregationStrategy?: AggregationStrategy
}): Promise<{ started: boolean, totalTracks: number, labelled: boolean }> {
  requirePlugin()
  return InferenceNative.runQualityEvaluation(options)
}

/** Requests a stop. Completed results are preserved. */
export async function stopQualityEvaluation(): Promise<void> {
  requirePlugin()
  await InferenceNative.stopQualityEvaluation()
}

export async function getQualityEvaluationStatus(): Promise<{
  running: boolean
  maxTracks: number
}> {
  requirePlugin()
  return InferenceNative.getQualityEvaluationStatus()
}

/**
 * Subscribes to all four evaluation events at once.
 *
 * Returns a disposer that removes every listener. Registering them
 * together makes it impossible to leak one by forgetting it in a
 * component teardown.
 */
export async function onQualityEvalEvents(handlers: {
  onStarted?: (e: QualityEvalStartedEvent) => void
  onTrackStarted?: (e: QualityEvalTrackStartedEvent) => void
  onTrackCompleted?: (e: QualityEvalTrackCompletedEvent) => void
  onFinished?: (e: EvaluationReport) => void
}): Promise<() => void> {
  requirePlugin()
  const handles = await Promise.all([
    InferenceNative.addListener('qualityEvalStarted', (e) => handlers.onStarted?.(e)),
    InferenceNative.addListener('qualityEvalTrackStarted', (e) => handlers.onTrackStarted?.(e)),
    InferenceNative.addListener('qualityEvalTrackCompleted', (e) => handlers.onTrackCompleted?.(e)),
    InferenceNative.addListener('qualityEvalFinished', (e) => handlers.onFinished?.(e)),
  ])
  return () => {
    handles.forEach(h => void h.remove())
  }
}

/**
 * Cosine similarity, mirrored in TypeScript for display-side checks.
 *
 * THIS IS NOT THE PRODUCTION PATH. Every score shown in the lab is
 * computed natively from the real embedding; this exists so the
 * arithmetic can be asserted in the test suite and so the UI can
 * sanity-check a matrix it was handed.
 *
 * Throws rather than returning NaN: a NaN would flow into a table
 * cell and look like a measurement.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Cannot compare a ${a.length}-d embedding with a ${b.length}-d one. ` +
      'Refusing to pad or truncate.',
    )
  }
  if (a.length === 0) throw new Error('Cannot compute similarity between empty vectors.')
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Refusing to compute a similarity from non-finite components.')
    }
    dot += x * y
  }
  // Both inputs are expected to be unit length, so the dot product IS
  // the cosine. Clamped because float rounding can nudge an identical
  // pair a hair past 1.
  return Math.min(1, Math.max(-1, dot))
}

/** L2 norm. */
export function l2Norm(v: readonly number[]): number {
  let acc = 0
  for (const x of v) acc += x * x
  return Math.sqrt(acc)
}

/** Whether a vector is unit length within the shared tolerance. */
export function isUnitLength(v: readonly number[], tolerance = 1e-4): boolean {
  if (v.length === 0) return false
  if (!v.every(Number.isFinite)) return false
  return Math.abs(l2Norm(v) - 1) <= tolerance
}

/**
 * Formats the quality conclusion for display.
 *
 * Deliberately has no GOOD or BAD branch. The lab measures geometry;
 * grading it would require labelled ground truth this phase does not
 * have, and a threshold invented to fill the gap is exactly the
 * confirmation bias the phase exists to avoid.
 */
export function describeQualityConclusion(report: EvaluationReport): string {
  return report.labelled
    ? 'INSUFFICIENT EVIDENCE — labelled pairs were supplied, but the sample is ' +
      'small and no accepted threshold exists for these statistics.'
    : 'INSUFFICIENT EVIDENCE — unlabeled run. These numbers describe embedding ' +
      'geometry only, not whether the tracks actually sound alike.'
}

/**
 * Renders a similarity distribution as text bars.
 *
 * Buckets are fixed across [-1, 1] rather than fitted to the data, so
 * a narrow cluster LOOKS narrow. An auto-scaled histogram would make
 * every distribution appear healthy.
 */
export function renderHistogram(stats: SimilarityStats, width = 24): string[] {
  const peak = Math.max(...stats.histogram, 1)
  const bucketWidth = 2 / stats.histogramBuckets
  return stats.histogram.map((count, i) => {
    const lo = -1 + i * bucketWidth
    const hi = lo + bucketWidth
    const filled = Math.round((count / peak) * width)
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, width - filled))
    return `${lo.toFixed(1)}..${hi.toFixed(1)} ${bar} ${count}`
  })
}

/** A progress bar for the run header. */
export function renderProgressBar(done: number, total: number, width = 14): string {
  if (total <= 0) return '\u2591'.repeat(width)
  const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)))
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

/**
 * Summarises one completed track for the live feed.
 *
 * Returns the explicit first-track sentence rather than a score when
 * there is nothing to compare against yet.
 */
export function describeNeighbours(evaluation: TrackEvaluation): string {
  if (!evaluation.ok) return evaluation.errorMessage ?? 'Failed.'
  if (!evaluation.hasComparison) return 'No comparison available \u2014 first embedding.'
  const near = evaluation.nearestScore?.toFixed(4) ?? '?'
  const far = evaluation.farthestScore?.toFixed(4) ?? '?'
  return `closest ${evaluation.nearestTrackId} (${near}) \u00b7 ` +
    `farthest ${evaluation.farthestTrackId} (${far})`
}
