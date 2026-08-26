// ============================================================
// SYSTEMA — Phase 14: the benchmark lab cannot touch the library
// ============================================================
// THE MOST IMPORTANT SUITE IN PHASE 14 (§2, §21, §23).
//
// The absolute constraint on this phase is that benchmarking must
// never analyse the user's music library. Not on startup, not after a
// scan, not in the background, not "just the first hundred". A
// benchmark sees a hand-built dataset of at most 20 samples and
// nothing else.
//
// Proving a negative
// ------------------
// "No code path does X" cannot be proven by running one scenario, so
// this is a static audit — the same method Phase 13's no-autostart
// suite uses, and for the same reason. To keep it honest rather than
// a naive grep it:
//
//   1. strips comments first, so the extensive prose in these files
//      about what is deliberately NOT done cannot satisfy or trip a
//      check;
//   2. inspects auto-run surfaces specifically (Nuxt plugins,
//      onMounted, watch, WorkManager APIs) rather than whole files,
//      so an explicitly user-triggered call is correctly allowed;
//   3. additionally EXECUTES the dataset builders against oversized
//      input, so the 20-sample cap is verified behaviourally and not
//      merely asserted to exist in the source.
//
// Point 3 matters: a static check alone could be defeated by a
// refactor, but a runtime cap that truncates 5,000 tracks to 20
// cannot be.
// ============================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
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

/** Removes comments so documentation cannot satisfy a check. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
}

function walk(dir: string, out: string[] = [], match = /\.(ts|vue)$/): string[] {
  const abs = resolve(root, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    if (statSync(full).isDirectory()) walk(full, out, match)
    else if (match.test(entry)) out.push(full)
  }
  return out
}

console.log('\n\x1b[1mPhase 14 — benchmark lab safety\x1b[0m')

// ------------------------------------------------------------
console.log('\n\x1b[1m1. No library-wide analysis entry points\x1b[0m')
// ------------------------------------------------------------

const labFiles = [
  ...walk('app/services/ai-lab'),
  ...walk('app/pages/dev'),
  ...walk('app/components/ai-lab'),
  resolve(root, 'app/stores/aiLab.ts'),
].filter(existsSync)

ok('the AI lab source tree exists', labFiles.length >= 8,
  `found ${labFiles.length} files`)

/**
 * Phrases that would indicate a whole-library sweep. These are the
 * concrete API shapes that could actually enumerate the library.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp, why: string }> = [
  { pattern: /\ballTracks\b/, why: 'enumerates the whole library' },
  { pattern: /\bloadAllTracks\b/, why: 'loads the entire library' },
  { pattern: /analyzeAll|analyseAll|indexAll|embedAll/i, why: 'whole-library processing' },
  { pattern: /\bWorkManager\b/, why: 'background work scheduling' },
  { pattern: /PeriodicWorkRequest|enqueueUniquePeriodicWork/, why: 'recurring background work' },
  { pattern: /AudioAnalysisScheduler/, why: 'Phase 13 batch scheduler' },
  { pattern: /library\.tracks\s*\.\s*forEach/, why: 'iterates every loaded track' },
]

/**
 * `scanLibrary` is allowed ONLY behind an explicit user gesture.
 *
 * The real-audio page needs a SCAN button so it works without a
 * detour to Library settings — the same self-sufficiency the Phase 13
 * diagnostic page has. What must never happen is a scan starting on
 * its own, so the check moved from "is the call present" to "is the
 * call reachable from an auto-run surface". A blanket ban would have
 * been easy to satisfy and would have tested the wrong property.
 */
function autoRunSurfaces(source: string): string {
  const blocks: string[] = []
  const patterns = [
    /onMounted\s*\([\s\S]*?\n\}\)/g,
    /watch\s*\([\s\S]*?\n\}\)/g,
    /watchEffect\s*\([\s\S]*?\n\}\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) blocks.push(match[0])
  }
  return blocks.join('\n')
}

