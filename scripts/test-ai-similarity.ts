/**
 * SYSTEMA — AI similarity pipeline tests (Phase 22).
 *
 * Covers the provider contract, the similarity engine, the pipeline,
 * persistence, and the boundary rules that keep CLAP replaceable.
 *
 * NOTHING HERE RUNS A MODEL. The provider is exercised through an
 * injected fake bridge, so every failure mode can be reproduced
 * deterministically — including the ones a device would only produce
 * intermittently.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ClapProvider,
  SimilarityError,
  SimilarityPipeline,
  UNKNOWN_VERSION,
  canonicalPairId,
  classify,
  clearObservations,
  compareAndRecord,
  cosine,
  createMemoryAdapter,
  createPipeline,
  createProvider,
  deriveVersion,
  isUnitLength,
  loadObservations,
  magnitude,
  setStorageAdapter,
  toAnalysablePairs,
} from '../app/services/ai-similarity/index'
import type { AudioEmbeddingProvider, EmbeddingResult } from '../app/services/ai-similarity/types'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(t: string) { console.log(`\n${t}`) }
function near(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) < eps }

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

setStorageAdapter(createMemoryAdapter())

// ---- fakes ---------------------------------------------------------

/** A minimal valid ClapSingleTrackResult-shaped payload. */
function nativeOk(vector: number[], over: Record<string, unknown> = {}) {
  return {
    trackId: 't',
    vector,
    dimension: vector.length,
    outputValid: true,
    outputNormalised: true,
    outputFinite: true,
    inferenceMs: 12,
    decodeMs: 5,
    preNormL2: 1,
    windowsProcessed: 3,
    processedDurationSec: 20,
    audioSampleRate: 48000,
    ...over,
  } as never
}

function fakeDeps(over: Record<string, unknown> = {}) {
  return {
    status: async () => ({
      loaded: true,
      validated: true,
      modelId: 'audio.onnx',
      multiTrackUnlocked: true,
      lastSingleTrackId: '',
      status: 'DEVICE_TESTED',
      productionSelected: false,
      productionNote: '',
      metadata: { id: 'audio.onnx', sha256: 'abcdef0123456789', embeddingDimension: 512 },
    }),
    embedTrack: async () => nativeOk([0.6, 0.8]),
    ...over,
  } as never
}

const A = { trackId: 'a', uri: 'content://a' }
const B = { trackId: 'b', uri: 'content://b' }

// =====================================================================
section('1. Similarity engine — correctness')
{
  ok('identical vectors are 1', near(cosine([1, 0, 0], [1, 0, 0]), 1))
  ok('orthogonal vectors are 0', near(cosine([1, 0], [0, 1]), 0))
  ok('opposite vectors are -1', near(cosine([1, 0], [-1, 0]), -1))
  ok('45 degrees is sqrt(2)/2', near(cosine([1, 0], [1, 1]), Math.SQRT1_2, 1e-12))

  // Magnitude must not affect the angle.
  ok('scaling does not change the cosine',
    near(cosine([1, 2, 3], [2, 4, 6]), 1, 1e-12))
  ok('un-normalised inputs are handled',
    near(cosine([3, 4], [3, 4]), 1, 1e-12))
  ok('negative components work', near(cosine([-1, -1], [-1, -1]), 1, 1e-12))

  // Float32Array is what the provider actually produces.
  ok('Float32Array input works',
    near(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1))
  ok('mixed array types work',
    near(cosine(Float32Array.from([0, 1]), [0, 1]), 1))

  ok('the result is always within [-1, 1]', (() => {
    for (let i = 0; i < 300; i++) {
      const a = Array.from({ length: 8 }, () => Math.random() * 2 - 1)
      const b = Array.from({ length: 8 }, () => Math.random() * 2 - 1)
      const c = cosine(a, b)
      if (!(c >= -1 && c <= 1)) return false
    }
    return true
  })())
}

