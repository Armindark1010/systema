// ============================================================
// SYSTEMA — Phase 16A: the wiring around the aggregator
// ============================================================
// The ARITHMETIC of aggregation is proven by executing it:
// android/app/src/test/java/com/systema/music/inference/AggregationTest.kt
// compiles and runs on a plain JVM via scripts/run-inference-tests.sh,
// and asserts real numbers on real FloatArrays.
//
// This suite covers what the JVM run cannot reach: the Android and
// TypeScript wiring that decides WHICH tensor reaches the aggregator,
// WHEN it runs relative to the timing boundaries, and WHAT the UI is
// allowed to call it.
//
// The failure this exists to prevent is specific. Phase 16.2 found a
// benchmark reporting "out dim 208921" — 401 frames x 521 AudioSet
// classes, flattened — in a slot that read like an embedding width,
// while the actual 1024-d embeddings were computed and thrown away.
// Correct pooling maths wired to the wrong tensor reproduces exactly
// that bug with more confidence, so the wiring needs its own audit.
//
// Comments are stripped before any "absence" check, per the Phase
// 13/14/15/16 convention: a rule described in prose must not satisfy
// a test looking for it in code.
// ============================================================

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(name)
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

const AGG = 'android/app/src/main/java/com/systema/music/inference/FrameEmbeddingAggregator.kt'
const BRIDGE = 'android/app/src/main/java/com/systema/music/inference/FrameEmbeddingBridge.kt'
const TEST = 'android/app/src/test/java/com/systema/music/inference/AggregationTest.kt'
const RUNTIME = 'android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt'
const BENCH = 'android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt'
const DESC = 'android/app/src/main/java/com/systema/music/inference/ModelDescriptor.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const PAGE = 'app/pages/dev/ai-benchmark/onnx.vue'
const RUNNER = 'scripts/run-inference-tests.sh'

console.log('\n============================================================')
console.log('SYSTEMA — Phase 16A aggregation wiring audit')
console.log('============================================================')

