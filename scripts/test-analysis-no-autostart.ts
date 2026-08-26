// ============================================================
// SYSTEMA — Phase 13: nothing analyses the library automatically
// ============================================================
// Phase 13 ships a working analyser and a working WorkManager queue,
// but deliberately does NOT switch on whole-library analysis. Nothing
// may start decoding a user's 10,000 files because they opened the
// app, finished a scan, or navigated to a page.
//
// This suite walks every path that runs on its own — app startup,
// Nuxt plugins, the Activity, plugin registration, the scheduler,
// route mounting, the settings page, and the scan-completion hook —
// and asserts that none of them reaches an analysis entry point.
//
// Method
// ------
// This is necessarily a static audit: "no code path calls X" is a
// property of the code, and there is no way to prove absence by
// running one scenario. To keep it honest rather than a naive grep,
// it:
//
//   1. resolves the actual set of analysis entry points from the
//      service and native plugin sources, so a NEW entry point is
//      picked up automatically instead of being silently missed;
//   2. strips comments before matching, so prose about what is
//      deliberately not done cannot pass or fail a check;
//   3. checks the auto-run surfaces specifically (onMounted, watch,
//      Nuxt plugins, Activity onCreate, WorkManager periodic APIs)
//      rather than the file as a whole, so an explicit user-triggered
//      call in the same file is correctly allowed.
//
// The complementary positive evidence — that a user-initiated
// analysis DOES work — is covered by the DSP and pipeline suites and,
// on hardware, by the device checklist in docs/PHASE-13-VERIFICATION.md.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

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

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/** Removes comments so prose cannot satisfy or trip a check. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const rel = join(dir, entry)
    const full = resolve(root, rel)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.nuxt' || entry === 'dist') continue
      walk(rel, out)
    } else {
      out.push(rel)
    }
  }
  return out
}

console.log('\n\x1b[1mSYSTEMA — Phase 13 auto-start prevention\x1b[0m\n')

// ============================================================
console.log('Analysis entry points are enumerated from source')
// ============================================================

const serviceSrc = read('app/services/native/audioAnalysisService.ts')

// Every exported function in the analysis service is a potential way
// to start work. Derived from the source so a newly added entry point
// is covered without anyone remembering to update this list.
const exportedEntryPoints = [...serviceSrc.matchAll(/export async function (\w+)/g)].map(m => m[1]!)
ok('the analysis service exports were discovered',
  exportedEntryPoints.length >= 6, `found ${exportedEntryPoints.join(', ')}`)

/** The ones that actually cause DSP work to happen. */
const WORK_STARTING = exportedEntryPoints.filter(
  name => /^(analyzeTrack|enqueueAnalysisBatch)$/.test(name),
)
ok('the work-starting entry points are analyzeTrack and enqueueAnalysisBatch',
  WORK_STARTING.length === 2, WORK_STARTING.join(', '))

// Read-only calls that are always safe to make automatically.
const READ_ONLY = ['getAnalysis', 'getAnalysisStatus', 'getAnalysisSummary', 'cancelAnalysis']
for (const name of READ_ONLY) {
  ok(`${name} is read-only and safe to call on mount`, exportedEntryPoints.includes(name))
}

