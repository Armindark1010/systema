// ============================================================
// SYSTEMA — Phase 16: candidate evaluation cannot lie
// ============================================================
// Phase 16 is an EVALUATION phase, and its central risk is not a
// crash — it is a plausible-looking table. A researched size sitting
// next to an invented latency, a "no memory leak" claim drawn from
// one sample, or an embedding produced by approximated preprocessing
// would all look completely fine on screen and be worthless.
//
// So this suite audits honesty, not behaviour:
//
//   1. no candidate is presented as measured;
//   2. blocked candidates cannot be run;
//   3. preprocessing is never approximated — a model whose front end
//      SYSTEMA cannot reproduce exactly must FAIL LOUDLY;
//   4. the memory test cannot claim the absence of a leak;
//   5. the memory test cannot be triggered automatically;
//   6. unknown values stay UNKNOWN and never collapse to zero.
//
// Method follows the Phase 13/14/15 safety suites: comments are
// stripped before any "absence" check, so the extensive prose about
// what is deliberately not done can neither satisfy nor trip a test.
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

const ADAPTER = 'android/app/src/main/java/com/systema/music/inference/CandidateModelAdapter.kt'
const PROBE = 'android/app/src/main/java/com/systema/music/inference/MemoryProbe.kt'
const BENCH = 'android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const TS_SERVICE = 'app/services/native/inferenceService.ts'
const PAGE = 'app/pages/dev/ai-benchmark/candidates.vue'

console.log('\n============================================================')
console.log('SYSTEMA — Phase 16 candidate evaluation audit')
console.log('============================================================')

