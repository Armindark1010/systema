// ============================================================
// SYSTEMA — Phase 14: the benchmark harness measures correctly
// ============================================================
// A benchmark is only worth as much as the machinery that produces
// it. This suite verifies that machinery: the registry, deterministic
// preprocessing, the reference runtime, the statistics, failure
// isolation, and the comparison rules.
//
// Coverage maps to the brief:
//   §10 registry — registration, lookup, versioning, validation
//   §6  preprocessing — determinism, framing, normalisation
//   §13 runner — warm-up, repeats, load time kept separate
//   §7  metrics — percentiles, RTF, confidence labelling
//   §25 partial success — a failed sample does not destroy a run
//   §12 comparison — compatible vs incompatible detection
//   §11 persistence — run and per-sample round-trip
//
// Everything runs against the reference runtime, which is real code
// and not a mock — so these are genuine end-to-end measurements of
// the pipeline, just with a weight-free model.
// ============================================================

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function near(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance
}

const root = resolve(import.meta.dirname, '..')
const labDir = resolve(root, 'app/services/ai-lab')

console.log('\n\x1b[1mPhase 14 — AI benchmark harness\x1b[0m')

// ------------------------------------------------------------
console.log('\n\x1b[1m1. Module layout\x1b[0m')
// ------------------------------------------------------------

for (const file of [
  'types.ts', 'modelRegistry.ts', 'preprocessing.ts',
  'inferenceRuntime.ts', 'dataset.ts', 'benchmarkRunner.ts',
  'comparison.ts', 'resultStore.ts', 'deviceInfo.ts',
]) {
  ok(`ai-lab/${file} exists`, existsSync(resolve(labDir, file)))
}

const registry = await import('../app/services/ai-lab/modelRegistry')
const preprocessing = await import('../app/services/ai-lab/preprocessing')
const runtimes = await import('../app/services/ai-lab/inferenceRuntime')
const datasets = await import('../app/services/ai-lab/dataset')
const runner = await import('../app/services/ai-lab/benchmarkRunner')
const comparison = await import('../app/services/ai-lab/comparison')
const store = await import('../app/services/ai-lab/resultStore')
const types = await import('../app/services/ai-lab/types')

// The localStorage adapter deliberately no-ops outside a browser
// (it guards on import.meta.client), so inject a real in-memory
// adapter and exercise the persistence contract for real.
const memoryAdapter = store.createMemoryAdapter()
store.setStorageAdapter(memoryAdapter)

// ------------------------------------------------------------
console.log('\n\x1b[1m2. Model registry (§10)\x1b[0m')
// ------------------------------------------------------------

const models = registry.listModels()
ok('the registry is populated', models.length >= 5, `${models.length} models`)
ok('the registry validates cleanly', registry.validateRegistry().length === 0,
  registry.validateRegistry().join('; '))

ok('lookup by id works', registry.getModel('yamnet-1024')?.modelName === 'YAMNet (MobileNetV1)')
ok('an unknown id returns null, not a throw', registry.getModel('nope') === null)

ok('every model has a distinct id',
  new Set(models.map(m => m.modelId)).size === models.length)
ok('every model declares a version',
  models.every(m => /\S/.test(m.version)))
ok('every model declares an embedding dimension',
  models.every(m => m.embeddingDimension > 0))
ok('every model declares its input contract',
  models.every(m => m.inputSampleRate > 0 && m.inputDurationSec > 0 && m.inputChannels > 0))
ok('every real candidate declares limitations',
  models.filter(m => m.availability !== 'SYNTHETIC').every(m => m.limitations.length > 0))
ok('every model carries a rationale',
  models.every(m => m.rationale.length > 40))
ok('size claims are labelled with a confidence',
  models.every(m => ['MEASURED', 'ESTIMATED', 'UNKNOWN', 'NOT_APPLICABLE']
    .includes(m.sizeConfidence)))

// §4: CLAP must be present as a measurable candidate, not a default.
ok('CLAP is registered as one candidate among several',
  models.some(m => /clap/i.test(m.modelId)))
ok('CLAP is not the default selection',
  models[0]!.modelId !== 'laion-clap-htsat-tiny')
ok('lighter alternatives to CLAP are registered',
  models.some(m => m.modelId === 'yamnet-1024')
  && models.some(m => /panns/i.test(m.modelId)))

// Validation must actually catch problems.
const badRegistry = registry.validateRegistry([
  { ...models[1]!, modelId: '' },
  { ...models[1]!, limitations: [], availability: 'NOT_INSTALLED' },
  { ...models[1]!, embeddingDimension: 0 },
])
ok('validation catches an empty id', badRegistry.some(p => /empty modelId/.test(p)))
ok('validation catches missing limitations', badRegistry.some(p => /limitations/.test(p)))
ok('validation catches a bad dimension', badRegistry.some(p => /embeddingDimension/.test(p)))
ok('validation catches duplicate ids',
  registry.validateRegistry([models[1]!, models[1]!]).some(p => /duplicate/.test(p)))

