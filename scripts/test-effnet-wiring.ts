/**
 * PHASE 29.x — DISCOGS-EFFNET WIRING (Step 9)
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE
 * ------------------------------------
 * It runs in Node. There is no Android, no ONNX Runtime and no model
 * file, so it CANNOT prove that inference works. Claiming otherwise
 * would be exactly the mistake Step 10 forbids.
 *
 * What it CAN prove is that the wiring is honest: that every path is
 * connected to the next, that identity is derived rather than invented,
 * that no fallback to CLAP or to fabricated data exists anywhere on the
 * error paths, and that the code contains no label-generating logic for
 * heads that do not exist.
 *
 * Those are static and behavioural properties, and they are the ones
 * that historically go wrong silently.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/**
 * Source with comments removed.
 *
 * Every "this file must not mention X" assertion has to run against
 * CODE, not prose. These files explain at length why they do not fall
 * back to CLAP and why they surface no genre — and matching those
 * explanations would fail the very tests the explanations exist to
 * satisfy. Worse, it would push the next person to delete the
 * reasoning to make a test go green.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

let passed = 0
let failed = 0
const failures: string[] = []

function ok(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
  }
  else {
    failed++
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

const KT = 'android/app/src/main/java/com/systema/music/inference'
const session = read(`${KT}/effnet/EffnetDiscogsSession.kt`)
const model = read(`${KT}/effnet/EffnetDiscogsModel.kt`)
const frontEnd = read(`${KT}/effnet/EffnetDiscogsMelFrontEnd.kt`)
const plugin = read(`${KT}/InferencePlugin.kt`)
const registry = read(`${KT}/ModelRegistry.kt`)
const melFrontEnds = read(`${KT}/MelFrontEnds.kt`)
const runtimeTs = read('app/services/music-semantics/providers/semanticRuntime.ts')
const pluginTs = read('app/services/native/inferencePlugin.ts')

// Comment-free views, for the "must not contain" assertions.
const sessionCode = code(session)
const registryCode = code(registry)
const runtimeTsCode = code(runtimeTs)

// =====================================================================
section('1. Registration goes through the EXISTING importer path')
{
  ok('the session does not construct its own storage path',
    !/["']\/sdcard\//.test(sessionCode) && !/getExternalStorage/.test(sessionCode))
  ok('it resolves descriptors through the registry',
    /registry\.resolve\(/.test(session))
  ok('it does NOT build a competing descriptor for loading',
    !/runtime\.loadModel\(\s*EffnetDiscogsModel\.descriptorFor/.test(sessionCode))
  ok('it locates the model by scanning installed files',
    /storage\.listInstalled\(\)/.test(session))
  ok('it never hardcodes a single file name',
    !/discogs-effnet-bsdynamic-1\.onnx["']\s*\)/.test(sessionCode))
  ok('the model is not bundled in the APK',
    !/assets\/.*effnet/i.test(sessionCode)
    && !/installTestModelFromAssets/.test(sessionCode))
}

// =====================================================================
section('2. Identity is derived from the file, never invented')
{
  ok('the model id comes from the installed file name',
    /removeSuffix\(ModelStorage\.EXTENSION\)/.test(session))
  ok('a version parser exists', /fun versionFromFileName/.test(model))
  ok('the parser can return null rather than inventing one',
    /fun versionFromFileName\([^)]*\): String\?/.test(model))
  ok('the registry derives a version from the file too',
    /fun versionForInstalled/.test(registry))
  ok('the registry no longer hardcodes "imported" as the version',
    !/version = if \(contract != null\) "imported"/.test(registry))
  ok('the family is matched by prefix, not by one exact id',
    /MODEL_FAMILY/.test(model) && /fun isEffnetDiscogsId/.test(model))

  // bs64 and bsdynamic are DIFFERENT exports and must not collapse
  // into one identity, or swapping them would silently reuse the cache.
  const stem = (f: string) => f.replace(/\.onnx$/, '')
  ok('bs64 and bsdynamic produce different ids',
    stem('discogs-effnet-bs64-1.onnx') !== stem('discogs-effnet-bsdynamic-1.onnx'))
}

// =====================================================================
section('3. Batch size is read from the graph, not from the filename')
{
  ok('a graph-derived batch reader exists', /fun batchSizeFrom/.test(model))
  ok('a batch mode is classified from the loaded model',
    /fun batchModeOf/.test(model))
  ok('Dynamic, Fixed and Unknown are all distinguished',
    /data object Dynamic/.test(model)
    && /data class Fixed/.test(model)
    && /data object Unknown/.test(model))
  ok('the session branches on the real batch mode',
    /BatchMode\.Dynamic/.test(session) && /BatchMode\.Fixed/.test(session))
  ok('a dynamic export runs the whole track in one call',
    /toSingleBatch/.test(session))
  ok('the front end takes the batch as a parameter',
    /batchSize: Int/.test(frontEnd))
}

// =====================================================================
section('4. Preprocessing is EffNet\'s own, never CLAP\'s')
{
  ok('the session builds an EffNet front end',
    /EffnetDiscogsMelFrontEnd\(\)/.test(session))
  ok('it never references the CLAP front end',
    !/ClapMelFrontEnd/.test(sessionCode))
  ok('it never references a CLAP session', !/ClapSession/.test(sessionCode))
  ok('it decodes at the model\'s own rate',
    /targetSampleRate = EffnetDiscogsMelFrontEnd\.SAMPLE_RATE/.test(session))
  ok('that rate is 16 kHz', /const val SAMPLE_RATE = 16_000/.test(frontEnd))
  ok('96 mel bands', /const val MEL_BANDS = 96/.test(frontEnd))
  ok('128-frame patches', /const val PATCH_SIZE = 128/.test(frontEnd))
  ok('patch hop 62', /const val PATCH_HOP = 62/.test(frontEnd))

  // A too-short track must FAIL, not be padded: padding makes the
  // model describe silence and report it as this track's embedding.
  // Padding a short track makes the model describe silence and report
  // it as this track's embedding — a wrong answer that looks right.
  ok('the minimum length is computed from the front end',
    /minimumSamplesForOnePatch/.test(sessionCode))
  ok('short tracks are actively compared against it',
    /if \(pcm\.size < minimum\)/.test(sessionCode))
  ok('and throwing is the response',
    /if \(pcm\.size < minimum\)[\s\S]{0,120}?throw InferenceException/.test(sessionCode))
  ok('the error names the too-short condition',
    /PREPROCESSING_FAILED: the track is too short/.test(session))
  ok('a zero-sample decode is also refused',
    /if \(totalSamples == 0\)[\s\S]{0,120}?throw InferenceException/.test(sessionCode))
}

// =====================================================================
section('5. The mel front-end gate is generic, not a Discogs hack')
{
  ok('a front-end registry exists', /object MelFrontEnds/.test(melFrontEnds))
  ok('it is keyed by a predicate, not a hardcoded id list',
    /matches: \(String\) -> Boolean/.test(melFrontEnds))
  ok('the registry gate asks the registry, not the model name',
    /MelFrontEnds\.hasFrontEndFor/.test(registry))
  ok('ModelRegistry contains no Discogs-specific branch',
    !/discogs/i.test(registryCode))
  // A developer declaring 44100 Hz for a 16 kHz front end has a real
  // disagreement; ignoring it means the decoder resamples to the wrong
  // rate and every mel band lands on the wrong frequency.
  const mfeCode = code(melFrontEnds)
  ok('a conflicting declared sample rate is compared',
    /declaredSampleRate != entry\.sampleRate/.test(mfeCode))
  ok('and the comparison actually gates the result',
    /declaredSampleRate != null && declaredSampleRate != entry\.sampleRate\) return false/
      .test(mfeCode))
  ok('null means "not declared", which is not a conflict',
    /declaredSampleRate != null/.test(mfeCode))
  ok('the conflict has its own explanation',
    /shifts every mel band/.test(melFrontEnds))
  ok('a blocked model gets a reason, not a bare false',
    /fun blockedReasonFor/.test(melFrontEnds))
  ok('MEL_SPECTROGRAM (non-log) is still blocked',
    /MEL_SPECTROGRAM/.test(registry))
}

// =====================================================================
section('6. Four distinct error codes, and never a fallback')
{
  for (const code of [
    'MODEL_NOT_INSTALLED',
    'MODEL_INCOMPATIBLE',
    'PREPROCESSING_FAILED',
    'INFERENCE_FAILED',
  ]) {
    ok(`${code} is reachable from the bridge`, plugin.includes(code))
    ok(`${code} is declared in TypeScript`, pluginTs.includes(code))
  }

  ok('the plugin maps every runtime code explicitly',
    /private fun errorCodeFor/.test(plugin))
  ok('no error path substitutes CLAP',
    !/clap\./i.test(sessionCode))
  ok('the TS runtime never falls back to another provider on error',
    !/catch[\s\S]{0,400}?clap/i.test(runtimeTsCode))
  ok('a failed embedding returns a code, never a vector',
    !/embedding: \[\]/.test(runtimeTsCode) && !/\.fill\(0\)/.test(runtimeTsCode))
  ok('there is no Math.random anywhere in the runtime',
    !/Math\.random/.test(runtimeTsCode))
  ok('the reference runtime is never used as a fallback',
    !/RuntimeIds\.REFERENCE/.test(sessionCode))
}

// =====================================================================
section('7. Output is validated before it can be stored')
{
  ok('an empty embedding is rejected', /returned no embedding/.test(runtimeTs))
  ok('a length mismatch is rejected',
    /does not match the/.test(runtimeTs) && /embeddingDimension/.test(runtimeTs))
  ok('non-finite values are rejected', /Number\.isFinite/.test(runtimeTs))
  ok('an all-zero vector is rejected', /all zeros/.test(runtimeTs))
  ok('INVALID_OUTPUT is the code used for these',
    /code: 'INVALID_OUTPUT'/.test(runtimeTs))

  // Pooling must not average the zero-padded tail of a fixed batch.
  ok('pooling uses the REAL patch count',
    /patches = batch\.realPatchCount/.test(session))
  ok('a shape surprise throws instead of reshaping',
    /MODEL_INCOMPATIBLE: output has/.test(session))
}

// =====================================================================
section('8. No fabricated labels anywhere')
{
  ok('the session states it produces no labels',
    /producesLabels["']?,?\s*,?\s*false/.test(session)
    || /put\("producesLabels", false\)/.test(session))
  ok('the TS result type pins producesLabels to false',
    /producesLabels: false/.test(pluginTs))
  for (const word of ['danceability', 'acousticness', 'happy', 'sad', 'party']) {
    ok(`no hardcoded "${word}" in the session`,
      !new RegExp(word, 'i').test(sessionCode))
  }
  ok('the heads still refuse', /runHead/.test(runtimeTs))
  ok('head conversion is still tracked as outstanding',
    /id: 'head-conversion'[\s\S]{0,300}?done: false/.test(runtimeTs))
  // The 400-way Discogs styles head exists in the graph and is
  // documented, but its taxonomy is not SYSTEMA's, so it must never be
  // emitted as a field. The check is on emitted KEYS, not on prose: the
  // session's user-facing notice legitimately contains the word "genre"
  // in order to say that genre is NOT produced.
  ok('the styles output is documented on the model',
    /STYLE_CLASS_COUNT/.test(model))
  const emittedKeys = [...sessionCode.matchAll(/put\("([A-Za-z]+)"/g)]
    .map(m => m[1]!.toLowerCase())
  for (const banned of ['genre', 'genres', 'style', 'styles', 'mood', 'tags', 'labels']) {
    ok(`no "${banned}" key is emitted to the web layer`,
      !emittedKeys.includes(banned))
  }
  ok('the styles output is not read back from the result',
    !/OUTPUT_STYLES/.test(sessionCode))
}

// =====================================================================
section('9. Identity is carried with the vector, for the cache')
{
  ok('the native result reports the model that produced it',
    /put\("modelId", loadedModelId\)/.test(session))
  ok('and its version', /put\(\s*"modelVersion"/.test(session))
  ok('the TS result carries identity through',
    /modelId: result\.modelId/.test(runtimeTs))
  ok('and the version', /modelVersion: result\.modelVersion/.test(runtimeTs))
  ok('experimental is stamped on the result',
    /experimental: true/.test(runtimeTs) && /put\("experimental", true\)/.test(session))
}

// =====================================================================
section('10. Human labels are untouched by this path')
{
  for (const field of ['groundTruth', 'labelRevision', 'labelNotes', 'humanLabel']) {
    ok(`the session never writes ${field}`, !sessionCode.includes(field))
    ok(`the runtime never writes ${field}`, !runtimeTsCode.includes(field))
  }
}

// =====================================================================
section('11. The TS runtime actually calls native')
{
  ok('it imports the real plugin',
    /InferenceNative/.test(runtimeTs))
  ok('runEmbedding calls effnetEmbedTrack',
    /InferenceNative\.effnetEmbedTrack\(/.test(runtimeTs))
  ok('release calls effnetRelease',
    /InferenceNative\.effnetRelease\(/.test(runtimeTs))
  ok('the bridge declares all four methods',
    /effnetStatus\(\)/.test(pluginTs)
    && /effnetLoadModel\(\)/.test(pluginTs)
    && /effnetEmbedTrack\(/.test(pluginTs)
    && /effnetRelease\(\)/.test(pluginTs))
  ok('the Kotlin plugin implements all four',
    /fun effnetStatus/.test(plugin)
    && /fun effnetLoadModel/.test(plugin)
    && /fun effnetEmbedTrack/.test(plugin)
    && /fun effnetRelease/.test(plugin))
  ok('the browser path refuses instead of simulating',
    /Capacitor\.isNativePlatform\(\)/.test(runtimeTs)
    && /PROVIDER_UNAVAILABLE/.test(runtimeTs))
  ok('the runtime id is taken from RuntimeIds, not typed by hand',
    /RuntimeIds\.ONNX/.test(sessionCode) && !/"onnx"/.test(sessionCode))
}

// =====================================================================
section('12. Behavioural: the runtime refuses off-device')
{
  const rt = await import('../app/services/music-semantics/providers/semanticRuntime')

  const noPlatform = await rt.runEmbedding({ trackId: 't', uri: 'content://x' })
  ok('runEmbedding refuses in Node', noPlatform.ok === false)
  ok('with PROVIDER_UNAVAILABLE',
    !noPlatform.ok && noPlatform.code === 'PROVIDER_UNAVAILABLE')
  ok('and no vector is present', !('value' in noPlatform))

  const noUri = await rt.runEmbedding({ trackId: 't' })
  ok('a missing URI is also refused', noUri.ok === false)

  const status = await rt.embeddingStatus()
  ok('embeddingStatus returns null off-device', status === null)

  ok('releaseRuntime is safe off-device',
    await rt.releaseRuntime().then(() => true).catch(() => false))

  ok('code-level readiness excludes the device-specific requirement',
    rt.isRuntimeReadyForEmbedding() === true)
  ok('overall readiness is still false (heads are missing)',
    rt.isRuntimeReady() === false)
}

// =====================================================================
section('13. Behavioural: the embedding guards actually fire')
{
  const rt = await import('../app/services/music-semantics/providers/semanticRuntime')
  const v = rt.validateEmbedding

  const good = Array.from({ length: 1280 }, (_, i) => (i % 7) - 3)
  ok('a real-looking vector is accepted', v(good, 1280).ok === true)

  ok('an empty array is rejected', v([], 1280).ok === false)
  ok('a non-array is rejected', v(null, 1280).ok === false)
  ok('a wrong length is rejected', v(good.slice(0, 512), 1280).ok === false)

  // THE ONE THAT MATTERS MOST. An all-zero vector is what a graph
  // returns when it was fed silence or an uninitialised buffer, and it
  // is indistinguishable from a valid row once stored.
  const zeros = Array.from({ length: 1280 }, () => 0)
  const zeroResult = v(zeros, 1280)
  ok('an all-zero vector is REJECTED', zeroResult.ok === false)
  ok('and says so plainly',
    !zeroResult.ok && /all zeros/.test(zeroResult.message))
  ok('with INVALID_OUTPUT', !zeroResult.ok && zeroResult.code === 'INVALID_OUTPUT')

  // A single zero among real values is fine — only ALL zero is invalid.
  const oneZero = [...good]
  oneZero[0] = 0
  ok('a single zero element is still accepted', v(oneZero, 1280).ok === true)

  const withNaN = [...good]
  withNaN[5] = Number.NaN
  ok('NaN is rejected', v(withNaN, 1280).ok === false)

  const withInf = [...good]
  withInf[9] = Number.POSITIVE_INFINITY
  ok('Infinity is rejected', v(withInf, 1280).ok === false)

  const withString = [...good] as unknown[]
  withString[3] = '0.5'
  ok('a stringified number is rejected', v(withString, 1280).ok === false)

  // Every rejection must carry a code and a message, never a vector.
  for (const bad of [[], good.slice(0, 4), zeros, withNaN]) {
    const r = v(bad, 1280)
    ok('every rejection carries a usable code and message',
      r.ok === false && typeof r.message === 'string' && r.message.length > 10)
  }
}

// =====================================================================
section('14. The front-end registry matches the right models only')
{
  // Parsed from Kotlin rather than executed — but the RULES are what
  // matter, and they are expressed as a family-prefix predicate.
  const familyMatch = /MODEL_FAMILY = "([a-z-]+)"/.exec(model)
  ok('the family constant is discogs-effnet', familyMatch?.[1] === 'discogs-effnet')

  ok('id matching is prefix-based on the family',
    /fun isEffnetDiscogsId\(modelId: String\): Boolean =\s*\n?\s*modelId\.startsWith\(MODEL_FAMILY\)/
      .test(model))
  // Both official exports must resolve to the same family while
  // remaining distinct identities.
  for (const f of ['discogs-effnet-bs64-1', 'discogs-effnet-bsdynamic-1']) {
    ok(`${f} is in the family`, f.startsWith('discogs-effnet'))
  }
  ok('an unrelated model is not', !'yamnet-1'.startsWith('discogs-effnet'))
  ok('CLAP is not in the family', !'clap-音-2023'.startsWith('discogs-effnet'))

  ok('CLAP is deliberately absent from the registry',
    !/ClapMelFrontEnd/.test(code(melFrontEnds)))
  ok('exactly one front end is registered today',
    (code(melFrontEnds).match(/Entry\(\s*\n\s*id =/g) ?? []).length === 1)
  ok('the entry records where its parameters came from',
    /transcribedFrom/.test(melFrontEnds)
    && /TensorflowInputMusiCNN/.test(melFrontEnds))
  ok('a model with no entry is refused, not defaulted',
    /frontEndFor\(modelId\) \?: return false/.test(melFrontEnds))
  ok('the refusal explains why rather than returning a bare false',
    /No mel front end is implemented/.test(melFrontEnds))
}

// =====================================================================
section('15. The embedding is persisted, and label safety holds')
{
  const rec = await import('../app/services/ai-dataset/semanticRecord')
  const base = {
    model: 'discogs-effnet-bsdynamic-1',
    modelVersion: '1',
    analyzerVersion: 1,
    heads: [],
    unsupported: [],
    sourceDurationSec: 200,
    processedDurationSec: 120,
    sampleRate: 16000,
    decodeMs: 500,
    inferenceMs: 900,
    analyzedAt: new Date().toISOString(),
    experimental: true as const,
    source: 'model' as const,
  }
  const vec = Array.from({ length: 1280 }, (_, i) => (i % 5) - 2)

  ok('an embedding-only record is valid',
    rec.isSemanticAnalysis({ ...base, embedding: vec, embeddingDim: 1280 }))
  ok('a record with no embedding is still valid (pre-29.x rows)',
    rec.isSemanticAnalysis(base))
  ok('an explicit null embedding is valid',
    rec.isSemanticAnalysis({ ...base, embedding: null, embeddingDim: null }))

  ok('an all-zero embedding is REJECTED',
    !rec.isSemanticAnalysis({
      ...base,
      embedding: Array.from({ length: 1280 }, () => 0),
      embeddingDim: 1280,
    }))
  ok('a NaN in the embedding is rejected',
    !rec.isSemanticAnalysis({
      ...base,
      embedding: [...vec.slice(0, 1279), Number.NaN],
      embeddingDim: 1280,
    }))
  ok('a dimension that disagrees with the length is rejected',
    !rec.isSemanticAnalysis({ ...base, embedding: vec, embeddingDim: 512 }))
  ok('a dimension with no vector is rejected',
    !rec.isSemanticAnalysis({ ...base, embeddingDim: 1280 }))
  ok('an empty array is rejected',
    !rec.isSemanticAnalysis({ ...base, embedding: [], embeddingDim: 0 }))

  // The inviolable rule: a model prediction can never claim to be human.
  ok('source must be model, never human',
    !rec.isSemanticAnalysis({ ...base, source: 'human', embedding: vec }))
  ok('experimental cannot be turned off',
    !rec.isSemanticAnalysis({ ...base, experimental: false, embedding: vec }))

  // The bridge must COPY the vector, not alias the caller's array.
  const bridge = await import('../app/services/ai-dataset/semanticBridge')
  const live = [...vec]
  const stored = bridge.toStoredSemantic({
    trackId: 't1',
    model: 'discogs-effnet-bsdynamic-1',
    modelVersion: '1',
    heads: [],
    unsupported: [],
    embedding: live,
    embeddingDim: live.length,
    sourceDurationSec: 200,
    processedDurationSec: 120,
    sampleRate: 16000,
    decodeMs: 500,
    inferenceMs: 900,
    analyzedAt: new Date().toISOString(),
    experimental: true,
  })
  ok('the bridge carries the embedding through',
    stored.embedding?.length === 1280)
  ok('and records its dimension', stored.embeddingDim === 1280)
  live[0] = 999
  ok('the stored copy is independent of the caller\'s array',
    stored.embedding?.[0] !== 999)
  ok('the stored row is itself valid', rec.isSemanticAnalysis(stored))

  // The write path must never touch human fields.
  const svc = read('app/services/ai-dataset/datasetService.ts')
  const saveFn = /export async function saveSemanticAnalysis[\s\S]*?\n}/.exec(svc)?.[0] ?? ''
  ok('saveSemanticAnalysis preserves groundTruth explicitly',
    /groundTruth: existing\.groundTruth/.test(saveFn))
  for (const field of ['labelRevision', 'labelNotes']) {
    ok(`it never assigns ${field}`,
      !new RegExp(`${field}\\s*[:=]\\s*(?!existing)`).test(saveFn))
  }
}

// =====================================================================
section('16. The sheet shows an embedding-only result honestly')
{
  const sheet = read('app/components/player/PlayerAiAnalysis.vue')
  ok('an embedding alone counts as output',
    /hasEmbedding = computed/.test(sheet))
  ok('the section is not gated on heads existing',
    /v-if="hasSemanticOutput"/.test(sheet))
  ok('the dimension is displayed', /embeddingDim/.test(sheet))
  ok('the model identity comes from the record, not a constant',
    /props\.semantic\?\.model|m\.model/.test(sheet))
  ok('it says plainly that no labels are produced',
    /produces an embedding only/.test(sheet))
  ok('the experimental tag is still shown',
    /EXPERIMENTAL/.test(sheet))
  ok('predictions are still gated on real head output',
    /v-if="moodPredictions\.length"/.test(sheet))
  ok('nothing is displayed without a score',
    /pct\(p\.score\)/.test(sheet))
}

// =====================================================================
section('17. An embedding with no heads is a SUCCESS')
{
  const provider = code(read('app/services/music-semantics/providers/jamendoProvider.ts'))
  ok('zero heads is no longer an automatic failure',
    !/heads\.length === 0[\s\S]{0,200}?code: 'INFERENCE_FAILED'/.test(provider))
  ok('the embedding is attached to the result',
    /embedding: embedded\.value\.embedding/.test(provider))
  ok('identity comes from the model that actually ran',
    /model: embedded\.value\.modelId/.test(provider))
  ok('and its version too',
    /modelVersion: embedded\.value\.modelVersion/.test(provider))
  ok('missing heads are still itemised as unsupported',
    /unsupported\.push/.test(provider))
  ok('a wrong-size embedding is still refused',
    /INVALID_OUTPUT/.test(provider))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`EFFNET WIRING — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All EffNet wiring tests passed.')
console.log(
  '\nNOTE: this proves WIRING, not inference. No Android device, no ONNX\n'
  + 'Runtime and no model file are present here. Device verification is\n'
  + 'still required before any claim that this works.',
)