// ------------------------------------------------------------
section('1. The pieces exist')
// ------------------------------------------------------------
for (const p of [AGG, BRIDGE, TEST, RUNTIME, BENCH, DESC, PLUGIN, TS_PLUGIN, PAGE, RUNNER]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const agg = read(AGG)
const aggCode = stripComments(agg)
const bridge = read(BRIDGE)
const test = read(TEST)
const runtime = read(RUNTIME)
const runtimeCode = stripComments(runtime)
const bench = read(BENCH)
const benchCode = stripComments(bench)
const descCode = stripComments(read(DESC))
const pluginCode = stripComments(read(PLUGIN))
const tsPlugin = read(TS_PLUGIN)
const page = read(PAGE)
const pageCode = stripComments(page)
const runner = read(RUNNER)

// ------------------------------------------------------------
section('2. The aggregator is model-independent')
// ------------------------------------------------------------
ok(
  'it never mentions yamnet',
  !/yamnet/i.test(aggCode),
  'identifying a tensor by model name is the bug being prevented',
)
ok(
  'it takes the dimension as a parameter',
  /dimension:\s*Int/.test(aggCode),
)
ok(
  'it takes the frame count as a parameter',
  /frameCount:\s*Int/.test(aggCode),
)
ok(
  'no literal 1024 is baked into the maths',
  !/\b1024\b/.test(aggCode),
  'a hardcoded width would make swapping candidates a code change',
)
ok(
  'no literal 521 anywhere in the aggregator',
  !/\b521\b/.test(aggCode),
)

// ------------------------------------------------------------
section('3. The aggregator is platform-independent, hence testable')
// ------------------------------------------------------------
// This is what lets the arithmetic actually EXECUTE in CI rather
// than only being read. The moment a Capacitor import appears here,
// the JVM suite stops compiling.
ok(
  'the aggregator imports nothing from Capacitor',
  !/import com\.getcapacitor/.test(agg),
)
ok(
  'the aggregator imports nothing from Android',
  !/import android\./.test(agg),
)
ok(
  'the aggregator imports nothing from ONNX',
  !/import ai\.onnxruntime/.test(agg),
)
ok(
  'JSON serialisation lives in the bridge instead',
  /import com\.getcapacitor\.JSObject/.test(bridge) && /fun toJs/.test(bridge),
)
ok(
  'the runner compiles the aggregation suite',
  /AggregationTest\.kt/.test(runner),
)
ok(
  'the runner EXECUTES it, not just compiles it',
  /com\.systema\.music\.inference\.AggregationTest/.test(runner),
)
ok(
  'a failing aggregation suite fails the runner',
  /Aggregation suite FAILED/.test(runner) && /exit 1/.test(runner),
)
ok(
  'the aggregation suite runs even without the coroutines jar',
  runner.indexOf('AggregationTest') < runner.indexOf('COROUTINES JAR NOT FOUND'),
  'pooling maths must be verifiable on a bare toolchain',
)

// ------------------------------------------------------------
section('4. The embedding tensor is chosen by shape, never by name')
// ------------------------------------------------------------
ok(
  'the runtime classifies outputs via OutputContract',
  /OutputContract\.classify/.test(runtimeCode),
)
ok(
  'it accepts only embedding roles',
  /OutputRole\.FRAME_EMBEDDINGS/.test(runtimeCode) &&
    /OutputRole\.SINGLE_EMBEDDING/.test(runtimeCode),
)
ok(
  'the embedding index is searched, not assumed to be 1',
  /indexOfFirst/.test(runtimeCode),
  'output_1 is where YAMNet happens to put it, not a general rule',
)
ok(
  'no model-name branching selects the tensor',
  !/modelId\s*==\s*"?yamnet/i.test(runtimeCode),
)
ok(
  'the bridge lookup is also role-based',
  /role == OutputRole\.FRAME_EMBEDDINGS/.test(stripComments(bridge)),
)
ok(
  'the bridge returns null rather than guessing',
  /return null/.test(stripComments(bridge)),
)

// ------------------------------------------------------------
section('5. It fails explicitly, never falling back to output_0')
// ------------------------------------------------------------
ok(
  'a missing embedding produces a recorded reason',
  /aggregationError\s*=/.test(benchCode),
)
ok(
  'the benchmark checks for a null embedding tensor',
  /embFrames == null/.test(benchCode),
)
ok(
  'it does not substitute result.output when the embedding is absent',
  !/embeddingFrames\s*\?:\s*result\.output/.test(benchCode) &&
    !/embFrames\s*\?:\s*result\.output/.test(benchCode),
  'pooling 521-wide class scores would yield confident nonsense',
)
ok(
  'an unresolved shape is refused rather than guessed',
  /embShape\.size != 2/.test(benchCode),
)
ok(
  'the aggregator refuses a mismatched buffer',
  // The message is split across a Kotlin string concatenation, so
  // match it the way the source is written. The RUNTIME text is
  // asserted for real in AggregationTest.
  /Refusing to \s*"?\s*\+?\s*"?reshape/.test(agg),
)
ok(
  'a bad shape raises INPUT_SHAPE_MISMATCH',
  /InferenceErrorCode\.INPUT_SHAPE_MISMATCH/.test(aggCode),
)

// ------------------------------------------------------------
section('6. Aggregation runs after inference, outside the timings')
// ------------------------------------------------------------
const runIdx = benchCode.indexOf('rt.infer(prepared.data)')
const aggIdx = benchCode.indexOf('FrameEmbeddingAggregator.aggregate')
ok('the benchmark calls the aggregator', aggIdx > 0)
ok(
  'it is called AFTER inference returns',
  runIdx > 0 && aggIdx > runIdx,
  'aggregation must never sit inside the measured run',
)
ok(
  'inferenceMs still comes straight from the runtime result',
  /inferenceMs = result\.inferenceMs/.test(benchCode),
)
ok(
  'the runtime still times run() alone',
  /results = active\.run\(/.test(runtimeCode) &&
    /inferenceMs = \(System\.nanoTime\(\) - runStartNs\)/.test(runtimeCode),
)
ok(
  'totalMs keeps its original four terms',
  /val totalMs = decodeMs \+ prepared\.preparationMs \+ result\.inferenceMs \+ result\.tensorMs/
    .test(benchCode),
)
ok(
  'aggregationMs is NOT added to totalMs',
  !/totalMs\s*\+?=.*aggregationMs/.test(benchCode) &&
    !/aggregationMs.*\+.*totalMs/.test(benchCode),
  'earlier benchmark numbers must stay comparable',
)
ok(
  'aggregationMs is reported separately',
  /aggregationMs = trackEmbedding\?\.aggregationMs/.test(benchCode),
)
ok(
  'aggregation is not performed inside the ONNX graph',
  !/aggregate/i.test(runtimeCode.replace(/aggregationRequired/g, '')),
  'the graph is never modified; pooling is host-side',
)

// ------------------------------------------------------------
section('7. A failed aggregation does not fail the track')
// ------------------------------------------------------------
ok(
  'the aggregation call is wrapped',
  /catch \(e: InferenceException\) \{[\s\S]{0,120}aggregationError/.test(benchCode),
)
ok(
  'the measurement is still returned as ok',
  /aggregationError = aggregationError,/.test(benchCode) && /ok = true/.test(benchCode),
  'the model timings remain valid measurements either way',
)
ok(
  'failed rows carry explicit nulls',
  /trackEmbedding = null/.test(benchCode),
)

// ------------------------------------------------------------
section('8. The strategy is selectable, defaulted and reported')
// ------------------------------------------------------------
ok(
  'AggregationStrategy is an enum',
  /enum class AggregationStrategy/.test(aggCode),
)
ok('MEAN exists', /\bMEAN\b/.test(aggCode))
ok('MEAN_STD exists', /\bMEAN_STD\b/.test(aggCode))
ok(
  'MEAN is the default parameter',
  /strategy: AggregationStrategy = AggregationStrategy\.MEAN/.test(aggCode),
)
ok(
  'the benchmark threads a strategy through',
  /aggregationStrategy: AggregationStrategy/.test(benchCode),
)
ok(
  'the report states which strategy ran',
  /aggregationStrategy/.test(benchCode) &&
    /put\("aggregationStrategy"/.test(bench),
)
ok(
  'the plugin accepts a strategy from the web layer',
  /getString\("aggregationStrategy"\)/.test(read(PLUGIN)),
)
ok(
  'an unknown strategy is rejected, not defaulted',
  /Unknown aggregation strategy/.test(read(PLUGIN)),
  'a typo must never silently mislabel a run',
)
ok(
  'the TypeScript type lists exactly the two strategies',
  /export type AggregationStrategy = 'MEAN' \| 'MEAN_STD'/.test(tsPlugin),
)

// ------------------------------------------------------------
section('9. MEAN_STD is never sold as the 1024-d baseline')
// ------------------------------------------------------------
ok(
  'the strategy declares its own output width',
  /fun outputDimension\(dimension: Int\): Int/.test(aggCode),
)
ok(
  'MEAN_STD doubles the width in code',
  /MEAN_STD -> dimension \* 2/.test(aggCode),
)
ok(
  'the width difference is stated in the source',
  /2D WIDE, NOT D|OUTPUT IS 2D WIDE/.test(agg),
)
ok(
  'the UI warns that MEAN_STD is not interchangeable',
  /NOT[\s\S]{0,40}interchangeable/i.test(page),
)
ok(
  'the UI shows the actual dimension rather than assuming 1024',
  /trackEmbedding\.dimension/.test(pageCode),
)

// ------------------------------------------------------------
section('10. Zero-norm handling is safe and undisguised')
// ------------------------------------------------------------
ok(
  'a degenerate flag exists on the result',
  /val degenerate: Boolean/.test(aggCode),
)
ok(
  'zero norm returns a fresh zero array',
  /return FloatArray\(vector\.size\)/.test(aggCode),
)
ok(
  'no epsilon is added to the norm',
  !/norm \+ 1e-|1e-8|1e-9|1e-12|EPSILON/.test(aggCode),
  'an epsilon produces a vector that merely looks normalised',
)
ok(
  'the no-epsilon rule is documented',
  /No epsilon is added anywhere|no epsilon/i.test(agg),
)
ok(
  'a degenerate vector reports itself as non-unit',
  /if \(degenerate\) return false/.test(aggCode),
)
ok(
  'the UI explains that cosine is undefined, not zero',
  /cosine[\s\S]{0,60}undefined/i.test(page),
)

// ------------------------------------------------------------
section('11. Non-finite values are rejected before pooling')
// ------------------------------------------------------------
const nanIdx = aggCode.indexOf('nonFinite')
const poolIdx = aggCode.indexOf('val pooled = when (strategy)')
ok('a non-finite count is taken', nanIdx > 0)
ok(
  'the check happens BEFORE pooling',
  nanIdx > 0 && poolIdx > 0 && nanIdx < poolIdx,
  'one NaN poisons its whole column and every later similarity',
)
ok(
  'the error names how many were found',
  /non-finite value\(s\)/.test(agg),
)
ok(
  'non-finite values are not silently replaced',
  !/isNaN\(\)\)\s*\{?\s*\w+\s*=\s*0/.test(aggCode),
)

// ------------------------------------------------------------
section('12. Accumulation is done in Double')
// ------------------------------------------------------------
ok(
  'the mean accumulator is a DoubleArray',
  /val sums = DoubleArray\(dimension\)/.test(aggCode),
)
ok(
  'the variance accumulator is a DoubleArray',
  /val varianceAcc = DoubleArray\(dimension\)/.test(aggCode),
)
ok(
  'the L2 norm accumulates in Double',
  /fun l2Norm\(vector: FloatArray\): Double/.test(aggCode),
)
ok(
  'variance uses the two-pass form',
  /val delta = frames\[offset \+ d\] - mean\[d\]\.toDouble\(\)/.test(aggCode),
  'the one-pass shortcut cancels catastrophically on large means',
)
ok(
  'the sqrt argument is clamped non-negative',
  /coerceAtLeast\(0\.0\)/.test(aggCode),
)

// ------------------------------------------------------------
section('13. No duplicate copy of the N x D tensor')
// ------------------------------------------------------------
ok(
  'the already-read buffer is reused at index 0',
  /embeddingFrames = if \(embeddingIndex == 0\)/.test(runtimeCode),
)
ok(
  'mean pooling allocates one accumulator and one output',
  (aggCode.match(/DoubleArray\(dimension\)/g) || []).length === 2,
)
ok(
  'the frame buffer is never copied wholesale in the aggregator',
  !/frames\.copyOf\(\)/.test(aggCode),
)
ok(
  'the embedding is read inside the scope that closes the results',
  runtimeCode.indexOf('embeddingIndex') < runtimeCode.lastIndexOf('finally'),
  'native buffers must not outlive the run',
)
ok(
  'only a preview crosses the bridge, not 1024 floats',
  /vector\.take\(count\)/.test(agg) && !/put\("vector"/.test(bridge),
)

// ------------------------------------------------------------
section('14. The UI distinguishes the three quantities')
// ------------------------------------------------------------
ok('the page shows a TRACK EMBEDDING block', /TRACK EMBEDDING/.test(page))
ok('it shows the frame embedding shape', /inputFrameCount/.test(pageCode))
ok('it names the aggregation strategy', /trackEmbedding\.strategy/.test(pageCode))
ok('it names the normalisation', /trackEmbedding\.normalisation/.test(pageCode))
ok('it shows the aggregation time', /aggregationMs/.test(pageCode))
ok('it shows the pre-normalisation L2', /preNormL2/.test(pageCode))
ok('it reports the unit-length self-check', /unitLength/.test(pageCode))
ok(
  'no literal 208921 is presented as a dimension',
  !/208921/.test(pageCode),
)
ok(
  'the page still labels the raw count as a flattened count',
  /flattened/i.test(page),
)
ok(
  'the page states aggregation is excluded from totalMs',
  /excluded from[\s\S]{0,60}totalMs/i.test(page),
)

// ------------------------------------------------------------
section('15. No quality or readiness claim is made')
// ------------------------------------------------------------
const claimSurfaces = [agg, bench, page, test]
for (const [i, src] of claimSurfaces.entries()) {
  const label = ['aggregator', 'benchmark', 'page', 'test'][i]
  ok(
    `${label} does not call mean pooling optimal`,
    !/mean pooling is (the )?(best|optimal)/i.test(src),
  )
  ok(
    `${label} does not call the model production ready`,
    !/production[- ]ready/i.test(src),
  )
}
ok(
  'the aggregator states mean pooling is a baseline',
  /BASELINE/.test(agg),
)
ok(
  'the UI says quality is unevaluated',
  /no quality claim|not been evaluated|quality[\s\S]{0,40}unevaluated/i.test(page),
)
ok(
  'the test suite disclaims quality evaluation',
  /does NOT evaluate/i.test(test),
)

// ------------------------------------------------------------
section('16. Out-of-scope work was not started')
// ------------------------------------------------------------
const allKotlin = agg + bridge + bench + runtime
ok('no cosine similarity function', !/fun cosine/i.test(stripComments(allKotlin)))
ok('no embedding database', !/embeddingDao|EmbeddingEntity|CREATE TABLE embedding/i.test(allKotlin))
ok('no library scan added', !/scanLibrary|indexLibrary/i.test(stripComments(allKotlin)))
ok('no background analysis worker added', !/WorkManager|OneTimeWorkRequest/.test(allKotlin))
ok(
  'the native memory lifecycle test still exists',
  /MemoryProbe/.test(read(PLUGIN)) ||
    exists('android/app/src/main/java/com/systema/music/inference/MemoryProbe.kt'),
)
ok(
  'the deterministic test model is untouched',
  !/embedding/i.test(stripComments(read(DESC)).split('enum class InferenceErrorCode')[0]
    .split('data class InferenceResult')[0]),
)
ok(
  'InferenceResult carries the embedding without renaming output',
  /val output: FloatArray/.test(descCode) && /val embeddingFrames: FloatArray\?/.test(descCode),
  'the existing field keeps meaning exactly what it meant before',
)

// ------------------------------------------------------------
section('17. The plugin chain is unchanged in shape')
// ------------------------------------------------------------
ok('InferencePlugin still delegates to the benchmark', /benchmark\.runRealAudio/.test(pluginCode))
ok('the benchmark still delegates to a runtime', /runtime\(/.test(benchCode))
ok(
  'the runtime interface was not given an aggregate method',
  !/fun aggregate/.test(stripComments(read('android/app/src/main/java/com/systema/music/inference/InferenceRuntime.kt'))),
  'pooling is a benchmark-layer concern, not a runtime contract',
)

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
if (failures.length > 0) {
  console.log(`  failing: ${failures.join(', ')}`)
}
console.log(`
SCOPE OF THIS SUITE
-------------------
A static audit of the WIRING only: tensor selection, timing
boundaries, failure behaviour and labelling.

The aggregation ARITHMETIC is proven separately by executing it —
AggregationTest.kt compiles and runs on a JVM through
scripts/run-inference-tests.sh.

Neither suite runs the real yamnet.onnx, compiles the Android app, or
touches a device. Mean pooling is the BASELINE; its quality for music
similarity is UNMEASURED, and no production model has been selected.
`)

process.exit(failed > 0 ? 1 : 0)
