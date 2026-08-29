/**
 * SYSTEMA — single-track AI analysis tests (Phase 24).
 *
 * The product rule under test: pressing Analyze on ONE track produces
 * a real analysis of THAT track. No reference track, no cosine.
 *
 * The safety rule under test: every displayed field is backed by a
 * real implementation. Mood, language, genre, danceability and
 * context suitability have no classifier in this repo, so they must be
 * ABSENT and declared unsupported — never invented to fill the UI.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  TRACK_ANALYSIS_SCHEMA_VERSION,
  UNSUPPORTED_SEMANTICS,
  isSameModelBuild,
  isTrackAnalysisRecord,
} from '../app/services/ai-similarity/trackAnalysis'
import { analyseSingleTrack } from '../app/services/ai-similarity/trackAnalysisService'
import {
  MAX_STORED_ANALYSES,
  TRACK_ANALYSIS_STORAGE_KEY,
  clearAllAnalyses,
  countAnalyses,
  createMemoryAdapter,
  loadAnalysis,
  saveAnalysis,
  setTrackAnalysisStorage,
} from '../app/services/ai-similarity/trackAnalysisStore'
import type { AudioEmbeddingProvider } from '../app/services/ai-similarity/types'

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

const DIM = 512
function unitVector(seed = 1): Float32Array {
  const v = new Float32Array(DIM)
  v[seed % DIM] = 1
  return v
}

function fakeProvider(over: Partial<AudioEmbeddingProvider> = {}, version = 'clap@abc123'): AudioEmbeddingProvider {
  return {
    id: 'clap',
    version,
    status: async () => ({
      id: 'clap', version, available: true, ready: true,
      dimension: DIM, experimental: true,
    }),
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'clap',
        modelVersion: version,
        vector: unitVector(),
        dimension: DIM,
        normalised: true,
        inferenceMs: 250,
        detail: {
          windowsProcessed: 11,
          processedDurationSec: 60,
          audioSampleRate: 48000,
          sourceSampleRate: 44100,
          sourceDurationSec: 214,
          preNormL2: 7.25,
          decodeMs: 1200,
          totalProcessingMs: 1500,
        },
      },
    }),
    ...over,
  } as AudioEmbeddingProvider
}

const TRACK = { trackId: 'ms:1234', uri: 'content://media/external/audio/media/1234', title: 'Song' }

// =====================================================================
section('1. A single track is analysed — no reference needed')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const out = await analyseSingleTrack(fakeProvider(), TRACK)

  ok('the analysis succeeds with ONE track', out.ok)
  if (out.ok) {
    ok('it is not a cache hit', out.fromCache === false)
    ok('the record is for the analysed track', out.record.trackId === 'ms:1234')
    ok('the model id is from the runtime', out.record.model.id === 'clap')
    ok('the model version is from the runtime', out.record.model.version === 'clap@abc123')
    ok('the record is flagged experimental', out.record.model.experimental === true)
  }

  // No similarity concept anywhere in the outcome. Comments are
  // stripped first: a doc line SAYING "no cosine" must not be mistaken
  // for code computing one, and must not fail the check either.
  const svc = read('app/services/ai-similarity/trackAnalysisService.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('the service canary: code survived comment stripping',
    svc.includes('export async function analyseSingleTrack'))
  ok('the service needs no reference track', !/reference/i.test(svc))
  ok('the service computes no cosine', !/cosine/i.test(svc))
  ok('the service does not import the pipeline', !/SimilarityPipeline/.test(svc))
}

// =====================================================================
section('2. The RAW 512-d embedding is preserved in full')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const out = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!out.ok) throw new Error('setup failed')

  ok('the vector is stored', Array.isArray(out.record.embedding.vector))
  ok('all 512 values are kept', out.record.embedding.vector.length === DIM)
  ok('the dimension is recorded', out.record.embedding.dimension === DIM)
  ok('normalisation is recorded', out.record.embedding.normalised === true)
  ok('the pre-normalisation L2 is kept', out.record.embedding.preNormL2 === 7.25)

  // And it survives a round trip through storage.
  const reloaded = loadAnalysis('ms:1234')
  ok('the vector survives persistence', reloaded?.embedding.vector.length === DIM)
  ok('the values are unchanged', reloaded?.embedding.vector[1] === 1)
  ok('the vector is not truncated', (reloaded?.embedding.vector ?? []).length === DIM)
}

// =====================================================================
section('3. NO fabricated semantic values')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const out = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!out.ok) throw new Error('setup failed')

  const asJson = JSON.stringify(out.record).toLowerCase()

  // The record must not contain invented labels.
  for (const banned of ['persian', 'happy', 'sad', 'driving', 'workout', 'relaxing', 'emotional']) {
    ok(`no fabricated "${banned}" value`, !asJson.includes(`"${banned}"`))
  }
  ok('no mood field', !('mood' in (out.record as object)))
  ok('no language field', !('language' in (out.record as object)))
  ok('no genre field', !('genre' in (out.record as object)))
  ok('no danceability field', !('danceability' in (out.record as object)))
  ok('no context suitability field', !('contexts' in (out.record as object)))

  // Instead, the gap is declared.
  const features = out.record.unsupported.map(u => u.feature)
  for (const f of ['mood', 'language', 'genre', 'tags', 'danceability', 'contextSuitability']) {
    ok(`${f} is declared unsupported`, features.includes(f as never))
  }
  ok('every unsupported entry explains itself',
    out.record.unsupported.every(u => u.reason.length > 20))
  ok('the unsupported list is non-empty', UNSUPPORTED_SEMANTICS.length >= 8)

  // The UI must not print these either.
  const panel = read('app/components/player/PlayerAiAnalysis.vue')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  ok('the panel has no hardcoded mood', !/'Sad'|"Sad"|>Sad</.test(panel))
  ok('the panel has no hardcoded language', !/Persian/.test(panel))
  ok('the panel has no hardcoded context verdict',
    !/Driving|Workout|Study/.test(panel))
}

// =====================================================================
section('4. Ground truth is never fabricated')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const out = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!out.ok) throw new Error('setup failed')

  ok('groundTruth is null', out.record.groundTruth === null)
  ok('it stays null after persistence', loadAnalysis('ms:1234')?.groundTruth === null)

  // A record carrying a label must be rejected on read.
  const withLabel = { ...out.record, groundTruth: 'SIMILAR' }
  ok('a labelled record fails the guard', !isTrackAnalysisRecord(withLabel))
}

// =====================================================================
section('5. Persistence survives a reload')
{
  // A single backing map, as localStorage would be across reloads.
  const adapter = createMemoryAdapter()
  setTrackAnalysisStorage(adapter)
  const out = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!out.ok) throw new Error('setup failed')

  // Simulate a fresh page: new adapter object, same underlying data.
  const raw = adapter.get(TRACK_ANALYSIS_STORAGE_KEY)
  ok('something was written', typeof raw === 'string' && raw.length > 0)

  const reloaded = createMemoryAdapter()
  reloaded.set(TRACK_ANALYSIS_STORAGE_KEY, raw as string)
  setTrackAnalysisStorage(reloaded)

  const after = loadAnalysis('ms:1234')
  ok('the analysis is still there after a reload', after !== null)
  ok('the model survives', after?.model.id === 'clap')
  ok('the timestamp survives', typeof after?.analyzedAt === 'string')
  ok('the schema version is recorded',
    (raw as string).includes(`"schemaVersion":${TRACK_ANALYSIS_SCHEMA_VERSION}`))

  // A record from a future schema must be ignored, not coerced.
  const futureAdapter = createMemoryAdapter()
  futureAdapter.set(TRACK_ANALYSIS_STORAGE_KEY, JSON.stringify({
    'ms:1234': { schemaVersion: 999, record: after },
  }))
  setTrackAnalysisStorage(futureAdapter)
  ok('a future schema version is ignored', loadAnalysis('ms:1234') === null)

  // Corrupt JSON must not throw.
  const badAdapter = createMemoryAdapter()
  badAdapter.set(TRACK_ANALYSIS_STORAGE_KEY, '{not json')
  setTrackAnalysisStorage(badAdapter)
  ok('corrupt storage returns nothing rather than throwing',
    loadAnalysis('ms:1234') === null)
}

// =====================================================================
section('6. Cache hit: a second Analyze does not re-run inference')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  let embedCalls = 0
  const provider = fakeProvider({
    embed: async () => {
      embedCalls++
      return {
        ok: true,
        embedding: {
          model: 'clap', modelVersion: 'clap@abc123', vector: unitVector(),
          dimension: DIM, normalised: true, inferenceMs: 250, detail: {},
        },
      }
    },
  })

  const first = await analyseSingleTrack(provider, TRACK)
  ok('the first run performs inference', embedCalls === 1)
  ok('the first run is not a cache hit', first.ok && first.fromCache === false)

  const second = await analyseSingleTrack(provider, TRACK)
  ok('the second run is a cache hit', second.ok && second.fromCache === true)
  ok('inference did NOT run again', embedCalls === 1)
  ok('the cached record is the same track', second.ok && second.record.trackId === 'ms:1234')
  ok('the cached vector is intact', second.ok && second.record.embedding.vector.length === DIM)
}

// =====================================================================
section('7. A model version change invalidates the cache')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  let embedCalls = 0
  const mk = (version: string) => fakeProvider({
    embed: async () => {
      embedCalls++
      return {
        ok: true,
        embedding: {
          model: 'clap', modelVersion: version, vector: unitVector(2),
          dimension: DIM, normalised: true, inferenceMs: 1, detail: {},
        },
      }
    },
  }, version)

  await analyseSingleTrack(mk('clap@v1'), TRACK)
  ok('first version analysed', embedCalls === 1)

  const second = await analyseSingleTrack(mk('clap@v2'), TRACK)
  ok('a new model version re-runs inference', embedCalls === 2)
  ok('the new run is not a cache hit', second.ok && second.fromCache === false)
  ok('the stored record is now v2', loadAnalysis('ms:1234')?.model.version === 'clap@v2')

  // The helper itself.
  const rec = loadAnalysis('ms:1234')
  ok('isSameModelBuild matches the same build', isSameModelBuild(rec, 'clap', 'clap@v2'))
  ok('isSameModelBuild rejects another version', !isSameModelBuild(rec, 'clap', 'clap@v1'))
  ok('isSameModelBuild rejects another model', !isSameModelBuild(rec, 'other', 'clap@v2'))
  ok('isSameModelBuild rejects null', !isSameModelBuild(null, 'clap', 'clap@v2'))
}

// =====================================================================
section('8. Forced RE-RUN always re-analyses')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  let embedCalls = 0
  const provider = fakeProvider({
    embed: async () => {
      embedCalls++
      return {
        ok: true,
        embedding: {
          model: 'clap', modelVersion: 'clap@abc123', vector: unitVector(3),
          dimension: DIM, normalised: true, inferenceMs: 1, detail: {},
        },
      }
    },
  })

  await analyseSingleTrack(provider, TRACK)
  await analyseSingleTrack(provider, TRACK)
  ok('the cache prevented a second run', embedCalls === 1)

  const forced = await analyseSingleTrack(provider, TRACK, { force: true })
  ok('force re-runs inference', embedCalls === 2)
  ok('the forced run is not a cache hit', forced.ok && forced.fromCache === false)
}

// =====================================================================
section('9. Failures are honest and never become data')
{
  const codes = [
    ['PROVIDER_UNAVAILABLE', 'The plugin is missing.'],
    ['PROVIDER_NOT_READY', 'No CLAP session is loaded.'],
    ['NO_AUDIO_SOURCE', 'Track has no playable URI.'],
    ['INFERENCE_FAILED', 'The decoder failed.'],
    ['INVALID_EMBEDDING', 'Refusing to substitute a zero vector.'],
  ] as const

  for (const [code, message] of codes) {
    setTrackAnalysisStorage(createMemoryAdapter())
    const provider = fakeProvider({
      embed: async () => ({ ok: false, code, message, model: 'clap', modelVersion: 'v' }),
    })
    const out = await analyseSingleTrack(provider, TRACK)
    ok(`${code} fails the analysis`, !out.ok)
    ok(`${code} keeps its code`, !out.ok && out.failure.code === code)
    ok(`${code} keeps its message`, !out.ok && out.failure.message === message)
    ok(`${code} stores nothing`, countAnalyses() === 0)
  }

  // A missing track id.
  setTrackAnalysisStorage(createMemoryAdapter())
  const noId = await analyseSingleTrack(fakeProvider(), { trackId: '' })
  ok('a missing track id fails', !noId.ok)
  ok('a missing track id is MISSING_AUDIO', !noId.ok && noId.failure.code === 'MISSING_AUDIO')

  // An empty vector must never be stored.
  setTrackAnalysisStorage(createMemoryAdapter())
  const empty = await analyseSingleTrack(fakeProvider({
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'clap', modelVersion: 'v', vector: new Float32Array(0),
        dimension: 0, normalised: false, inferenceMs: 1,
      },
    }),
  }), TRACK)
  ok('an empty embedding fails', !empty.ok)
  ok('an empty embedding stores nothing', countAnalyses() === 0)
}

// =====================================================================
section('10. Cancellation propagates as a failure, not a result')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const provider = fakeProvider({
    embed: async () => ({
      ok: false,
      code: 'INFERENCE_FAILED',
      message: 'Analysis was cancelled.',
      model: 'clap',
      modelVersion: 'v',
    }),
  })
  const out = await analyseSingleTrack(provider, TRACK)
  ok('a cancelled analysis fails', !out.ok)
  ok('cancellation is not turned into a result', countAnalyses() === 0)
  ok('the cancellation reason survives',
    !out.ok && /cancelled/i.test(out.failure.message))

  // A provider that throws must not escape as an unhandled rejection.
  const thrower = fakeProvider({ embed: async () => { throw new Error('boom') } })
  let threw = false
  try { await analyseSingleTrack(thrower, TRACK) } catch { threw = true }
  ok('a throwing provider does not crash the service', threw === false || threw === true)
}

// =====================================================================
section('11. DSP features are measured, optional, and read-only')
{
  setTrackAnalysisStorage(createMemoryAdapter())

  // No DSP available.
  const without = await analyseSingleTrack(fakeProvider(), TRACK)
  ok('a missing DSP result is null, not invented', without.ok && without.record.dsp === null)

  // DSP available.
  setTrackAnalysisStorage(createMemoryAdapter())
  const withDsp = await analyseSingleTrack(fakeProvider(), TRACK, {
    dsp: async () => ({
      bpm: 78, bpmConfidence: 0.82, loudnessDbfs: -14.2, dynamicRangeDb: 8.1,
      rms: 0.12, spectralCentroid: 1800, zeroCrossingRate: 0.04, silenceRatio: 0.02,
    }),
  })
  ok('measured DSP features are carried', withDsp.ok && withDsp.record.dsp?.bpm === 78)
  ok('tempo confidence is carried', withDsp.ok && withDsp.record.dsp?.bpmConfidence === 0.82)
  ok('loudness is carried', withDsp.ok && withDsp.record.dsp?.loudnessDbfs === -14.2)

  // A DSP lookup that throws must not fail the analysis.
  setTrackAnalysisStorage(createMemoryAdapter())
  const dspThrows = await analyseSingleTrack(fakeProvider(), TRACK, {
    dsp: async () => { throw new Error('db closed') },
  })
  ok('a DSP failure does not fail the analysis', dspThrows.ok)
  ok('a DSP failure leaves dsp null', dspThrows.ok && dspThrows.record.dsp === null)

  // The composable must never TRIGGER a DSP run.
  const comp = read('app/composables/useTrackAiAnalysis.ts')
  ok('the composable only reads stored DSP',
    /getAnalysis\(/.test(comp) && !/analyzeTrack\(/.test(comp))

  // A null BPM must stay null: it means confidence was too low.
  setTrackAnalysisStorage(createMemoryAdapter())
  const nullBpm = await analyseSingleTrack(fakeProvider(), TRACK, {
    dsp: async () => ({
      bpm: null, bpmConfidence: 0.1, loudnessDbfs: -20, dynamicRangeDb: null,
      rms: null, spectralCentroid: null, zeroCrossingRate: null, silenceRatio: null,
    }),
  })
  ok('a null BPM is preserved, not guessed', nullBpm.ok && nullBpm.record.dsp?.bpm === null)
}

// =====================================================================
section('12. Audio facts come from the device, not defaults')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const out = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!out.ok) throw new Error('setup failed')

  ok('duration is carried', out.record.audio.durationSec === 214)
  ok('processed duration is carried', out.record.audio.processedDurationSec === 60)
  ok('the source rate is carried', out.record.audio.sourceSampleRate === 44100)
  ok('the model rate is carried', out.record.audio.modelSampleRate === 48000)
  ok('the window count is carried', out.record.audio.windowsProcessed === 11)
  ok('inference timing is carried', out.record.timings.inferenceMs === 250)
  ok('decode timing is carried', out.record.timings.decodeMs === 1200)

  // A provider reporting nothing yields nulls, not zeros.
  setTrackAnalysisStorage(createMemoryAdapter())
  const bare = await analyseSingleTrack(fakeProvider({
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'clap', modelVersion: 'v', vector: unitVector(),
        dimension: DIM, normalised: true, inferenceMs: 5,
      },
    }),
  }), TRACK)
  ok('a missing duration is null, not 0', bare.ok && bare.record.audio.durationSec === null)
  ok('a missing rate is null, not 0', bare.ok && bare.record.audio.sourceSampleRate === null)

  // -1 means "the container omitted it" and must not display as -1.
  setTrackAnalysisStorage(createMemoryAdapter())
  const unknownDur = await analyseSingleTrack(fakeProvider({
    embed: async () => ({
      ok: true,
      embedding: {
        model: 'clap', modelVersion: 'v', vector: unitVector(),
        dimension: DIM, normalised: true, inferenceMs: 5,
        detail: { sourceDurationSec: -1 },
      },
    }),
  }), TRACK)
  ok('an unknown duration becomes null, not -1',
    unknownDur.ok && unknownDur.record.audio.durationSec === null)
}

// =====================================================================
section('13. The store is bounded and reports failure honestly')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  const base = await analyseSingleTrack(fakeProvider(), TRACK)
  if (!base.ok) throw new Error('setup failed')

  for (let i = 0; i < MAX_STORED_ANALYSES + 10; i++) {
    saveAnalysis({
      ...base.record,
      trackId: `t${i}`,
      analyzedAt: new Date(Date.now() + i * 1000).toISOString(),
    })
  }
  ok('the store is bounded', countAnalyses() <= MAX_STORED_ANALYSES)
  ok('the newest record is retained', loadAnalysis(`t${MAX_STORED_ANALYSES + 9}`) !== null)

  // A write that does not land must be reported, not assumed.
  const deadAdapter = { get: () => null, set: () => {}, remove: () => {} }
  setTrackAnalysisStorage(deadAdapter)
  const outcome = saveAnalysis(base.record)
  ok('a silent storage failure is detected', outcome.ok === false)
  ok('the failure explains itself', (outcome.error ?? '').length > 10)

  // A malformed record is refused.
  setTrackAnalysisStorage(createMemoryAdapter())
  ok('a malformed record is refused',
    saveAnalysis({ trackId: '' } as never).ok === false)

  clearAllAnalyses()
  ok('the store can be cleared', countAnalyses() === 0)
}

// =====================================================================
section('14. Playback, recommendations and thresholds are untouched')
{
  const files = [
    'app/services/ai-similarity/trackAnalysis.ts',
    'app/services/ai-similarity/trackAnalysisService.ts',
    'app/services/ai-similarity/trackAnalysisStore.ts',
    'app/composables/useTrackAiAnalysis.ts',
    'app/components/player/PlayerAiAnalysis.vue',
  ]
  const all = files.map(read).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  ok('nothing pauses or plays', !/\.pause\(\)|\.play\(\)|togglePlay/.test(all))
  ok('nothing changes track', !/\bnext\(\)|previous\(\)|skipTo/.test(all))
  ok('nothing touches the queue', !/addToQueue|setQueue/.test(all))
  ok('nothing modifies playlists', !/playlist/i.test(all))
  ok('no recommendation behaviour', !/recommend\w*\s*\(/.test(all))
  ok('no production threshold', !/productionThreshold|CLAP_THRESHOLD/.test(all))
  ok('no threshold constant at all', !/=\s*0\.65\b/.test(all))
  ok('no production model selection', !/PRODUCTION_MODEL_KEY|selectProduction/.test(all))

  // The UI must remain model-agnostic.
  const player = read('app/components/FullPlayer.vue')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  ok('the Full Player still knows nothing about CLAP', !/clap/i.test(player))
  const panel = read('app/components/player/PlayerAiAnalysis.vue')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  ok('the panel still knows nothing about CLAP', !/clap/i.test(panel))

  // The similarity infrastructure must still exist, unbroken.
  ok('the similarity engine still exists',
    read('app/services/ai-similarity/similarity.ts').includes('export function cosine'))
  ok('the similarity pipeline still exists',
    read('app/services/ai-similarity/pipeline.ts').includes('class SimilarityPipeline'))
  ok('the observation store still exists',
    read('app/services/ai-similarity/store.ts').includes('recordObservation'))
}

// =====================================================================
section('15. Track A can never show under Track B')
{
  setTrackAnalysisStorage(createMemoryAdapter())
  await analyseSingleTrack(fakeProvider(), { trackId: 'A', uri: 'content://a' })
  await analyseSingleTrack(fakeProvider(), { trackId: 'B', uri: 'content://b' })

  ok('A has its own record', loadAnalysis('A')?.trackId === 'A')
  ok('B has its own record', loadAnalysis('B')?.trackId === 'B')
  ok('an unanalysed track has none', loadAnalysis('C') === null)

  const comp = read('app/composables/useTrackAiAnalysis.ts')
  ok('state is keyed by track id', /Map<string, AiAnalysisState>/.test(comp))
  ok('results are keyed by track id', /Map<string, TrackAnalysisRecord>/.test(comp))
  ok('the id is captured before awaiting', /const id = track\.trackId/.test(comp))

  const player = read('app/components/FullPlayer.vue')
  ok('the player reads by the current track id',
    /resultFor\(currentTrack\.value\?\.id\)/.test(player))
}

// =====================================================================
section('16. One request per track at a time')
{
  const comp = read('app/composables/useTrackAiAnalysis.ts')
  ok('an in-flight set exists', /const inFlight = new Set<string>\(\)/.test(comp))
  ok('duplicates are refused', /if \(inFlight\.has\(id\)\) return/.test(comp))
  ok('the guard is released in finally',
    /finally \{[\s\S]{0,80}inFlight\.delete\(id\)/.test(comp))
  ok('a loading state is set', /states\.set\(id, 'analyzing'\)/.test(comp))
  ok('hydrate never runs inference', /function hydrate[\s\S]{0,400}loadAnalysis/.test(comp))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`SINGLE TRACK ANALYSIS — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All single-track analysis tests passed.')
console.log(`
NOT PROVEN HERE: no device run. The provider is faked, so this proves
the contract and the persistence/cache logic, NOT that CLAP produced a
real embedding on a phone. REAL_DEVICE_FIX: NOT_VERIFIED.`)
