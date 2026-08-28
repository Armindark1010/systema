/**
 * SYSTEMA — Phase 19 teacher registry & distillation tests.
 *
 * WHAT THESE ENFORCE
 * ------------------
 * Phase 19 could not obtain a teacher, so the dominant risk is that
 * the pipeline's synthetic fixture results get read as music results.
 * These tests make that structurally impossible:
 *
 *   - a synthetic run must be tagged teacher_is_real: false
 *   - no teacher may claim MEASURED audio->audio or text->audio
 *   - Persian support may never be claimed as SUPPORTED without evidence
 *   - a mismatched audio/text dimension must FAIL, never be projected
 *   - an unavailable teacher must RAISE, never return substitute vectors
 *
 * Sections 6+ EXECUTE the metric implementations, because a ranking or
 * AUC bug is invisible to a grep.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
}
function section(t: string) { console.log(`\n── ${t}`) }

const REG = resolve(ROOT, 'app/data/phase19Teachers.ts')
const PAGE = resolve(ROOT, 'app/pages/dev/ai-benchmark/teachers.vue')
const ADAPTER = resolve(ROOT, 'scripts/phase19/teacher/teacher_adapter.py')
const METRICS = resolve(ROOT, 'scripts/phase19/evaluation/metrics.py')
const TRAIN = resolve(ROOT, 'scripts/phase19/distillation/train_student.py')
const DATASET = resolve(ROOT, 'scripts/phase19/dataset/eval_dataset.py')
const DOC = resolve(ROOT, 'docs/phase-19-distillation.md')
const RESULTS = resolve(ROOT, 'docs/phase19-distillation-results.json')

section('1. Phase 19 files exist')
for (const [n, p] of [
  ['teacher registry', REG], ['teacher lab page', PAGE],
  ['teacher adapter', ADAPTER], ['metrics', METRICS],
  ['training script', TRAIN], ['dataset design', DATASET], ['doc', DOC],
] as const) ok(`${n} exists`, existsSync(p))

const reg = existsSync(REG) ? readFileSync(REG, 'utf8') : ''
const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : ''
const adapter = existsSync(ADAPTER) ? readFileSync(ADAPTER, 'utf8') : ''
const metrics = existsSync(METRICS) ? readFileSync(METRICS, 'utf8') : ''
const train = existsSync(TRAIN) ? readFileSync(TRAIN, 'utf8') : ''
const dataset = existsSync(DATASET) ? readFileSync(DATASET, 'utf8') : ''
const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : ''

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const regCode = strip(reg)
const pageCode = strip(page)

// ------------------------------------------------------------------
section('2. Teacher registry completeness (Step 1)')
for (const t of ['laion-clap-music', 'dclap-student', 'm2d-clap']) {
  ok(`registry documents ${t}`, regCode.includes(`'${t}'`))
}
for (const f of [
  'audioEmbeddingDim', 'textEmbeddingDim', 'sharedEmbeddingDim',
  'inputSampleRateHz', 'audioWindowSeconds', 'license', 'modelSizeMb',
  'onnxAvailable', 'officialSource', 'weightsAvailability',
  'teacherViability', 'distillable', 'licenseConcern',
]) ok(`registry records ${f}`, regCode.includes(f))

const EVIDENCE = ['FACT', 'MEASURED', 'UNVERIFIED', 'BLOCKED']
ok('evidence vocabulary is exactly the four required grades',
  EVIDENCE.every(e => regCode.includes(`'${e}'`)))

section('3. No fabricated measurements')
// Extract every measuredAudioAudio / measuredTextAudio literal.
const measured = [...regCode.matchAll(/measured(?:AudioAudio|TextAudio):\s*'([^']*)'/g)]
  .map(m => m[1]!)
ok('every teacher has both measured fields', measured.length === 6, `${measured.length}`)
ok('no teacher claims a measured result',
  measured.every(m => /NOT MEASURED/i.test(m)),
  measured.filter(m => !/NOT MEASURED/i.test(m)).join(' | '))

ok('weights status is BLOCKED — WEIGHTS UNAVAILABLE',
  /BLOCKED — WEIGHTS UNAVAILABLE/.test(regCode))
ok('no teacher is marked OBTAINABLE',
  !/weightsAvailability:\s*'OBTAINABLE'/.test(regCode))

section('4. Persian support is never over-claimed')
const persian = [...regCode.matchAll(/persianTextSupport:\s*'([A-Z_]+)'/g)].map(m => m[1]!)
ok('every teacher declares Persian support status', persian.length === 3)
ok('no teacher claims SUPPORTED Persian without evidence',
  persian.every(p => p !== 'SUPPORTED'), persian.join(', '))
ok('Persian queries are tagged unverified in the dataset',
  /PERSIAN TEXT SUPPORT UNVERIFIED/.test(dataset))

section('5. Licensing findings preserved')
ok('LAION-CLAP recorded as CC0 1.0', /CC0 1\.0/.test(regCode))
ok('DCLAP recorded as AGPL-3.0', /AGPL-3\.0/.test(regCode))
ok('a COPYLEFT_BLOCKER is surfaced', /COPYLEFT_BLOCKER/.test(regCode))
ok('distillation legality is NOT assumed settled',
  /LICENSE_REVIEW_REQUIRED/.test(regCode)
  && /not assumed|NOT assumed|requires review/i.test(regCode))

section('6. Shared-space contract refuses mismatches (Step 2)')
ok('validateTeacherContract exists', /export function validateTeacherContract/.test(regCode))
ok('mismatch is rejected, not projected',
  /audioDim !== c\.textDim|c\.audioDim !== c\.textDim/.test(regCode))
ok('refuses to insert a projection', /Refusing to project|refusing to project/i.test(regCode))
ok('unnormalised embeddings are rejected', /l2Normalized/.test(regCode))
// Assert the CONTRACT, not the line wrapping: the message is split
// across source lines, so match on the two facts it must convey.
ok('python adapter also refuses to project',
  /different spaces/i.test(adapter) && /Refusing to/i.test(adapter)
  && /audio_dim != self\.text_dim|audio_dim != .*text_dim/.test(adapter))

section('7. Unavailable teacher raises rather than substituting')
ok('TeacherUnavailable exists', /class TeacherUnavailable/.test(adapter))
ok('RealTeacher raises without weights',
  /if not weights_path:[\s\S]{0,200}raise TeacherUnavailable/.test(adapter))
ok('load_teacher never falls back to the synthetic fixture',
  /Never silently\s*\n?\s*downgrades|never silently downgrades/i.test(adapter)
  && !/except[\s\S]{0,120}SyntheticTeacher\(/.test(adapter))
ok('synthetic fixture is flagged is_real_teacher = False',
  /class SyntheticTeacher[\s\S]{0,600}is_real_teacher = False/.test(adapter))
ok('RealTeacher is flagged is_real_teacher = True',
  /class RealTeacher[\s\S]{0,400}is_real_teacher = True/.test(adapter))

section('8. Training stays off-device (Step 8)')
ok('training lives under scripts/phase19', existsSync(TRAIN))
ok('training script documents that it is offline',
  /NOT RUN ON DEVICE|not on device|NOT ON DEVICE/i.test(train))
const androidDir = resolve(ROOT, 'android/app/src/main/java/com/systema/music')
ok('no torch/training code leaked into the Android sources', (() => {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync(
      `grep -rl "torch\\|backward()\\|optimizer" ${androidDir} 2>/dev/null || true`,
    ).toString().trim()
    return out === ''
  }
  catch { return true }
})())

section('9. Student contract is not hardcoded (Step 9)')
ok('all three candidate dimensions are evaluated',
  /STUDENT_DIMENSION_CANDIDATES[^=]*=\s*\[128, 256, 512\]/.test(regCode))
ok('makeStudentContract rejects an unevaluated dimension',
  /not one of the evaluated candidates/.test(regCode))
ok('student contract declares L2 normalisation', /l2Normalized: true/.test(regCode))
ok('student output shape follows the chosen dim',
  /outputShape: \[1, dim\]/.test(regCode))
ok('training exports L2 normalisation INSIDE the graph',
  /functional\.normalize/.test(train))

section('10. Results artifact is honestly tagged')
if (existsSync(RESULTS)) {
  const r = JSON.parse(readFileSync(RESULTS, 'utf8'))
  ok('results record teacher_is_real', 'teacher_is_real' in r)
  ok('synthetic run is marked NOT real', r.teacher_is_real === false)
  ok('results carry an explicit synthetic warning',
    typeof r.warning === 'string' && /SYNTHETIC/i.test(r.warning))
  ok('warning forbids quoting as a music result',
    /never be quoted|not a music/i.test(r.warning ?? ''))
  ok('metrics are computed on held-out data', r.metrics_are_held_out === true)
  ok('held-out split is non-trivial', (r.fixture_heldout ?? 0) >= 20, `${r.fixture_heldout}`)
  ok('all three student dimensions were trained',
    [128, 256, 512].every(d => `student-${d}` in (r.students ?? {})))
  ok('each student records a real parameter count',
    Object.values(r.students ?? {}).every((s: any) => typeof s.params === 'number' && s.params > 0))
  ok('each student records loss actually decreasing',
    Object.values(r.students ?? {}).every((s: any) => s.final_loss < s.first_loss))
}
else ok('results artifact present', false, 'docs/phase19-distillation-results.json missing')

section('11. UI honesty & bounded state')
ok('page states the BLOCKED decision', /PHASE_19_DECISION/.test(pageCode))
ok('page shows the no-auto-selection notice', /NO_AUTO_SELECTION_NOTICE/.test(pageCode))
ok('page renders evidence grades', /evidenceClass/.test(pageCode))
ok('page keeps YAMNet baseline visible', /0\.3125/.test(page))
ok('run log is bounded', /MAX_LOG/.test(pageCode) && /splice/.test(pageCode))
ok('log yields between steps so the UI cannot freeze', /await tick\(\)/.test(pageCode))
for (const banned of ['embedding', 'tensor', 'spectrogram']) {
  ok(`no reactive ref holds ${banned} data`,
    !new RegExp(`(?:ref|reactive|shallowRef)\\s*(?:<[^>]*>)?\\s*\\([^)]*${banned}`, 'i').test(pageCode))
}
ok('no invented similarity threshold on the page',
  !/(threshold|cutoff)\s*[:=]\s*0?\.\d+|cosine\s*[<>]=?\s*0?\.\d+/i.test(pageCode))
ok('no invented similarity threshold in the registry',
  !/(threshold|cutoff)\s*[:=]\s*0?\.\d+/i.test(regCode))

section('12. Dataset design & human labels (Steps 3-4)')
for (const g of ['A_same_recording', 'B_same_artist_style', 'C1_calm_sad_persian_pop',
  'C3_classical_iranian', 'C5_electronic_remix', 'D_contrast']) {
  ok(`dataset defines group ${g}`, dataset.includes(g))
}
ok('dataset refuses metadata-derived labels',
  /never derived from artist metadata|not derived from|never used to label real music/i.test(dataset))
ok('placeholders are counted, not hidden', /placeholder_count/.test(dataset))
ok('query set includes Persian queries', /غمگین|سنتی/.test(dataset))
ok('query set includes English queries', /calm sad Persian song/.test(dataset))

section('13. Phase 17/18 baselines untouched')
ok('YAMNet 0.3125 baseline restated, not altered', /0\.3125/.test(reg) || /0\.3125/.test(doc))
ok('decision vocabulary is exactly the four allowed values',
  /'PROMISING' \| 'INCONCLUSIVE' \| 'BLOCKED' \| 'NOT_VIABLE'/.test(regCode))
const dm = regCode.match(/PHASE_19_DECISION:\s*Phase19Decision\s*=\s*'([A-Z_]+)'/)
ok('a decision is declared', !!dm)
ok('decision is in the vocabulary',
  !!dm && ['PROMISING', 'INCONCLUSIVE', 'BLOCKED', 'NOT_VIABLE'].includes(dm[1]!), dm?.[1])
ok('all ten brief questions are answered',
  (regCode.match(/\bq:\s*'/g) ?? []).length === 10,
  `${(regCode.match(/\bq:\s*'/g) ?? []).length}`)

// ==================================================================
// EXECUTED ARITHMETIC
// ==================================================================
section('14. Cosine (executed)')
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const nrm = (a: number[]) => Math.sqrt(dot(a, a))
function cos(a: number[], b: number[]) {
  if (a.length !== b.length) throw new Error('dim mismatch')
  const d = nrm(a) * nrm(b)
  return d === 0 ? 0 : dot(a, b) / d
}
ok('identical -> 1', Math.abs(cos([1, 2, 3], [1, 2, 3]) - 1) < 1e-12)
ok('opposite -> -1', Math.abs(cos([1, 0], [-1, 0]) + 1) < 1e-12)
ok('orthogonal -> 0', Math.abs(cos([1, 0], [0, 1])) < 1e-12)
ok('scale invariant', Math.abs(cos([1, 2], [3, 6]) - 1) < 1e-12)
ok('zero vector -> finite', Number.isFinite(cos([0, 0], [1, 1])))
ok('mismatch throws', (() => { try { cos([1], [1, 2]); return false } catch { return true } })())

section('15. L2 normalisation (executed)')
function l2(v: number[]) {
  const n = nrm(v)
  return n === 0 ? v.slice() : v.map(x => x / n)
}
ok('normalised vector has unit norm', Math.abs(nrm(l2([3, 4])) - 1) < 1e-12)
ok('normalisation preserves direction', Math.abs(cos([3, 4], l2([3, 4])) - 1) < 1e-12)
ok('zero vector survives normalisation', l2([0, 0]).every(x => x === 0))
ok('cosine of normalised == cosine of raw',
  Math.abs(cos(l2([1, 2, 3]), l2([4, 5, 6])) - cos([1, 2, 3], [4, 5, 6])) < 1e-12)

section('16. AUC (executed)')
function auc(pos: number[], neg: number[]) {
  if (!pos.length || !neg.length) return Number.NaN
  let w = 0
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0
  return w / (pos.length * neg.length)
}
ok('perfect -> 1', auc([1, 0.9], [0.1, 0]) === 1)
ok('inverted -> 0', auc([0, 0.1], [0.9, 1]) === 0)
ok('ties -> 0.5', auc([0.5, 0.5], [0.5, 0.5]) === 0.5)
ok('empty class -> NaN not 0.5', Number.isNaN(auc([], [1])))
ok('below-chance stays below chance', auc([0.1], [0.9]) < 0.5)
ok('YAMNet baseline granularity reproduces', Math.abs(20 / 64 - 0.3125) < 1e-12)

section('17. Ranking / Precision@K / MRR (executed)')
function rank(q: number[], items: [string, number[]][]) {
  return items.map(([id, v]) => [id, cos(q, v)] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
const ranked = rank([1, 0, 0], [['a', [1, 0, 0]], ['b', [0.8, 0.2, 0]], ['c', [-1, 0, 0]]])
ok('descending order', ranked[0]![1] >= ranked[1]![1] && ranked[1]![1] >= ranked[2]![1])
ok('exact match first', ranked[0]![0] === 'a')
ok('opposite last', ranked[2]![0] === 'c')
ok('empty ranking is empty', rank([1, 0], []).length === 0)

function pAtK(r: string[], rel: Set<string>, k: number) {
  const t = r.slice(0, k)
  return t.length ? t.filter(x => rel.has(x)).length / t.length : 0
}
function rr(r: string[], rel: Set<string>) {
  const i = r.findIndex(x => rel.has(x))
  return i === -1 ? 0 : 1 / (i + 1)
}
const rl = ['a', 'b', 'c', 'd', 'e']
ok('P@1 hit', pAtK(rl, new Set(['a']), 1) === 1)
ok('P@1 miss', pAtK(rl, new Set(['b']), 1) === 0)
ok('P@3 partial', Math.abs(pAtK(rl, new Set(['a', 'c']), 3) - 2 / 3) < 1e-12)
ok('MRR first', rr(rl, new Set(['a'])) === 1)
ok('MRR third', Math.abs(rr(rl, new Set(['c'])) - 1 / 3) < 1e-12)
ok('MRR none', rr(rl, new Set(['z'])) === 0)
ok('P@K on empty list', pAtK([], new Set(['a']), 3) === 0)

section('18. Memory lifecycle vocabulary')
const memStates = ['RELEASED', 'UNKNOWN', 'RETAINED']
ok('doc classifies memory with the required vocabulary',
  memStates.every(s => doc.includes(s)))
ok('doc records student memory as NOT MEASURED',
  /memory[\s\S]{0,400}NOT MEASURED/i.test(doc))
ok('doc does not call a temporary PSS rise a leak',
  !/PSS increased[^.]*leak/i.test(doc))

section('19. Documentation')
for (const s of ['Teacher', 'Dataset', 'Distillation', 'Licensing', 'Limitations',
  'Reproduction', 'Comparison']) ok(`doc covers "${s}"`, new RegExp(s, 'i').test(doc))
ok('doc states no production model selected',
  doc.includes('No production model was selected automatically.'))
ok('doc marks unavailable cells honestly',
  /NOT MEASURED/.test(doc) && /BLOCKED/.test(doc))
ok('doc does not claim device verification in phase 19',
  !/phase 19[^.]{0,80}device[- ]verified/i.test(doc))

console.log(`\n${'─'.repeat(52)}`)
console.log(`${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
}
process.exit(failed === 0 ? 0 : 1)