for (const file of labFiles) {
  const relative = file.replace(`${root}/`, '')
  const source = codeOnly(readFileSync(file, 'utf8'))
  for (const { pattern, why } of FORBIDDEN_PATTERNS) {
    const hit = pattern.test(source)
    ok(`${relative}: no ${pattern.source} (${why})`, !hit)
  }
  // A scan may exist behind a button, but must never self-start.
  ok(`${relative}: no scanLibrary from an auto-run surface`,
    !/\bscanLibrary\s*\(/.test(autoRunSurfaces(source)))
  ok(`${relative}: no benchmark execution from an auto-run surface`,
    !/\b(execute|runTest|runBenchmark|measureRealTrack)\s*\(/
      .test(autoRunSurfaces(source)))
}

// ------------------------------------------------------------
console.log('\n\x1b[1m2. The store exposes no library-wide action\x1b[0m')
// ------------------------------------------------------------

const storeSource = codeOnly(read('app/stores/aiLab.ts'))

ok('store does not import the library store',
  !/from\s+['"]~\/stores\/library['"]/.test(storeSource))

ok('store has no benchmarkAll-style action',
  !/benchmarkAll|runAll|analyzeLibrary|analyseLibrary/i.test(storeSource))

// The store must not run anything at definition time. Only refresh()
// (reading stored results) may be called by the page on mount.
ok('store body contains no onMounted',
  !/onMounted\s*\(/.test(storeSource))

ok('store body contains no watch that triggers execution',
  !/watch\s*\([^)]*execute/.test(storeSource))

ok('store defines an explicit execute() gated on user action',
  /async function execute\s*\(/.test(storeSource))

// ------------------------------------------------------------
console.log('\n\x1b[1m3. No Nuxt plugin or startup hook launches a benchmark\x1b[0m')
// ------------------------------------------------------------

const pluginFiles = walk('app/plugins')
for (const file of pluginFiles) {
  const relative = file.replace(`${root}/`, '')
  const source = codeOnly(readFileSync(file, 'utf8'))
  ok(`${relative}: does not reference the AI lab`,
    !/ai-lab|aiLab|benchmark/i.test(source))
}
ok('plugin audit ran over the real plugin directory', pluginFiles.length > 0,
  `${pluginFiles.length} plugins`)

// The app shell must not mount anything from the lab.
const shell = codeOnly(read('app/components/AppShell.vue'))
ok('AppShell does not reference the AI lab',
  !/ai-lab|aiLab|benchmark/i.test(shell))

// ------------------------------------------------------------
console.log('\n\x1b[1m4. The lab is not linked from production navigation (§15)\x1b[0m')
// ------------------------------------------------------------

// The lab must stay out of the BROWSING experience: home, library,
// player, search and AI insights. Settings is treated separately
// below, because a developer on real hardware has no address bar.
const navigationFiles = [
  'app/components/AppShell.vue',
  'app/components/MobileDock.vue',
  'app/components/DesktopSidebar.vue',
  'app/components/MobileHeader.vue',
  'app/components/MobileBottomNavigation.vue',
  'app/pages/index.vue',
  'app/pages/ai.vue',
  'app/pages/search.vue',
].filter(p => existsSync(resolve(root, p)))

for (const relative of navigationFiles) {
  const source = codeOnly(read(relative))
  ok(`${relative}: contains no /dev/ai-benchmark link`,
    !/dev\/ai-benchmark/.test(source))
}
ok('navigation audit covered the real navigation surfaces',
  navigationFiles.length >= 5, `${navigationFiles.length} files`)

// Settings: exactly one entry, clearly marked as a developer tool.
//
// This is a deliberate, narrow exception to §15. Inside the Android
// WebView there is no address bar, so without it the lab would be
// unreachable on the very hardware it exists to measure. The
// constraint that still matters — that it is not part of the normal
// browsing experience — is preserved and asserted here.
const settingsSource = codeOnly(read('app/data/settings.ts'))
const labEntries = settingsSource.match(/dev\/ai-benchmark/g) ?? []
ok('settings exposes the lab exactly once', labEntries.length === 1,
  `found ${labEntries.length}`)
ok('the settings entry is marked as a developer diagnostic',
  /ai-benchmark[\s\S]{0,400}?Developer Diagnostic/.test(settingsSource)
  || /Developer Diagnostic[\s\S]{0,400}?ai-benchmark/.test(settingsSource))
ok('the settings entry states it is not a production feature',
  /ai-benchmark[\s\S]{0,400}?[Nn]ot a production feature/.test(settingsSource))

// ------------------------------------------------------------
console.log('\n\x1b[1m5. The lab route uses the isolated dev layout\x1b[0m')
// ------------------------------------------------------------

const labPage = read('app/pages/dev/ai-benchmark/index.vue')
ok('dashboard declares layout: dev', /layout:\s*['"]dev['"]/.test(labPage))
ok('run detail declares layout: dev',
  /layout:\s*['"]dev['"]/.test(read('app/pages/dev/ai-benchmark/[runId].vue')))
ok('comparison declares layout: dev',
  /layout:\s*['"]dev['"]/.test(read('app/pages/dev/ai-benchmark/compare.vue')))

const devLayout = read('app/layouts/dev.vue')
ok('dev layout does not mount AppShell', !/<AppShell/.test(devLayout))

// ------------------------------------------------------------
console.log('\n\x1b[1m6. Phase 13 is untouched (§22)\x1b[0m')
// ------------------------------------------------------------

// Phase 14 stores results in its own namespace precisely so the
// Phase 13 Room schema never needs a migration. Assert that.
const kotlinRoot = 'android/app/src/main/java/com/systema/music'
const kotlinFiles = walk(kotlinRoot, [], /\.kt$/)
ok('the Kotlin source tree was found', kotlinFiles.length > 0,
  `${kotlinFiles.length} files`)

const dbFiles = kotlinFiles.filter(f => /MusicLibraryDatabase\.kt$/.test(f))
ok('the Room database source was found', dbFiles.length > 0)

for (const file of dbFiles) {
  const source = readFileSync(file, 'utf8')
  const versionMatch = /version\s*=\s*(\d+)/.exec(source)
  ok(`${file.replace(`${root}/`, '')}: schema version is still 2`,
    versionMatch?.[1] === '2', `found version ${versionMatch?.[1] ?? 'none'}`)
}

// The Phase 13 five-minute window must be intact.
const windowSources = kotlinFiles.filter(f =>
  /maxAnalysisDurationMs/.test(readFileSync(f, 'utf8')))
ok('the analysis window constant still exists', windowSources.length > 0)

const anyWindow = windowSources.map(f => readFileSync(f, 'utf8')).join('\n')
ok('the 5-minute (300_000 ms) window is preserved',
  /300_000L?/.test(anyWindow))

// loudnessDbfs must not have been renamed to anything LUFS-flavoured.
const analysisSources = kotlinFiles.map(f => readFileSync(f, 'utf8')).join('\n')
ok('loudnessDbfs is still named loudnessDbfs',
  /loudnessDbfs/.test(analysisSources))

// Comments are stripped first: the Phase 13 sources deliberately
// mention LUFS in prose to DISCLAIM it ("this is explicitly NOT
// LUFS"), which is exactly the honesty we want to keep. What must
// not exist is a LUFS identifier in actual code.
ok('no LUFS identifier exists in Kotlin code (comments excluded)',
  !/\bLUFS\b/i.test(codeOnly(analysisSources)))
ok('the Phase 13 sources still explicitly disclaim LUFS in prose',
  /NOT LUFS/i.test(analysisSources))

// Phase 14 must not have added a Room entity of its own.
ok('no benchmark Room entity was introduced',
  !/BenchmarkRun|benchmark/i.test(
    kotlinFiles.filter(f => /db\//.test(f))
      .map(f => readFileSync(f, 'utf8')).join('\n')))

// Phase 14 READS the Phase 13 analysis surface (that is how real
// audio gets decoded) but must never MODIFY it. Reading is confined
// to one module so the coupling stays visible and reviewable.
const phase13Consumers = labFiles.filter(f =>
  /audioAnalysisPlugin|audioAnalysisService/.test(codeOnly(readFileSync(f, 'utf8'))))
  .map(f => f.replace(`${root}/`, ''))

ok('only deviceAudio.ts and the real-audio page touch the Phase 13 API',
  phase13Consumers.every(f =>
    f.endsWith('deviceAudio.ts') || f.endsWith('real-audio.vue')),
  phase13Consumers.join(', '))

// It may call analyzeTrack; it must not schedule or batch anything.
const deviceAudioSource = codeOnly(read('app/services/ai-lab/deviceAudio.ts'))
ok('deviceAudio only analyses one explicitly named track at a time',
  /analyzeTrack\(trackId/.test(deviceAudioSource))
ok('deviceAudio never enumerates tracks',
  !/getAllTracks|listTracks|tracks\s*\.\s*map/.test(deviceAudioSource))

// ------------------------------------------------------------
console.log('\n\x1b[1m7. Dataset cap is enforced at runtime, not just documented\x1b[0m')
// ------------------------------------------------------------

const { buildDeviceDataset, validateDataset, syntheticDataset, fullSyntheticDataset, MAX_DATASET_SAMPLES }
  = await import('../app/services/ai-lab/dataset')

ok('the documented cap is 20', MAX_DATASET_SAMPLES === 20)

// The decisive test: hand it a whole library and watch it truncate.
const hugeLibrary = Array.from({ length: 5000 }, (_, i) => ({
  id: `track-${i}`,
  title: `Track ${i}`,
  durationMs: 200_000,
}))
const capped = buildDeviceDataset(hugeLibrary)
ok('a 5,000-track input is truncated to the cap',
  capped.samples.length === MAX_DATASET_SAMPLES,
  `got ${capped.samples.length}`)

ok('validateDataset rejects an oversized dataset',
  validateDataset({
    datasetId: 'oversized',
    name: 'oversized',
    description: '',
    samples: Array.from({ length: 40 }, (_, i) => ({
      sampleId: `s${i}`,
      label: `s${i}`,
      kind: 'synthetic' as const,
      characteristics: [],
      durationSec: 1,
    })),
  }).some(problem => /cap/i.test(problem)))

ok('the synthetic dataset also respects the cap',
  fullSyntheticDataset().samples.length <= MAX_DATASET_SAMPLES)

ok('an empty dataset is rejected',
  validateDataset({ datasetId: 'x', name: 'x', description: '', samples: [] }).length > 0)

// ------------------------------------------------------------
console.log('\n\x1b[1m8. No audio, embeddings or paths are persisted (§11, §20)\x1b[0m')
// ------------------------------------------------------------

const deviceDataset = buildDeviceDataset([
  { id: 'content://media/external/audio/media/42', title: 'Some Song', durationMs: 180_000 },
])
const sample = deviceDataset.samples[0]!

ok('a device sample stores a track id, not a filesystem path',
  typeof sample.trackId === 'string' && !sample.trackId.startsWith('/'))
ok('a device sample carries no audio buffer',
  !Object.prototype.hasOwnProperty.call(sample, 'audio')
  && !Object.prototype.hasOwnProperty.call(sample, 'pcm'))

const typesSource = codeOnly(read('app/services/ai-lab/types.ts'))
ok('SampleResult has no field for raw audio',
  !/\baudio(Buffer|Data|Bytes|Pcm)\b/i.test(typesSource))
ok('SampleResult stores embedding statistics, not the embedding',
  /embeddingStats\?:/.test(typesSource) && !/embedding:\s*Float32Array/.test(typesSource))

const exportSource = codeOnly(read('app/services/ai-lab/resultStore.ts'))

// Behavioural rather than textual: build a real export and inspect
// the payload keys. The disclaimer string mentions the word "audio"
// (to warn the reader), so a naive grep would be misleading here.
const { exportRuns } = await import('../app/services/ai-lab/resultStore')
const exported = JSON.parse(exportRuns([{
  id: 'r1',
  timestamp: 1,
  environment: 'SYNTHETIC',
  status: 'SUCCESS',
  modelId: 'reference-dsp-v1',
  modelName: 'Reference',
  modelVersion: '1.0.0',
  device: {
    label: 'test', platform: 'web', cpuArchitecture: 'x86_64', osVersion: 'Linux',
    totalRamMb: { value: null, confidence: 'UNKNOWN' }, isTargetDevice: false,
  },
  runtime: 'reference',
  executionProvider: 'cpu',
  datasetId: 'synthetic-v1-1',
  sampleCount: 1,
  performance: {
    modelLoadMs: { value: 1, confidence: 'MEASURED' },
    warmupMs: { value: 1, confidence: 'MEASURED' },
    averageInferenceMs: { value: 1, confidence: 'MEASURED' },
    medianInferenceMs: { value: 1, confidence: 'MEASURED' },
    p95InferenceMs: { value: 1, confidence: 'MEASURED' },
    throughputPerSec: { value: 1, confidence: 'MEASURED' },
    totalAudioSec: 10,
    realTimeFactor: { value: 0.1, confidence: 'MEASURED' },
  },
  memory: {
    baselineMb: { value: null, confidence: 'UNKNOWN' },
    peakMb: { value: null, confidence: 'UNKNOWN' },
    deltaMb: { value: null, confidence: 'UNKNOWN' },
  },
  cpuUsage: { value: null, confidence: 'NOT_APPLICABLE' },
  reliability: {
    successfulSamples: 1, failedSamples: 0, errorCount: 0,
    timeoutCount: 0, successRate: 1,
  },
  quality: {
    determinism: { value: 1, confidence: 'MEASURED' },
    meanPairwiseSimilarity: { value: 0.4, confidence: 'MEASURED' },
    nearestNeighbourSane: true,
    notes: [],
  },
  samples: [{
    sampleId: 's1',
    status: 'SUCCESS',
    inferenceMs: 1,
    audioSec: 10,
    embeddingStats: {
      dimension: 64, l2Norm: 1, mean: 0, min: -1, max: 1, hasNonFinite: false,
    },
  }],
  reproducibility: {
    modelId: 'reference-dsp-v1', modelVersion: '1.0.0', modelChecksum: null,
    runtime: 'reference', executionProvider: 'cpu', datasetId: 'synthetic-v1-1',
    preprocessing: {
      sampleRate: 22050, channels: 1, windowSec: 10, overlapSec: 0,
      normalization: 'peak', aggregation: 'mean',
    },
    appVersion: '0.14.0', harnessVersion: 1, warmupRuns: 2, measuredRuns: 3,
  },
  warnings: [],
}]))

ok('the export payload has exactly the expected top-level keys',
  JSON.stringify(Object.keys(exported).sort())
  === JSON.stringify(['disclaimer', 'exportVersion', 'exportedAt', 'runs']))

const exportedSample = exported.runs[0].samples[0]
ok('an exported sample carries no audio payload',
  !Object.keys(exportedSample).some(k => /^(audio|pcm|buffer|waveform)$/i.test(k)))
ok('an exported sample carries no raw embedding',
  !Object.prototype.hasOwnProperty.call(exportedSample, 'embedding'))
ok('an exported sample keeps only embedding statistics',
  typeof exportedSample.embeddingStats?.l2Norm === 'number')
ok('the export states its DESKTOP/SYNTHETIC caveat',
  /DESKTOP/.test(exported.disclaimer) && /SYNTHETIC/.test(exported.disclaimer))

// ------------------------------------------------------------
console.log('\n\x1b[1m9. Isolated storage — Room is untouched (§21)\x1b[0m')
// ------------------------------------------------------------

ok('the result store uses its own namespaced key',
  /systema:ai-lab:runs/.test(exportSource))
ok('the result store does not touch the settings key',
  !/SETTINGS_STORAGE_KEY/.test(exportSource))
ok('the result store does not reference Room or SQLite',
  !/Room|sqlite|execSQL/i.test(exportSource))

// ------------------------------------------------------------
console.log('\n\x1b[1m10. Structured logging carries no user data (§24)\x1b[0m')
// ------------------------------------------------------------

const runnerSource = codeOnly(read('app/services/ai-lab/benchmarkRunner.ts'))
ok('logs use the [AI-BENCHMARK] prefix', /\[AI-BENCHMARK\]/.test(runnerSource))
ok('logs do not emit track titles',
  !/title/.test(runnerSource.match(/function logLine[\s\S]*?\n}/)?.[0] ?? ''))
ok('logs do not emit file paths',
  !/\bpath\b|\buri\b/i.test(runnerSource.match(/function logLine[\s\S]*?\n}/)?.[0] ?? ''))

// ------------------------------------------------------------
console.log('\n\x1b[1m11. No premature Phase 15+ features (§32)\x1b[0m')
// ------------------------------------------------------------

const PREMATURE = [
  { pattern: /vectorSearch|VectorIndex|faiss|hnsw/i, why: 'vector search' },
  { pattern: /semanticSearch/i, why: 'semantic search' },
  { pattern: /recommendTracks|recommendationEngine/i, why: 'recommendations' },
  { pattern: /userTaste|tasteProfile/i, why: 'taste profiling' },
  { pattern: /generatePlaylist|aiPlaylist/i, why: 'AI playlists' },
  { pattern: /openai|anthropic|llmClient/i, why: 'LLM integration' },
]

for (const file of labFiles) {
  const relative = file.replace(`${root}/`, '')
  const source = codeOnly(readFileSync(file, 'utf8'))
  for (const { pattern, why } of PREMATURE) {
    ok(`${relative}: no ${why}`, !pattern.test(source))
  }
}

// No new runtime dependency was smuggled in.
const pkg = JSON.parse(read('package.json'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
ok('onnxruntime was NOT added as a dependency in Phase 14',
  !Object.keys(deps).some(d => /onnxruntime/i.test(d)))
ok('no tensorflow dependency was added',
  !Object.keys(deps).some(d => /tensorflow|tfjs/i.test(d)))

const gradle = existsSync(resolve(root, 'android/app/build.gradle'))
  ? read('android/app/build.gradle')
  : ''
ok('no onnxruntime AAR was added to Gradle',
  !/onnxruntime/i.test(gradle))

// ------------------------------------------------------------
console.log('\n\x1b[1m12. Production selection is never automatic (§28)\x1b[0m')
// ------------------------------------------------------------

ok('selectProductionModel requires an explicit rationale',
  /if\s*\(!rationale\.trim\(\)\)\s*return false/.test(storeSource))
ok('execute() never writes a production selection',
  !/saveProductionSelection/.test(
    storeSource.match(/async function execute[\s\S]*?\n {2}}/)?.[0] ?? ''))
ok('the dashboard renders the no-selection state',
  /NO PRODUCTION MODEL SELECTED/.test(labPage))

// ------------------------------------------------------------
console.log(
  `\n\x1b[1mPhase 14 safety: \x1b[32m${passed} passed\x1b[0m`
  + (failed ? `, \x1b[31m${failed} failed\x1b[0m` : '')
  + '\x1b[0m\n',
)
if (failed > 0) process.exit(1)