// Only runnable models are offered as runnable.
ok('listRunnableModels excludes uninstalled weights',
  registry.listRunnableModels().every(m => m.availability !== 'NOT_INSTALLED'))

// ------------------------------------------------------------
console.log('\n\x1b[1m3. Execution providers (§8, §9)\x1b[0m')
// ------------------------------------------------------------

const androidProviders = registry.listExecutionProviders('android')
ok('CPU is available on Android',
  androidProviders.find(p => p.id === 'cpu')?.available === true)
ok('NNAPI is registered but not assumed available',
  androidProviders.find(p => p.id === 'nnapi')?.available === false)
ok('the NNAPI note records its Android 15 deprecation',
  /deprecated/i.test(androidProviders.find(p => p.id === 'nnapi')?.note ?? ''))
ok('the GPU note records that QNN does not apply to MediaTek',
  /QNN|Mali|MediaTek/i.test(androidProviders.find(p => p.id === 'gpu')?.note ?? ''))
ok('every provider explains its state',
  androidProviders.every(p => p.note.length > 20))
ok('the browser offers no native provider',
  registry.listExecutionProviders('web').every(p => p.id === 'none'))

// ------------------------------------------------------------
console.log('\n\x1b[1m4. Deterministic preprocessing (§6)\x1b[0m')
// ------------------------------------------------------------

const config = registry.DEFAULT_PREPROCESSING
const sample = datasets.fullSyntheticDataset().samples[0]!

const audioA = preprocessing.synthesiseAudio(sample, config)
const audioB = preprocessing.synthesiseAudio(sample, config)
ok('synthesis is byte-identical across calls',
  audioA.length === audioB.length && audioA.every((v, i) => v === audioB[i]))

const otherSample = datasets.fullSyntheticDataset().samples[1]!
const audioC = preprocessing.synthesiseAudio(otherSample, config)
ok('different samples produce different audio',
  !audioA.every((v, i) => v === audioC[i]))

ok('synthesised length matches the requested duration',
  audioA.length === Math.round(config.sampleRate * sample.durationSec))
ok('synthesised audio is finite throughout', audioA.every(Number.isFinite))

// The seeded PRNG must be reproducible and well-behaved.
const rand1 = preprocessing.seededRandom(42)
const rand2 = preprocessing.seededRandom(42)
ok('the PRNG is reproducible from a seed',
  Array.from({ length: 20 }, () => rand1()).every((v, i) => {
    void i
    return v === undefined ? false : true
  }) && rand2() === preprocessing.seededRandom(42)())
const draws = Array.from({ length: 1000 }, () => preprocessing.seededRandom(7)())
ok('PRNG output stays within [0, 1)', draws.every(v => v >= 0 && v < 1))
ok('hashString is stable',
  preprocessing.hashString('abc') === preprocessing.hashString('abc'))
ok('hashString separates different inputs',
  preprocessing.hashString('abc') !== preprocessing.hashString('abd'))

// Normalisation edge cases — the silence case is the dangerous one.
const silent = new Float32Array(1000)
const normalisedSilence = preprocessing.normalise(silent, 'peak')
ok('peak-normalising silence does not produce NaN',
  normalisedSilence.every(v => v === 0))
const rmsSilence = preprocessing.normalise(new Float32Array(1000), 'rms')
ok('RMS-normalising silence does not produce NaN',
  rmsSilence.every(Number.isFinite))

const loud = new Float32Array([2, -4, 1])
const peakNormalised = preprocessing.normalise(Float32Array.from(loud), 'peak')
ok('peak normalisation scales to just under unity',
  Math.max(...Array.from(peakNormalised).map(Math.abs)) <= 0.951)

// Framing.
const frames = preprocessing.frameAudio(new Float32Array(48_000 * 25), config)
ok('a 25 s buffer at a 10 s window yields 3 frames', frames.length === 3,
  `got ${frames.length}`)
ok('every frame is exactly one window long',
  frames.every(f => f.length === config.windowSec * config.sampleRate))
ok('a short buffer still yields one zero-padded frame',
  preprocessing.frameAudio(new Float32Array(100), config).length === 1)
ok('an empty buffer still yields one frame',
  preprocessing.frameAudio(new Float32Array(0), config).length === 1)

const overlapped = preprocessing.frameAudio(
  new Float32Array(48_000 * 20),
  { ...config, overlapSec: 5 },
)
ok('overlap increases the frame count', overlapped.length > 2, `got ${overlapped.length}`)

// Model-specific reconciliation must be reported, not silent.
const resolved = preprocessing.resolvePreprocessing(config, registry.getModel('yamnet-1024')!)
ok('a model with a different sample rate is honoured',
  resolved.config.sampleRate === 16_000)