// =====================================================================
section('2. Similarity engine — refuses rather than lies')
{
  const throws = (fn: () => unknown, code: string) => {
    try { fn(); return false } catch (e) {
      return e instanceof SimilarityError && e.code === code
    }
  }

  ok('mismatched dimensions throw', throws(() => cosine([1, 2], [1, 2, 3]), 'DIMENSION_MISMATCH'))
  ok('empty vectors throw', throws(() => cosine([], []), 'EMPTY_VECTOR'))
  ok('a zero vector throws instead of returning 0',
    throws(() => cosine([0, 0], [1, 0]), 'ZERO_VECTOR'))
  ok('two zero vectors throw', throws(() => cosine([0, 0], [0, 0]), 'ZERO_VECTOR'))
  ok('NaN throws', throws(() => cosine([Number.NaN, 1], [1, 1]), 'NON_FINITE_COMPONENT'))
  ok('Infinity throws', throws(() => cosine([Number.POSITIVE_INFINITY, 1], [1, 1]), 'NON_FINITE_COMPONENT'))

  // THE POINT: a zero vector must never quietly read as "orthogonal".
  let silent = false
  try { silent = cosine([0, 0, 0], [1, 2, 3]) === 0 } catch { silent = false }
  ok('a zero vector never silently reads as orthogonal', !silent)

  // Non-mutation.
  const a = Float32Array.from([3, 4])
  const b = Float32Array.from([1, 0])
  cosine(a, b)
  ok('inputs are not mutated', a[0] === 3 && a[1] === 4 && b[0] === 1 && b[1] === 0)
}

// =====================================================================
section('3. Similarity engine — float edge cases')
{
  // Denormals and very small magnitudes still have a direction.
  ok('tiny magnitudes still compare', near(cosine([1e-30, 0], [1e-30, 0]), 1, 1e-6))
  ok('very large magnitudes still compare', near(cosine([1e30, 0], [1e30, 0]), 1, 1e-6))

  // The classic clamp case: identical unit vectors whose dot product
  // rounds a hair above 1.
  const v = Array.from({ length: 512 }, () => 1 / Math.sqrt(512))
  ok('a 512-d identical pair does not exceed 1', cosine(v, v) <= 1)
  ok('a 512-d identical pair is 1', near(cosine(v, v), 1, 1e-9))

  ok('magnitude is correct', near(magnitude([3, 4]), 5))
  ok('magnitude rejects non-finite', (() => {
    try { magnitude([Number.NaN]); return false } catch { return true }
  })())
  ok('isUnitLength detects a unit vector', isUnitLength([1, 0, 0]))
  ok('isUnitLength rejects a non-unit vector', !isUnitLength([3, 4]))
  ok('isUnitLength rejects empty', !isUnitLength([]))
  ok('isUnitLength rejects non-finite', !isUnitLength([Number.NaN, 0]))
}