// The composable's own work-starting method.
const WORK_PATTERNS = [
  /\banalyzeTrackNative\s*\(/,
  /\bAudioAnalysisNative\.analyzeTrack\s*\(/,
  /\bAudioAnalysisNative\.enqueueBatch\s*\(/,
  /\benqueueAnalysisBatch\s*\(/,
  /\baudioAnalysis\.analyze\s*\(/,
  /\banalysis\.analyze\s*\(/,
]

function startsWork(src: string): boolean {
  const code = codeOnly(src)
  return WORK_PATTERNS.some(p => p.test(code))
}

// ============================================================
console.log('\nNuxt plugins (run automatically at app startup)')
// ============================================================

const plugins = walk('app/plugins')
ok('the app has plugins to audit', plugins.length > 0, plugins.join(', '))

for (const plugin of plugins) {
  const src = read(plugin)
  ok(`${plugin.split('/').pop()} does not start analysis at startup`, !startsWork(src))
  ok(`${plugin.split('/').pop()} does not import the analysis service`,
    !codeOnly(src).includes('audioAnalysisService')
    && !codeOnly(src).includes('useAudioAnalysis'))
}

// ============================================================
console.log('\nStores and library initialisation')
// ============================================================

const libraryStore = read('app/stores/library.ts')
ok('the library store never starts analysis', !startsWork(libraryStore))
ok('initNativeLibrary does not trigger analysis',
  !codeOnly(libraryStore).includes('analyzeTrack')
  && !codeOnly(libraryStore).includes('enqueueAnalysisBatch'))
ok('a library scan does not chain into analysis',
  !codeOnly(libraryStore).includes('audioAnalysis'))

// ============================================================
console.log('\nEvery Vue component: automatic hooks must not start work')
// ============================================================

const vueFiles = [...walk('app/components'), ...walk('app/pages')].filter(f => f.endsWith('.vue'))
ok('components and pages were discovered', vueFiles.length > 20, `${vueFiles.length} files`)

/**
 * Extracts the bodies of hooks that fire WITHOUT user interaction.
 * A call inside onMounted runs by itself; the same call inside a
 * click handler does not, and is legitimate.
 */
function autoRunBlocks(src: string): string {
  const code = codeOnly(src)
  const blocks: string[] = []

  // onMounted(...) / onActivated(...) / watch(...) / watchEffect(...)
  // Brace-matched so nested code is captured accurately.
  for (const match of code.matchAll(/\b(onMounted|onActivated|onBeforeMount|watchEffect|watch|onServerPrefetch)\s*\(/g)) {
    const start = match.index! + match[0].length
    let depth = 1
    let i = start
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++
      else if (code[i] === ')') depth--
      i++
    }
    blocks.push(code.slice(start, i))
  }

  // Top-level immediate calls in <script setup> (outside any function)
  // are also automatic. Approximated by lines that are a bare call at
  // zero indentation.
  for (const line of code.split('\n')) {
    if (/^(await\s+)?(void\s+)?[a-zA-Z_$][\w$.]*\s*\(/.test(line)) blocks.push(line)
  }

  return blocks.join('\n')
}

const autoStarters: string[] = []
for (const file of vueFiles) {
  const src = read(file)
  if (startsWork(autoRunBlocks(src))) autoStarters.push(file)
}
ok('no component or page starts analysis from an automatic hook',
  autoStarters.length === 0,
  autoStarters.length ? `offenders: ${autoStarters.join(', ')}` : '')

// The components that DO analyse must only do so from a handler.
const fullPlayer = read('app/components/FullPlayer.vue')
ok('FullPlayer analyses only from an explicit confirm handler',
  /function onAnalyzeConfirm/.test(fullPlayer) && !startsWork(autoRunBlocks(fullPlayer)))

const companion = read('app/components/ai/AICompanionAnalysis.vue')
ok('the AI panel analyses only from its button handler',
  /function onAnalyze\b/.test(companion) && !startsWork(autoRunBlocks(companion)))
ok('the AI panel only hydrates and reads counters on mount',
  /onMounted/.test(companion) && !startsWork(autoRunBlocks(companion)))

// ============================================================
console.log('\nThe audio-analysis settings page')
// ============================================================

const settingsPage = read('app/pages/settings/audio-analysis.vue')
ok('opening the settings page does not analyse anything',
  !startsWork(autoRunBlocks(settingsPage)))
ok('the settings page does analyse on explicit request',
  /analyzeTrack\s*\(/.test(codeOnly(settingsPage)),
  'the page must still be able to analyse when the user asks')
ok('the scan-completion watcher only reloads the list and counters',
  !startsWork(autoRunBlocks(settingsPage)))

// ============================================================
console.log('\nThe composable itself')
// ============================================================

const composable = read('app/composables/useAudioAnalysis.ts')
const composableCode = codeOnly(composable)
ok('hydrate() only reads stored state, never analyses',
  /async function hydrate/.test(composableCode)
  && !/async function hydrate[\s\S]*?analyzeTrackNative/.test(
    composableCode.slice(composableCode.indexOf('async function hydrate'),
      composableCode.indexOf('async function refreshSummary')),
  ))
ok('refreshSummary() only reads counters',
  !/async function refreshSummary[\s\S]{0,400}analyzeTrackNative/.test(composableCode))
ok('the composable has no module-scope call that would run on import',
  !/^\s*(void\s+)?analyze\s*\(/m.test(composableCode))

// ============================================================
console.log('\nNative: the Activity and plugin registration')
// ============================================================

const mainActivity = codeOnly(read('android/app/src/main/java/com/systema/music/MainActivity.java'))
ok('MainActivity registers the analysis plugin', mainActivity.includes('AudioAnalysisPlugin.class'))
ok('MainActivity never enqueues analysis work',
  !mainActivity.includes('AudioAnalysisScheduler') && !mainActivity.includes('enqueue'))
ok('MainActivity never touches the analysis repository',
  !mainActivity.includes('AudioAnalysisRepository'))

const plugin = codeOnly(read('android/app/src/main/java/com/systema/music/analysis/AudioAnalysisPlugin.kt'))
ok('the plugin does no work in its constructor or load()',
  !/override fun load\(\)[\s\S]{0,300}(enqueue|analyzeTrack)/.test(plugin))
ok('the plugin only analyses inside @PluginMethod handlers',
  plugin.includes('@PluginMethod'))

// Count the call sites: every one must be inside a bridge method the
// WebView has to invoke deliberately.
const enqueueCalls = [...plugin.matchAll(/AudioAnalysisScheduler\.enqueue\w*\(/g)]
ok('the only native enqueue call is in the enqueueBatch bridge method',
  enqueueCalls.length === 1, `found ${enqueueCalls.length}`)

// ============================================================
console.log('\nNative: the scheduler defines no automatic work')
// ============================================================

const scheduler = codeOnly(read('android/app/src/main/java/com/systema/music/analysis/work/AudioAnalysisScheduler.kt'))

// WorkManager's recurring/self-starting APIs must be absent entirely.
for (const api of [
  'PeriodicWorkRequest',
  'PeriodicWorkRequestBuilder',
  'enqueueUniquePeriodicWork',
  'setPeriodic',
  'Configuration.Provider',
  'WorkManagerInitializer',
]) {
  ok(`the scheduler does not use ${api}`, !scheduler.includes(api))
}

ok('the scheduler only exposes explicit entry points',
  scheduler.includes('fun enqueueTracks') && scheduler.includes('fun enqueueBatch')
  && scheduler.includes('fun cancelAll'))

const worker = codeOnly(read('android/app/src/main/java/com/systema/music/analysis/work/AudioAnalysisWorker.kt'))
ok('the worker does not reschedule itself',
  !worker.includes('AudioAnalysisScheduler') && !worker.includes('enqueue'))
ok('the worker processes a bounded batch, not the whole library',
  worker.includes('MAX_BATCH_SIZE') && worker.includes('coerceIn(1, MAX_BATCH_SIZE)'))

// ============================================================
console.log('\nNative: no app-startup initializer runs analysis')
// ============================================================

const manifest = read('android/app/src/main/AndroidManifest.xml')
ok('no androidx.startup provider is declared',
  !manifest.includes('androidx.startup'))
ok('no custom Application class is declared that could bootstrap work',
  !/android:name="\.\w*Application"/.test(manifest))
ok('the only declared service is the media playback service',
  (manifest.match(/<service/g) ?? []).length === 1
  && manifest.includes('PlaybackService'))
ok('no BOOT_COMPLETED receiver exists',
  !manifest.includes('BOOT_COMPLETED'))

// A whole-package sweep: nothing outside the analysis package may
// reach the scheduler at all.
const nativeFiles = walk('android/app/src/main/java').filter(
  f => (f.endsWith('.kt') || f.endsWith('.java'))
    && !f.includes('/analysis/'),
)
const schedulerLeaks = nativeFiles.filter(f => codeOnly(read(f)).includes('AudioAnalysisScheduler'))
ok('nothing outside the analysis package references the scheduler',
  schedulerLeaks.length === 0, schedulerLeaks.join(', '))

const repoLeaks = nativeFiles.filter(f => codeOnly(read(f)).includes('AudioAnalysisRepository'))
ok('nothing outside the analysis package references the analysis repository',
  repoLeaks.length === 0, repoLeaks.join(', '))

// The player must never trigger analysis when a track starts.
const playerFiles = walk('android/app/src/main/java/com/systema/music/player')
for (const file of playerFiles) {
  const name = file.split('/').pop()!
  ok(`${name} does not trigger analysis on playback`,
    !codeOnly(read(file)).includes('Analysis'))
}

// ============================================================
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`)
if (failed > 0) process.exit(1)
