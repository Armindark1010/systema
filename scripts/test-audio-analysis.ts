// ============================================================
// SYSTEMA — Phase 13: audio analysis contract (TypeScript side)
// ============================================================
// The DSP itself is Kotlin and is tested by scripts/run-dsp-tests.sh
// against real synthetic signals. This suite covers the parts that
// live in TypeScript:
//
//   - the web build must not crash or invent analysis data
//   - the native contract must be fully typed (no `any`)
//   - formatting must distinguish "no value" from "zero", and
//     "tempo undetermined" from "tempo unavailable"
//
// The browser rules matter as much as the native ones: SYSTEMA runs in
// a plain browser during development, where there is no decoder and no
// MediaStore, and every analysis entry point has to degrade quietly.
// ============================================================

import { readFileSync } from 'node:fs'
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

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(name, a === b, a === b ? '' : `expected ${b}, got ${a}`)
}

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

console.log('\n\x1b[1mSYSTEMA — Phase 13 audio analysis contract\x1b[0m\n')

// ============================================================
console.log('Browser safety')
// ============================================================
// The service is imported for real here. If it touched Capacitor at
// module scope, or assumed a native platform, this import would throw
// under tsx — which is precisely the web-mode crash we must prevent.

const service = await import('../app/services/native/audioAnalysisService.js')

ok('the analysis service imports outside a browser/native runtime',
  typeof service.analyzeTrack === 'function')

// Every entry point must resolve rather than throw when no analyser
// exists. Capacitor reports a non-native platform under tsx, so these
// exercise the real browser branch.
const analysis = await service.analyzeTrack('track-1')
check('analyzeTrack returns null in the browser', analysis, null)

const stored = await service.getAnalysis('track-1')
check('getAnalysis returns null in the browser', stored, null)

const status = await service.getAnalysisStatus('track-1')
check('getAnalysisStatus returns null in the browser', status, null)

const summary = await service.getAnalysisSummary()
check('getAnalysisSummary returns null in the browser', summary, null)

const enqueued = await service.enqueueAnalysisBatch(5)
check('enqueueAnalysisBatch is a no-op in the browser', enqueued, false)

const cancelled = await service.cancelAnalysis()
check('cancelAnalysis is a no-op in the browser', cancelled, false)

ok('no mock analysis is fabricated for the browser',
  analysis === null && stored === null,
  'the web build must report absence, not invented DSP values')

// ============================================================
console.log('\nError normalisation')
// ============================================================

const structured = service.toAnalysisError({ code: 'UNSUPPORTED_FORMAT', message: 'nope' })
check('a structured native error keeps its code', structured.code, 'UNSUPPORTED_FORMAT')
check('a structured native error keeps its message', structured.message, 'nope')

const bare = service.toAnalysisError(new Error('boom'))
check('an unstructured error becomes UNKNOWN', bare.code, 'UNKNOWN')
ok('an unstructured error still carries a message', bare.message.length > 0)

const nothing = service.toAnalysisError(undefined)
check('undefined becomes UNKNOWN', nothing.code, 'UNKNOWN')

// ============================================================
console.log('\nFormatting distinguishes absence from zero')
// ============================================================

check('a real value formats with its unit',
  service.formatAnalysisValue(0.4567, ' dB', 2), '0.46 dB')
check('zero formats as zero, not as absent',
  service.formatAnalysisValue(0, '', 2), '0.00')
check('null formats as a dash', service.formatAnalysisValue(null), '—')
check('undefined formats as a dash', service.formatAnalysisValue(undefined), '—')
check('NaN formats as a dash', service.formatAnalysisValue(Number.NaN), '—')

check('a confident tempo reads naturally',
  service.formatBpm({ bpm: 128.4, bpmConfidence: 0.82 }), '128.4 BPM (82% confident)')
check('an undetermined tempo with evidence says so',
  service.formatBpm({ bpm: null, bpmConfidence: 0.09 }), 'undetermined (confidence 9%)')
check('an undetermined tempo with no evidence says so plainly',
  service.formatBpm({ bpm: null, bpmConfidence: 0 }), 'undetermined')
ok('a null BPM is never rendered as 0 BPM',
  !service.formatBpm({ bpm: null, bpmConfidence: null }).includes('0 BPM'))

// ============================================================
console.log('\nNative contract typing')
// ============================================================

const pluginSrc = read('app/services/native/audioAnalysisPlugin.ts')
const serviceSrc = read('app/services/native/audioAnalysisService.ts')

// No `any` anywhere in the contract: the phase spec requires it and a
// single `any` would hollow out the whole typed surface.
const anyMatches = (pluginSrc.match(/:\s*any\b/g) ?? [])
  .concat(serviceSrc.match(/:\s*any\b/g) ?? [])
check('the analysis contract contains no `any`', anyMatches.length, 0)

// Nullability is the contract's core promise.
for (const field of [
  'rms', 'peak', 'silenceRatio', 'spectralCentroid', 'spectralBandwidth',
  'spectralRolloff', 'zeroCrossingRate', 'bpm', 'bpmConfidence',
]) {
  ok(`${field} is nullable in the contract`,
    new RegExp(`${field}:\\s*number \\| null`).test(pluginSrc))
}

ok('durationMs is non-nullable (always known)',
  /durationMs:\s*number\n/.test(pluginSrc) || /durationMs:\s*number$/m.test(pluginSrc))