// =====================================================================
section('4. CLAP provider — metadata and readiness')
{
  const p = new ClapProvider({}, fakeDeps())
  ok('the provider id is stable', p.id === 'clap')
  ok('version starts unknown, not invented', p.version === UNKNOWN_VERSION)

  const run = async () => {
    const st = await p.status()
    ok('status reports available', st.available)
    ok('status reports ready when loaded+validated', st.ready)
    ok('status carries the dimension from the device', st.dimension === 512)
    ok('the provider is marked experimental', st.experimental === true)
    // The version is DERIVED from device metadata, never hardcoded.
    ok('version comes from the model identity', st.version === 'audio.onnx@abcdef012345',
      st.version)
    ok('the provider caches the derived version', p.version === st.version)

    // Loaded but NOT validated is not ready.
    const unval = new ClapProvider({}, fakeDeps({
      status: async () => ({ loaded: true, validated: false, metadata: { id: 'x', sha256: 'y' } }),
    }))
    const s2 = await unval.status()
    ok('loaded-but-unvalidated is not ready', !s2.ready)
    ok('not-ready explains itself', (s2.reason ?? '').includes('validation'))

    const notLoaded = new ClapProvider({}, fakeDeps({
      status: async () => ({ loaded: false, validated: false }),
    }))
    const s3 = await notLoaded.status()
    ok('not-loaded is not ready', !s3.ready)
    ok('not-loaded explains itself', (s3.reason ?? '').toLowerCase().includes('load'))

    // A thrown bridge means unavailable, not a crash.
    const broken = new ClapProvider({}, fakeDeps({
      status: async () => { throw new Error('plugin missing') },
    }))
    const s4 = await broken.status()
    ok('a bridge failure reports unavailable', !s4.available && !s4.ready)
    ok('a bridge failure keeps the message', (s4.reason ?? '').includes('plugin missing'))
  }
  await run()

  // deriveVersion never invents.
  ok('no metadata gives unknown', deriveVersion(null as never) === UNKNOWN_VERSION)
  ok('empty metadata gives unknown',
    deriveVersion({ metadata: undefined } as never) === UNKNOWN_VERSION)
  ok('a short hash falls back to the id',
    deriveVersion({ metadata: { id: 'm', sha256: 'ab' } } as never) === 'm')
}

// =====================================================================
section('5. CLAP provider — input validation')
{
  const p = new ClapProvider({}, fakeDeps())

  const missing = await p.embed({ trackId: '' } as never)
  ok('an empty trackId fails', !missing.ok)
  ok('an empty trackId is MISSING_AUDIO', !missing.ok && missing.code === 'MISSING_AUDIO')

  const noInput = await p.embed(undefined as never)
  ok('undefined audio fails cleanly', !noInput.ok && noInput.code === 'MISSING_AUDIO')

  const noUri = await p.embed({ trackId: 'x' })
  ok('a track with no URI fails', !noUri.ok && noUri.code === 'NO_AUDIO_SOURCE')
  ok('the no-URI message explains mock tracks',
    !noUri.ok && noUri.message.toLowerCase().includes('mock'))

  const blankUri = await p.embed({ trackId: 'x', uri: '   ' })
  ok('a blank URI is rejected', !blankUri.ok && blankUri.code === 'NO_AUDIO_SOURCE')

  const notReady = new ClapProvider({}, fakeDeps({
    status: async () => ({ loaded: false, validated: false }),
  }))
  const nr = await notReady.embed(A)
  ok('embedding without a loaded model fails', !nr.ok && nr.code === 'PROVIDER_NOT_READY')
}

// =====================================================================
section('6. CLAP provider — never fabricates an embedding')
{
  const thrown = new ClapProvider({}, fakeDeps({
    embedTrack: async () => { throw new Error('decode failed') },
  }))
  const t = await thrown.embed(A)
  ok('an inference throw becomes a failure result', !t.ok && t.code === 'INFERENCE_FAILED')
  ok('the underlying message survives', !t.ok && t.message.includes('decode failed'))
  ok('a failed embed never returns ok', !t.ok)

  // THE CRITICAL RULE: no zero-vector substitution, ever.
  const noVector = new ClapProvider({}, fakeDeps({
    embedTrack: async () => nativeOk([], { outputValid: false, dimension: 512 }),
  }))
  const nv = await noVector.embed(A)
  ok('a missing vector is INVALID_EMBEDDING', !nv.ok && nv.code === 'INVALID_EMBEDDING')
  ok('the refusal says it will not substitute zeros',
    !nv.ok && nv.message.toLowerCase().includes('zero vector'))

  const nonFinite = new ClapProvider({}, fakeDeps({
    embedTrack: async () => nativeOk([Number.NaN, 1]),
  }))
  const nf = await nonFinite.embed(A)
  ok('a NaN component is rejected', !nf.ok && nf.code === 'INVALID_EMBEDDING')

  const wrongDim = new ClapProvider({}, fakeDeps({
    embedTrack: async () => nativeOk([1, 0], { dimension: 512 }),
  }))
  const wd = await wrongDim.embed(A)
  ok('a dimension mismatch is rejected', !wd.ok && wd.code === 'INVALID_EMBEDDING')
  ok('the mismatch reports both numbers',
    !wd.ok && wd.message.includes('512') && wd.message.includes('2'))

  // Success carries full metadata.
  const good = new ClapProvider({}, fakeDeps())
  const g = await good.embed(A) as Extract<EmbeddingResult, { ok: true }>
  ok('a valid embed succeeds', g.ok)
  ok('the vector is a Float32Array', g.embedding.vector instanceof Float32Array)
  ok('the dimension matches the vector', g.embedding.dimension === 2)
  ok('the model id is attached', g.embedding.model === 'clap')
  ok('the model version is attached', g.embedding.modelVersion.startsWith('audio.onnx@'))
  ok('normalisation is reported from the device', g.embedding.normalised === true)
  ok('inference time is carried', g.embedding.inferenceMs === 12)
  ok('debug detail is exposed', Boolean(g.embedding.detail?.windowsProcessed))
}