ok('the sample-rate difference is reported',
  resolved.differences.some(d => /sample rate/.test(d)))
ok('the window difference is reported',
  resolved.differences.some(d => /window/.test(d)))
ok('a matching model reports no differences',
  preprocessing.resolvePreprocessing(config, {
    inputSampleRate: config.sampleRate,
    inputChannels: config.channels,
    inputDurationSec: config.windowSec,
  }).differences.length === 0)

// ------------------------------------------------------------
console.log('\n\x1b[1m5. Reference runtime\x1b[0m')
// ------------------------------------------------------------

const reference = runtimes.getRuntime('reference')
ok('the reference runtime is available', reference.isAvailable('cpu'))
ok('the reference runtime reports no blocking reason',
  reference.unavailableReason('cpu') === null)

const refModel = registry.getModel('reference-dsp-v1')!
const loaded = await reference.load(refModel, 'cpu')
ok('loading reports the embedding dimension',
  loaded.embeddingDimension === refModel.embeddingDimension)

const frame = preprocessing.frameAudio(audioA, config)[0]!
const emb1 = await reference.infer(loaded, frame)
const emb2 = await reference.infer(loaded, frame)

ok('inference returns the declared dimension', emb1.length === refModel.embeddingDimension)
ok('inference is deterministic', emb1.every((v, i) => v === emb2[i]))
ok('embeddings are finite', emb1.every(Number.isFinite))
ok('embeddings are L2-normalised',
  near(Math.sqrt(emb1.reduce((a, v) => a + v * v, 0)), 1, 1e-5))

// Different audio must produce a different embedding, or the model
// is useless and the harness could not detect it.
const embOther = await reference.infer(
  loaded,
  preprocessing.frameAudio(audioC, config)[0]!,
)
ok('different audio yields a different embedding',
  !emb1.every((v, i) => v === embOther[i]))

// Degenerate input must not crash or produce NaN.
const embSilent = await reference.infer(loaded, new Float32Array(48_000))
ok('silence produces a finite embedding', embSilent.every(Number.isFinite))
const embEmpty = await reference.infer(loaded, new Float32Array(0))
ok('an empty frame produces a finite embedding', embEmpty.every(Number.isFinite))

// ---- ONNX stub must fail honestly, never fabricate --------------
const onnx = runtimes.getRuntime('onnxruntime')
ok('the ONNX runtime reports itself unavailable', !onnx.isAvailable('cpu'))
ok('the ONNX runtime explains why',
  (onnx.unavailableReason('cpu') ?? '').length > 40)
ok('the ONNX reason mentions Phase 15',
  /Phase 15/.test(onnx.unavailableReason('cpu') ?? ''))

let onnxThrew = false
try {
  await onnx.load(registry.getModel('yamnet-1024')!, 'cpu')
} catch (error) {
  onnxThrew = error instanceof runtimes.InferenceError
    && error.code === 'RUNTIME_UNAVAILABLE'
}
ok('the ONNX stub throws rather than returning a fake model', onnxThrew)

let inferThrew = false
try {
  await onnx.infer()
} catch {
  inferThrew = true
}
ok('the ONNX stub never returns a fabricated embedding', inferThrew)

// ---- Embedding discrimination (regression guards) ---------------
// These pin two bugs found by auditing the reference runtime's actual
// output rather than trusting that it "looked reasonable":
//
//   1. A time-domain band-RMS embedding produced a nearly FLAT vector
//      for stationary signals, so unrelated inputs scored cosine
//      1.0000 against one another. Fixed by embedding the frequency
//      domain (Goertzel per log-spaced band) and mean-centring.
//   2. Log-compressing an all-zero spectrum yielded a UNIFORM vector,
//      so digital silence scored ~0.99 against everything. Fixed by
//      returning the zero vector for a silent frame.
//
// Both would have silently invalidated every quality metric, so they
// are asserted numerically here.

const allEmbeddings = new Map<string, Float32Array>()
for (const s of datasets.fullSyntheticDataset().samples) {
  const perFrame: Float32Array[] = []
  for (const f of preprocessing.frameAudio(preprocessing.synthesiseAudio(s, config), config)) {
    perFrame.push(await reference.infer(loaded, f))
  }
  allEmbeddings.set(s.sampleId, runtimes.aggregateEmbeddings(perFrame, config.aggregation))
}

const allIds = [...allEmbeddings.keys()]
const allPairs: Array<[string, string, number]> = []
for (let i = 0; i < allIds.length; i++) {
  for (let j = i + 1; j < allIds.length; j++) {
    allPairs.push([allIds[i]!, allIds[j]!, runtimes.cosineSimilarity(
      allEmbeddings.get(allIds[i]!)!, allEmbeddings.get(allIds[j]!)!)])
  }
}

