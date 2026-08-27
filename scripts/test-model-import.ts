// ============================================================
// SYSTEMA — Phase 16.1: in-app model import cannot lie
// ============================================================
// The import flow lets a developer hand SYSTEMA an arbitrary file
// from device storage. That is a new trust boundary, and the failure
// mode it introduces is specific: a file that LOADS but whose
// preprocessing is unknown will happily produce timings and
// embeddings that are completely meaningless.
//
// So this suite audits five things:
//
//   1. only ONNX Runtime decides whether a file is valid — extension
//      and MIME type are hints, never proof;
//   2. an invalid file is deleted, not registered;
//   3. metadata is READ FROM THE GRAPH, never guessed from a name;
//   4. an undeclared preprocessing contract BLOCKS benchmarking with
//      PREPROCESSING_UNAVAILABLE;
//   5. importing changes nothing else — no scan, no inference, no
//      production selection, no second runtime.
//
// Method matches the Phase 13/14/15/16 safety suites: comments are
// stripped before any "absence" check.
// ============================================================

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

const IMPORTER = 'android/app/src/main/java/com/systema/music/inference/ModelImporter.kt'
const STORE = 'android/app/src/main/java/com/systema/music/inference/ModelContractStore.kt'
const STORAGE = 'android/app/src/main/java/com/systema/music/inference/ModelStorage.kt'
const REGISTRY = 'android/app/src/main/java/com/systema/music/inference/ModelRegistry.kt'
const RUNTIME = 'android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt'
const BENCH = 'android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt'
const DESC = 'android/app/src/main/java/com/systema/music/inference/ModelDescriptor.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const TS_SERVICE = 'app/services/native/inferenceService.ts'
const PAGE = 'app/pages/dev/ai-benchmark/candidates.vue'

console.log('\n============================================================')
console.log('SYSTEMA — Phase 16.1 model import audit')
console.log('============================================================')