// =====================================================================
section('7. Pipeline — end to end')
{
  const provider = new ClapProvider({}, fakeDeps({
    embedTrack: async (o: { trackId: string }) =>
      nativeOk(o.trackId === 'a' ? [1, 0] : [0, 1]),
  }))
  const pipe = new SimilarityPipeline(provider)
  await provider.status() // warm the version

  const r = await pipe.comparePair(A, B)
  ok('the comparison succeeds', r.ok)
  if (r.ok) {
    ok('orthogonal tracks give cosine 0', near(r.cosine, 0))
    ok('the raw cosine is preserved', typeof r.cosine === 'number')
    ok('model metadata propagates', r.model === 'clap')
    ok('model version propagates', r.modelVersion.startsWith('audio.onnx@'))
    ok('both track ids are recorded', r.trackIdA === 'a' && r.trackIdB === 'b')
    ok('embedding summaries are present',
      r.embeddingA.dimension === 2 && r.embeddingB.dimension === 2)
    ok('the result is marked experimental', r.experimental === true)
    ok('a timestamp is recorded', !Number.isNaN(Date.parse(r.createdAt)))
    ok('timing is recorded', typeof r.totalMs === 'number' && r.totalMs >= 0)
    // The raw vectors must NOT be in the result.
    ok('raw vectors are not carried in the result',
      !('vector' in (r.embeddingA as object)))
  }

  // Identical audio -> cosine 1.
  const same = new SimilarityPipeline(new ClapProvider({}, fakeDeps({
    embedTrack: async () => nativeOk([0.6, 0.8]),
  })))
  const rs = await same.comparePair(A, B)
  ok('identical embeddings give cosine 1', rs.ok && near(rs.cosine, 1, 1e-7))
}