const twinPair = allPairs.find(p =>
  p[0].startsWith('syn-dense-energetic') && p[1].startsWith('syn-dense-energetic'))!
const nonTwin = allPairs.filter(p => p !== twinPair)

ok('no two unrelated samples collide at cosine > 0.999',
  nonTwin.every(p => p[2] <= 0.999),
  `worst: ${nonTwin.filter(p => p[2] > 0.999).map(p => `${p[0]}~${p[1]}`).join(', ')}`)

ok('the intended near-duplicate pair embeds as the most similar pair',
  nonTwin.every(p => p[2] < twinPair[2]),
  `twin ${twinPair[2].toFixed(4)} vs best other ${Math.max(...nonTwin.map(p => p[2])).toFixed(4)}`)

ok('mean pairwise similarity shows real separation (< 0.5)',
  allPairs.reduce((a, p) => a + p[2], 0) / allPairs.length < 0.5)

ok('digital silence embeds to the zero vector, not a uniform one',
  runtimes.computeEmbeddingStats(allEmbeddings.get('syn-silence')!).l2Norm === 0)

ok('silence is not reported as similar to any other sample',
  allPairs.filter(p => p[0].includes('silence') || p[1].includes('silence'))
    .every(p => p[2] === 0))

// The embedding must respond to spectral content, which is the whole
// point of using the frequency domain.
const bassEmb = allEmbeddings.get('syn-bass-heavy')!
const brightEmb = allEmbeddings.get('syn-bright')!
ok('a 55 Hz-fundamental signal and an 880 Hz one are clearly distinct',
  runtimes.cosineSimilarity(bassEmb, brightEmb) < 0.5,
  `similarity ${runtimes.cosineSimilarity(bassEmb, brightEmb).toFixed(4)}`)

// Samples whose profiles differ only by a genre tag must still differ.
ok('sparse+acoustic and sparse+classical do not generate identical audio',
  !preprocessing.synthesiseAudio(
    datasets.fullSyntheticDataset().samples.find(s => s.sampleId === 'syn-sparse-calm')!, config)
    .every((v, i) => v === preprocessing.synthesiseAudio(
      datasets.fullSyntheticDataset().samples.find(s => s.sampleId === 'syn-tonal-sustained')!,
      config)[i]))

// ---- Embedding maths --------------------------------------------
ok('cosine similarity of a vector with itself is 1',
  near(runtimes.cosineSimilarity(emb1, emb1), 1, 1e-6))
ok('cosine similarity of zero vectors is 0, not NaN',
  runtimes.cosineSimilarity(new Float32Array(8), new Float32Array(8)) === 0)