ok('analyzerVersion is non-nullable', /analyzerVersion:\s*number$/m.test(pluginSrc))

// ============================================================
console.log('\nLoudness is labelled honestly')
// ============================================================
// The spec is explicit: an RMS-derived value must not be called LUFS.

ok('the loudness field is named loudnessDbfs, not lufs',
  pluginSrc.includes('loudnessDbfs') && !/\blufs\b/i.test(pluginSrc.replace(/NOT called LUFS|NOT LUFS/gi, '')))
ok('the contract documents that it is not LUFS',
  /not.{0,20}LUFS/i.test(pluginSrc))

const kotlinResult = read('android/app/src/main/java/com/systema/music/analysis/model/AudioAnalysisResult.kt')
ok('the Kotlin model documents the same caveat', /NOT LUFS/i.test(kotlinResult))
ok('the Kotlin field is also named loudnessDbfs', kotlinResult.includes('loudnessDbfs'))

// ============================================================
console.log('\nStructured failure codes')
// ============================================================

const kotlinException = read('android/app/src/main/java/com/systema/music/analysis/AudioAnalysisException.kt')
const requiredCodes = [
  'UNSUPPORTED_FORMAT', 'DECODER_ERROR', 'INVALID_URI', 'EMPTY_AUDIO',
  'INVALID_PCM', 'DSP_ERROR', 'BPM_UNAVAILABLE', 'CANCELLED',
  'OUT_OF_MEMORY', 'UNKNOWN',
]
for (const code of requiredCodes) {
  ok(`${code} exists natively and in TypeScript`,
    kotlinException.includes(code) && pluginSrc.includes(code))
}

// ============================================================
console.log('\nPlayer isolation')
// ============================================================
// The DSP must never reach into playback. This checks the actual
// imports of the analysis package rather than trusting a comment.

const analysisFiles = [
  'android/app/src/main/java/com/systema/music/analysis/AudioAnalyzer.kt',
  'android/app/src/main/java/com/systema/music/analysis/AudioAnalysisRepository.kt',
  'android/app/src/main/java/com/systema/music/analysis/AudioAnalysisPlugin.kt',
  'android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt',
  'android/app/src/main/java/com/systema/music/analysis/work/AudioAnalysisWorker.kt',
]

/**
 * Strips comments so the check tests CODE, not prose. Several of these
 * files legitimately mention ExoPlayer in a comment explaining why
 * they deliberately avoid it, and that explanation must not be
 * mistaken for a dependency.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

for (const file of analysisFiles) {
  const src = codeOnly(read(file))
  const name = file.split('/').pop()
  ok(`${name} does not import the player package`,
    !src.includes('com.systema.music.player'))
  ok(`${name} does not reference ExoPlayer or MediaSession in code`,
    !src.includes('ExoPlayer') && !src.includes('MediaSession'))
  ok(`${name} does not import media3`, !src.includes('androidx.media3'))
}

// The analyser uses its own decode path, not the playback engine.
const decoderSrc = read('android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')
ok('the analyser decodes with MediaExtractor/MediaCodec',
  decoderSrc.includes('MediaExtractor') && decoderSrc.includes('MediaCodec'))
ok('the analyser reads through ContentResolver, not file paths',
  decoderSrc.includes('contentResolver.openFileDescriptor'))

// ============================================================
console.log('\nNo forbidden dependencies were introduced')
// ============================================================

const appGradle = read('android/app/build.gradle')
for (const forbidden of ['onnxruntime', 'tensorflow', 'pytorch', 'clap', 'openai', 'huggingface']) {
  ok(`no ${forbidden} dependency`, !appGradle.toLowerCase().includes(forbidden))
}
ok('WorkManager is the only new Android dependency',
  appGradle.includes('androidx.work:work-runtime-ktx'))

const pkg = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const forbidden of ['onnxruntime-web', '@tensorflow/tfjs', 'openai', '@xenova/transformers']) {
  ok(`no ${forbidden} npm dependency`, !(forbidden in allDeps))
}

// ============================================================
console.log('\nAnalyzer versioning')
// ============================================================

const configSrc = read('android/app/src/main/java/com/systema/music/analysis/dsp/AudioAnalysisConfig.kt')
ok('a single analyzer version constant exists',
  /AUDIO_ANALYZER_VERSION\s*:\s*Int\s*=\s*\d+/.test(configSrc))
ok('the version is documented as DSP, not a model version',
  /not.{0,30}modelVersion/i.test(configSrc))

const daoSrc = read('android/app/src/main/java/com/systema/music/library/db/AudioAnalysisDao.kt')
ok('stale analyses can be detected by version',
  daoSrc.includes('analyzerVersion < :currentVersion'))
ok('upsert prevents duplicate rows per track',
  daoSrc.includes('OnConflictStrategy.REPLACE'))

const dbSrc = read('android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt')
ok('the database version was bumped', dbSrc.includes('version = 2'))
ok('an explicit migration was added, not destructive migration',
  dbSrc.includes('MIGRATION_1_2') && !dbSrc.includes('fallbackToDestructiveMigration'))
ok('the analysis DAO is exposed', dbSrc.includes('audioAnalysisDao'))

// ============================================================
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`)
if (failed > 0) process.exit(1)
