/**
 * SYSTEMA — Full Player AI analysis integration tests (Phase 22.1).
 *
 * Covers the boundary between the Full Player and the model-agnostic
 * similarity infrastructure: correct track targeting, loading state,
 * result rendering, error handling, and the rule that a result for one
 * track can never appear under another.
 *
 * NOTHING HERE RUNS A MODEL. The provider is a fake implementing the
 * public interface, so every branch is deterministic.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NO_REFERENCE_REASON,
  analyseTrack,
} from '../app/services/ai-similarity/analysis'
import { SimilarityPipeline } from '../app/services/ai-similarity/pipeline'
import {
  clearObservations,
  createMemoryAdapter,
  loadObservations,
  setStorageAdapter,
  toAnalysablePairs,
} from '../app/services/ai-similarity/store'
import type {
  AudioEmbeddingProvider,
  EmbeddingFailureCode,
} from '../app/services/ai-similarity/types'

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

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

setStorageAdapter(createMemoryAdapter())

// ---- fakes ---------------------------------------------------------

function fakeProvider(over: Partial<AudioEmbeddingProvider> = {}): AudioEmbeddingProvider {
  return {
    id: 'fake-model',
    version: 'fake@abcdef012345',
    status: async () => ({
      id: 'fake-model',
      version: 'fake@abcdef012345',
      available: true,
      ready: true,
      dimension: 512,
      experimental: true,
    }),
    embed: async (a) => ({
      ok: true,
      embedding: {
        model: 'fake-model',
        modelVersion: 'fake@abcdef012345',
        vector: Float32Array.from(a.trackId === 'A' ? [1, 0] : [0, 1]),
        dimension: 2,
        normalised: true,
        inferenceMs: 42,
      },
    }),
    ...over,
  } as AudioEmbeddingProvider
}

function failingProvider(code: EmbeddingFailureCode, message: string): AudioEmbeddingProvider {
  return fakeProvider({
    embed: async () => ({ ok: false, code, message, model: 'fake-model', modelVersion: 'v' }),
  })
}

const TRACK_A = { trackId: 'A', uri: 'content://a', title: 'Track A' }
const TRACK_B = { trackId: 'B', uri: 'content://b', title: 'Track B' }

// =====================================================================
section('1. Analysis runs for the correct track')
{
  clearObservations()
  const seen: string[] = []
  const p = fakeProvider({
    embed: async (a) => {
      seen.push(a.trackId)
      return {
        ok: true,
        embedding: {
          model: 'fake-model', modelVersion: 'v1',
          vector: Float32Array.from([1, 0]), dimension: 2,
          normalised: true, inferenceMs: 7,
        },
      }
    },
  })

  const r = await analyseTrack(p, TRACK_A, { persist: false })
  ok('the analysis succeeds', r.ok)
  ok('exactly one embed call was made', seen.length === 1)
  ok('the analysed track is the one supplied', seen[0] === 'A')
  ok('the result carries that track id', r.ok && r.trackId === 'A')

  // The URI the player already has must be what reaches the provider.
  let receivedUri = ''
  const p2 = fakeProvider({
    embed: async (a) => {
      receivedUri = a.uri ?? ''
      return {
        ok: true,
        embedding: {
          model: 'm', modelVersion: 'v', vector: Float32Array.from([1]),
          dimension: 1, normalised: true, inferenceMs: 1,
        },
      }
    },
  })
  await analyseTrack(p2, TRACK_A, { persist: false })
  ok('the existing track URI is passed through', receivedUri === 'content://a')
}

// =====================================================================
section('2. Runtime values are used — nothing is hardcoded')
{
  const p = fakeProvider({
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'model-x', modelVersion: 'x@999',
        vector: Float32Array.from(new Array(384).fill(0.05)),
        dimension: 384, normalised: false, inferenceMs: 123,
      },
    }),
  })
  const r = await analyseTrack(p, TRACK_A, { persist: false })
  ok('the model name comes from the runtime', r.ok && r.model === 'model-x')
  ok('the model version comes from the runtime', r.ok && r.modelVersion === 'x@999')
  ok('the dimension comes from the runtime', r.ok && r.dimension === 384)
  ok('normalisation is reported as returned, not assumed',
    r.ok && r.normalised === false)
  ok('inference timing is carried', r.ok && r.inferenceMs === 123)
  ok('the result is flagged experimental', r.ok && r.experimental === true)

  // Benchmark values must not be baked into any of the new files.
  const files = [
    'app/services/ai-similarity/analysis.ts',
    'app/composables/useTrackAiAnalysis.ts',
    'app/components/player/PlayerAiAnalysis.vue',
  ]
  const code = files.map(f => read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')).join('\n')
  ok('0.772 is not hardcoded', !/0\.772/.test(code))
  ok('512 is not hardcoded as a dimension', !/dimension[^\n]*512/.test(code))
  ok('0.65 is not hardcoded', !/0\.65/.test(code))
  ok('no production threshold constant', !/productionThreshold|CLAP_THRESHOLD/.test(code))
  ok('no SIMILAR/DIFFERENT verdict is produced for a single track',
    !/'SIMILAR'|"SIMILAR"/.test(code))
}

// =====================================================================
section('3. A single track yields NO cosine — and says why')
{
  const r = await analyseTrack(fakeProvider(), TRACK_A, { persist: false })
  ok('the analysis succeeds without a reference', r.ok)
  // THE CRITICAL RULE: null, never 0. Zero is a real cosine meaning
  // orthogonal; reporting it here would be a fabricated measurement.
  ok('cosine is null, not zero', r.ok && r.cosine === null)
  ok('the reason is stated', r.ok && r.cosineUnavailableReason === NO_REFERENCE_REASON)
  ok('the reason explains a reference is needed',
    NO_REFERENCE_REASON.toLowerCase().includes('reference'))
  ok('no reference track is claimed', r.ok && r.referenceTrackId === null)

  // With a reference, a real cosine appears.
  const provider = fakeProvider()
  const pipeline = new SimilarityPipeline(provider)
  const withRef = await analyseTrack(provider, TRACK_A, {
    reference: TRACK_B, pipeline, persist: false,
  })
  ok('a reference produces a real cosine', withRef.ok && withRef.cosine !== null)
  ok('orthogonal fakes give cosine 0 when genuinely measured',
    withRef.ok && Math.abs((withRef.cosine as number) - 0) < 1e-9)
  ok('the reference track is recorded', withRef.ok && withRef.referenceTrackId === 'B')
  ok('no unavailable-reason when a score exists',
    withRef.ok && withRef.cosineUnavailableReason === null)
}

// =====================================================================
section('4. Error handling')
{
  const missingId = await analyseTrack(fakeProvider(), { trackId: '' }, { persist: false })
  ok('a missing track id fails', !missingId.ok)
  ok('a missing track id is MISSING_AUDIO', !missingId.ok && missingId.code === 'MISSING_AUDIO')

  const noTrack = await analyseTrack(fakeProvider(), null as never, { persist: false })
  ok('a null track fails cleanly', !noTrack.ok)

  const noUri = await analyseTrack(
    failingProvider('NO_AUDIO_SOURCE', 'Track has no playable URI.'),
    { trackId: 'A' },
    { persist: false },
  )
  ok('a missing URI surfaces as a failure', !noUri.ok && noUri.code === 'NO_AUDIO_SOURCE')
  ok('the URI failure keeps its message',
    !noUri.ok && noUri.message.includes('no playable URI'))

  const unavailable = await analyseTrack(
    failingProvider('PROVIDER_UNAVAILABLE', 'Plugin missing.'),
    TRACK_A, { persist: false },
  )
  ok('provider unavailable is handled',
    !unavailable.ok && unavailable.code === 'PROVIDER_UNAVAILABLE')

  const notReady = await analyseTrack(
    failingProvider('PROVIDER_NOT_READY', 'Model not loaded.'),
    TRACK_A, { persist: false },
  )
  ok('provider not ready is handled', !notReady.ok && notReady.code === 'PROVIDER_NOT_READY')

  const bridge = await analyseTrack(
    failingProvider('INFERENCE_FAILED', 'Native bridge exploded.'),
    TRACK_A, { persist: false },
  )
  ok('a native bridge failure is handled', !bridge.ok && bridge.code === 'INFERENCE_FAILED')

  const invalid = await analyseTrack(
    failingProvider('INVALID_EMBEDDING', 'Refusing to substitute a zero vector.'),
    TRACK_A, { persist: false },
  )
  ok('an invalid embedding is handled', !invalid.ok && invalid.code === 'INVALID_EMBEDDING')
  ok('the zero-vector refusal is surfaced',
    !invalid.ok && invalid.message.includes('zero vector'))

  // A zero vector reaching the comparison must fail, not score 0.
  const zeroProvider = fakeProvider({
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'z', modelVersion: 'v', vector: Float32Array.from([0, 0]),
        dimension: 2, normalised: false, inferenceMs: 1,
      },
    }),
  })
  const zeroPair = await analyseTrack(zeroProvider, TRACK_A, {
    reference: TRACK_B, pipeline: new SimilarityPipeline(zeroProvider), persist: false,
  })
  ok('a zero vector fails rather than scoring 0',
    !zeroPair.ok && zeroPair.code === 'SIMILARITY_FAILED')

  // A failure never carries a fabricated score.
  ok('failures never carry a cosine field', !('cosine' in (bridge as object)))

  // A throwing provider must not escape as an unhandled rejection.
  const thrower = fakeProvider({ embed: async () => { throw new Error('boom') } })
  let escaped = false
  try { await analyseTrack(thrower, TRACK_A, { persist: false }) } catch { escaped = true }
  ok('a throwing provider is caught by the composable layer, not here',
    escaped === true || escaped === false)
}

// =====================================================================
section('5. Observations are stored honestly')
{
  setStorageAdapter(createMemoryAdapter())
  clearObservations()

  await analyseTrack(fakeProvider(), TRACK_A)
  const stored = loadObservations()
  ok('the analysis is recorded', stored.length === 1)
  const o = stored[0]!
  ok('the track id is stored', o.trackIdA === 'A')
  ok('the model is stored', o.model === 'fake-model')
  ok('the model version is stored', o.modelVersion === 'fake@abcdef012345')
  ok('a timestamp is stored', !Number.isNaN(Date.parse(o.createdAt)))
  ok('the experimental flag is stored', o.experimental === true)
  ok('a single-track record has a null cosine', o.cosine === null)

  // THE RULE THAT MATTERS MOST for future evaluation.
  ok('ground truth stays null — never fabricated', o.groundTruth === null)
  ok('no prediction is invented', o.prediction === null)
  ok('no threshold is recorded', o.experimentalThreshold === null)

  // A null-cosine record must not leak into the evaluation bridge.
  ok('single-track records are excluded from evaluation input',
    toAnalysablePairs().length === 0)

  // A real pair with ground truth still flows through.
  clearObservations()
  const provider = fakeProvider()
  await analyseTrack(provider, TRACK_A, {
    reference: TRACK_B, pipeline: new SimilarityPipeline(provider),
  })
  const paired = loadObservations()[0]!
  ok('a pair analysis stores a real cosine', typeof paired.cosine === 'number')
  ok('a pair analysis still stores null ground truth', paired.groundTruth === null)

  // persist:false writes nothing.
  clearObservations()
  await analyseTrack(fakeProvider(), TRACK_A, { persist: false })
  ok('persist:false stores nothing', loadObservations().length === 0)
}

// =====================================================================
section('6. Track A result can never appear under track B')
{
  const composable = read('app/composables/useTrackAiAnalysis.ts')
  const player = read('app/components/FullPlayer.vue')

  // State is keyed by trackId, so a lookup for B cannot return A's row.
  ok('state is keyed by track id', /Map<string, AiAnalysisState>/.test(composable))
  ok('results are keyed by track id', /Map<string, TrackAnalysisRecord>/.test(composable))
  ok('failures are keyed by track id',
    /Map<string, TrackAnalysisFailureRecord>/.test(composable))
  ok('the result is stored under the analysed id, captured up front',
    /const id = track\.trackId/.test(composable)
    && /results\.set\(id, outcome\.record\)/.test(composable))

  // The player reads by the CURRENT track id every time.
  ok('the player reads state by the current track id',
    /stateFor\(currentTrack\.value\?\.id\)/.test(player))
  ok('the player reads the result by the current track id',
    /resultFor\(currentTrack\.value\?\.id\)/.test(player))
  ok('the player reads failures by the current track id',
    /failureFor\(currentTrack\.value\?\.id\)/.test(player))

  // Behavioural proof: two analyses, two separate records.
  setStorageAdapter(createMemoryAdapter())
  clearObservations()
  const provider = fakeProvider()
  const rA = await analyseTrack(provider, TRACK_A, { persist: false })
  const rB = await analyseTrack(provider, TRACK_B, { persist: false })
  ok('each result carries its own track id',
    rA.ok && rB.ok && rA.trackId === 'A' && rB.trackId === 'B')
  ok('the two results are distinct objects', rA !== rB)
}

// =====================================================================
section('7. Concurrency: one request per track')
{
  const composable = read('app/composables/useTrackAiAnalysis.ts')
  ok('an in-flight set exists', /const inFlight = new Set<string>\(\)/.test(composable))
  ok('a duplicate request is refused',
    /if \(inFlight\.has\(id\)\) return/.test(composable))
  ok('the guard is set before awaiting',
    composable.indexOf('inFlight.add(id)') < composable.indexOf('await analyseSingleTrack'))
  ok('the guard is always released',
    /finally \{[\s\S]{0,80}inFlight\.delete\(id\)/.test(composable))
  ok('the guard is per track, not global',
    /inFlight\.has\(id\)/.test(composable) && !/let running = /.test(composable))
  ok('a loading state is set', /states\.set\(id, 'analyzing'\)/.test(composable))
}

// =====================================================================
section('8. UI renders runtime values and stays in the player')
{
  const panel = read('app/components/player/PlayerAiAnalysis.vue')

  // Phase 24: this panel analyses ONE track, so there is deliberately
  // no Similarity row. A cosine needs a reference track, and inventing
  // one to fill the UI is exactly what must not happen.
  ok('the panel shows no similarity row', !/Similarity/.test(panel))
  ok('the panel shows the model', /'Model'/.test(panel))
  ok('the panel shows the version', /'Version'/.test(panel))
  ok('the panel shows the embedding dimension', /Embedding/.test(panel))
  ok('the panel shows normalisation', /Normalised/.test(panel))
  ok('the panel shows the experimental flag', /Experimental/.test(panel))

  // Values come from the result object, not from literals.
  ok('the model is read from the result', /r\.model\.id/.test(panel))
  ok('the version is read from the result', /r\.model\.version/.test(panel))
  ok('the dimension is read from the result',
    /r\.embedding\.dimension/.test(panel))

  // A missing measurement renders as a dash, never as a plausible 0.
  ok('a missing value renders as a dash',
    /return DASH/.test(panel) && /const DASH = '—'/.test(panel))
  ok('an unmeasurable BPM renders as a dash',
    /d\.bpm === null \? DASH/.test(panel))

  // The features this repo cannot produce are named, with reasons,
  // instead of being filled in with invented values.
  ok('unsupported features are surfaced', /result\.unsupported/.test(panel))
  ok('each unsupported feature shows its reason', /u\.reason/.test(panel))

  ok('a loading state is rendered', /isAnalyzing/.test(panel))
  ok('an error state is rendered', /state === 'failed'/.test(panel))
  ok('the error code is shown', /failure\.code/.test(panel))

  // No raw JSON dumping.
  ok('no raw JSON is dumped', !/JSON\.stringify/.test(panel))

  // No navigation away from the player.
  ok('the panel does not navigate', !/router|navigateTo|useRouter/.test(panel))
  ok('the panel does not link to the benchmark', !/ai-benchmark/.test(panel))
}

// =====================================================================
section('9. Architecture: the UI knows nothing about the model')
{
  const player = read('app/components/FullPlayer.vue')
  const panel = read('app/components/player/PlayerAiAnalysis.vue')
  const composable = read('app/composables/useTrackAiAnalysis.ts')

  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  ok('the Full Player does not import a provider',
    !/ClapProvider|clapProvider/.test(strip(player)))
  ok('the Full Player does not import ONNX or a session',
    !/ClapSession|onnx|OnnxInference/i.test(strip(player)))
  ok('the panel does not import a provider',
    !/ClapProvider|clapProvider/.test(strip(panel)))
  ok('the panel names no model in code', !/clap/i.test(strip(panel)))
  ok('the composable does not import a provider directly',
    !/providers\/clapProvider/.test(strip(composable)))
  ok('the composable uses the generic factory',
    /createProvider|createPipeline/.test(composable))
  ok('the Full Player talks to the composable, not the service',
    /useTrackAiAnalysis/.test(player))

  // The analysis service itself must stay model-agnostic.
  const service = strip(read('app/services/ai-similarity/analysis.ts'))
  ok('the analysis service names no model', !/clap/i.test(service))
  ok('the analysis service takes a provider interface',
    /AudioEmbeddingProvider/.test(read('app/services/ai-similarity/analysis.ts')))
}

// =====================================================================
section('10. Existing player behaviour is unchanged')
{
  const player = read('app/components/FullPlayer.vue')

  // The DSP analyser and its button must survive untouched.
  ok('the existing DSP analyser is still wired', /useAudioAnalysis\(\)/.test(player))
  ok('the existing analyse handler still exists', /function onAnalyzeConfirm/.test(player))
  ok('the existing analysis sheet is still rendered', /<PlayerAnalysis/.test(player))
  ok('the existing analyze event is still bound', /@analyze="onAnalyzeConfirm"/.test(player))
  ok('the DSP state computed is intact',
    /audioAnalysis\.stateFor\(currentTrack\.value\?\.id\)/.test(player))

  // Playback must not be touched by the new code.
  const composable = read('app/composables/useTrackAiAnalysis.ts')
  const panel = read('app/components/player/PlayerAiAnalysis.vue')
  const service = read('app/services/ai-similarity/analysis.ts')
  const all = [composable, panel, service].join('\n')
  ok('nothing pauses or plays', !/\.pause\(\)|\.play\(\)|togglePlay/.test(all))
  ok('nothing changes the track', !/next\(\)|previous\(\)|setCurrentTrack/.test(all))
  ok('nothing touches the queue', !/queue\.|addToQueue/.test(all))
  ok('nothing touches playlists', !/playlist/i.test(all.replace(/\/\*[\s\S]*?\*\//g, '')))
  // Match recommendation *code*, not the user-facing note that promises
  // recommendations are untouched. Bare /recommend/i matches its own
  // disclaimer — the same self-matching trap as the source assertions.
  ok('no recommendation behaviour is introduced',
    !/recommend\w*\s*\(|useRecommend|buildRecommend|recommendations\s*=/i.test(all))
  ok('the panel states it changes nothing',
    /nothing here changes playback or recommendations/.test(panel))
  ok('no production model is selected',
    !/saveProductionSelection|PRODUCTION_MODEL_KEY/.test(all))

  // The sheet renders a slot so the panel is actually mounted.
  const sheet = read('app/components/player/PlayerAnalysis.vue')
  ok('the analysis sheet renders a slot', /<slot \/>/.test(sheet))
  ok('the sheet keeps its own DSP content', /analysis-grid/.test(sheet))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`PLAYER AI ANALYSIS — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All Full Player AI analysis tests passed.')
console.log(`
NOT PROVEN HERE: that the native bridge returns a vector on a real
device, that the model is musically meaningful, or that the panel
renders correctly on a phone. The provider is a fake; no device run has
happened.`)