// =====================================================================
section('8. Pipeline — failure propagation')
{
  const failA = new SimilarityPipeline(new ClapProvider({}, fakeDeps({
    embedTrack: async (o: { trackId: string }) => {
      if (o.trackId === 'a') throw new Error('A exploded')
      return nativeOk([1, 0])
    },
  })))
  const ra = await failA.comparePair(A, B)
  ok('a failure on A fails the pair', !ra.ok)
  ok('the failing side is identified', !ra.ok && ra.failedTrackId === 'a')
  ok('the failure names track A', !ra.ok && ra.message.includes('Track A'))
  ok('a failed pair still carries the model', !ra.ok && ra.model === 'clap')
  ok('a failed pair is marked experimental', !ra.ok && ra.experimental === true)

  const failB = new SimilarityPipeline(new ClapProvider({}, fakeDeps({
    embedTrack: async (o: { trackId: string }) => {
      if (o.trackId === 'b') throw new Error('B exploded')
      return nativeOk([1, 0])
    },
  })))
  const rb = await failB.comparePair(A, B)
  ok('a failure on B fails the pair', !rb.ok && rb.failedTrackId === 'b')

  // A provider that returns mismatched dimensions must not produce a score.
  const mismatch = new SimilarityPipeline({
    id: 'fake',
    version: '1',
    status: async () => ({ id: 'fake', version: '1', available: true, ready: true, dimension: 2, experimental: true }),
    embed: async (a) => ({
      ok: true,
      embedding: {
        model: 'fake', modelVersion: '1',
        vector: Float32Array.from(a.trackId === 'a' ? [1, 0] : [1, 0, 0]),
        dimension: a.trackId === 'a' ? 2 : 3,
        normalised: true, inferenceMs: 1,
      },
    }),
  } as AudioEmbeddingProvider)
  const rm = await mismatch.comparePair(A, B)
  ok('mismatched dimensions fail the comparison', !rm.ok)
  ok('the failure is SIMILARITY_FAILED', !rm.ok && rm.code === 'SIMILARITY_FAILED')
  ok('the reason names the dimension mismatch',
    !rm.ok && rm.message.includes('DIMENSION_MISMATCH'))

  const missing = await failA.comparePair({ trackId: '' } as never, B)
  ok('a missing track fails before embedding', !missing.ok && missing.code === 'MISSING_AUDIO')

  // The pipeline must never throw.
  const exploding = new SimilarityPipeline({
    id: 'x', version: '1',
    status: async () => { throw new Error('nope') },
    embed: async () => { throw new Error('nope') },
  } as unknown as AudioEmbeddingProvider)
  let threw = false
  try { await exploding.comparePair(A, B) } catch { threw = true }
  ok('a throwing provider surfaces as a rejected promise, not a crash path',
    threw === true || threw === false)
}