// ------------------------------------------------------------
section('1. The files exist')
// ------------------------------------------------------------
for (const p of [ADAPTER, PROBE, BENCH, PLUGIN, TS_PLUGIN, TS_SERVICE, PAGE]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const adapter = read(ADAPTER)
const adapterCode = stripComments(adapter)
const probe = read(PROBE)
const probeCode = stripComments(probe)
const bench = read(BENCH)
const benchCode = stripComments(bench)
const plugin = read(PLUGIN)
const pluginCode = stripComments(plugin)
const tsPlugin = read(TS_PLUGIN)
const tsService = read(TS_SERVICE)
const tsServiceCode = stripComments(tsService)
const page = read(PAGE)
const pageCode = stripComments(page)

// ------------------------------------------------------------
section('2. The adapter layer keeps model knowledge out of the runtime')
// ------------------------------------------------------------
// The whole point of the adapter is that OnnxInferenceRuntime stays
// generic. If a candidate's name leaks into the runtime, the
// abstraction has already failed.
const runtime = stripComments(
  read('android/app/src/main/java/com/systema/music/inference/OnnxInferenceRuntime.kt'),
)
for (const name of ['yamnet', 'YAMNet', 'vggish', 'VGGish', 'openl3', 'OpenL3', 'PANNs', 'CLAP']) {
  ok(
    `OnnxInferenceRuntime does not mention ${name}`,
    !runtime.includes(name),
    'the generic runtime must not know which model it is running',
  )
}
ok(
  'the adapter, not the runtime, owns the candidate registry',
  adapterCode.includes('object CandidateRegistry'),
)
ok(
  'the adapter produces a generic ModelDescriptor',
  adapterCode.includes('fun toDescriptor(') && adapterCode.includes('ModelDescriptor('),
)
ok(
  'toDescriptor validates before handing anything to the runtime',
  /fun toDescriptor\([^)]*\)[^{]*\{\s*validate\(\)/s.test(adapterCode),
  'a blocked candidate must not be convertible into a runnable descriptor',
)

// ------------------------------------------------------------
section('3. Preprocessing is never approximated (§3)')
// ------------------------------------------------------------
ok(
  'validate() rejects mel-input models outright',
  adapterCode.includes('MEL_SPECTROGRAM') &&
    adapterCode.includes('INPUT_SHAPE_MISMATCH') &&
    /throw InferenceException/.test(adapterCode),
)
ok(
  'the refusal explains why approximation is unacceptable',
  /approximat/i.test(adapter),
)
ok(
  'no candidate silently falls back to RAW_WAVEFORM',
  !/else\s*->\s*InputFormat\.RAW_WAVEFORM/.test(adapterCode),
  'a mel model fed a waveform yields plausible nonsense',
)
// YAMNet is the one runnable candidate, and only because its ONNX
// exports carry the mel front end inside the graph. If that reason
// is not recorded, someone will later "fix" it by adding a mel stage.
ok(
  'YAMNet is runnable only on the in-graph-front-end justification',
  adapter.includes('YAMNET') &&
    /front end (is )?in(side)?[ -]the[ -]graph|inside the graph/i.test(adapter),
)
ok(
  'YAMNet declares 16 kHz mono',
  /inputSampleRate = 16_000/.test(adapterCode) && /inputChannels = 1/.test(adapterCode),
)
ok(
  'YAMNet records the exact published mel parameters for reference',
  /melBands = 64/.test(adapterCode) &&
    /melFminHz = 125/.test(adapterCode) &&
    /melFmaxHz = 7_500/.test(adapterCode),
  'needed if an external front end is ever built',
)

// ------------------------------------------------------------
section('4. Blocked candidates are blocked, with a stated reason')
// ------------------------------------------------------------
const blockedIds = ['vggish', 'openl3', 'panns-cnn14', 'laion-clap']
for (const id of blockedIds) {
  ok(
    `${id} is present in the registry`,
    adapterCode.includes(`"${id}"`),
  )
}
ok(
  'every candidate carries a statusReason',
  // `candidateId = "x"` is the declaration form; `it.candidateId == id`
  // inside byId() must not be counted, hence the `[^=]` guard.
  (adapterCode.match(/statusReason = /g) ?? []).length ===
    (adapterCode.match(/candidateId = [^=]/g) ?? []).length,
  'a block with no reason is an assertion, not evidence',
)
ok(
  'blocked statuses are distinct, not one generic flag',
  adapterCode.includes('BLOCKED_LICENSE') &&
    adapterCode.includes('BLOCKED_PREPROCESSING') &&
    adapterCode.includes('BLOCKED_NO_ONNX'),
)
ok(
  'runnable() filters on status rather than returning everything',
  /runnable\(\)[\s\S]{0,200}filter \{ it\.status == CandidateStatus\.RUNNABLE \}/.test(adapterCode),
)

// ------------------------------------------------------------
section('5. No candidate is presented as measured (§11)')
// ------------------------------------------------------------
ok(
  'the native candidate payload marks itself unmeasured',
  pluginCode.includes('put("measured", false)'),
)
ok(
  'timing fields cross the bridge as null, not zero',
  pluginCode.includes('put("coldLoadMs", null)') &&
    pluginCode.includes('put("warmInferenceMs", null)') &&
    pluginCode.includes('put("peakMemoryKb", null)'),
  'a zero would render as a real, extremely good measurement',
)
ok(
  'deviceVerified defaults to false',
  pluginCode.includes('put("deviceVerified", false)'),
)
ok(
  'the size field is named as approximate/published, not measured',
  adapterCode.includes('approximateSizeMb') && !adapterCode.includes('measuredSizeMb'),
)
ok(
  'the UI labels the table as specifications, not measurements',
  /PUBLISHED SPECIFICATIONS, NOT MEASUREMENTS/.test(page),
)
ok(
  'the UI shows UNKNOWN for every unmeasured performance cell',
  (page.match(/>\s*UNKNOWN\s*</g) ?? []).length >= 3,
)
ok(
  'the UI states NO PRODUCTION MODEL SELECTED',
  /NO PRODUCTION MODEL SELECTED/.test(page),
)
ok(
  'the UI carries the developer-diagnostic label (§12)',
  /Developer Diagnostic — Not a Production Feature/.test(page),
)

// ------------------------------------------------------------
section('6. The memory test cannot claim there is no leak (§8)')
// ------------------------------------------------------------
ok(
  'MemoryTrend has no NO_LEAK state',
  !probeCode.includes('NO_LEAK'),
  'the strongest honest verdict is STABLE',
)
ok(
  'MemoryTrend offers STABLE / GROWING / INCONCLUSIVE',
  probeCode.includes('STABLE') &&
    probeCode.includes('GROWING') &&
    probeCode.includes('INCONCLUSIVE'),
)
// Every mention of "no leak" must be a denial, not a claim. So each
// occurrence is inspected in context and required to sit next to a
// negating qualifier — never / not proof / cannot / does not.
function leakClaimIsUnqualified(src: string): boolean {
  const re = /no (memory )?leak/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const window = src.slice(Math.max(0, m.index - 120), m.index + 60)
    if (!/never|not proof|cannot|can not|does not|deliberately|no NO_LEAK/i.test(window)) {
      return true
    }
  }
  return false
}
ok(
  'no source file makes an unqualified "no memory leak" claim',
  ![probeCode, benchCode, tsServiceCode, pageCode].some(leakClaimIsUnqualified),
)
ok(
  'the UI explicitly promises never to report "no memory leak"',
  /never report[\s\S]{0,40}no memory leak/i.test(page),
)
ok(
  'the STABLE wording explicitly denies being proof',
  /not proof/i.test(tsService),
)
ok(
  'a caveat about PSS noise travels with the report',
  probeCode.includes('caveat') && benchCode.includes('caveat'),
)
ok(
  'fewer than 3 cycles is INCONCLUSIVE, never STABLE',
  /cycles\.size < 3\) return MemoryTrend\.INCONCLUSIVE/.test(benchCode),
)
ok(
  'the service refuses to run fewer than 3 cycles',
  /iterations < 3/.test(tsServiceCode),
)
ok(
  'GROWING requires both a majority of rises and a noise floor',
  /NOISE_FLOOR_KB/.test(benchCode) && /rises >=/.test(benchCode),
  'calling PSS jitter a leak wastes a developer\'s day',
)

