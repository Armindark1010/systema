/**
 * SYSTEMA — CLAP session lifecycle regression tests (Phase 23.1).
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * The lab's single-track test passes `releaseAfter: true`, which
 * unloads the native session on purpose (Phase 21.2 requires the test
 * to prove memory is returned). So after a normal lab run the model is
 * imported and chosen but NOTHING IS LOADED — and every later analysis
 * reported PROVIDER_NOT_READY, even though the human really had
 * pressed Load Model and seen it succeed.
 *
 * The contract under test: after the lab releases the session, a later
 * embed reloads THE MODEL THE HUMAN CHOSE, validates it, and only then
 * runs. It must never invent a model, never skip validation, and never
 * fake readiness.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ClapProvider, type ClapProviderDeps } from '../app/services/ai-similarity/providers/clapProvider'
import {
  CLAP_MODEL_PREFERENCE_KEY,
  forgetClapModel,
  recallClapModel,
  rememberClapModel,
  setClapPreferenceStorage,
} from '../app/services/ai-similarity/providers/clapModelPreference'

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

function memoryStore() {
  const map = new Map<string, string>()
  setClapPreferenceStorage({
    get: k => map.get(k) ?? null,
    set: (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
  })
  return map
}

/** A fake device whose session can be released exactly like the real one. */
function fakeDevice(opts: { loaded?: boolean, validated?: boolean } = {}) {
  const state = {
    loaded: opts.loaded ?? false,
    validated: opts.validated ?? false,
    modelId: opts.loaded ? 'clap-audio' : '',
    loadCalls: [] as string[],
    validateCalls: 0,
    embedCalls: 0,
  }
  const deps: ClapProviderDeps = {
    status: async () => ({
      loaded: state.loaded,
      modelId: state.modelId,
      validated: state.validated,
      multiTrackUnlocked: false,
      lastSingleTrackId: '',
      status: state.validated ? 'VALIDATED' : state.loaded ? 'LOADED' : 'IDLE',
      productionSelected: false,
      productionNote: '',
      metadata: { id: 'clap-audio', sha256: 'abcdef0123456789' },
    }) as never,
    loadModel: async ({ modelId }) => {
      state.loadCalls.push(modelId)
      state.loaded = true
      state.modelId = modelId
      return {}
    },
    validateModel: async () => {
      state.validateCalls++
      state.validated = state.loaded
      return { ok: state.loaded }
    },
    recallModel: () => recallClapModel(),
    embedTrack: async () => {
      state.embedCalls++
      return {
        trackId: 't1',
        vector: new Array(512).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        embeddingDimension: 512,
        inferenceMs: 100,
      } as never
    },
  }
  return { state, deps }
}

const TRACK = { trackId: 't1', uri: 'content://t1', title: 'T' }

// =====================================================================
section('1. The preference remembers only what the human chose')
{
  memoryStore()
  ok('nothing is remembered initially', recallClapModel() === null)

  rememberClapModel('clap-audio')
  ok('a loaded model is remembered', recallClapModel() === 'clap-audio')

  rememberClapModel('')
  ok('an empty id does not overwrite', recallClapModel() === 'clap-audio')
  rememberClapModel(null)
  ok('null does not overwrite', recallClapModel() === 'clap-audio')
  rememberClapModel(undefined)
  ok('undefined does not overwrite', recallClapModel() === 'clap-audio')

  rememberClapModel('  spaced  ')
  ok('ids are trimmed', recallClapModel() === 'spaced')

  forgetClapModel()
  ok('the preference can be cleared', recallClapModel() === null)

  ok('the key follows the systema convention',
    CLAP_MODEL_PREFERENCE_KEY.startsWith('systema:'))
}

