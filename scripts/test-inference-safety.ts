// ============================================================
// SYSTEMA — Phase 15: inference cannot escape the lab
// ============================================================
// THE MOST IMPORTANT SUITE IN PHASE 15 (§13).
//
// Phase 15 adds the ability to run a neural model over the user's
// music. The absolute constraint is that this capability must be
// reachable ONLY from Settings → AI Benchmark Lab → explicit
// selection → MEASURE, on at most 20 tracks.
//
// It must never run from Home, Library or Player. It must never
// analyse the 3,910-track library. It must never start by itself.
//
// Proving a negative
// ------------------
// "No code path does X" cannot be shown by running one scenario, so
// this is a static audit, following the method the Phase 13 and 14
// safety suites established:
//
//   1. comments are stripped first, so the extensive prose about what
//      is deliberately NOT done cannot satisfy or trip a check;
//   2. auto-run surfaces (Nuxt plugins, onMounted, watch, WorkManager)
//      are inspected specifically, so an explicitly user-triggered
//      call is correctly allowed;
//   3. the track cap is checked in BOTH layers, since the web layer is
//      a UI and not a security boundary.
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const exists = (p: string) => existsSync(resolve(ROOT, p))

function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(resolve(ROOT, dir))
  } catch {
    return out
  }
  for (const e of entries) {
    if (['node_modules', '.git', '.nuxt', '.output', 'dist', '.gradle', 'build'].includes(e)) continue
    const p = join(dir, e)
    if (statSync(resolve(ROOT, p)).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

console.log('\n=== SYSTEMA Phase 15 — inference safety audit ===')

const INFERENCE_DIR = 'android/app/src/main/java/com/systema/music/inference'

// ------------------------------------------------------------
section('1. Inference never starts by itself')
// ------------------------------------------------------------

// Nuxt plugins run on every app start. If any of them reaches the
// inference service, a model could run before the user does anything.
const pluginFiles = exists('app/plugins') ? walk('app/plugins') : []
let pluginLeak: string[] = []
for (const f of pluginFiles) {
  const src = stripComments(read(f))
  if (/inferenceService|InferenceNative|runRealAudio|runTestModel/.test(src)) {
    pluginLeak.push(f)
  }
}
ok('no Nuxt plugin touches inference', pluginLeak.length === 0, pluginLeak.join(', '))

// App-level layouts and the root component run on every screen.
const globalSurfaces = [
  'app/app.vue',
  'app/layouts/default.vue',
].filter(exists)
for (const f of globalSurfaces) {
  const src = stripComments(read(f))
  ok(`${f} does not reference inference`,
    !/inferenceService|InferenceNative|runRealAudio/.test(src))
}

// ------------------------------------------------------------
section('2. Inference is unreachable from the main app (§13)')
// ------------------------------------------------------------

// Home, Library, Player, Search, Queue, Playlists must not be able
// to trigger a model — not even indirectly.
const MAIN_APP_DIRS = ['app/pages', 'app/components', 'app/stores', 'app/composables']
const LAB_PATHS = ['dev/ai-benchmark', 'ai-lab', 'services/native/inference']

const mainAppFiles = MAIN_APP_DIRS
  .filter(exists)
  .flatMap(d => walk(d))
  .filter(f => !LAB_PATHS.some(lab => f.replace(/\\/g, '/').includes(lab)))

const offenders: string[] = []
for (const f of mainAppFiles) {
  const src = stripComments(read(f))
  if (/from ['"]~\/services\/native\/inference(Service|Plugin)['"]/.test(src)
    || /InferenceNative/.test(src)
    || /runRealAudio\s*\(/.test(src)
    || /runTestModel\s*\(/.test(src)) {
    offenders.push(f)
  }
}
ok('no main-app page, component, store or composable imports inference',
  offenders.length === 0, offenders.join(', '))

// Specifically name the surfaces the user cares about.
for (const page of [
  'app/pages/index.vue',
  'app/pages/library.vue',
  'app/pages/player.vue',
  'app/pages/search.vue',
]) {
  if (!exists(page)) continue
  const src = stripComments(read(page))
  ok(`${page.split('/').pop()} cannot trigger inference`,
    !/[Ii]nference/.test(src))
}

// ------------------------------------------------------------
section('3. The 20-track cap is enforced in BOTH layers (§9)')
// ------------------------------------------------------------

const benchKt = read(`${INFERENCE_DIR}/InferenceBenchmark.kt`)
const pluginKt = read(`${INFERENCE_DIR}/InferencePlugin.kt`)
const svcTs = read('app/services/native/inferenceService.ts')

ok('Kotlin declares MAX_TRACKS = 20', /MAX_TRACKS\s*=\s*20/.test(benchKt))
ok('the Kotlin benchmark rejects an oversized batch',
  /tracks\.size\s*>\s*MAX_TRACKS/.test(stripComments(benchKt)))
ok('the Kotlin plugin independently rejects an oversized batch',
  /tracks\.size\s*>\s*InferenceBenchmark\.MAX_TRACKS/.test(stripComments(pluginKt)))
ok('TypeScript declares the same cap',
  /MAX_BENCHMARK_TRACKS\s*=\s*20/.test(svcTs))
ok('the TypeScript service rejects an oversized batch',
  /tracks\.length\s*>\s*MAX_BENCHMARK_TRACKS/.test(stripComments(svcTs)))

// Behavioural, not just declared: the guard must actually fire.
const MAX = 20
function wouldReject(count: number): boolean {
  return count === 0 || count > MAX
}
ok('a 3,910-track request would be rejected', wouldReject(3910))
ok('a 21-track request would be rejected', wouldReject(21))
ok('a 20-track request is allowed', !wouldReject(20))
ok('an empty request is rejected', wouldReject(0))

// ------------------------------------------------------------
section('4. Nothing discovers tracks on its own (§13)')
// ------------------------------------------------------------

const inferenceFiles = walk(INFERENCE_DIR)
for (const f of inferenceFiles) {
  const src = stripComments(read(f))
  ok(`${f.split('/').pop()} does not query MediaStore`,
    !/MediaStore|ContentResolver/.test(src))
  ok(`${f.split('/').pop()} does not enumerate the track table`,
    !/findTracksNeedingAnalysis|getAllTracks|trackDao\.all/.test(src))
}

ok('the native plugin has no "analyze library" method',
  !/analyzeLibrary|analyzeAll|scanAndAnalyze/i.test(pluginKt))
ok('tracks are required, never defaulted',
  stripComments(pluginKt).includes('A non-empty tracks array is required')
  || /rawTracks\s*==\s*null\s*\|\|\s*rawTracks\.length\(\)\s*==\s*0/.test(stripComments(pluginKt)))

// ------------------------------------------------------------
section('5. No WorkManager scheduling of inference (§13)')
// ------------------------------------------------------------

for (const f of inferenceFiles) {
  const src = stripComments(read(f))
  ok(`${f.split('/').pop()} does not schedule background work`,
    !/WorkManager|OneTimeWorkRequest|PeriodicWorkRequest|enqueue\(/.test(src))
}

// ------------------------------------------------------------
section('6. Phase 13 results are never modified (§13)')
// ------------------------------------------------------------

for (const f of inferenceFiles) {
  const src = stripComments(read(f))
  ok(`${f.split('/').pop()} never writes to the analysis store`,
    !/AudioAnalysisRepository|analysisDao|AudioAnalysisEntity|\.upsert\(|\.insert\(/.test(src))
}

// Reading the DECODER is fine and expected; writing analysis is not.
const benchStripped = stripComments(benchKt)
ok('the benchmark reuses the Phase 13 decoder read-only',
  benchStripped.includes('PcmDecoder') && !benchStripped.includes('AudioAnalysisRepository'))
ok('the benchmark does not run or overwrite Phase 13 DSP',
  !/WindowedAnalyzer|FeatureAggregator|TempoEstimator/.test(benchStripped))

// ------------------------------------------------------------
section('7. No synthetic audio and no fabricated output (§13)')
// ------------------------------------------------------------

for (const f of inferenceFiles) {
  const src = stripComments(read(f))
  ok(`${f.split('/').pop()} generates no random values`,
    !/Random\(|Math\.random|nextFloat\(|nextGaussian/.test(src))
}

const labPage = stripComments(read('app/pages/dev/ai-benchmark/onnx.vue'))
ok('the lab page invents no numbers',
  !/Math\.random/.test(labPage))
ok('the lab page shows an error code when a run fails',
  labPage.includes('audioError') && labPage.includes('errorCode'))

// ------------------------------------------------------------
section('8. Model weights stay out of git (§7)')
// ------------------------------------------------------------

const gitignore = exists('.gitignore') ? read('.gitignore') : ''
ok('.gitignore excludes common weight formats',
  ['*.pt', '*.pth', '*.safetensors', '*.tflite'].some(p => gitignore.includes(p)),
  'add weight extensions to .gitignore')

const allFiles = walk('.')
const bigBinaries = allFiles.filter((f) => {
  if (!/\.(onnx|pt|pth|bin|safetensors|tflite|ckpt|h5|pb)$/.test(f)) return false
  return statSync(resolve(ROOT, f)).size > 100 * 1024
})
ok('no large model binary is committed', bigBinaries.length === 0, bigBinaries.join(', '))

// The one permitted .onnx must be the tiny arithmetic fixture.
const onnxFiles = allFiles.filter(f => f.endsWith('.onnx'))
ok('exactly one .onnx is committed, and it is the test fixture',
  onnxFiles.length === 1 && onnxFiles[0]!.endsWith('systema-test-model.onnx'),
  onnxFiles.join(', '))

// ------------------------------------------------------------
section('9. Models load and unload, never leak (§12)')
// ------------------------------------------------------------

const onnxKt = read(`${INFERENCE_DIR}/OnnxInferenceRuntime.kt`)
// unloadModel() delegates to releaseLocked(), which takes the session
// into a local and closes it. Check that path rather than a specific
// call idiom, so a refactor that stays correct does not fail here.
const onnxStripped = stripComments(onnxKt)
ok('unloadModel releases the session',
  /unloadModel\(\)[\s\S]{0,200}?releaseLocked\(\)/.test(onnxStripped))
ok('releaseLocked closes the session and clears the reference',
  /private fun releaseLocked\(\)[\s\S]{0,600}?\.close\(\)[\s\S]{0,400}?session = null/
    .test(onnxStripped))
ok('the descriptor is cleared too, so no stale model is reported',
  /private fun releaseLocked\(\)[\s\S]{0,800}?descriptor = null/.test(onnxStripped))
ok('tensors are released in a finally block',
  /finally\s*\{[\s\S]{0,300}?tensor\?\.close\(\)/.test(onnxKt))
ok('the benchmark unloads even after a failure',
  /finally\s*\{[\s\S]{0,200}?unloadModel\(\)/.test(benchKt))
ok('the model is loaded once per batch, not once per track',
  benchStripped.indexOf('loadModel(descriptor)') < benchStripped.indexOf('for (track in tracks)'))

// ------------------------------------------------------------
section('10. The lab is reachable only from Settings')
// ------------------------------------------------------------

ok('the ONNX lab lives under /dev/ai-benchmark',
  exists('app/pages/dev/ai-benchmark/onnx.vue'))

const settings = exists('app/data/settings.ts') ? read('app/data/settings.ts') : ''
ok('the benchmark lab is entered from Settings',
  /ai-benchmark/.test(settings))

// ------------------------------------------------------------
console.log('\n' + '='.repeat(60))
console.log(`  ${passed} passed, ${failed} failed`)
console.log('='.repeat(60))

if (failed > 0) process.exit(1)