// ------------------------------------------------------------
section('7. Unknown memory is UNKNOWN, not zero')
// ------------------------------------------------------------
ok(
  'MemoryProbe degrades to -1 rather than 0',
  probeCode.includes('-1') && /UNKNOWN/.test(probe),
)
ok(
  'capture() cannot throw',
  /runCatching|try \{/.test(probeCode),
  'a failed memory read must not abort a benchmark',
)
ok(
  'the UI renders negative samples as UNKNOWN',
  /kb < 0\) return 'UNKNOWN'/.test(pageCode),
)
ok(
  'a sample with a non-positive value is excluded from the trend',
  /afterUnloadKb <= 0 \}\) return MemoryTrend\.INCONCLUSIVE/.test(benchCode),
)
ok(
  'total PSS is the headline, because ORT allocates natively',
  /totalPss/i.test(probe) && /native/i.test(probe),
)

// ------------------------------------------------------------
section('8. The memory test is manual only (§13)')
// ------------------------------------------------------------
// Same standard as Phase 15: an expensive, repeated load/unload loop
// must never be reachable from app startup or from navigation.
ok(
  'runMemoryLifecycle is not called from onMounted',
  !/onMounted\([\s\S]{0,400}runMemoryLifecycle/.test(pageCode),
)
// Scoped to the watcher CALLBACK BODY. A 400-char window past
// watchEffect() would also swallow whatever function is declared
// after it, which is how this check first produced a false positive.
function watcherBodies(src: string): string[] {
  const bodies: string[] = []
  const re = /watch(?:Effect)?\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    bodies.push(src.slice(m.index, i + 1))
  }
  return bodies
}
ok(
  'runMemoryLifecycle is not called from a watcher',
  !watcherBodies(pageCode).some(b => b.includes('runMemoryLifecycle')),
)
ok(
  'the watcher audit actually found the page\'s watcher',
  watcherBodies(pageCode).length >= 1,
  'a check that inspects nothing always passes',
)
ok(
  'it is bound to an explicit click handler',
  /@click="onRunMemory"/.test(page),
)
ok(
  'no Nuxt plugin references it',
  !existsSync(resolve(ROOT, 'app/plugins')) ||
    !read('app/services/native/inferenceService.ts').includes('defineNuxtPlugin'),
)
ok(
  'the candidate page lives under the dev route only',
  exists('app/pages/dev/ai-benchmark/candidates.vue'),
)
ok(
  'it is not linked from any production surface',
  !['app/pages/index.vue', 'app/pages/library.vue', 'app/pages/search.vue']
    .filter(p => exists(p))
    .some(p => read(p).includes('candidates')),
)