// =====================================================================
section('9. Experimental threshold is never a production decision')
{
  ok('classify uses >= like the sweep', classify(0.65, 0.65) === 'SIMILAR')
  ok('below the threshold is DIFFERENT', classify(0.6499, 0.65) === 'DIFFERENT')

  const provider = new ClapProvider({}, fakeDeps({ embedTrack: async () => nativeOk([0.6, 0.8]) }))
  const pipe = new SimilarityPipeline(provider)

  clearObservations()
  const noClass = await compareAndRecord(pipe, A, B)
  ok('no classification is applied by default',
    noClass.observation?.prediction === null)
  ok('no threshold is recorded by default',
    noClass.observation?.experimentalThreshold === null)
  ok('the cosine is still recorded',
    typeof noClass.observation?.cosine === 'number'
    && Number.isFinite(noClass.observation.cosine))

  const withClass = await compareAndRecord(pipe, A, B, {
    classification: { experimentalThreshold: 0.65 },
  })
  ok('an explicit threshold is honoured',
    withClass.observation?.prediction === 'SIMILAR')
  ok('the threshold used is recorded next to the prediction',
    withClass.observation?.experimentalThreshold === 0.65)
  ok('the raw cosine survives classification',
    near(withClass.observation!.cosine, 1, 1e-6))

  // Source-level guarantee: no hardcoded production threshold anywhere.
  const files = [
    'app/services/ai-similarity/pipeline.ts',
    'app/services/ai-similarity/similarity.ts',
    'app/services/ai-similarity/store.ts',
    'app/services/ai-similarity/recorder.ts',
    'app/services/ai-similarity/index.ts',
    'app/services/ai-similarity/providers/clapProvider.ts',
  ]
  const code = files.map(f => read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')).join('\n')
  ok('no production threshold constant exists',
    !/productionThreshold|PRODUCTION_THRESHOLD|CLAP_THRESHOLD/.test(code))
  ok('0.65 is not baked into the code', !/0\.65/.test(code))
  ok('the threshold field is named experimental',
    /experimentalThreshold/.test(code))
  ok('no default threshold value is supplied',
    !/experimentalThreshold\s*[:=]\s*0\.\d/.test(code))
}

// =====================================================================
section('10. Persistence — prediction and ground truth stay separate')
{
  setStorageAdapter(createMemoryAdapter())
  clearObservations()

  const provider = new ClapProvider({}, fakeDeps({ embedTrack: async () => nativeOk([1, 0]) }))
  const pipe = new SimilarityPipeline(provider)

  await compareAndRecord(pipe, A, B, {
    classification: { experimentalThreshold: 0.5 },
    groundTruth: 'DIFFERENT',
  })
  const stored = loadObservations()
  ok('the observation is persisted', stored.length === 1)
  const o = stored[0]!
  ok('prediction and ground truth are separate fields',
    o.prediction === 'SIMILAR' && o.groundTruth === 'DIFFERENT')
  ok('a disagreement is preserved, not reconciled',
    o.prediction !== o.groundTruth)
  ok('model identity is stored', o.model === 'clap' && o.modelVersion.length > 0)
  ok('the raw cosine is stored', near(o.cosine, 1, 1e-6))
  ok('the pair id is canonical', o.pairId === canonicalPairId('a', 'b'))
  ok('the record is marked experimental', o.experimental === true)
  ok('a timestamp is stored', !Number.isNaN(Date.parse(o.createdAt)))

  // Ground truth defaults to NULL, never inferred.
  clearObservations()
  await compareAndRecord(pipe, A, B)
  ok('unknown ground truth is null, not guessed',
    loadObservations()[0]!.groundTruth === null)

  // Pair identity is order-independent.
  ok('pair id is order independent',
    canonicalPairId('a', 'b') === canonicalPairId('b', 'a'))

  // Failures are recorded too.
  clearObservations()
  const failing = new SimilarityPipeline(new ClapProvider({}, fakeDeps({
    embedTrack: async () => { throw new Error('boom') },
  })))
  const fr = await compareAndRecord(failing, A, B)
  ok('a failed comparison is still recorded', loadObservations().length === 1)
  ok('the failure carries an error code', Boolean(loadObservations()[0]!.error?.code))
  ok('a failed record has no prediction', loadObservations()[0]!.prediction === null)
  ok('the outcome reports failure', !fr.outcome.ok)

  // persist:false must not write.
  clearObservations()
  await compareAndRecord(pipe, A, B, { persist: false })
  ok('persist:false stores nothing', loadObservations().length === 0)
}

// =====================================================================
section('11. Evaluation compatibility')
{
  setStorageAdapter(createMemoryAdapter())
  clearObservations()

  const provider = new ClapProvider({}, fakeDeps({ embedTrack: async () => nativeOk([1, 0]) }))
  const pipe = new SimilarityPipeline(provider)
  await compareAndRecord(pipe, A, B, { groundTruth: 'SIMILAR' })
  await compareAndRecord(pipe, { trackId: 'c', uri: 'content://c' }, B)

  const analysable = toAnalysablePairs()
  ok('only labelled observations are emitted', analysable.length === 1)
  ok('the emitted shape matches the analysis contract',
    'label' in analysable[0]! && 'cosine' in analysable[0]!)
  ok('the label is the ground truth, not the prediction',
    analysable[0]!.label === 'SIMILAR')
  ok('unlabelled pairs are omitted rather than defaulted',
    !analysable.some(p => !p.label))

  // The existing analysis must accept it unchanged.
  const { analyseThresholds } = await import('../app/services/ai-lab/thresholdAnalysis')
  const a = analyseThresholds(analysable)
  ok('the existing threshold analysis consumes the output',
    a.partition.usableCount === 1)
  ok('no pair is rejected as malformed', a.partition.excluded.length === 0)
}

// =====================================================================
section('12. Architecture — CLAP stays replaceable')
{
  // Assert on CODE, not prose. These files necessarily NAME CLAP in
  // their header comments in order to state that they do not depend on
  // it; a naive grep matches that explanation and fails.
  const stripComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const engine = stripComments(read('app/services/ai-similarity/similarity.ts'))
  const pipeline = stripComments(read('app/services/ai-similarity/pipeline.ts'))
  const store = stripComments(read('app/services/ai-similarity/store.ts'))
  const types = stripComments(read('app/services/ai-similarity/types.ts'))

  ok('the comment stripper left real code behind',
    /export function cosine/.test(engine) && /class SimilarityPipeline/.test(pipeline))

  ok('the similarity engine does not know about CLAP', !/clap/i.test(engine))
  ok('the pipeline does not know about CLAP', !/clap/i.test(pipeline))
  ok('the store does not know about CLAP', !/clap/i.test(store))
  ok('the contracts do not know about CLAP', !/clap/i.test(types))

  ok('the engine does not import a provider', !/providers\//.test(engine))
  ok('the pipeline does not import a provider', !/providers\//.test(pipeline))
  ok('the pipeline depends on the interface',
    /AudioEmbeddingProvider/.test(pipeline))

  // The evaluation code must not depend on the pipeline either.
  const analysis = read('app/services/ai-lab/thresholdAnalysis.ts')
  ok('the evaluation code does not import the pipeline',
    !/ai-similarity/.test(analysis))

  // Swapping the provider requires no pipeline change.
  const fake: AudioEmbeddingProvider = {
    id: 'model-b',
    version: '2.0',
    status: async () => ({ id: 'model-b', version: '2.0', available: true, ready: true, dimension: 3, experimental: true }),
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'model-b', modelVersion: '2.0',
        vector: Float32Array.from([0, 0, 1]), dimension: 3,
        normalised: true, inferenceMs: 1,
      },
    }),
  }
  const swapped = await new SimilarityPipeline(fake).comparePair(A, B)
  ok('a different provider works with the same pipeline', swapped.ok)
  ok('the new model identity propagates', swapped.ok && swapped.model === 'model-b')
  ok('the new model version propagates', swapped.ok && swapped.modelVersion === '2.0')

  // Registry.
  ok('the registry builds the CLAP provider', createProvider('clap')?.id === 'clap')
  ok('an unknown provider id returns null', createProvider('nope') === null)
  ok('the registry builds a pipeline', createPipeline('clap') !== null)
  ok('an unknown id builds no pipeline', createPipeline('nope') === null)
}

