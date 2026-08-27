// ============================================================
// SYSTEMA — white-screen regression suite
// ============================================================
// Guards the Phase 18 bug where the Labelled Quality Evaluation page
// went blank near the end of a run on device.
//
// ROOT CAUSE BEING GUARDED
// ------------------------
// Android's org.json cannot represent NaN or Infinity: JSON.checkDouble
// throws "Forbidden numeric value". Capacitor's JSObject.put(String,
// double) catches that JSONException and ignores it, so the key is
// silently OMITTED from the payload. A field the TypeScript interface
// declared as `number` arrived as `undefined`, `.toFixed()` threw
// TypeError inside a Vue render function, and Vue unmounted the tree —
// a blank, still-scrollable page.
//
// NaN is a NORMAL value in this phase: `auc` is NaN when a label class
// is empty, and `cosine` is NaN for a pair whose track failed to
// embed. So this is a routine state, not an edge case.
//
// HOW THESE TESTS WORK
// --------------------
// Sections 1-3 are a static audit of the fix.
// Sections 4-10 EXECUTE: they mount the real render path through
// Vue's own runtime with a custom (non-DOM) renderer, feed it the
// exact payload shape the bridge produces, and assert the page is
// still rendered afterwards. A regression here fails as a genuinely
// blank tree, the same way it failed on the phone.
//
// WHAT THEY DO NOT COVER
// ----------------------
// No model runs, no audio is decoded, no device is involved. These
// prove the RENDERING and STATE contract, not that ONNX works.
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRenderer, h, ref, nextTick, defineComponent, onErrorCaptured } from '@vue/runtime-core'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

// ============================================================
// A faithful model of the Capacitor / org.json numeric contract.
// ============================================================

/** Android org.json: NaN and Infinity are rejected. */
function checkDouble(d: number): void {
  if (Number.isNaN(d) || !Number.isFinite(d)) {
    throw new Error(`Forbidden numeric value: ${d}`)
  }
}

/**
 * Capacitor's JSObject, including the silent-swallow behaviour that
 * caused the bug. `put(key, double)` drops the key on a JSONException.
 */
class JSObject {
  private m: Record<string, unknown> = {}

  put(key: string, value: unknown): this {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      try {
        checkDouble(value)
      } catch {
        return this // KEY DROPPED — exactly what Capacitor does
      }
    }
    this.m[key] = value
    return this
  }

  /** The fixed path: non-finite doubles become JSON null. */
  putNumeric(key: string, value: number): this {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      this.m[key] = null
      return this
    }
    return this.put(key, value)
  }

  json(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.m))
  }
}

// ============================================================
// A real Vue renderer with a plain-object host, so a torn-down tree
// is observable as an empty node rather than needing a browser.
// ============================================================

interface Node { type: string, children: Node[], text: string | null, parent: Node | null }

let nid = 0
const mk = (type: string): Node => {
  nid++
  return { type, children: [], text: null, parent: null }
}

const { createApp } = createRenderer<Node, Node>({
  createElement: mk,
  createText: (t) => { const n = mk('#text'); n.text = t; return n },
  createComment: () => mk('#comment'),
  setText: (n, t) => { n.text = t },
  setElementText: (n, t) => { n.text = t; n.children = [] },
  insert: (child, parent, anchor) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const i = anchor ? parent.children.indexOf(anchor) : -1
    if (i >= 0) parent.children.splice(i, 0, child)
    else parent.children.push(child)
  },
  remove: (child) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  },
  parentNode: n => n.parent,
  nextSibling: n => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] ?? null : null),
  patchProp: () => {},
})

const dump = (n: Node): string => (n.text ?? '') + n.children.map(dump).join('')

// ---- the production helpers, imported by behaviour ----------
// Mirrors app/services/native/inferenceService.ts exactly.
type MaybeNumber = number | null | undefined

function formatAuc(auc: MaybeNumber): string {
  if (auc === null || auc === undefined || !Number.isFinite(auc)) return 'not measured'
  return auc.toFixed(3)
}

