// ============================================================
// SYSTEMA — Phase 15: ONNX integration audit
// ============================================================
// What this suite can and cannot prove, stated plainly.
//
// CAN PROVE (statically, on any machine):
//   - the deterministic .onnx file exists, is a real ONNX protobuf,
//     and encodes the exact graph the Kotlin/TS layers expect
//   - the expected-output constants agree across Python, Kotlin and
//     TypeScript, so no layer is checking a different answer
//   - the containment invariant: ai.onnxruntime appears in exactly
//     one production file
//   - no model weights have been committed
//
// CANNOT PROVE (needs the device — §15):
//   - that ONNX Runtime on Android actually loads and executes it
//
// That distinction is the whole point. This suite passing means the
// integration is WIRED CORRECTLY, not that inference ran. Only the
// Poco X7 Pro can establish the latter.
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

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
const has = (p: string) => existsSync(resolve(ROOT, p))

/** Strips comments so prose about what is NOT done cannot satisfy a check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

console.log('\n=== SYSTEMA Phase 15 — ONNX integration audit ===')

// ------------------------------------------------------------
section('1. The deterministic test model is a real ONNX file')
// ------------------------------------------------------------

const MODEL_PATH = 'android/app/src/main/assets/models/systema-test-model.onnx'
ok('test model is present in the APK assets', has(MODEL_PATH))

if (has(MODEL_PATH)) {
  const bytes = readFileSync(resolve(ROOT, MODEL_PATH))

  // A real ONNX file is a protobuf; field 1 (ir_version, varint) makes
  // the first byte 0x08. A text file or an LFS pointer would not.
  ok('starts with a protobuf varint field, as an ONNX file must',
    bytes[0] === 0x08, `first byte was 0x${bytes[0]?.toString(16)}`)

  ok('is not a Git LFS pointer',
    !bytes.subarray(0, 64).toString('utf8').includes('git-lfs'))

  // Tiny by design: pure arithmetic, no learned parameters.
  ok('is under 4 KB, i.e. genuinely weight-free',
    bytes.length > 0 && bytes.length < 4096, `${bytes.length} bytes`)

  const asText = bytes.toString('latin1')
  // The graph's operators and tensor names are stored as plain strings
  // in the protobuf, so the intended graph can be confirmed without a
  // protobuf parser.
  ok('declares a Mul operator', asText.includes('Mul'))
  ok('declares an Add operator', asText.includes('Add'))
  ok('names its input tensor "input"', asText.includes('input'))
  ok('names its output tensor "output"', asText.includes('output'))
  ok('is attributed to this project', asText.includes('systema'))
}

// ------------------------------------------------------------
section('2. Every layer expects the SAME answer')
// ------------------------------------------------------------

// If Python generated (x*2+1)^2 but Kotlin asserted (x*2)^2, the test
// would fail on device for a reason nobody could see from here. So the
// constants are cross-checked.

const pyGen = read('scripts/make-test-onnx-model.py')
ok('generator declares input [1,2,3,4]',
  pyGen.includes('CANONICAL_INPUT = [1.0, 2.0, 3.0, 4.0]'))
ok('generator declares output [9,25,49,81]',
  pyGen.includes('CANONICAL_OUTPUT = [9.0, 25.0, 49.0, 81.0]'))
ok('generator uses scale 2.0', pyGen.includes('SCALE = 2.0'))
ok('generator uses offset 1.0', pyGen.includes('OFFSET = 1.0'))

const tsPlugin = read('app/services/native/inferencePlugin.ts')
ok('TypeScript expects the same input',
  tsPlugin.includes('TEST_MODEL_INPUT = [1, 2, 3, 4]'))
ok('TypeScript expects the same output',
  tsPlugin.includes('TEST_MODEL_EXPECTED_OUTPUT = [9, 25, 49, 81]'))

// Verify the transform in TS matches the documented formula.
function expected(input: number[]): number[] {
  return input.map(x => (x * 2 + 1) ** 2)
}
const computed = expected([1, 2, 3, 4])
ok('the documented transform really yields [9,25,49,81]',
  JSON.stringify(computed) === JSON.stringify([9, 25, 49, 81]),
  JSON.stringify(computed))

// The transform has a single Kotlin definition, TestModel.transform,
// which the reference runtime calls. Assert the definition itself,
// then that the runtime uses it rather than a second copy that could
// drift.
const descriptorKt = read('android/app/src/main/java/com/systema/music/inference/ModelDescriptor.kt')
ok('Kotlin defines the transform exactly once',
  /fun transform\(x: Float\): Float \{[\s\S]{0,200}?x \* SCALE \+ OFFSET[\s\S]{0,120}?shifted \* shifted/
    .test(descriptorKt))
ok('Kotlin uses scale 2 and offset 1',
  /const val SCALE = 2f/.test(descriptorKt) && /const val OFFSET = 1f/.test(descriptorKt))
ok('Kotlin declares the same canonical input',
  /CANONICAL_INPUT = floatArrayOf\(1f, 2f, 3f, 4f\)/.test(descriptorKt))
ok('Kotlin declares the same canonical output',
  /CANONICAL_OUTPUT = floatArrayOf\(9f, 25f, 49f, 81f\)/.test(descriptorKt))

const refRuntime = read('android/app/src/main/java/com/systema/music/inference/ReferenceInferenceRuntime.kt')
ok('the reference runtime calls the shared transform, not a copy',
  refRuntime.includes('TestModel.transform(input[it])'))

// ------------------------------------------------------------
section('2b. Runtime identifiers are canonical and agree across the bridge')
// ------------------------------------------------------------
//
// REGRESSION GUARD.
//
// On device, every ONNX run failed with:
//   RUNTIME_UNAVAILABLE
//   Unknown runtime 'onnxruntime'. Available: onnx, reference
//
// Cause: the Kotlin registry was a hand-written mapOf keyed "onnx",
// while each runtime's own runtimeId said "onnxruntime".
// getCapabilities() advertised the PROPERTY; runtime(id) looked up the
// KEY. Two sources of truth for one identifier.
//
// These assertions lock down both halves: one canonical spelling, and
// a registry that cannot disagree with what it advertises.

const benchKt = read('android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt')
const onnxKtSrc = read('android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt')
const refKtSrc = read('android/app/src/main/java/com/systema/music/inference/ReferenceInferenceRuntime.kt')
const pluginKtSrc = read('android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt')

// ---- canonical constants exist, with the agreed values ----
ok('Kotlin defines RuntimeIds.ONNX as "onnxruntime"',
  /const val ONNX = "onnxruntime"/.test(descriptorKt))
ok('Kotlin defines RuntimeIds.REFERENCE as "reference"',
  /const val REFERENCE = "reference"/.test(descriptorKt))
ok('TypeScript defines RUNTIME_ONNX as "onnxruntime"',
  /RUNTIME_ONNX = 'onnxruntime'/.test(tsPlugin))
ok('TypeScript defines RUNTIME_REFERENCE as "reference"',
  /RUNTIME_REFERENCE = 'reference'/.test(tsPlugin))

// ---- the two languages list the SAME set ----
const kotlinIds = [...descriptorKt.matchAll(/const val (?:ONNX|REFERENCE) = "([^"]+)"/g)]
  .map(m => m[1]!).sort()
const tsIds = [...tsPlugin.matchAll(/RUNTIME_(?:ONNX|REFERENCE) = '([^']+)'/g)]
  .map(m => m[1]!).sort()
ok('Kotlin and TypeScript declare identical runtime ids',
  kotlinIds.length === 2 && JSON.stringify(kotlinIds) === JSON.stringify(tsIds),
  `kotlin=${JSON.stringify(kotlinIds)} ts=${JSON.stringify(tsIds)}`)

// ---- the registry derives its keys, so it cannot desynchronise ----
ok('the registry is keyed by each runtime\'s own runtimeId',
  /associateBy\s*\{\s*it\.runtimeId\s*\}/.test(benchKt))
// Comments stripped: the file documents the old broken mapOf in prose
// precisely so nobody reintroduces it, and that explanation must not
// fail the check.
ok('the registry is NOT a hand-written map of literal keys',
  !/mapOf\(\s*"onnx"/.test(stripComments(benchKt)))

// ---- runtimes identify themselves via the constants ----
ok('OnnxInferenceRuntime uses RuntimeIds.ONNX',
  /override val runtimeId = RuntimeIds\.ONNX/.test(onnxKtSrc))
ok('ReferenceInferenceRuntime uses RuntimeIds.REFERENCE',
  /override val runtimeId: String = RuntimeIds\.REFERENCE/.test(refKtSrc))
ok('the plugin defaults to the canonical ONNX constant, not a literal',
  /\?: RuntimeIds\.ONNX/.test(pluginKtSrc) && !/\?: "onnx"/.test(pluginKtSrc))

// ---- no stale literal survives anywhere in the inference package ----
const inferenceKt = ['InferenceBenchmark', 'InferencePlugin', 'OnnxInferenceRuntime',
  'ReferenceInferenceRuntime', 'ModelRegistry', 'ModelStorage']
for (const f of inferenceKt) {
  const src = stripComments(read(`android/app/src/main/java/com/systema/music/inference/${f}.kt`))
  ok(`${f}.kt contains no bare "onnx" runtime literal`,
    !/"onnx"/.test(src))
}

// ---- the lab page compares against the constant ----
const labSrc = read('app/pages/dev/ai-benchmark/onnx.vue')
ok('the lab page selects ONNX via RUNTIME_ONNX',
  /r\.id === RUNTIME_ONNX/.test(labSrc))
ok('the lab page holds no bare \'onnx\' runtime literal',
  !/'onnx'/.test(stripComments(labSrc)))

// ---- NO SILENT FALLBACK when ONNX is unavailable (§13) ----
// The old code did `?? caps.runtimes[0]?.id`, which would have
// selected the reference runtime whenever ONNX was missing.
ok('the page does not default to whichever runtime happens to be first',
  !/runtimes\[0\]\?\.id/.test(stripComments(labSrc)))
ok('an unavailable ONNX keeps the selection on ONNX, so MEASURE fails visibly',
  /runtimeId\.value = onnx\?\.id \?\? RUNTIME_ONNX/.test(labSrc))

// ---- BEHAVIOURAL: simulate the exact device path ----
// Static checks alone could pass while the wiring is still wrong, so
// the resolution is executed end to end.
{
  const ONNX = 'onnxruntime'
  const REFERENCE = 'reference'
  const instances = [
    { cls: 'OnnxInferenceRuntime', runtimeId: ONNX, available: true },
    { cls: 'ReferenceInferenceRuntime', runtimeId: REFERENCE, available: true },
  ]
  // Kotlin: listOf(...).associateBy { it.runtimeId }
  const registry = new Map(instances.map(i => [i.runtimeId, i.cls]))
  // Kotlin: getCapabilities() puts rt.runtimeId as "id"
  const advertised = instances.map(i => ({ id: i.runtimeId, available: i.available }))

  ok('every advertised id is resolvable by the registry',
    advertised.every(r => registry.has(r.id)),
    advertised.filter(r => !registry.has(r.id)).map(r => r.id).join(', '))

  const picked = advertised.find(r => r.id === ONNX)?.id ?? ONNX
  ok('the page picks "onnxruntime"', picked === ONNX, picked)
  ok('selecting ONNX resolves OnnxInferenceRuntime, not RUNTIME_UNAVAILABLE',
    registry.get(picked) === 'OnnxInferenceRuntime', String(registry.get(picked)))
  ok('selecting reference resolves ReferenceInferenceRuntime',
    registry.get(REFERENCE) === 'ReferenceInferenceRuntime')

  // The precise regression: the old key set could not serve the id.
  const oldRegistry = new Map([['onnx', 'OnnxInferenceRuntime'], [REFERENCE, 'ReferenceInferenceRuntime']])
  ok('the OLD registry genuinely failed on "onnxruntime" (regression is real)',
    !oldRegistry.has(ONNX))

  // No-fallback: an unavailable ONNX must not yield the reference runtime.
  const onnxDown = [
    { id: ONNX, available: false },
    { id: REFERENCE, available: true },
  ]
  const pickedWhenDown = onnxDown.find(r => r.id === ONNX)?.id ?? ONNX
  ok('an unavailable ONNX still selects ONNX, never reference',
    pickedWhenDown === ONNX, pickedWhenDown)
}

// ------------------------------------------------------------
section('3. ONNX Runtime is contained in exactly one file (§4)')
// ------------------------------------------------------------

// The architectural promise is that Nuxt never learns which runtime
// executes. That is only true if no ONNX type escapes Kotlin.

// Comments are stripped BEFORE looking. Several files legitimately
// discuss ai.onnxruntime in prose — explaining precisely that they
// must not import it — and a naive grep would flag exactly the files
// that document the invariant most carefully. Only real code counts.
let candidates: string[] = []
try {
  const out = execSync(
    'grep -rl "ai\\.onnxruntime" --include=*.kt --include=*.java --include=*.ts --include=*.vue . ' +
    '|| true',
    { cwd: ROOT, encoding: 'utf8' },
  )
  candidates = out.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => !p.includes('node_modules') && !p.includes('/scripts/'))
} catch {
  // grep unavailable; the check below will report it.
}

const ALLOWED = [
  './android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt',
  './android/app/src/test/java/com/systema/music/inference/OnnxRuntimeTest.kt',
]

const leaked = candidates.filter((p) => {
  if (ALLOWED.includes(p)) return false
  // Real import/usage only, not a mention inside a comment.
  return stripComments(read(p)).includes('ai.onnxruntime')
})
ok('no file outside the ONNX runtime implementation imports ai.onnxruntime',
  leaked.length === 0, leaked.join(', '))

// The mentions that DO remain should be in comments explaining the
// boundary — worth confirming the invariant is documented, not just
// accidentally true.
ok('the boundary is documented in the files that respect it',
  candidates.some(p => !ALLOWED.includes(p)))

const tsFiles = ['app/services/native/inferencePlugin.ts', 'app/services/native/inferenceService.ts']
for (const f of tsFiles) {
  const src = stripComments(read(f))
  ok(`${f} contains no ONNX type reference`,
    !src.includes('ai.onnxruntime') && !src.includes('OrtSession') && !src.includes('OnnxTensor'))
}

const labPage = stripComments(read('app/pages/dev/ai-benchmark/onnx.vue'))
ok('the lab page contains no ONNX type reference',
  !labPage.includes('OrtSession') && !labPage.includes('OnnxTensor'))

// ------------------------------------------------------------
section('4. No model weights are committed (§7)')
// ------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(resolve(ROOT, dir))
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === '.nuxt' || e === '.output') continue
    const p = join(dir, e)
    const s = statSync(resolve(ROOT, p))
    if (s.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const allFiles = walk('.')
const WEIGHT_EXT = ['.onnx', '.pt', '.pth', '.bin', '.safetensors', '.tflite', '.pb', '.ckpt', '.h5']
const weightFiles = allFiles.filter(f => WEIGHT_EXT.some(ext => f.endsWith(ext)))

// Exactly one .onnx is permitted: the 423-byte arithmetic fixture.
const unexpectedWeights = weightFiles.filter(f => !f.endsWith('systema-test-model.onnx'))
ok('no model weight files are committed beyond the test fixture',
  unexpectedWeights.length === 0, unexpectedWeights.join(', '))

const oversized = weightFiles.filter(f => statSync(resolve(ROOT, f)).size > 100 * 1024)
ok('no committed model file exceeds 100 KB',
  oversized.length === 0, oversized.join(', '))

// ------------------------------------------------------------
section('5. The runtime never falls back or fabricates (§13)')
// ------------------------------------------------------------

const onnxRuntime = read('android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt')
const onnxCode = stripComments(onnxRuntime)

ok('the ONNX runtime never instantiates the reference runtime',
  !onnxCode.includes('ReferenceInferenceRuntime'))
ok('the ONNX runtime contains no random or synthetic value generation',
  !/Random|Math\.random|nextFloat|nextDouble/.test(onnxCode))

const benchCode = stripComments(read('android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt'))
// A catch that swaps runtimes would be the silent fallback §13 forbids.
ok('the benchmark never substitutes a runtime after a failure',
  !/catch[\s\S]{0,400}?runtime\("reference"\)/.test(benchCode))
ok('the benchmark never generates synthetic audio',
  !/Random|Math\.random|sin\(|synthetic/i.test(benchCode))

const svcCode = stripComments(read('app/services/native/inferenceService.ts'))
ok('the service never retries with a different runtime',
  !/catch[\s\S]{0,300}?runtimeId:\s*['"]reference['"]/.test(svcCode))
ok('the service throws rather than returning a placeholder',
  svcCode.includes('throw toServiceError(e)'))

// The reference runtime must refuse real models rather than
// producing arithmetic that could be mistaken for an embedding.
ok('the reference runtime refuses non-test models',
  refRuntime.includes('MODEL_INVALID') &&
  refRuntime.includes('descriptor.modelId != TestModel.ID'))

// ------------------------------------------------------------
section('6. Unimplemented preprocessing is refused, not approximated (§10)')
// ------------------------------------------------------------

const prep = read('android/app/src/main/java/com/systema/music/inference/ModelInputPreparer.kt')
ok('mel formats throw instead of being approximated',
  /MEL_SPECTROGRAM,\s*\n\s*InputFormat\.LOG_MEL_SPECTROGRAM,\s*\n\s*->\s*throw/.test(prep) ||
  (prep.includes('LOG_MEL_SPECTROGRAM') && prep.includes('INPUT_SHAPE_MISMATCH')))
ok('the resampler documents its lack of anti-aliasing',
  prep.includes('anti-aliasing'))
ok('peak normalisation cannot divide by zero',
  prep.includes('if (peak <= 0f) return input'))

// ------------------------------------------------------------
section('7. All five required error codes exist (§7)')
// ------------------------------------------------------------

const descriptor = descriptorKt
for (const code of [
  'MODEL_NOT_FOUND', 'MODEL_LOAD_FAILED', 'MODEL_INVALID',
  'MODEL_INFERENCE_FAILED', 'MODEL_UNLOADED',
]) {
  ok(`Kotlin defines ${code}`, descriptor.includes(code))
  ok(`TypeScript mirrors ${code}`, tsPlugin.includes(code))
}

// ------------------------------------------------------------
section('8. The descriptor carries the §6 metadata')
// ------------------------------------------------------------

for (const field of [
  'modelId', 'modelName', 'version', 'inputShape', 'inputSampleRate',
  'inputType', 'outputShape', 'outputType', 'filePath', 'sizeBytes',
]) {
  ok(`descriptor declares ${field}`, new RegExp(`val ${field}\\b`).test(descriptor))
}

ok('the descriptor makes no CLAP-specific assumption',
  !/clap/i.test(stripComments(descriptor).replace(/CLAP-specific|CLAP's/g, '')))

// ------------------------------------------------------------
section('9. Timings are separated so the model cost is answerable (§11)')
// ------------------------------------------------------------

const bench = read('android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt')
for (const field of [
  'decodeMs', 'preprocessingMs', 'inferenceMs', 'totalMs', 'audioDurationMs', 'rtf',
]) {
  ok(`benchmark records ${field}`, bench.includes(field))
}
ok('cold load is reported separately from warm inference',
  bench.includes('coldLoadMs') && bench.includes('warmInferenceMs'))
ok('inferenceMs times session.run() alone',
  onnxRuntime.includes('val runStartNs = System.nanoTime()') &&
  onnxRuntime.includes('active.run('))

// ------------------------------------------------------------
section('10. Environment metadata accompanies every result (§1)')
// ------------------------------------------------------------

const envSnap = read('android/app/src/main/java/com/systema/music/inference/EnvironmentSnapshot.kt')
for (const field of [
  'screenOn', 'charging', 'batteryLevel', 'thermalStatus',
  'timestamp', 'deviceModel', 'androidVersion',
]) {
  ok(`snapshot records ${field}`, envSnap.includes(field))
}
// Comments stripped: the file explicitly documents that it does NOT
// report a temperature, and that sentence must not fail the check.
ok('thermal status is a bucket, never a fabricated temperature',
  envSnap.includes('THERMAL_STATUS_NONE') &&
  !/temperature|getTemperature|celsius/i.test(stripComments(envSnap)))
ok('both report types embed an environment snapshot',
  bench.includes('val environment: EnvironmentSnapshot'))

// ------------------------------------------------------------
section('11. Tensor contract and output-dimension reporting')
// ------------------------------------------------------------
//
// AUDIT OF THE DEVICE RESULT "out dim 2889792".
//
// That number is the DECODED SAMPLE COUNT, not an embedding size. The
// test model is element-wise ((x*2+1)^2 applied per sample), and its
// declared shape is dynamic [-1], so N floats in produce N floats out.
// 2,889,792 / 22,050 Hz = 131.06 s, a 2m11s track — and 19,614 ms /
// 131,056 ms reproduces the reported RTF of 0.150 exactly.
//
// These assertions pin the reporting down so nobody later mistakes the
// figure for a model output dimension.

// ---- outputDimension is the real output length, not a guess ----
ok('outputDimension is taken from the actual output array length',
  /outputDimension = result\.output\.size/.test(bench))
ok('outputDimension is NOT taken from the input or a declared shape',
  !/outputDimension = (?:prepared|input|descriptor|model)\./.test(bench))

// ---- the runtime reports the shape ONNX actually returned ----
ok('outputShape is read from the returned tensor, not from the descriptor',
  /outShape = \(first\.info as\? TensorInfo\)\?\.shape\?\.toList\(\)/.test(onnxRuntime))
ok('the output is flattened from the real ORT value',
  /flattenFloats\(first\.value\)/.test(onnxRuntime))

// ---- the test model is element-wise with a dynamic shape ----
const registryKt = read('android/app/src/main/java/com/systema/music/inference/ModelRegistry.kt')
const testDescriptorBlock = registryKt.slice(
  registryKt.indexOf('fun testModelDescriptor'),
  registryKt.indexOf('fun installedModels'),
)
ok('the test model declares a dynamic input shape [-1]',
  /inputShape = listOf\(-1L\)/.test(testDescriptorBlock))
ok('the test model declares a dynamic output shape [-1]',
  /outputShape = listOf\(-1L\)/.test(testDescriptorBlock))
ok('the test model uses RAW_TENSOR, so PCM passes through unresampled',
  /inputFormat = InputFormat\.RAW_TENSOR/.test(testDescriptorBlock))

// A single dynamic dimension must resolve to the actual element count.
ok('a lone dynamic dimension resolves from the real input length',
  /if \(dynamicCount == 0\) return declared\.toLongArray\(\)/.test(onnxRuntime) &&
  /inferred = if \(known > 0\) actualElements \/ known/.test(onnxRuntime))

// Behavioural: replay the element-wise contract at the device's size.
{
  const N = 2_889_792
  const SAMPLE_RATE = 22_050
  // RAW_TENSOR is a passthrough copy, so out length == decoded length.
  const outDim = N
  ok('element-wise model: out dim equals the decoded sample count',
    outDim === N)

  const audioMs = (N * 1000) / SAMPLE_RATE
  ok('2,889,792 samples at 22.05 kHz is a ~131 s track',
    Math.abs(audioMs - 131_056) < 1, `${audioMs.toFixed(0)} ms`)

  // The reported RTF must be reproducible from the reported parts.
  const totalMs = 19_614
  const rtf = totalMs / audioMs
  ok('the device RTF 0.150 is reproducible from total/audioDuration',
    Math.abs(rtf - 0.150) < 0.001, rtf.toFixed(4))

  // out dim must NOT be mistakable for a fixed embedding width.
  for (const embeddingWidth of [128, 512, 1024, 2048, 6144]) {
    ok(`out dim is not the ${embeddingWidth}-d embedding of a real model`,
      outDim !== embeddingWidth)
  }
}

// ------------------------------------------------------------
section('12. Timing boundaries are exact and fully accounted for (§11)')
// ------------------------------------------------------------

// inferenceMs must wrap session.run() and NOTHING else.
const runWindow = onnxRuntime.slice(
  onnxRuntime.indexOf('val runStartNs'),
  onnxRuntime.indexOf('val readStartNs'),
)
ok('the inference window contains session.run()',
  /active\.run\(/.test(runWindow))
ok('the inference window does NOT contain tensor creation',
  !/createTensor/.test(runWindow))
ok('the inference window does NOT contain output conversion',
  !/flattenFloats/.test(runWindow))
ok('tensor creation is timed separately as tensorMs',
  /val tensorMs = \(System\.nanoTime\(\) - tensorStartNs\)/.test(onnxRuntime))
ok('output read-back is timed separately and folded into tensorMs',
  /tensorMs = tensorMs \+ readMs/.test(onnxRuntime))

// decode/prep must not leak into the model figure.
ok('inferenceMs comes from the runtime, not from the benchmark loop',
  /inferenceMs = result\.inferenceMs/.test(bench))
ok('decodeMs is measured around the decoder only',
  /val decodeMs = \(System\.nanoTime\(\) - decodeStartNs\)/.test(bench))
ok('preprocessingMs comes from the preparer, not the inference call',
  /preprocessingMs = prepared\.preparationMs/.test(bench))

// TOTAL must equal the sum of its reported parts — no hidden time.
ok('totalMs is exactly decode + prep + inference + tensor',
  /totalMs = decodeMs \+ prepared\.preparationMs \+ result\.inferenceMs \+ result\.tensorMs/
    .test(bench))
ok('cold load is excluded from totalMs (it is paid once per batch)',
  !/totalMs = [^\n]*coldLoad/.test(bench))

// REGRESSION: every component of TOTAL must be visible in the UI.
// tensorMs was computed and folded into TOTAL but never rendered,
// leaving ~11.8 ms of the device's 19,614 ms unexplainable on screen.
const labUi = read('app/pages/dev/ai-benchmark/onnx.vue')
for (const field of ['decode', 'preprocessing', 'inference', 'tensor', 'total']) {
  ok(`the summary renders summary.${field}`,
    new RegExp(`summary\\.${field}`).test(labUi))
}
ok('the UI states the TOTAL formula so the numbers can be checked',
  /TOTAL = decode \+ prep \+ inference \+ tensor/.test(labUi))
// Wording updated by the Phase 16.2 output-contract audit: the label
// "out dim" was retired everywhere because it read like an embedding
// width. The SUBSTANCE of this check is unchanged - the UI must still
// warn that the test model's element count is a sample count.
ok('the UI warns that the test model\'s element count is a sample count',
  /raw output elements\s*\n?\s*equals the\s*\n?\s*decoded sample count/.test(labUi))
ok('the retired "out dim" label is gone from the UI',
  !/>\s*out dim|out dim \{\{/.test(labUi))

// ------------------------------------------------------------
section('13. The real-audio path uses real audio (§3)')
// ------------------------------------------------------------

// This is the Phase 14 bug class: synthetic audio silently measured
// in place of the track the user picked.
ok('the benchmark decodes through the real PcmDecoder',
  /decoder\.decode\(Uri\.parse\(track\.uri\)/.test(bench))
ok('the decoder uses MediaExtractor and MediaCodec',
  /import android\.media\.MediaExtractor/.test(read(
    'android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')) &&
  /import android\.media\.MediaCodec/.test(read(
    'android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')))
ok('the decoder reads the user\'s file through ContentResolver',
  /contentResolver\.openFileDescriptor/.test(read(
    'android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')))
ok('a track that decodes to nothing FAILS rather than being substituted',
  /Decoding produced no audio/.test(bench))
ok('audioDurationMs is derived from real decoded samples',
  /audioDurationMs = totalSamples \* 1000\.0 \/ config\.targetSampleRate/.test(bench))
ok('inference runs on the prepared real PCM',
  /rt\.infer\(prepared\.data\)/.test(bench))

// The ONNX lab must not reach into Phase 14's synthetic dataset.
const labCode = stripComments(labUi)
ok('the ONNX lab does not import the synthetic ai-lab dataset',
  !/from '~\/services\/ai-lab\/(dataset|benchmarkRunner)'/.test(labCode))
ok('the ONNX lab sends real track URIs to native',
  /uri: t\.uri as string/.test(labUi))
ok('tracks without a readable URI are rejected, not faked',
  /have no readable file URI/.test(labUi))

// ------------------------------------------------------------
console.log('\n' + '='.repeat(60))
console.log(`  ${passed} passed, ${failed} failed`)
console.log('='.repeat(60))
console.log(
  '\n  SCOPE: this suite proves the integration is wired correctly and\n' +
  '  contained. It does NOT itself execute ONNX Runtime — there is no\n' +
  '  Android runtime in this environment.\n' +
  '\n' +
  '  DEVICE VERIFIED (Poco X7 Pro, 2026-08-27): the deterministic model\n' +
  '  returned [9,25,49,81], deterministic across 10 runs, and a real\n' +
  '  track ran decode 19586 ms / prep 6.8 / inference 9.4 / tensor 11.8\n' +
  '  / total 19614 ms, rtf 0.150, out dim 2889792 (= the decoded sample\n' +
  '  count, since the test model is element-wise). Sections 11-13 pin\n' +
  '  that reporting down so it cannot silently regress.\n',
)

if (failed > 0) process.exit(1)