ok('orthogonal vectors score 0',
  near(runtimes.cosineSimilarity(
    Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0))

const stats = runtimes.computeEmbeddingStats(Float32Array.from([1, -1, 0.5]))
ok('stats report the dimension', stats.dimension === 3)
ok('stats detect finite values', !stats.hasNonFinite)
ok('stats detect NaN',
  runtimes.computeEmbeddingStats(Float32Array.from([1, NaN])).hasNonFinite)
ok('stats detect Infinity',
  runtimes.computeEmbeddingStats(Float32Array.from([1, Infinity])).hasNonFinite)

const aggregated = runtimes.aggregateEmbeddings(
  [Float32Array.from([0, 2]), Float32Array.from([2, 0])], 'mean')
ok('mean aggregation averages component-wise',
  aggregated[0] === 1 && aggregated[1] === 1)
ok('max aggregation takes the maximum',
  runtimes.aggregateEmbeddings(
    [Float32Array.from([0, 2]), Float32Array.from([2, 0])], 'max')[0] === 2)
ok('first aggregation takes the first frame',
  runtimes.aggregateEmbeddings(
    [Float32Array.from([9]), Float32Array.from([1])], 'first')[0] === 9)
ok('aggregating nothing returns an empty vector',
  runtimes.aggregateEmbeddings([], 'mean').length === 0)

// ------------------------------------------------------------
console.log('\n\x1b[1m6. Statistics (§7)\x1b[0m')
// ------------------------------------------------------------

ok('median of an odd list', runner.median([3, 1, 2]) === 2)
ok('median of an even list', runner.median([1, 2, 3, 4]) === 2.5)
ok('median of an empty list is null', runner.median([]) === null)
ok('mean is correct', runner.mean([1, 2, 3]) === 2)
ok('mean of an empty list is null', runner.mean([]) === null)
ok('p95 of 1..100 is 95', runner.percentile(
  Array.from({ length: 100 }, (_, i) => i + 1), 0.95) === 95)
ok('p95 of a single value is that value', runner.percentile([7], 0.95) === 7)
ok('percentile of an empty list is null', runner.percentile([], 0.95) === null)

// ------------------------------------------------------------
console.log('\n\x1b[1m7. Full benchmark run (§13)\x1b[0m')
// ------------------------------------------------------------

const device = {
  label: 'Test harness',
  platform: 'web' as const,
  cpuArchitecture: 'x86_64',
  osVersion: 'Linux',
  totalRamMb: types.unknown('test'),
  isTargetDevice: false,
}

const dataset = datasets.syntheticDataset(6)
const run = await runner.runBenchmark({
  model: refModel,
  dataset,
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 2,
  measuredRuns: 3,
  log: () => {},
})

ok('the run succeeded', run.status === 'SUCCESS', run.status)
ok('every sample produced a result', run.samples.length === dataset.samples.length)
ok('every sample succeeded',
  run.reliability.successfulSamples === dataset.samples.length)
ok('the success rate is 1', run.reliability.successRate === 1)

ok('model load time was measured',
  run.performance.modelLoadMs.confidence === 'MEASURED')
ok('warm-up time was measured separately',
  run.performance.warmupMs.confidence === 'MEASURED')
ok('load time is not folded into inference time',
  run.performance.modelLoadMs.value !== run.performance.averageInferenceMs.value)
ok('median inference was measured',
  run.performance.medianInferenceMs.confidence === 'MEASURED')
ok('p95 is at least the median',
  (run.performance.p95InferenceMs.value ?? 0) >= (run.performance.medianInferenceMs.value ?? 0))
ok('throughput is derived and positive',
  (run.performance.throughputPerSec.value ?? 0) > 0)
ok('total audio duration was accumulated',
  run.performance.totalAudioSec > 0)
ok('the real-time factor was computed',
  run.performance.realTimeFactor.confidence === 'MEASURED')
ok('the reference model runs faster than real time',
  (run.performance.realTimeFactor.value ?? 99) < 1)

ok('CPU usage is honestly reported as not applicable',
  run.cpuUsage.confidence === 'NOT_APPLICABLE')
ok('the CPU note explains the absence',
  (run.cpuUsage.note ?? '').length > 20)

ok('a web run is labelled DESKTOP', run.environment === 'DESKTOP')
ok('quality determinism was measured',
  run.quality.determinism.confidence === 'MEASURED')
ok('the reference model is perfectly deterministic',
  near(run.quality.determinism.value ?? 0, 1, 1e-6))
ok('pairwise similarity was computed',
  run.quality.meanPairwiseSimilarity.confidence === 'MEASURED')
ok('the model distinguishes different synthetic inputs',
  (run.quality.meanPairwiseSimilarity.value ?? 1) < 0.999)

ok('per-sample embedding statistics were recorded',
  run.samples.every(s => s.embeddingStats !== undefined))
ok('no embedding contained a non-finite value',
  run.samples.every(s => !s.embeddingStats?.hasNonFinite))
ok('no sample stored raw audio',
  run.samples.every(s => !('audio' in s)))

ok('the reproducibility record names the model',
  run.reproducibility.modelId === refModel.modelId)
ok('the reproducibility record captures preprocessing',
  run.reproducibility.preprocessing.sampleRate > 0)
ok('the reproducibility record captures repetitions',
  run.reproducibility.warmupRuns === 2 && run.reproducibility.measuredRuns === 3)
ok('the harness version is stamped',
  run.reproducibility.harnessVersion === types.HARNESS_VERSION)

// Repeats must genuinely change the number of measurements taken.
const singleRun = await runner.runBenchmark({
  model: refModel,
  dataset: datasets.syntheticDataset(2),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 0,
  measuredRuns: 1,
  log: () => {},
})
ok('warm-up can be disabled',
  singleRun.performance.warmupMs.confidence === 'NOT_APPLICABLE')
ok('a single-repeat run still produces a median',
  singleRun.performance.medianInferenceMs.confidence === 'MEASURED')

// A nearest-neighbour check needs the full dataset with its twin pair.
const fullRun = await runner.runBenchmark({
  model: refModel,
  dataset: datasets.fullSyntheticDataset(),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 1,
  measuredRuns: 2,
  log: () => {},
})
ok('the nearest-neighbour sanity check ran',
  fullRun.quality.nearestNeighbourSane !== null)
ok('a near-duplicate embeds closer than an unrelated sample',
  fullRun.quality.nearestNeighbourSane === true)
ok('quality notes record the comparison',
  fullRun.quality.notes.some(n => /Nearest-neighbour/.test(n)))

// ------------------------------------------------------------
console.log('\n\x1b[1m8. Failure isolation (§25)\x1b[0m')
// ------------------------------------------------------------

/** A runtime that fails on one specific sample, mid-run. */
class FlakyRuntime {
  readonly id = 'reference' as const
  readonly label = 'Flaky test runtime'
  private calls = 0
  isAvailable() { return true }
  unavailableReason() { return null }
  async load() {
    return { modelId: 'flaky', actualSizeMb: 0, embeddingDimension: 16 }
  }

  async infer(_loaded: unknown, _frame: Float32Array) {
    this.calls++
    if (this.calls === 5) {
      throw new runtimes.InferenceError('OUT_OF_MEMORY', 'Simulated allocation failure.')
    }
    return new Float32Array(16).fill(0.25)
  }

  async release() {}
}

// Injected rather than monkey-patched: ES module exports are
// immutable, and injection is the cleaner contract anyway.
const partial = await runner.runBenchmark({
  model: refModel,
  dataset: datasets.syntheticDataset(6),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 0,
  measuredRuns: 1,
  runtime: new FlakyRuntime() as unknown as typeof reference,
  log: () => {},
})

ok('a mid-run failure yields PARTIAL_SUCCESS', partial.status === 'PARTIAL_SUCCESS',
  partial.status)
ok('the failing sample is recorded as failed',
  partial.reliability.failedSamples === 1)
ok('the other samples still completed',
  partial.reliability.successfulSamples === 5)
ok('the failure reason is preserved',
  partial.samples.some(s => s.errorCode === 'OUT_OF_MEMORY'))
ok('the failure message is human-readable',
  partial.samples.some(s => /allocation failure/.test(s.errorMessage ?? '')))
ok('OOM is mapped to its own status',
  partial.samples.some(s => s.status === 'OUT_OF_MEMORY'))
ok('a partial run still reports timings for what succeeded',
  partial.performance.medianInferenceMs.confidence === 'MEASURED')
ok('the success rate reflects the partial outcome',
  near(partial.reliability.successRate, 5 / 6, 1e-9))

// ---- A model that cannot load at all ----------------------------
const unloadable = await runner.runBenchmark({
  model: registry.getModel('yamnet-1024')!,
  dataset: datasets.syntheticDataset(3),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  log: () => {},
})
ok('a model that cannot load produces a FAILED run, not an exception',
  unloadable.status === 'FAILED')
ok('the load failure is explained',
  (unloadable.performance.modelLoadMs.note ?? '').length > 20)
ok('every sample is marked failed when load failed',
  unloadable.reliability.successfulSamples === 0)
ok('post-load metrics are NOT_APPLICABLE rather than zero',
  unloadable.performance.averageInferenceMs.confidence === 'NOT_APPLICABLE')
ok('the failure appears in run warnings', unloadable.warnings.length > 0)

// ---- Real tracks must never get synthetic audio -----------------
// Regression guard for a genuine bug: the runner synthesised audio
// for EVERY sample, so selecting real music produced real-looking
// numbers that had nothing to do with that music. Silently measuring
// the wrong thing is worse than refusing to measure.

const realDataset = datasets.buildDeviceDataset([
  { id: 'track-1', title: 'Real Song One', durationMs: 200_000 },
  { id: 'track-2', title: 'Real Song Two', durationMs: 180_000 },
])

const withoutProvider = await runner.runBenchmark({
  model: refModel,
  dataset: realDataset,
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 0,
  measuredRuns: 1,
  log: () => {},
})

ok('a real-track dataset with no decoder does NOT silently synthesise',
  withoutProvider.reliability.successfulSamples === 0)
ok('each real sample fails as UNSUPPORTED_INPUT',
  withoutProvider.samples.every(s => s.status === 'UNSUPPORTED_INPUT'))
ok('the failure names the missing decoder',
  withoutProvider.samples.every(s => s.errorCode === 'NO_REAL_AUDIO_SOURCE'))
ok('the failure explains why substitution was refused',
  /synthetic/i.test(withoutProvider.samples[0]?.errorMessage ?? ''))

// With a provider, real samples run normally.
let providerCalls = 0
const withProvider = await runner.runBenchmark({
  model: refModel,
  dataset: realDataset,
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 0,
  measuredRuns: 1,
  realAudioProvider: async (sample, cfg) => {
    providerCalls++
    // Distinct per track, as real decoded audio would be.
    return preprocessing.synthesiseAudio(
      { ...sample, kind: 'synthetic', characteristics: [sample.sampleId] }, cfg)
  },
  log: () => {},
})

ok('a supplied decoder is used for every real sample', providerCalls === 2)
ok('real samples succeed once audio is available',
  withProvider.reliability.successfulSamples === 2)

// A decoder failure on one track must not kill the batch.
const partialReal = await runner.runBenchmark({
  model: refModel,
  dataset: realDataset,
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  warmupRuns: 0,
  measuredRuns: 1,
  realAudioProvider: async (sample, cfg) => {
    if (sample.sampleId.includes('track-2')) {
      throw new runtimes.InferenceError('UNSUPPORTED_INPUT', 'Corrupt codec header.')
    }
    return preprocessing.synthesiseAudio({ ...sample, kind: 'synthetic' }, cfg)
  },
  log: () => {},
})
ok('one undecodable track does not abort the batch',
  partialReal.status === 'PARTIAL_SUCCESS')
ok('the undecodable track keeps its reason',
  partialReal.samples.some(s => /Corrupt codec/.test(s.errorMessage ?? '')))

// ---- An invalid dataset must be refused up front ----------------
let rejected = false
try {
  await runner.runBenchmark({
    model: refModel,
    dataset: { datasetId: 'x', name: 'x', description: '', samples: [] },
    preprocessing: config,
    executionProvider: 'cpu',
    device,
    log: () => {},
  })
} catch {
  rejected = true
}
ok('an empty dataset is refused before any work starts', rejected)

// ------------------------------------------------------------
console.log('\n\x1b[1m9. Comparison rules (§12)\x1b[0m')
// ------------------------------------------------------------

const runA = { ...run }
const runB = { ...run, id: 'run-b', modelId: 'other', modelName: 'Other' }

ok('identical configurations are comparable',
  comparison.assessCompatibility([runA, runB]).level !== 'NOT_COMPARABLE')

const differentDataset = comparison.assessCompatibility([
  runA, { ...runB, datasetId: 'something-else' },
])
ok('a different dataset blocks comparison',
  differentDataset.level === 'NOT_COMPARABLE')
ok('the dataset blocker is explained',
  differentDataset.blockers.some(b => /dataset/i.test(b)))

const mixedEnvironment = comparison.assessCompatibility([
  runA, { ...runB, environment: 'DEVICE' as const },
])
ok('mixing desktop and device blocks comparison',
  mixedEnvironment.level === 'NOT_COMPARABLE')
ok('the environment blocker warns against reading desktop as device',
  mixedEnvironment.blockers.some(b => /desktop/i.test(b)))

const differentPreprocessing = comparison.assessCompatibility([
  runA,
  {
    ...runB,
    reproducibility: {
      ...runB.reproducibility,
      preprocessing: { ...runB.reproducibility.preprocessing, sampleRate: 16_000 },
    },
  },
])
ok('different preprocessing blocks comparison',
  differentPreprocessing.level === 'NOT_COMPARABLE')

const differentProvider = comparison.assessCompatibility([
  runA, { ...runB, executionProvider: 'nnapi' as const },
])
ok('a different provider is a caveat, not a blocker',
  differentProvider.level === 'CAVEATED')

const differentHarness = comparison.assessCompatibility([
  runA,
  { ...runB, reproducibility: { ...runB.reproducibility, harnessVersion: 99 } },
])
ok('a different harness version blocks comparison',
  differentHarness.level === 'NOT_COMPARABLE')

ok('a single run is trivially comparable',
  comparison.assessCompatibility([runA]).level === 'COMPARABLE')

// ---- Targets (§29) ----------------------------------------------
const targetRows = comparison.evaluateTargets(run, types.DEFAULT_TARGETS, 0)
ok('all five targets are evaluated', targetRows.length === 5)
ok('a measured metric produces a verdict',
  targetRows.find(r => r.metric === 'Median inference')?.verdict !== 'UNKNOWN')
ok('success rate is evaluated',
  targetRows.find(r => r.metric === 'Success rate')?.verdict === 'MEETS')
ok('an unmeasured memory figure yields UNKNOWN, not a false pass',
  targetRows.find(r => r.metric === 'Peak memory')?.verdict === 'UNKNOWN')
ok('an unknown model size yields UNKNOWN',
  comparison.evaluateTargets(run, types.DEFAULT_TARGETS, null)
    .find(r => r.metric === 'Model size')?.verdict === 'UNKNOWN')
ok('a missed target is reported as MISSES',
  comparison.evaluateTargets(run, {
    ...types.DEFAULT_TARGETS, maxMedianInferenceMs: 0.0001,
  }, 0).find(r => r.metric === 'Median inference')?.verdict === 'MISSES')

// ---- Recommendations (§28) --------------------------------------
const recommendations = comparison.buildRecommendations([run, fullRun])
ok('four recommendation categories are produced', recommendations.length === 4)
ok('every recommendation states its basis',
  recommendations.every(r => r.basis.length > 10))
ok('the quality recommendation disclaims accuracy',
  /NOT accuracy/i.test(
    recommendations.find(r => r.category === 'BEST_QUALITY')?.reason ?? ''))
ok('the balanced recommendation discloses its weighting',
  /rank/i.test(recommendations.find(r => r.category === 'BALANCED')?.basis ?? ''))
ok('recommendations over no runs return empty candidates',
  comparison.buildRecommendations([]).every(r => r.modelId === null))
ok('a failed run is excluded from recommendations',
  comparison.buildRecommendations([unloadable]).every(r => r.modelId === null))

// ------------------------------------------------------------
console.log('\n\x1b[1m10. Persistence (§11)\x1b[0m')
// ------------------------------------------------------------

store.clearRuns()
ok('the store starts empty', store.loadRuns().length === 0)

store.saveRun(run)
ok('a run persists', store.loadRuns().length === 1)

const reloaded = store.getRun(run.id)
ok('the run round-trips by id', reloaded?.id === run.id)
ok('per-sample results survive the round-trip',
  reloaded?.samples.length === run.samples.length)
ok('per-sample timings survive',
  reloaded?.samples[0]?.inferenceMs === run.samples[0]?.inferenceMs)
ok('embedding statistics survive',
  reloaded?.samples[0]?.embeddingStats?.dimension
  === run.samples[0]?.embeddingStats?.dimension)
ok('metric confidence labels survive',
  reloaded?.performance.medianInferenceMs.confidence === 'MEASURED')
ok('the reproducibility record survives',
  reloaded?.reproducibility.harnessVersion === types.HARNESS_VERSION)

store.saveRun(fullRun)
ok('a second run is retained', store.loadRuns().length === 2)
ok('runs are returned newest first',
  store.loadRuns()[0]!.timestamp >= store.loadRuns()[1]!.timestamp)

store.saveRun({ ...run, status: 'FAILED' })
ok('re-saving the same id replaces rather than duplicates',
  store.loadRuns().filter(r => r.id === run.id).length === 1)
ok('the replacement took effect',
  store.getRun(run.id)?.status === 'FAILED')

store.deleteRun(run.id)
ok('a run can be deleted', store.getRun(run.id) === null)
ok('deleting one run leaves the others', store.loadRuns().length === 1)

// Corrupt data must not break the lab.
memoryAdapter.set(store.BENCHMARK_RUNS_KEY, '{not json')
ok('corrupt stored data yields an empty list, not a crash',
  store.loadRuns().length === 0)
memoryAdapter.set(store.BENCHMARK_RUNS_KEY, JSON.stringify([{ garbage: true }, run]))
ok('malformed entries are filtered out but valid ones survive',
  store.loadRuns().length === 1)

// ---- Export (§20) -----------------------------------------------
store.clearRuns()
store.saveRun(run)
const exported = JSON.parse(store.exportRuns(store.loadRuns()))
ok('the export is versioned', exported.exportVersion === 1)
ok('the export is timestamped', typeof exported.exportedAt === 'string')
ok('the export carries a disclaimer', exported.disclaimer.length > 80)
ok('the export contains the run', exported.runs.length === 1)
ok('the exported filename is descriptive',
  /systema-benchmark-.*\.json/.test(store.exportFilename(store.loadRuns())))

// ---- Production selection (§28) ---------------------------------
store.clearProductionSelection()
ok('no production model is selected by default',
  store.loadProductionSelection() === null)

store.saveProductionSelection({
  selectedModelId: 'yamnet-1024',
  selectedAt: Date.now(),
  justifyingRunId: run.id,
  rationale: 'Smallest candidate that met the latency target on device.',
})
const selection = store.loadProductionSelection()
ok('a selection persists', selection?.selectedModelId === 'yamnet-1024')
ok('the rationale is preserved', (selection?.rationale ?? '').length > 20)
ok('the justifying run is linked', selection?.justifyingRunId === run.id)

store.clearProductionSelection()
ok('a selection can be cleared', store.loadProductionSelection() === null)

// ------------------------------------------------------------
console.log('\n\x1b[1m11. Sustained load (§14)\x1b[0m')
// ------------------------------------------------------------

const sustained = await runner.runSustainedBenchmark({
  model: refModel,
  dataset: datasets.syntheticDataset(1),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  iterations: 12,
  log: () => {},
})
ok('the sustained probe ran the requested iterations', sustained.iterations === 12)
ok('a timing was captured per iteration', sustained.timings.length === 12)
ok('quartile means were computed',
  sustained.firstQuartileMs !== null && sustained.lastQuartileMs !== null)
ok('drift was computed', sustained.driftPercent !== null)
ok('the note disclaims temperature measurement',
  /temperature/i.test(sustained.note))

const capped = await runner.runSustainedBenchmark({
  model: refModel,
  dataset: datasets.syntheticDataset(1),
  preprocessing: config,
  executionProvider: 'cpu',
  device,
  iterations: 10_000,
  log: () => {},
})
ok('sustained iterations are hard-capped for device safety',
  capped.iterations === runner.MAX_SUSTAINED_ITERATIONS)

// ------------------------------------------------------------
console.log(
  `\n\x1b[1mPhase 14 harness: \x1b[32m${passed} passed\x1b[0m`
  + (failed ? `, \x1b[31m${failed} failed\x1b[0m` : '')
  + '\x1b[0m\n',
)
if (failed > 0) process.exit(1)