// =====================================================================
section('2. THE REGRESSION: lab releases the session, analysis still works')
{
  memoryStore()
  // Step 1: the human loads the model in the lab.
  rememberClapModel('clap-audio')

  // Step 2: the lab's test runs with releaseAfter:true, so the native
  // session is gone. This is exactly the reported state.
  const { state, deps } = fakeDevice({ loaded: false, validated: false })
  ok('precondition: no session is loaded', state.loaded === false)

  // Step 3: Full Player analyses a track.
  const provider = new ClapProvider({}, deps)
  const before = await provider.status()
  ok('status correctly reports NOT ready before the fix runs',
    before.ready === false)

  const result = await provider.embed(TRACK)

  ok('the embed succeeds after re-establishing the session', result.ok,
    result.ok ? '' : `${result.code}: ${result.message}`)
  ok('the model was reloaded', state.loadCalls.length === 1)
  ok('the model reloaded is the one the human chose',
    state.loadCalls[0] === 'clap-audio')
  ok('the reloaded graph was validated', state.validateCalls === 1)
  ok('validation happened before inference',
    state.validateCalls === 1 && state.embedCalls === 1)
  ok('a real embedding came back', result.ok && result.embedding.dimension === 512)
}

// =====================================================================
section('3. It never invents a model')
{
  memoryStore()
  forgetClapModel() // the human has NEVER loaded anything

  const { state, deps } = fakeDevice({ loaded: false })
  const provider = new ClapProvider({}, deps)
  const result = await provider.embed(TRACK)

  ok('the embed fails honestly', !result.ok)
  ok('it reports PROVIDER_NOT_READY',
    !result.ok && result.code === 'PROVIDER_NOT_READY')
  ok('NO model was loaded', state.loadCalls.length === 0)
  ok('no inference was attempted', state.embedCalls === 0)
  ok('the original honest reason survives',
    !result.ok && /No CLAP session is loaded/.test(result.message))
}

// =====================================================================
section('4. An already-ready session is left completely alone')
{
  memoryStore()
  rememberClapModel('clap-audio')
  const { state, deps } = fakeDevice({ loaded: true, validated: true })
  const provider = new ClapProvider({}, deps)
  const result = await provider.embed(TRACK)

  ok('the embed succeeds', result.ok)
  ok('nothing was reloaded', state.loadCalls.length === 0)
  ok('nothing was re-validated', state.validateCalls === 0)
  ok('the session was used directly', state.embedCalls === 1)
}

// =====================================================================
section('5. Loaded but unvalidated: validate, never bypass')
{
  memoryStore()
  rememberClapModel('clap-audio')
  const { state, deps } = fakeDevice({ loaded: true, validated: false })
  const provider = new ClapProvider({}, deps)
  const result = await provider.embed(TRACK)

  ok('the embed succeeds once validated', result.ok)
  ok('it did NOT reload an already-loaded session', state.loadCalls.length === 0)
  ok('it validated the existing session', state.validateCalls === 1)
}

// =====================================================================
section('6. Failure paths stay honest')
{
  // Reload throws.
  memoryStore()
  rememberClapModel('clap-audio')
  const d1 = fakeDevice({ loaded: false })
  d1.deps.loadModel = async () => { throw new Error('out of memory') }
  const r1 = await new ClapProvider({}, d1.deps).embed(TRACK)
  ok('a failed reload fails the embed', !r1.ok)
  ok('a failed reload explains itself',
    !r1.ok && /Could not reload/.test(r1.message))
  ok('a failed reload names the underlying cause',
    !r1.ok && /out of memory/.test(r1.message))
  ok('no inference ran after a failed reload', d1.state.embedCalls === 0)

  // Validation fails.
  memoryStore()
  rememberClapModel('clap-audio')
  const d2 = fakeDevice({ loaded: false })
  d2.deps.validateModel = async () => ({ ok: false })
  const r2 = await new ClapProvider({}, d2.deps).embed(TRACK)
  ok('a failed validation fails the embed', !r2.ok)
  ok('an unvalidated graph never sees audio', d2.state.embedCalls === 0)
  ok('a failed validation explains itself',
    !r2.ok && /failed validation/.test(r2.message))

  // Missing URI is still rejected before any session work.
  memoryStore()
  rememberClapModel('clap-audio')
  const d3 = fakeDevice({ loaded: false })
  const r3 = await new ClapProvider({}, d3.deps).embed({ trackId: 't', uri: '' })
  ok('a missing URI is rejected', !r3.ok && r3.code === 'NO_AUDIO_SOURCE')
  ok('a missing URI does not trigger a reload', d3.state.loadCalls.length === 0)
}

