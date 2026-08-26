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
console.log('\n' + '='.repeat(60))
console.log(`  ${passed} passed, ${failed} failed`)
console.log('='.repeat(60))
console.log(
  '\n  SCOPE: this suite proves the integration is wired correctly and\n' +
  '  contained. It does NOT prove ONNX Runtime executed anything —\n' +
  '  no Android runtime exists in this environment. Device execution\n' +
  '  is verified only by running the ONNX RUNTIME LAB on hardware.\n',
)

if (failed > 0) process.exit(1)