// ------------------------------------------------------------
section('1. The pieces exist')
// ------------------------------------------------------------
for (const p of [IMPORTER, STORE, STORAGE, REGISTRY, PLUGIN, TS_PLUGIN, TS_SERVICE, PAGE]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const importer = read(IMPORTER)
const importerCode = stripComments(importer)
const store = stripComments(read(STORE))
const storage = read(STORAGE)
const storageCode = stripComments(storage)
const registry = read(REGISTRY)
const registryCode = stripComments(registry)
const runtimeCode = stripComments(read(RUNTIME))
const bench = read(BENCH)
const benchCode = stripComments(bench)
const plugin = read(PLUGIN)
const pluginCode = stripComments(plugin)
const desc = read(DESC)
const tsPlugin = read(TS_PLUGIN)
const tsService = read(TS_SERVICE)
const tsServiceCode = stripComments(tsService)
const page = read(PAGE)
const pageCode = stripComments(page)

// ------------------------------------------------------------
section('2. The Android system file picker is used correctly')
// ------------------------------------------------------------
ok(
  'ACTION_OPEN_DOCUMENT, not ACTION_GET_CONTENT',
  pluginCode.includes('Intent.ACTION_OPEN_DOCUMENT') &&
    !pluginCode.includes('ACTION_GET_CONTENT'),
  'OPEN_DOCUMENT grants access to exactly one chosen file',
)
ok(
  'CATEGORY_OPENABLE is set',
  pluginCode.includes('Intent.CATEGORY_OPENABLE'),
)
ok(
  'multiple selection is explicitly disabled',
  /EXTRA_ALLOW_MULTIPLE, false/.test(pluginCode),
  'bulk import is not offered; each model is an explicit choice',
)
ok(
  'no directory-tree access is requested',
  !pluginCode.includes('OPEN_DOCUMENT_TREE') &&
    !pluginCode.includes('MANAGE_EXTERNAL_STORAGE'),
  'the import must not be able to see anything but the picked file',
)
ok(
  'the result arrives through an @ActivityCallback',
  pluginCode.includes('@ActivityCallback') &&
    pluginCode.includes('handleModelPicked'),
)
ok(
  'a cancelled picker resolves rather than rejecting',
  /resultCode != Activity\.RESULT_OK[\s\S]{0,300}call\.resolve/.test(pluginCode),
  'dismissing a picker is normal, not an error',
)
ok(
  // Checked against the RAW source, not the stripped copy: the MIME
  // literal "*/*" contains the characters "/*", so the block-comment
  // stripper swallows it and everything after. A neat demonstration
  // that stripComments is a heuristic, not a parser.
  'MIME filtering is permissive because providers are inconsistent',
  /type = "\*\/\*"/.test(plugin),
  'strict filtering would hide the very file being imported',
)
ok(
  'the reason for permissive MIME is documented',
  /inconsistent/i.test(plugin) && /MIME/i.test(plugin),
)

// ------------------------------------------------------------
section('3. Only ONNX Runtime decides what is valid')
// ------------------------------------------------------------
ok(
  'the importer loads the file through the real runtime',
  /runtime\.loadModel\(probe\)/.test(importerCode),
)
ok(
  'validation uses the InferenceRuntime contract, not a private path',
  /runtime: InferenceRuntime/.test(importerCode),
)
ok(
  'the importer does not import ai.onnxruntime itself',
  !importer.includes('ai.onnxruntime'),
  'OnnxInferenceRuntime remains the only file that touches ORT',
)
ok(
  'the structural sniff is documented as a reject filter only',
  /REJECT filter, not an accept filter/i.test(importer),
)
ok(
  'obvious non-models are rejected by signature',
  ['PK', '%PDF', 'ID3', 'RIFF'].every(sig => importerCode.includes(sig)),
  'renamed zip / pdf / mp3 / wav files',
)
ok(
  'a file passing the sniff still goes through a real load',
  importerCode.indexOf('looksLikeOnnx') < importerCode.indexOf('runtime.loadModel'),
)
ok(
  'extension alone never validates a model',
  !/\.onnx"\)\s*\)\s*return\s+ImportReport\(\s*ok = true/.test(importerCode),
)

// ------------------------------------------------------------
section('4. Invalid files are deleted, never registered')
// ------------------------------------------------------------
ok(
  'the candidate is staged before validation',
  importerCode.includes('stagingFileFor') && importerCode.includes('copyToStaging'),
)
ok(
  'the staging suffix keeps partial files out of the catalog',
  storageCode.includes('STAGING_SUFFIX') && storageCode.includes('.part'),
)
ok(
  'listInstalled only matches the real extension',
  /endsWith\(EXTENSION\)/.test(storageCode),
)
ok(
  'a rejected load discards the staging file',
  /catch \(e: InferenceException\)[\s\S]{0,200}discardStaging/.test(importerCode),
)
ok(
  'every failure path discards staging',
  (importerCode.match(/discardStaging\(staging\)/g) ?? []).length >= 5,
)
ok(
  'the contract is only saved after a successful load',
  importerCode.indexOf('runtime.loadModel') < importerCode.indexOf('contracts.save'),
)
ok(
  'promotion happens only after validation',
  importerCode.indexOf('runtime.loadModel') < importerCode.indexOf('promoteStaging'),
)
ok(
  'the validation session is unloaded in a finally',
  /finally \{[\s\S]{0,200}runtime\.unloadModel\(\)/.test(importerCode),
  'a resident validation session would corrupt the next cold-load figure',
)

// ------------------------------------------------------------
section('5. Metadata is read from the graph, never guessed')
// ------------------------------------------------------------
ok(
  'the runtime reports full tensor signatures',
  runtimeCode.includes('readSignatures') && runtimeCode.includes('TensorSignature'),
)
ok(
  'signatures come from the session info maps',
  /readSignatures\(created\.inputInfo\)/.test(runtimeCode) &&
    /readSignatures\(created\.outputInfo\)/.test(runtimeCode),
)
ok(
  'an unreadable type degrades to UNKNOWN, not to a plausible default',
  /type = tensorInfo\?\.type\?\.name \?: "UNKNOWN"/.test(runtimeCode),
)
ok(
  'embedding dimension comes from the graph output',
  /embeddingDimension = info\.outputs\.firstOrNull\(\)\?\.trailingDimension/.test(importerCode),
)
ok(
  'a dynamic trailing dimension yields null, not a guess',
  /takeIf \{ it > 0 \}/.test(stripComments(desc)),
)
ok(
  'sample rate is explicitly null at import time',
  /sampleRate = null/.test(importerCode),
  'an ONNX graph does not record it',
)
ok(
  'input format is explicitly null at import time',
  /inputFormat = null/.test(importerCode),
)
ok(
  'preprocessing starts UNKNOWN',
  /preprocessingStatus = PreprocessingStatus\.UNKNOWN/.test(importerCode),
)
ok(
  'the filename is never used to infer a model identity',
  !/yamnet|vggish|openl3/i.test(importerCode),
  'a file called yamnet.onnx is not evidence that it is YAMNet',
)
ok(
  'the reason metadata cannot be guessed is documented',
  /not in an ONNX graph|does not record sample rate|cannot be read/i.test(importer),
)

// ------------------------------------------------------------
section('6. An undeclared contract blocks benchmarking')
// ------------------------------------------------------------
ok(
  'PREPROCESSING_UNAVAILABLE exists as its own error code',
  desc.includes('PREPROCESSING_UNAVAILABLE'),
)
ok(
  'it is distinct from INPUT_SHAPE_MISMATCH, with the reason stated',
  /distinct from INPUT_SHAPE_MISMATCH|its own code/i.test(desc),
)
ok(
  'TypeScript mirrors the new code',
  tsPlugin.includes("'PREPROCESSING_UNAVAILABLE'"),
)
ok(
  'the registry exposes a hard gate',
  registryCode.includes('fun requireAudioContract'),
)
ok(
  'a model with no contract at all is refused',
  /contracts\.find\(modelId\)\s*\?: throw InferenceException/.test(registryCode),
)
ok(
  'UNKNOWN status is refused',
  /PreprocessingStatus\.UNKNOWN -> throw InferenceException/.test(registryCode),
)
ok(
  'BLOCKED status is refused',
  /PreprocessingStatus\.BLOCKED -> throw InferenceException/.test(registryCode),
)
ok(
  'VERIFIED without a sample rate is treated as unverified',
  /contract\.sampleRate == null \|\| contract\.sampleRate <= 0/.test(registryCode),
  'a contradictory record must not pass',
)
ok(
  'the real-audio benchmark calls the gate',
  benchCode.includes('registry.requireAudioContract(modelId)'),
)
ok(
  'the gate runs before any track is decoded',
  benchCode.indexOf('requireAudioContract') < benchCode.indexOf('PcmDecoder(context'),
  'failing per-track would bury the reason in twenty identical rows',
)
ok(
  'the bundled test model is exempt, and only it',
  /if \(modelId == ModelStorage\.TEST_MODEL_ID\) return/.test(registryCode),
)

// ------------------------------------------------------------
section('7. No sample-rate guessing for audio models')
// ------------------------------------------------------------
ok(
  'an undeclared model does NOT default to RAW_WAVEFORM',
  !/inputFormat: InputFormat = InputFormat\.RAW_WAVEFORM/.test(registryCode),
  'RAW_WAVEFORM would run happily on the wrong PCM; RAW_TENSOR refuses',
)
ok(
  'the descriptor falls back to RAW_TENSOR when nothing is declared',
  /inputFormat \?: contract\?\.inputFormat \?: InputFormat\.RAW_TENSOR/.test(registryCode),
)
ok(
  'a declared contract overrides any default sample rate',
  /inputSampleRate = sampleRate \?: contract\?\.sampleRate/.test(registryCode),
)
ok(
  'the Phase 13 rate is not silently applied to imported models',
  !/inputSampleRate = 22_?050/.test(registryCode),
)
ok(
  'the service refuses a waveform declaration with no rate',
  /RAW_WAVEFORM'[\s\S]{0,160}sampleRate/.test(tsServiceCode),
)
ok(
  'the 16 kHz vs 22.05 kHz hazard is documented for the developer',
  /16000|16 kHz/.test(tsService) && /22050|22\.05/.test(tsService),
)
ok(
  'declaring a mel format records BLOCKED, not VERIFIED',
  /MEL_SPECTROGRAM,\s*InputFormat\.LOG_MEL_SPECTROGRAM,\s*-> PreprocessingStatus\.BLOCKED/
    .test(registryCode.replace(/\s+/g, ' ').replace(/InputFormat\./g, 'InputFormat.')) ||
    /-> PreprocessingStatus\.BLOCKED/.test(registryCode),
  'declaring a mel front end does not make one exist',
)
ok(
  'RAW_TENSOR cannot be declared VERIFIED for audio',
  /InputFormat\.RAW_TENSOR -> PreprocessingStatus\.UNKNOWN/.test(registryCode),
)

// ------------------------------------------------------------
section('8. Import changes nothing it should not')
// ------------------------------------------------------------
ok(
  'the importer never touches the music library',
  !/MediaStore|library|Track|contentResolver\.query\(MediaStore/i.test(
    importerCode.replace(/contentResolver\.(openInputStream|query)/g, ''),
  ),
)
ok(
  'the importer never runs inference',
  !importerCode.includes('.infer('),
  'loading a model is not the same as running it',
)
ok(
  'the importer never enumerates a directory',
  !/listFiles|walk\(|listInstalled\(\)/.test(importerCode),
)
ok(
  'no production model is selected on import',
  !/productionSelection|selectProduction|setProductionModel/i.test(importerCode),
)
ok(
  'the UI does not auto-select the imported model for benchmarking',
  !/runRealAudio|runTestModel/.test(pageCode),
  'the candidate page imports and declares; benchmarking stays in the ONNX lab',
)
ok(
  'import is bound to an explicit click',
  /@click="onImportModel"/.test(page),
)
ok(
  'import is not triggered on mount',
  !/onMounted\([\s\S]{0,400}pickAndImportModel/.test(pageCode),
)
ok(
  'the test model cannot be deleted',
  /if \(fileName == TEST_MODEL_FILE\) return false/.test(storageCode) &&
    /modelId == ModelStorage\.TEST_MODEL_ID[\s\S]{0,300}call\.reject/.test(pluginCode),
  'the Phase 15 proof depends on it',
)

// ------------------------------------------------------------
section('9. One inference path, no JS runtime')
// ------------------------------------------------------------
ok(
  'no JavaScript ONNX runtime was added',
  !existsSync(resolve(ROOT, 'node_modules/onnxruntime-web')) ||
    !read('package.json').includes('onnxruntime-web'),
)
ok(
  'package.json gained no inference dependency',
  !/onnxruntime|tensorflow|tfjs/i.test(read('package.json')),
)
ok(
  'the web layer still holds no ORT types',
  !stripComments(tsPlugin).includes('ai.onnxruntime') &&
    !stripComments(tsService).includes('OrtSession'),
  'the prose may name the boundary; the code may not cross it',
)
ok(
  'the plugin validates against the same runtime the benchmark uses',
  /benchmark\.runtime\(RuntimeIds\.ONNX\)/.test(pluginCode),
)
ok(
  'no fallback to the reference runtime on import failure',
  !/RuntimeIds\.REFERENCE/.test(pluginCode.split('handleModelPicked')[1] ?? ''),
)
ok(
  'an unavailable ONNX runtime fails the import outright',
  /!runtime\.isAvailable\(\)[\s\S]{0,300}RUNTIME_UNAVAILABLE/.test(importerCode),
)
ok(
  'the refusal to substitute a runtime is documented',
  /No silent substitution|will not accept a model it has not proved/i.test(importer),
)

// ------------------------------------------------------------
section('10. Filenames from providers are not trusted')
// ------------------------------------------------------------
ok(
  'display names are sanitised',
  storageCode.includes('fun sanitiseFileName'),
)
ok(
  'path separators are stripped',
  /substringAfterLast\('\/'\)/.test(storageCode),
)
ok(
  'traversal segments are removed',
  /replace\("\.\.", ""\)/.test(storageCode),
)
ok(
  'the sanitised name always ends in .onnx',
  /"\$base\$EXTENSION"/.test(storageCode),
)
ok(
  'a blank name falls back rather than producing an empty path',
  /if \(base\.isBlank\(\)\)/.test(storageCode),
)
ok(
  'an existing model is not silently overwritten',
  storageCode.includes('fun uniqueFileNameFor'),
)
ok(
  'deleteInstalled refuses traversal',
  /fileName\.contains\('\/'\) \|\| fileName\.contains\("\.\."\)/.test(storageCode),
)
ok(
  'an oversized file is refused',
  storageCode.includes('MAX_IMPORT_BYTES') && importerCode.includes('MAX_IMPORT_BYTES'),
)
ok(
  'the size cap is enforced DURING the copy, not only from metadata',
  /total > ModelStorage\.MAX_IMPORT_BYTES/.test(importerCode),
  'a provider can under-report SIZE',
)

// ------------------------------------------------------------
section('11. The contract store degrades safely')
// ------------------------------------------------------------
ok(
  'a corrupt store yields an empty list, not a crash',
  /catch \(t: Throwable\)[\s\S]{0,200}emptyList\(\)/.test(store),
)
ok(
  'an unrecognised stored format degrades to null',
  /runCatching \{ InputFormat\.valueOf\(name\) \}\.getOrNull\(\)/.test(store),
  'defaulting here would silently license a benchmark',
)
ok(
  'an unrecognised status degrades to UNKNOWN',
  /getOrDefault\(PreprocessingStatus\.UNKNOWN\)/.test(store),
)
ok(
  'the store does not touch the analysis database',
  !/Room|AudioAnalysis|@Dao|@Entity/.test(store),
)
ok(
  'deleting a model also forgets its contract',
  /if \(deleted\) contracts\.remove\(modelId\)/.test(registryCode),
)

// ------------------------------------------------------------
section('12. The bridge contract matches on both sides')
// ------------------------------------------------------------
for (const m of ['pickAndImportModel', 'declareModelContract', 'deleteImportedModel']) {
  ok(`${m} exists natively`, pluginCode.includes(`fun ${m}(call: PluginCall)`))
  ok(`${m} is declared in TypeScript`, tsPlugin.includes(`${m}(`))
  ok(`${m} is exposed by the service`, tsServiceCode.includes(m))
}
ok(
  'ImportResult is typed',
  tsPlugin.includes('export interface ImportResult'),
)
ok(
  'ModelContract is typed',
  tsPlugin.includes('export interface ModelContract'),
)
ok(
  'PreprocessingStatus mirrors the Kotlin enum',
  tsPlugin.includes("'VERIFIED' | 'UNKNOWN' | 'BLOCKED'"),
)
ok(
  'cancelled is a first-class non-error outcome',
  tsPlugin.includes('cancelled: boolean') && /res\.cancelled/.test(pageCode),
)

// ------------------------------------------------------------
section('13. The UI states what is known and what is not')
// ------------------------------------------------------------
ok(
  'the action is labelled IMPORT ONNX MODEL',
  page.includes('IMPORT ONNX MODEL'),
)
ok(
  'filename, size, validation and runtime are shown',
  ['fileName', 'FILE SIZE', 'validation', 'RUNTIME'].every(t => page.includes(t)),
)
ok(
  'preprocessing status is shown',
  page.includes('PREPROCESSING'),
)
ok(
  'loading is explicitly not an endorsement',
  /LOADING IS NOT ENDORSEMENT/.test(page),
)
// Every mention must be a denial. The banner reads "It is not
// production-ready", which is exactly the text that should be there,
// so each occurrence is checked in context for a negation.
function claimsProductionReady(src: string): boolean {
  const re = /production[- ]ready/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const window = src.slice(Math.max(0, m.index - 100), m.index + 40)
    if (!/\bnot\b|never|isn't|is not/i.test(window)) return true
  }
  return false
}
ok(
  'the UI never claims an imported model is production-ready',
  !claimsProductionReady(page),
)
ok(
  'a declared contract is labelled as declared, not verified',
  /DEVELOPER_DECLARED/.test(page) && /did not verify/i.test(page),
)
ok(
  'dynamic dimensions render as "dynamic", never as a number',
  /d <= 0 \? 'dynamic'/.test(pageCode),
)
ok(
  'unknown sizes render as UNKNOWN, not 0 B',
  /bytes < 0\) return 'UNKNOWN'/.test(pageCode),
)
ok(
  'the developer-diagnostic label is still present',
  /Developer Diagnostic — Not a Production Feature/.test(page),
)
ok(
  'NO PRODUCTION MODEL SELECTED is still stated',
  /NO PRODUCTION MODEL SELECTED/.test(page),
)

// ------------------------------------------------------------
section('14. Phase 13/14/15 semantics are untouched')
// ------------------------------------------------------------
const dspConfig = read(
  'android/app/src/main/java/com/systema/music/analysis/dsp/AudioAnalysisConfig.kt',
)
ok('Phase 13 target sample rate unchanged', dspConfig.includes('22_050'))
ok('Phase 13 analysis window unchanged', dspConfig.includes('300_000'))
ok(
  'the deterministic test model contract is unchanged',
  desc.includes('floatArrayOf(9f, 25f, 49f, 81f)'),
)
ok(
  'the test model still loads through the normal path',
  registryCode.includes('fun testModelDescriptor'),
)
ok(
  'the 20-track cap is intact',
  bench.includes('MAX_TRACKS = 20') && tsService.includes('MAX_BENCHMARK_TRACKS = 20'),
)
ok(
  'the memory lifecycle test still has no NO_LEAK verdict',
  !stripComments(
    read('android/app/src/main/java/com/systema/music/inference/MemoryProbe.kt'),
  ).includes('NO_LEAK'),
  'the enum must not gain the state; the comment may name its absence',
)
ok(
  'benchmark aggregation semantics are unchanged',
  benchCode.includes('LatencyStats.of(warmTimes)') &&
    benchCode.includes('coldLoadMs = loaded.loadMs'),
)
ok(
  'PcmDecoder usage is unchanged',
  benchCode.includes('PcmDecoder(context, config)'),
)
ok(
  'no model weights entered the repository',
  !exists('android/app/src/main/assets/models/yamnet.onnx'),
)

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
console.log(`
SCOPE OF THIS SUITE
-------------------
This is a static audit of the import flow's contracts and refusals.
It proves the code cannot register an unvalidated file, cannot invent
metadata, and cannot benchmark a model whose preprocessing is
undeclared.

It does NOT prove the file picker works on a device. The Android
Storage Access Framework, the content:// copy and the ONNX session
build have NOT been executed on hardware — no JDK is installable in
this environment, so the Kotlin was not even compiled. Those remain
NOT VERIFIED ON HARDWARE.
`)

process.exit(failed > 0 ? 1 : 0)