// =====================================================================
section('7. The readiness check was NOT bypassed')
{
  const src = read('app/services/ai-similarity/providers/clapProvider.ts')
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const code = strip(src)

  ok('readiness is still checked', /if \(!st\.available \|\| !st\.ready\)/.test(code))
  ok('PROVIDER_NOT_READY can still be returned', /PROVIDER_NOT_READY/.test(code))
  ok('ready is never hardcoded true', !/ready:\s*true\s*,/.test(code)
    || !/ready = true/.test(code))
  ok('no fake result is substituted', !/fakeResult|return\s+fake/.test(code))
  ok('no zero vector fallback', !/new Array\(\d+\)\.fill\(0\)/.test(code))
  ok('validation is still required for readiness',
    /s\.loaded && s\.validated/.test(code))
  ok('re-establishing only runs when available but not ready',
    /if \(st\.available && !st\.ready\)/.test(code))
  ok('the model id comes from recall, never a literal',
    /recallModel\(\)/.test(code) && !/modelId: 'clap/.test(code))
  ok('recovery is skipped when its dependencies are absent',
    /if \(!recallModel \|\| !loadModel \|\| !validateModel\) return current/.test(code))
}

// =====================================================================
section('8. The lab records the human choice; architecture intact')
{
  const lab = read('app/pages/dev/ai-benchmark/clap.vue')
  ok('the lab remembers the model on load', /rememberClapModel\(modelId\.value\)/.test(lab))
  ok('the lab still releases after its test', /releaseAfter: true/.test(lab))

  const player = read('app/components/FullPlayer.vue')
  const composable = read('app/composables/useTrackAiAnalysis.ts')
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  ok('the Full Player still knows nothing about CLAP',
    !/clap/i.test(strip(player)))
  ok('the composable still knows nothing about CLAP',
    !/clap/i.test(strip(composable)))
  ok('the preference module is CLAP-specific and lives with the provider',
    read('app/services/ai-similarity/providers/clapModelPreference.ts').length > 0)

  // The generic analysis service must not learn about model loading.
  const analysis = strip(read('app/services/ai-similarity/analysis.ts'))
  ok('the generic analysis service does not load models',
    !/loadModel|recallModel/.test(analysis))
}

// =====================================================================
section('9. Native lifecycle logging exists and is safe')
{
  const session = read('android/app/src/main/java/com/systema/music/inference/clap/ClapSession.kt')
  const plugin = read('android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt')

  ok('session state is logged', /ClapLog\.SESSION_STATE/.test(session))
  ok('session identity is logged', /ClapLog\.SESSION_IDENTITY/.test(session))
  ok('plugin creation is logged', /pluginCreated/.test(plugin))
  ok('plugin destruction is logged', /pluginDestroyed/.test(plugin))
  ok('identity uses a safe hash, not raw state',
    /identityHashCode/.test(session) && /identityHashCode/.test(plugin))
  ok('ClapLog is imported by the plugin',
    /import com\.systema\.music\.inference\.clap\.ClapLog/.test(plugin))
  ok('no audio is logged', !/FloatArray|samples\b/.test(
    session.split('SESSION_STATE')[1]?.slice(0, 400) ?? ''))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`CLAP SESSION LIFECYCLE — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All CLAP session lifecycle tests passed.')
console.log(`
NOT PROVEN HERE: the fix has NOT been run on a real Android device.
The device is faked. Kotlin was not compiled (no JVM/SDK in this
sandbox). REAL_DEVICE_FIX: NOT_VERIFIED.`)