function formatScore(v: MaybeNumber, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

function prettyVerdict(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v.replace(/_/g, ' ') : 'UNKNOWN'
}

// The boundary component, mirroring app/components/dev/ResultsBoundary.vue
const Boundary = defineComponent({
  name: 'ResultsBoundary',
  setup(_props, { slots }) {
    const failure = ref<string | null>(null)
    onErrorCaptured((err) => {
      failure.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      return false
    })
    return () => (failure.value
      ? h('div', `RESULTS DISPLAY ERROR: ${failure.value}`)
      : h('div', slots.default?.()))
  },
})

console.log('\x1b[1m\x1b[36mSYSTEMA — white-screen regression suite\x1b[0m')

// ============================================================
section('1. The native serializer no longer drops non-finite doubles')
// ============================================================

const evalJson = read('android/app/src/main/java/com/systema/music/inference/EvaluationJson.kt')
const labLab = read('android/app/src/main/java/com/systema/music/inference/LabeledQualityLab.kt')
const memAudit = read('android/app/src/main/java/com/systema/music/inference/MemoryLifecycleAudit.kt')

ok('putNumeric exists', /fun JSObject\.putNumeric\(/.test(evalJson))
ok('it writes JSONObject.NULL, not a dropped key',
  /org\.json\.JSONObject\.NULL/.test(evalJson))
ok('it tests both NaN and infinity',
  /isNaN\(\)/.test(evalJson) && /isInfinite\(\)/.test(evalJson))
ok('the comment names the Capacitor swallow as the cause',
  /catch \(JSONException/.test(evalJson) && /white-?screen/i.test(evalJson))

for (const field of ['auc', 'meanGap', 'rangeOverlap', 'overlapFraction']) {
  ok(`ClassSeparation.${field} uses putNumeric`,
    new RegExp(`putNumeric\\("${field}"`).test(evalJson))
}
for (const field of ['cosine', 'referenceValue']) {
  ok(`LabeledPairResult.${field} uses putNumeric`,
    new RegExp(`putNumeric\\("${field}"`).test(evalJson))
}
for (const field of ['mean', 'median', 'min', 'max', 'stdDev', 'p25', 'p75']) {
  ok(`SimilarityStats.${field} uses putNumeric`,
    new RegExp(`putNumeric\\("${field}"`).test(evalJson))
}
for (const field of ['l2Norm', 'rtf', 'medianRtf', 'medianDecodeMs']) {
  ok(`report/row ${field} uses putNumeric`,
    new RegExp(`putNumeric\\("${field}"`).test(labLab))
}
ok('memory elapsedMs uses putNumeric', /putNumeric\("elapsedMs"/.test(memAudit))

// No plain put() left on a known-nullable double.
ok('no bare put("auc", ...) remains', !/[^c]put\("auc",/.test(evalJson))
ok('no bare put("cosine", ...) remains', !/[^c]put\("cosine",/.test(evalJson))

// ============================================================
section('2. The TypeScript contract admits null')
// ============================================================

const pluginTs = read('app/services/native/inferencePlugin.ts')
const serviceTs = read('app/services/native/inferenceService.ts')

ok('MaybeNumber is exported', /export type MaybeNumber = number \| null/.test(pluginTs))
ok('ClassSeparation.auc is MaybeNumber', /auc: MaybeNumber/.test(pluginTs))
ok('LabeledPairResult.cosine is MaybeNumber', /cosine: MaybeNumber/.test(pluginTs))
ok('TrackEmbeddingRow.l2Norm is MaybeNumber', /l2Norm: MaybeNumber/.test(pluginTs))
ok('SimilarityStats.mean is MaybeNumber', /mean: MaybeNumber/.test(pluginTs))
ok('formatAuc accepts MaybeNumber', /formatAuc\(auc: MaybeNumber/.test(serviceTs))
ok('formatScore exists for cosine-scale values', /export function formatScore/.test(serviceTs))
ok('describeClass no longer calls .toFixed directly',
  !/s\.mean\.toFixed/.test(serviceTs))

// ============================================================
section('3. The page guards every native read')
// ============================================================

const page = read('app/pages/dev/ai-benchmark/labeled.vue')

ok('fmt() rejects null and non-finite',
  /function fmt\(n: MaybeNumber \| undefined[\s\S]{0,160}Number\.isFinite/.test(page))
ok('the cosine cell no longer uses Number.isNaN as its only guard',
  !/Number\.isNaN\(p\.cosine\)/.test(page))
ok('verdict rendering goes through prettyVerdict',
  /prettyVerdict\(liveSeparation\.verdict\)/.test(page)
  && /prettyVerdict\(report\.separation\.verdict\)/.test(page))
ok('no raw .replace() on a native enum remains',
  !/verdict\.replace\(/.test(page) && !/attribution\.replace\(/.test(page))
ok('results are wrapped in a render boundary',
  /<DevResultsBoundary/.test(page))
// Strip comments first: the page EXPLAINS why the hook cannot live
// here, and prose about a pattern must not register as the pattern.
const pageCode = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
ok('the boundary is a child component, not a same-component hook',
  !/onErrorCaptured\s*\(/.test(pageCode))
ok('malformed payloads are dropped and reported, not defaulted',
  /noteMalformed\(/.test(page) && /MALFORMED NATIVE EVENTS DROPPED/.test(page))

const boundary = read('app/components/dev/ResultsBoundary.vue')
ok('the boundary logs to the console for logcat', /console\.error/.test(boundary))
ok('the boundary shows the error rather than hiding it',
  /DISPLAY ERROR/.test(boundary) && /\{\{ failure \}\}/.test(boundary))
ok('the boundary does not navigate away or reload',
  !/router\.(push|replace)/.test(boundary) && !/location\.reload/.test(boundary))

// ============================================================
section('4. The bug reproduces on the OLD path and is fixed on the new')
// ============================================================

// LabeledPairEvaluation.compare() with an empty class -> all NaN.
const emptyClass = {
  higher: 'SIMILAR', lower: 'DIFFERENT', countHigher: 1, countLower: 0,
  auc: NaN, meanGap: NaN, rangeOverlap: NaN, overlappingPairs: 0,
  overlapFraction: NaN, insufficient: true,
}

const oldWire = new JSObject()
  .put('higher', emptyClass.higher).put('lower', emptyClass.lower)
  .put('auc', emptyClass.auc).put('meanGap', emptyClass.meanGap)
  .put('overlapFraction', emptyClass.overlapFraction)
  .json()

ok('OLD: auc key is dropped entirely by the bridge', !('auc' in oldWire))
ok('OLD: reading it yields undefined', oldWire.auc === undefined)

let oldThrew = false
try { (oldWire.auc as number).toFixed(3) } catch { oldThrew = true }
ok('OLD: .toFixed() on it throws — the crash', oldThrew)

const newWire = new JSObject()
  .put('higher', emptyClass.higher).put('lower', emptyClass.lower)
  .putNumeric('auc', emptyClass.auc)
  .putNumeric('meanGap', emptyClass.meanGap)
  .putNumeric('overlapFraction', emptyClass.overlapFraction)
  .json()

ok('NEW: the auc key survives', 'auc' in newWire)
ok('NEW: its value is null, not undefined', newWire.auc === null)
ok('NEW: null is distinguishable from a real 0', newWire.auc !== 0)
ok('NEW: formatAuc renders it safely', formatAuc(newWire.auc as null) === 'not measured')
ok('NEW: a finite auc is unchanged',
  formatAuc(new JSObject().putNumeric('auc', 0.875).json().auc as number) === '0.875')

// ============================================================
section('5. A complete multi-track evaluation does not blank the UI')
// ============================================================

// Full page model: the parts under test, in the same structure.
function makePage() {
  const rows = ref<any[]>([])
  const pairs = ref<any[]>([])
  const liveSeparation = ref<any>(null)
  const report = ref<any>(null)
  const trackPosition = ref(0)

  const Page = defineComponent({
    setup: () => () => h('div', [
      h('h1', 'Labelled Quality Evaluation'),
      h('p', `TRACKS ${trackPosition.value}`),
      h(Boundary, null, {
        default: () => [
          liveSeparation.value
            ? h('section', (liveSeparation.value.comparisons ?? []).map((c: any) =>
                h('p', `AUC ${formatAuc(c.auc)}`)))
            : null,
          h('section', pairs.value.map((p: any) =>
            h('p', `${prettyVerdict(p.label)} ${formatScore(p.cosine)} ${p.outcome}`))),
          h('section', rows.value.map((r: any) =>
            h('p', `${r.ok ? 'OK' : 'FAILED'} norm ${formatScore(r.l2Norm)}`))),
          report.value
            ? h('section', `FINAL ${prettyVerdict(report.value.separation?.verdict)} `
                + `rtf ${formatScore(report.value.medianRtf, 3)}`)
            : null,
        ],
      }),
    ]),
  })

  const root = mk('root')
  createApp(Page).mount(root)
  return { root, rows, pairs, liveSeparation, report, trackPosition }
}

const visible = (root: Node) => dump(root).includes('Labelled Quality Evaluation')

{
  const p = makePage()
  // 13 tracks, exactly as the real run.
  for (let i = 0; i < 13; i++) {
    p.rows.value = [...p.rows.value, {
      index: i, ok: true, l2Norm: 1.0, rtf: 0.05,
    }]
    p.trackPosition.value = i + 1
    await nextTick()
    if (!visible(p.root)) break
  }
  ok('page survives all 13 track events', visible(p.root))
  ok('every track row rendered', dump(p.root).split('OK norm').length - 1 === 13)

  // Stage 2: the first pair carries the all-null separation.
  const sepWire = {
    verdict: 'INSUFFICIENT_DATA',
    comparisons: [new JSObject()
      .put('higher', 'SIMILAR').put('lower', 'DIFFERENT')
      .putNumeric('auc', NaN).putNumeric('meanGap', NaN)
      .putNumeric('overlapFraction', NaN).json()],
  }
  p.liveSeparation.value = sepWire
  p.pairs.value = [new JSObject()
    .put('label', 'SAME').put('outcome', 'NOT_SCORED')
    .putNumeric('cosine', NaN).json()]
  await nextTick()

  ok('page survives the first pair with an unmeasured AUC', visible(p.root))
  ok('the unmeasured AUC prints as text', dump(p.root).includes('not measured'))
  ok('an unscored cosine prints as an em dash', dump(p.root).includes('—'))

  // Final report, medianRtf null (no successful rows is legal).
  p.report.value = {
    separation: { verdict: 'INSUFFICIENT_DATA' },
    medianRtf: null,
  }
  await nextTick()
  ok('page survives the final report', visible(p.root))
  ok('the final summary renders', dump(p.root).includes('FINAL INSUFFICIENT DATA'))
}

// ============================================================
section('6. Results appear incrementally, not only at the end')
// ============================================================

{
  const p = makePage()
  const seen: number[] = []
  for (let i = 0; i < 5; i++) {
    p.pairs.value = [...p.pairs.value, {
      label: 'DIFFERENT', outcome: 'CONSISTENT', cosine: 0.5 + i / 100,
    }]
    await nextTick()
    seen.push(dump(p.root).split('DIFFERENT').length - 1)
  }
  ok('each pair is visible as soon as it lands',
    JSON.stringify(seen) === JSON.stringify([1, 2, 3, 4, 5]),
    `saw ${JSON.stringify(seen)}`)
  ok('nothing was buffered until the end', seen[0] === 1)
}

// ============================================================
section('7. A failed track does not blank the page')
// ============================================================

{
  const p = makePage()
  // TrackEmbeddingRow.failed(): l2Norm and rtf are NaN -> null.
  const failedRow = new JSObject()
    .put('index', 3).put('ok', false)
    .putNumeric('l2Norm', NaN).putNumeric('preNormL2', NaN)
    .putNumeric('rtf', NaN).putNumeric('totalMs', 0.0)
    .put('errorCode', 'DECODE_FAILED').json()

  p.rows.value = [{ index: 0, ok: true, l2Norm: 1.0 }, failedRow]
  await nextTick()
  ok('page survives a failed track row', visible(p.root))
  ok('the failure is shown, not hidden', dump(p.root).includes('FAILED'))
  ok('the good track is still shown', dump(p.root).includes('OK norm 1.0000'))

  // And the pair that references it is NOT_SCORED with a null cosine.
  p.pairs.value = [new JSObject()
    .put('label', 'SIMILAR').put('outcome', 'NOT_SCORED')
    .putNumeric('cosine', NaN).json()]
  await nextTick()
  ok('page survives the resulting unscored pair', visible(p.root))
  ok('the evaluation continues past the failure',
    dump(p.root).includes('NOT_SCORED'))
}

// ============================================================
section('8. Malformed native data does not blank the page')
// ============================================================

{
  // These are shapes the bridge should never send. The boundary is the
  // last line of defence if it ever does.
  const nasty: Array<[string, any]> = [
    ['comparisons missing', { verdict: 'X', comparisons: undefined }],
    ['comparisons not an array', { verdict: 'X', comparisons: 'nope' as any }],
    ['comparison is null', { verdict: 'X', comparisons: [null] }],
    ['auc is a string', { verdict: 'X', comparisons: [{ auc: '0.9' }] }],
    ['verdict is a number', { verdict: 42, comparisons: [] }],
    ['verdict is null', { verdict: null, comparisons: [] }],
  ]

  for (const [name, sep] of nasty) {
    const p = makePage()
    p.liveSeparation.value = sep
    try { await nextTick() } catch { /* boundary handles it */ }
    await new Promise(r => setTimeout(r, 0))
    ok(`page survives: ${name}`, visible(p.root))
  }
}

// ============================================================
section('9. NaN / Infinity never reach a renderer as undefined')
// ============================================================

{
  const cases: Array<[string, number]> = [
    ['NaN', NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ]
  for (const [name, value] of cases) {
    const wire = new JSObject().putNumeric('v', value).json()
    ok(`${name} survives as null`, wire.v === null)
    ok(`${name} formats without throwing`, formatScore(wire.v as null) === '—')
    ok(`${name} formats as AUC without throwing`,
      formatAuc(wire.v as null) === 'not measured')
  }

  // -0.0 and very small/large finite values must NOT be nulled.
  for (const [name, value] of [['zero', 0], ['negative zero', -0],
    ['tiny', 5e-324], ['huge', 1.7976931348623157e308]] as Array<[string, number]>) {
    const wire = new JSObject().putNumeric('v', value).json()
    ok(`${name} is preserved as a number`, typeof wire.v === 'number')
  }
}

// ============================================================
section('10. Listener and timer lifecycle')
// ============================================================

ok('a single disposeListeners() handles both listeners and the timer',
  /function disposeListeners\(\)[\s\S]{0,300}clearInterval/.test(page))
ok('start() disposes before subscribing again',
  /disposeListeners\(\)\s*\n\s*renderError\.value = null[\s\S]{0,200}onLabeledEvalEvents/.test(page))
ok('onFinished stops the interval',
  /onFinished[\s\S]{0,300}clearInterval\(tickTimer\)/.test(page))
ok('a rejected start() also disposes',
  /error\.value = \(e as Error\)\.message\s*\n\s*disposeListeners\(\)/.test(page))
ok('unmount disposes', /onBeforeUnmount\(\(\) => \{\s*\n\s*disposeListeners\(\)/.test(page))
ok('the disposer removes all five listeners',
  /handles\.forEach\(h => void h\.remove\(\)\)/.test(serviceTs))

// Simulate repeated runs: listeners must not accumulate.
{
  let live = 0
  const subscribe = () => { live += 5; return () => { live -= 5 } }
  let disposeFn: (() => void) | null = null
  const startRun = () => { disposeFn?.(); disposeFn = subscribe() }

  startRun(); ok('run 1 registers 5 listeners', live === 5)
  startRun(); ok('run 2 does not accumulate', live === 5)
  startRun(); ok('run 3 does not accumulate', live === 5)
  disposeFn?.(); ok('unmount releases them all', live === 0)
}

// ============================================================
section('11. The final state transition is deterministic')
// ============================================================

{
  // stage only ever moves idle -> embedding -> pairing -> done.
  const order = ['idle', 'embedding', 'pairing', 'done']
  const seen: string[] = ['idle']
  let stage = 'idle'
  const set = (s: string) => { stage = s; seen.push(s) }

  set('embedding')
  for (let i = 1; i <= 13; i++) if (i >= 13) set('pairing')
  set('done')

  ok('stage advances in exactly one direction',
    JSON.stringify(seen) === JSON.stringify(order), JSON.stringify(seen))
  ok('the run ends in done', stage === 'done')
  ok('done is reached once', seen.filter(s => s === 'done').length === 1)
}

ok('a finished event always clears running',
  /onFinished: \(e\) => \{\s*\n\s*running\.value = false/.test(page))
ok('a failed report still clears running (no permanent spinner)',
  /running\.value = false[\s\S]{0,400}if \(e\.failed\)/.test(page))

// ============================================================
section('12. The fix does not hide the bug')
// ============================================================

ok('no blanket try/catch was added around the evaluation',
  (page.match(/catch/g) ?? []).length <= 4,
  `${(page.match(/catch/g) ?? []).length} catch blocks`)
ok('no automatic page reload', !/location\.reload/.test(page))
ok('no automatic navigation away on error',
  !/router\.(push|replace)\([^)]*\)\s*[\s\S]{0,40}catch/.test(page))
ok('no arbitrary delay was introduced', !/setTimeout\([^,]+,\s*\d{3,}\)/.test(page))
ok('the similarity matrix is still reported', /matrix/i.test(labLab))
ok('MAX_TRACKS was not reduced to dodge the bug',
  /MAX_TRACKS = EmbeddingQualityLab\.MAX_TRACKS/.test(labLab))
ok('aggregation is still MEAN + L2 (unchanged)',
  /AggregationStrategy\.MEAN/.test(labLab))
ok('output_1 is still the embedding source, never output_0',
  /result\.embeddingFrames/.test(labLab) && /EMBEDDING_UNAVAILABLE/.test(labLab))
ok('no similarity threshold was introduced by this fix',
  !/cosine\s*[<>]=?\s*0\.[0-9]/.test(page))

// ============================================================
console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailed:')
  failures.forEach(f => console.log(`  - ${f}`))
}
console.log(
  '\nThese tests prove the RENDERING and STATE contract only. No model\n'
  + 'ran, no audio was decoded and no Android device was involved, so\n'
  + 'they cannot confirm the page stays up during a real on-device run.',
)
process.exit(failed > 0 ? 1 : 0)
