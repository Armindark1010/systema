// ============================================================
// SYSTEMA — Phase 16.2: the output contract cannot be ambiguous
// ============================================================
// A device run reported "out dim 208921" for YAMNet. That figure was
// 401 frames x 521 AudioSet classes — the CLASS SCORE tensor,
// flattened — and it was displayed in a position that read like an
// embedding width.
//
// The bug was never the number. It was that one unlabelled integer
// stood in for a tensor contract, and nothing in the pipeline could
// contradict it. This suite audits the fix:
//
//   1. every output is discovered from the SESSION, not hardcoded;
//   2. shapes are resolved at runtime, so dynamic dims become real;
//   3. the output that was READ is named explicitly;
//   4. 208921 is explained from the shape, reproducibly;
//   5. a flattened count is never called an embedding dimension
//      unless it genuinely is one vector;
//   6. the deterministic test model is untouched.
//
// Comments are stripped before any "absence" check, per the Phase
// 13/14/15/16 convention.
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
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(\\.|[^"\\\n])*"/g, '""')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CONTRACT = 'android/app/src/main/java/com/systema/music/inference/OutputContract.kt'
const RUNTIME = 'android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt'
const BENCH = 'android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt'
const DESC = 'android/app/src/main/java/com/systema/music/inference/ModelDescriptor.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const PAGE = 'app/pages/dev/ai-benchmark/onnx.vue'
const STUB = 'scripts/make-yamnet-shaped-stub.py'
const VERIFY = 'scripts/verify-yamnet-output-contract.py'

console.log('\n============================================================')
console.log('SYSTEMA — Phase 16.2 output contract audit')
console.log('============================================================')

// ------------------------------------------------------------
section('1. The pieces exist')
// ------------------------------------------------------------
for (const p of [CONTRACT, RUNTIME, BENCH, DESC, TS_PLUGIN, PAGE, STUB, VERIFY]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const contract = read(CONTRACT)
const contractCode = stripComments(contract)
const runtime = read(RUNTIME)
const runtimeCode = stripComments(runtime)
const bench = read(BENCH)
const benchCode = stripComments(bench)
const desc = read(DESC)
const descCode = stripComments(desc)
const tsPlugin = read(TS_PLUGIN)
const page = read(PAGE)
const pageCode = stripComments(page)
const verify = read(VERIFY)

// ------------------------------------------------------------
section('2. The arithmetic of 208921 is forced, not chosen')
// ------------------------------------------------------------
const N = 208921
ok('208921 = 401 x 521', 401 * 521 === N)
ok('521 divides it exactly', N % 521 === 0)
ok('1024 does NOT divide it', N % 1024 !== 0, 'so it is not the embedding tensor')
ok('64 does NOT divide it', N % 64 !== 0)
const divisors = []
for (let d = 1; d <= N; d++) if (N % d === 0) divisors.push(d)
ok(
  '401 and 521 are both prime, so the factorisation is unique',
  JSON.stringify(divisors) === JSON.stringify([1, 401, 521, N]),
  'no competing explanation of the number exists',
)
ok(
  'the embedding tensor would have been 410624, a different number',
  401 * 1024 === 410624 && 401 * 1024 !== N,
)

// ------------------------------------------------------------
section('3. Outputs are discovered from the session, not hardcoded')
// ------------------------------------------------------------
ok(
  'the runtime enumerates outputs from session.outputNames',
  /session\.outputNames\.toList\(\)/.test(runtimeCode),
)
ok(
  'runtime shapes are read from the RESULT, not the declaration',
  /results\.get\(index\)\.info as\? TensorInfo/.test(runtimeCode),
  'declared shapes carry -1; only resolved ones explain a count',
)
ok(
  'every output is captured, not just the first',
  /names\.mapIndexed/.test(runtimeCode),
)
ok(
  'the result carries all output signatures',
  descCode.includes('val outputs: List<TensorSignature>'),
)
ok(
  'the selected output is named on the result',
  descCode.includes('selectedOutputName') && descCode.includes('selectedOutputIndex'),
  'a bare count is uninterpretable without knowing its source',
)
ok(
  'the runtime records which output it read',
  /selectedOutputName = active\.outputNames\.firstOrNull/.test(runtimeCode),
)
ok(
  'output count is never hardcoded to 3',
  !/outputs\.size == 3|listOf\("output_0", "output_1", "output_2"\)/.test(contractCode),
)
ok(
  'no output name is hardcoded in the classifier',
  !/"output_0"|"output_1"|"output_2"/.test(contractCode),
  'classification is by SHAPE, so it generalises past YAMNet',
)

// ------------------------------------------------------------
section('4. Classification is by shape, and admits UNKNOWN')
// ------------------------------------------------------------
ok(
  'a 521-wide output classifies as CLASS_SCORES',
  /AUDIOSET_CLASS_COUNT -> OutputRole\.CLASS_SCORES/.test(contractCode),
)
ok(
  'a 1024-wide output classifies as FRAME_EMBEDDINGS',
  /YAMNET_EMBEDDING_DIM -> OutputRole\.FRAME_EMBEDDINGS/.test(contractCode),
)
ok(
  'a 64-wide output classifies as LOG_MEL_SPECTROGRAM',
  /YAMNET_MEL_BANDS -> OutputRole\.LOG_MEL_SPECTROGRAM/.test(contractCode),
)
ok(
  'anything else is UNKNOWN, never defaulted to embedding',
  /else -> OutputRole\.UNKNOWN/.test(contractCode),
  'defaulting to "embedding" is precisely how 208921 looked meaningful',
)
ok(
  'UNKNOWN is a declared role, not an error',
  contractCode.includes('UNKNOWN,'),
)
ok(
  'the constants are documented as corroboration, not identification',
  /never to assert that a model is YAMNet|not proof of the architecture/i.test(contract),
)
ok(
  'the ontology size is named, not a magic number',
  contractCode.includes('AUDIOSET_CLASS_COUNT = 521L'),
)

// ------------------------------------------------------------
section('5. A flattened count is never called an embedding dimension')
// ------------------------------------------------------------
ok(
  'isSingleEmbeddingVector is computed, not assumed',
  contractCode.includes('isSingleEmbeddingVector') &&
    contractCode.includes('fun isSingleVector'),
)
ok(
  'only rank-1, or [1, d], counts as a single vector',
  /1 -> shape\[0\] > 0/.test(contractCode) && /2 -> shape\[0\] == 1L/.test(contractCode),
)
ok(
  'embeddingDimension comes from the trailing dim of the EMBEDDING output',
  /embeddingDim = embedding\?\.shape[\s\S]{0,80}lastOrNull\(\)/.test(contractCode),
)
ok(
  'frameCount comes from the LEADING dim',
  /frameCount[\s\S]{0,120}firstOrNull\(\)/.test(contractCode),
)
ok(
  'rawOutputElements is named separately from embeddingDimension',
  contractCode.includes('rawOutputElements') && contractCode.includes('embeddingDimension'),
)
ok(
  'the UI no longer labels the count "out dim"',
  !pageCode.includes('out dim'),
)
ok(
  'the UI labels it "raw output elements"',
  page.includes('raw output elements'),
)
ok(
  'the field is documented as NOT an embedding dimension',
  /NOT an embedding dimension/.test(bench) && /NOT an embedding dimension/.test(tsPlugin),
)
ok(
  'the CLASS_SCORES explanation calls it a category error',
  /category error/i.test(contract),
)

// ------------------------------------------------------------
section('6. The explanation is checkable arithmetic')
// ------------------------------------------------------------
ok(
  'the explanation states shape[0] x shape[1] = product',
  /\$\{shape\[0\]\} x \$\{shape\[1\]\} = \$product/.test(contract),
)
ok(
  'the product is cross-checked against the real buffer length',
  /product == elements\.toLong\(\)/.test(contractCode),
)
ok(
  'a disagreement between shape and buffer is flagged as a WARNING',
  /WARNING: the shape implies/.test(contract),
)
ok(
  'an unresolved shape is admitted, not papered over',
  /could not be fully resolved/.test(contract),
)
ok(
  'the explanation names the unread embedding tensor',
  /which this run did NOT read/.test(contract),
)
ok(
  'it states that pooling is not implemented',
  /aggregation is NOT implemented|NOT implemented/.test(contract),
)

// ------------------------------------------------------------
section('7. Output SELECTION is unchanged — this is an audit')
// ------------------------------------------------------------
ok(
  'the runtime still reads results.get(0)',
  /val first = results\.get\(0\)/.test(runtimeCode),
  'silently switching tensors would change what past numbers meant',
)
ok(
  'selectedOutputIndex is 0, matching the actual read',
  /selectedOutputIndex = 0/.test(runtimeCode),
)
ok(
  'no pooling or aggregation was implemented',
  !/fun pool|meanPool|averagePool|aggregateFrames/.test(
    contractCode + runtimeCode + benchCode,
  ),
)
ok(
  'the deliberate non-change is documented in the runtime',
  /left unchanged here on purpose|does not silently switch/i.test(runtime),
)
ok(
  'the UI warns when the read tensor is not the embedding',
  /THIS RUN DID NOT MEASURE AN EMBEDDING/.test(page),
)
ok(
  'the warning says selection was deliberately not changed',
  /deliberately NOT been changed/.test(page),
)
ok(
  'aggregationRequired is surfaced',
  contractCode.includes('aggregationRequired') && page.includes('POOLING REQUIRED'),
)

// ------------------------------------------------------------
section('8. Nothing else was touched')
// ------------------------------------------------------------
ok(
  'the deterministic test model contract is unchanged',
  desc.includes('floatArrayOf(9f, 25f, 49f, 81f)'),
)
ok(
  'the test model still transforms (x*2+1)^2',
  desc.includes('SCALE = 2f') && desc.includes('OFFSET = 1f'),
)
ok(
  'Phase 13 sample rate untouched',
  read('android/app/src/main/java/com/systema/music/analysis/dsp/AudioAnalysisConfig.kt')
    .includes('22_050'),
)
ok(
  'no mel front end was added',
  !/fun melFilterbank|fun computeMel|melSpectrogram\(/.test(
    contractCode + runtimeCode + benchCode,
  ),
)
ok(
  'preprocessing was not modified',
  !stripComments(
    read('android/app/src/main/java/com/systema/music/inference/ModelInputPreparer.kt'),
  ).includes('OutputContract'),
)
ok(
  'the 16 kHz YAMNet contract is unchanged',
  read('android/app/src/main/java/com/systema/music/inference/CandidateModelAdapter.kt')
    .includes('inputSampleRate = 16_000'),
)
ok(
  'the 20-track cap is intact',
  bench.includes('MAX_TRACKS = 20'),
)
ok(
  'no model weights entered the repository',
  !exists('android/app/src/main/assets/models/yamnet.onnx') &&
    !exists('scripts/yamnet_shaped_stub.onnx'),
)
ok(
  'the stand-in graph is written to /tmp, never committed',
  /\/tmp\//.test(read(STUB)) && !exists('yamnet_shaped_stub.onnx'),
)
ok(
  'the stand-in is clearly labelled as NOT YAMNet',
  /THIS IS NOT YAMNET/.test(read(STUB)),
)

// ------------------------------------------------------------
section('9. The TypeScript mirror is complete')
// ------------------------------------------------------------
ok('OutputRole is mirrored', tsPlugin.includes('export type OutputRole'))
ok('DescribedOutput is mirrored', tsPlugin.includes('export interface DescribedOutput'))
ok(
  'OutputContractReport is mirrored',
  tsPlugin.includes('export interface OutputContractReport'),
)
for (const role of ['CLASS_SCORES', 'FRAME_EMBEDDINGS', 'LOG_MEL_SPECTROGRAM', 'UNKNOWN']) {
  ok(`${role} exists on both sides`,
    contractCode.includes(role) && tsPlugin.includes(role))
}
ok(
  'the measurement carries the contract',
  tsPlugin.includes('outputContract?: OutputContractReport'),
)

// ------------------------------------------------------------
section('10. The reproduction script is honest about scope')
// ------------------------------------------------------------
ok(
  'it states the real yamnet.onnx was not executed',
  /does not execute the real yamnet|not YAMNet itself/i.test(verify),
)
ok(
  'it states the Kotlin was not compiled',
  /not compile|no JDK/i.test(verify),
)
ok(
  'it says a hardware retest is required',
  /hardware retest is required/i.test(verify),
)
ok(
  'it skips cleanly without onnxruntime',
  /except ImportError/.test(verify),
)

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
console.log(`
SCOPE OF THIS SUITE
-------------------
A static audit of the output-contract diagnostics, plus the closed-form
arithmetic of 208921 (= 401 x 521, a unique factorisation).

The live tensor reproduction lives in
scripts/verify-yamnet-output-contract.py, which runs a real ONNX
Runtime against a YAMNet-SHAPED stand-in graph.

Neither executes the real yamnet.onnx, and neither compiles the
Kotlin. The new diagnostics have NOT been seen on device — a hardware
retest is required to confirm they render.
`)

process.exit(failed > 0 ? 1 : 0)