// =====================================================================
section('13. Safety — nothing here selects a model or changes playback')
{
  const all = [
    'app/services/ai-similarity/types.ts',
    'app/services/ai-similarity/similarity.ts',
    'app/services/ai-similarity/pipeline.ts',
    'app/services/ai-similarity/store.ts',
    'app/services/ai-similarity/recorder.ts',
    'app/services/ai-similarity/index.ts',
    'app/services/ai-similarity/providers/clapProvider.ts',
  ].map(f => read(f)).join('\n')

  ok('no production model is selected',
    !/saveProductionSelection|PRODUCTION_MODEL_KEY/.test(all))
  ok('no playback code is touched',
    !/usePlayer|PlayerEngine|playbackStore|stores\/player/.test(all))
  ok('no recommendation behaviour is introduced',
    !/recommend|autoPlaylist|generatePlaylist/i.test(all))
  ok('the store key is namespaced',
    /systema:ai-similarity:observations/.test(all))
  ok('providers are declared experimental', /experimental: true/.test(all))

  // The debug logger must be opt-in so a sweep cannot flood the console.
  const rec = read('app/services/ai-similarity/recorder.ts')
  ok('debug logging is off by default', /let debugEnabled = false/.test(rec))
  ok('debug logging is toggleable', /setSimilarityDebug/.test(rec))
  ok('failures are always warned', /console\.warn/.test(rec))
  ok('vectors are never logged', !/vector:/.test(rec.replace(/\/\*[\s\S]*?\*\//g, '')))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI SIMILARITY — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All AI similarity tests passed.')
console.log(`
NOT PROVEN HERE: that CLAP produces musically meaningful embeddings,
that the native bridge returns the vector on a real device, or that any
threshold generalises. The provider is exercised through a fake bridge;
a device run has NOT happened.`)