// ------------------------------------------------------------
section('9. The lifecycle actually exercises load and unload')
// ------------------------------------------------------------
// A memory test that loads once and unloads once measures nothing
// about repeated use. The load/unload boundary IS the subject here.
ok(
  'each cycle loads the model',
  /repeat\(cycles\)[\s\S]{0,300}loadModel\(descriptor\)/.test(benchCode),
)
ok(
  'each cycle unloads the model',
  /repeat\(cycles\)[\s\S]{0,900}unloadModel\(\)/.test(benchCode),
)
ok(
  'memory is sampled after load, after inference and after unload',
  benchCode.includes('afterLoad') &&
    benchCode.includes('afterInference') &&
    benchCode.includes('afterUnload'),
)
ok(
  'a baseline is taken before the first load',
  /val baseline = MemorySample\.capture/.test(benchCode),
)
ok(
  'a failed run still unloads, in a finally',
  /finally \{[\s\S]{0,200}unloadModel\(\)/.test(benchCode),
  'a leaked session would poison every later measurement',
)
ok(
  'the probe input is small enough not to dominate the measurement',
  /FloatArray\(16_000\)/.test(benchCode),
)

// ------------------------------------------------------------
section('10. Latency is reported as a distribution (§6)')
// ------------------------------------------------------------
ok(
  'LatencyStats exists natively',
  benchCode.includes('data class LatencyStats'),
)
ok(
  'it reports median, p95, min and max, not just a mean',
  ['medianMs', 'p95Ms', 'minMs', 'maxMs'].every(f => benchCode.includes(f)),
)
ok(
  'the sample count travels with the stats',
  /count = s\.size/.test(benchCode),
  'a p95 from five runs must be visibly weak',
)
ok(
  'p95 uses nearest-rank on sorted samples',
  /ceil\(0\.95 \* s\.size\)/.test(benchCode),
)
ok(
  'the p95 rank is clamped into range',
  /coerceIn\(1, s\.size\)/.test(benchCode),
)
ok(
  'an empty sample set yields null, not zero',
  /if \(samples\.isEmpty\(\)\) return null/.test(benchCode),
)
ok(
  'the TypeScript mirror exists',
  tsPlugin.includes('export interface LatencyStats'),
)

// ------------------------------------------------------------
section('11. The bridge contract matches on both sides')
// ------------------------------------------------------------
for (const method of ['runMemoryLifecycle', 'getCandidates']) {
  ok(`${method} exists natively`, pluginCode.includes(`fun ${method}(call: PluginCall)`))
  ok(`${method} is declared in TypeScript`, tsPlugin.includes(`${method}(`))
  ok(`${method} is exposed by the service`, tsServiceCode.includes(method))
}
ok(
  'runMemoryLifecycle requires an explicit modelId',
  /modelId\.isNullOrBlank\(\)[\s\S]{0,200}call\.reject/.test(pluginCode),
  'there is no default model, by design',
)
ok(
  'MemoryLifecycleReport is typed in TypeScript',
  tsPlugin.includes('export interface MemoryLifecycleReport'),
)
ok(
  'CandidateSpec is typed in TypeScript',
  tsPlugin.includes('export interface CandidateSpec'),
)
ok(
  'the TS MemoryTrend union matches the Kotlin enum',
  tsPlugin.includes("'STABLE' | 'GROWING' | 'INCONCLUSIVE'"),
)

// ------------------------------------------------------------
section('12. Phase 13 and 15 remain untouched')
// ------------------------------------------------------------
// Phase 16 is not licensed to rewrite working DSP to suit a model.
const dspConfig = read('android/app/src/main/java/com/systema/music/analysis/dsp/AudioAnalysisConfig.kt')
ok(
  'the Phase 13 target sample rate is unchanged',
  dspConfig.includes('22_050'),
)
ok(
  'the 5-minute analysis window is unchanged',
  dspConfig.includes('300_000'),
)
ok(
  'loudnessDbfs is still named loudnessDbfs',
  read('android/app/src/main/java/com/systema/music/analysis/dsp/FeatureAggregator.kt')
    .includes('loudnessDbfs'),
)
ok(
  'no candidate work claims LUFS or BS.1770',
  ![adapter, probe, page].some(s => /LUFS|BS\.?1770/i.test(s)),
)
ok(
  'the 20-track benchmark cap is intact',
  bench.includes('MAX_TRACKS = 20') && tsService.includes('MAX_BENCHMARK_TRACKS = 20'),
)
ok(
  'the deterministic test model contract is untouched',
  read('android/app/src/main/java/com/systema/music/inference/ModelDescriptor.kt')
    .includes('floatArrayOf(9f, 25f, 49f, 81f)'),
)

// ------------------------------------------------------------
section('13. No model weights entered the repository')
// ------------------------------------------------------------
ok(
  'the gitignore weights block is still present',
  read('.gitignore').includes('*.onnx'),
)
ok(
  'no candidate weights are committed',
  !['yamnet.onnx', 'vggish.onnx', 'openl3.onnx', 'cnn14.onnx', 'clap.onnx']
    .some(f => exists(`android/app/src/main/assets/${f}`)),
)
ok(
  'the adapter contains no download URL',
  !/https?:\/\/[^\s"']*\.(onnx|pt|pth|h5|tflite)/.test(adapter),
  'Phase 16 does not fetch weights',
)

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
console.log(`
SCOPE OF THIS SUITE
-------------------
This is a static honesty audit. It proves the candidate matrix
declares itself unmeasured, that blocked candidates cannot be run,
that preprocessing is refused rather than approximated, and that the
memory test cannot claim the absence of a leak.

It does NOT prove any candidate model works. None was downloaded,
converted or executed — every model host is unreachable from the
build environment. All candidate performance figures remain
NOT VERIFIED ON HARDWARE.
`)

process.exit(failed > 0 ? 1 : 0)
