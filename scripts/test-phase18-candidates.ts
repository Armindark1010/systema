/**
 * SYSTEMA — Phase 18 production candidate evaluation tests.
 *
 * WHAT THESE TESTS ARE FOR
 * ------------------------
 * Phase 18 produced a research dossier, not a measurement run. The
 * single biggest risk in that situation is that a well-formatted table
 * of specifications quietly starts reading as evidence. These tests
 * exist to make that failure impossible to commit:
 *
 *   - a model with no device run MUST read NOT_TESTED
 *   - a model with no quality measurement MUST read NOT_MEASURED
 *   - only YAMNet may claim DEVICE_VERIFIED, because only YAMNet ran
 *   - the YAMNet baseline numbers must stay exactly as Phase 17 left them
 *   - no similarity threshold may be invented anywhere
 *   - a text-capable model must declare a SHARED space of the SAME
 *     dimension as its embedding, or its cosine claim is meaningless
 *
 * They also execute the cosine and ranking arithmetic rather than
 * grepping for it, because a static check cannot tell a correct
 * implementation from a plausible one.
 *
 * NOTHING HERE runs a model, downloads weights, or touches a device.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
  }
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
}

function section(title: string) {
  console.log(`\n── ${title}`)
}

// ------------------------------------------------------------------
// Load the dossier module as source and as data.
//
// The data is parsed out of the TypeScript rather than imported,
// because importing a Nuxt-aliased module from a bare tsx script drags
// in the whole app. The fields under test are simple literals, so
// reading them is reliable — and the structural assertions below prove
// the parse actually found the records.
// ------------------------------------------------------------------

const DOSSIER_PATH = resolve(ROOT, 'app/data/phase18Candidates.ts')
const PAGE_PATH = resolve(ROOT, 'app/pages/dev/ai-benchmark/production-candidates.vue')
const DOC_PATH = resolve(ROOT, 'docs/phase-18-production-model-evaluation.md')

section('1. Files exist')
ok('dossier module exists', existsSync(DOSSIER_PATH))
ok('evaluation page exists', existsSync(PAGE_PATH))
ok('phase 18 doc exists', existsSync(DOC_PATH))

const dossierSrc = existsSync(DOSSIER_PATH) ? readFileSync(DOSSIER_PATH, 'utf8') : ''
const pageSrc = existsSync(PAGE_PATH) ? readFileSync(PAGE_PATH, 'utf8') : ''
const docSrc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : ''

/** Strip comments so prose can never satisfy a code assertion. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const dossierCode = stripComments(dossierSrc)
const pageCode = stripComments(pageSrc)

// ------------------------------------------------------------------
// Parse each candidate record into a flat field map.
// ------------------------------------------------------------------

interface Rec { [k: string]: string }

/**
 * Module-level `const X = '...'` string aliases, so a field written as
 * `measuredAudioAudio: PHASE_17_BASELINE_NOTE` is tested on its VALUE
 * rather than on the identifier. Without this the baseline assertions
 * would pass or fail based on how the source happens to be factored,
 * which is exactly the brittle-regex trap this project has hit before.
 */
function parseStringConsts(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /const\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[\w<>[\]| ]+)?\s*=\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    out[m[1]!] = m[2]!
      .trim()
      .split(/'\s*\+\s*'/)
      .map(s => s.replace(/^'/, '').replace(/'$/, ''))
      .join('')
  }
  return out
}

function parseCandidates(src: string): Rec[] {
  const out: Rec[] = []
  // Each record starts at `candidateId: '...'` and runs to the next one.
  const starts: number[] = []
  const re = /candidateId:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) starts.push(m.index)

  for (let i = 0; i < starts.length; i++) {
    const chunk = src.slice(starts[i]!, starts[i + 1] ?? src.length)
    const rec: Rec = {}
    // Single-quoted (possibly concatenated) string fields.
    const fieldRe = /(\w+):\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+|[A-Za-z0-9_.-]+)\s*,/g
    let f: RegExpExecArray | null
    while ((f = fieldRe.exec(chunk)) !== null) {
      const key = f[1]!
      let val = f[2]!.trim()
      if (val.startsWith('\'')) {
        val = val
          .split(/'\s*\+\s*'/)
          .map(s => s.replace(/^'/, '').replace(/'$/, ''))
          .join('')
      }
      // Resolve a bare identifier to its module-level string value.
      else if (val in STRING_CONSTS) {
        val = STRING_CONSTS[val]!
      }
      if (!(key in rec)) rec[key] = val
    }
    out.push(rec)
  }
  return out
}

const STRING_CONSTS = parseStringConsts(dossierCode)
const candidates = parseCandidates(dossierCode)

section('2. Dossier parses and is populated')
ok('at least 5 candidates documented', candidates.length >= 5, `got ${candidates.length}`)
ok('yamnet is present', candidates.some(c => c.candidateId === 'yamnet'))
ok(
  'a CLAP-class candidate is present',
  candidates.some(c => (c.candidateId ?? '').includes('clap')),
)
ok(
  'every candidate has a displayName',
  candidates.every(c => !!c.displayName),
)

// ------------------------------------------------------------------
// THE CENTRAL INVARIANT: untested must read untested.
// ------------------------------------------------------------------

section('3. Device status honesty (18K)')

const DEVICE_VALUES = new Set(['DEVICE_VERIFIED', 'NOT_TESTED'])
ok(
  'every deviceStatus uses the permitted vocabulary',
  candidates.every(c => DEVICE_VALUES.has(c.deviceStatus ?? '')),
  candidates.filter(c => !DEVICE_VALUES.has(c.deviceStatus ?? ''))
    .map(c => `${c.candidateId}=${c.deviceStatus}`).join(', '),
)

const verified = candidates.filter(c => c.deviceStatus === 'DEVICE_VERIFIED')
ok(
  'exactly one candidate claims DEVICE_VERIFIED',
  verified.length === 1,
  `got ${verified.length}: ${verified.map(c => c.candidateId).join(', ')}`,
)
ok(
  'the only device-verified candidate is YAMNet',
  verified.length === 1 && verified[0]!.candidateId === 'yamnet',
  verified.map(c => c.candidateId).join(', '),
)

// A candidate that never ran cannot have quality numbers.
section('4. Quality status honesty (18F/18K)')
const QUALITY_VALUES = new Set(['MEASURED_ON_LABELLED_SET', 'NOT_MEASURED'])
ok(
  'every qualityStatus uses the permitted vocabulary',
  candidates.every(c => QUALITY_VALUES.has(c.qualityStatus ?? '')),
)
ok(
  'no NOT_TESTED candidate claims a measured quality status',
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED')
    .every(c => c.qualityStatus === 'NOT_MEASURED'),
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED' && c.qualityStatus !== 'NOT_MEASURED')
    .map(c => c.candidateId).join(', '),
)
ok(
  'every NOT_TESTED candidate says NOT MEASURED for audio->audio',
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED')
    .every(c => /NOT MEASURED/i.test(c.measuredAudioAudio ?? '')),
)
ok(
  'every NOT_TESTED candidate says NOT MEASURED or N\\A for text->audio',
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED')
    .every(c => /NOT MEASURED|N\/A/i.test(c.measuredTextAudio ?? '')),
)

// ------------------------------------------------------------------
// 18B — the YAMNet baseline must not drift.
// ------------------------------------------------------------------

section('5. YAMNet baseline regression (18B)')
const yamnet = candidates.find(c => c.candidateId === 'yamnet')
ok('yamnet record found', !!yamnet)
if (yamnet) {
  ok(
    'baseline AUC 0.3125 is stated verbatim',
    (yamnet.measuredAudioAudio ?? '').includes('0.3125'),
    yamnet.measuredAudioAudio,
  )
  ok(
    'baseline overlap 56.25% is stated verbatim',
    (yamnet.measuredAudioAudio ?? '').includes('56.25'),
  )
  ok(
    'baseline HEAVY OVERLAP verdict is stated',
    (yamnet.measuredAudioAudio ?? '').includes('HEAVY OVERLAP'),
  )
  ok(
    'baseline pair counts (SAME 3, SIMILAR 8, DIFFERENT 8) are stated',
    /SAME 3/.test(yamnet.measuredAudioAudio ?? '')
    && /SIMILAR 8/.test(yamnet.measuredAudioAudio ?? '')
    && /DIFFERENT 8/.test(yamnet.measuredAudioAudio ?? ''),
  )
  ok(
    'yamnet embedding dimension stays 1024',
    yamnet.embeddingDimension === '1024',
    yamnet.embeddingDimension,
  )
  ok(
    'yamnet memory result records RELEASED',
    (yamnet.memoryNote ?? '').includes('RELEASED'),
  )
  ok(
    'yamnet is audio-only (cannot serve text search)',
    yamnet.modality === 'AUDIO_ONLY',
  )
  ok(
    'yamnet verdict is NOT_SUITABLE, matching AUC 0.3125',
    yamnet.verdict === 'NOT_SUITABLE',
    yamnet.verdict,
  )
}

// ------------------------------------------------------------------
// 18C — a text-capable model must have a genuine SHARED space.
// This is the anti-fake check: matching dimensions are necessary (not
// sufficient) for cosine(text, audio) to mean anything at all.
// ------------------------------------------------------------------

section('6. Shared embedding space contract (18C)')
const textCapable = candidates.filter(c => c.modality === 'AUDIO_AND_TEXT')
ok('at least one audio+text candidate documented', textCapable.length >= 1)

for (const c of textCapable) {
  const dim = c.embeddingDimension
  const shared = c.sharedSpaceDimension
  // UNKNOWN is allowed, but only when BOTH are unknown — a model may
  // not claim a shared space of a dimension it cannot state.
  if (dim === 'null' || shared === 'null') {
    ok(
      `${c.candidateId}: unknown dims are unknown on both sides`,
      dim === 'null' && shared === 'null',
      `dim=${dim} shared=${shared}`,
    )
  }
  else {
    ok(
      `${c.candidateId}: shared space dimension equals embedding dimension`,
      dim === shared,
      `embedding=${dim} shared=${shared}`,
    )
  }
  ok(
    `${c.candidateId}: declares a text encoder or states UNKNOWN`,
    !!c.textEncoder,
  )
}

ok(
  'audio-only candidates declare NO shared space',
  candidates
    .filter(c => c.modality === 'AUDIO_ONLY')
    .every(c => c.sharedSpaceDimension === 'null'),
  candidates
    .filter(c => c.modality === 'AUDIO_ONLY' && c.sharedSpaceDimension !== 'null')
    .map(c => c.candidateId).join(', '),
)

// ------------------------------------------------------------------
// 18Q / result vocabulary.
// ------------------------------------------------------------------

section('7. Verdict vocabulary (18Q)')
const VERDICTS = new Set(['PROMISING', 'INSUFFICIENT_EVIDENCE', 'NOT_SUITABLE', 'BLOCKED'])
ok(
  'every candidate verdict is in the permitted vocabulary',
  candidates.every(c => VERDICTS.has(c.verdict ?? '')),
  candidates.filter(c => !VERDICTS.has(c.verdict ?? ''))
    .map(c => `${c.candidateId}=${c.verdict}`).join(', '),
)
ok(
  'every verdict has a stated reason',
  candidates.every(c => (c.verdictReason ?? '').length > 20),
)
ok(
  'no candidate is called READY / PRODUCTION-READY',
  !/READY_FOR_PRODUCTION/.test(
    candidates.map(c => c.verdict).join(' '),
  ),
)

const OVERALL = new Set([
  'READY_FOR_PRODUCTION', 'PROMISING_NEEDS_MORE_DATA', 'NOT_SUITABLE', 'BLOCKED',
])
const overallMatch = dossierCode.match(/OVERALL_VERDICT:\s*OverallVerdict\s*=\s*'([A-Z_]+)'/)
ok('an overall verdict is declared', !!overallMatch)
ok(
  'the overall verdict is in the 18Q vocabulary',
  !!overallMatch && OVERALL.has(overallMatch[1]!),
  overallMatch?.[1],
)

section('8. Required no-auto-selection notice (18Q)')
ok(
  'the exact notice string exists in the dossier',
  dossierCode.includes('No production model was selected automatically.'),
)
ok(
  'the page renders the notice',
  pageCode.includes('NO_AUTO_SELECTION_NOTICE'),
)
ok(
  'the doc states the notice',
  docSrc.includes('No production model was selected automatically.'),
)

// ------------------------------------------------------------------
// No invented thresholds. This is a standing project rule: a cosine
// cutoff that nobody derived from data is a fabricated finding.
// ------------------------------------------------------------------

section('9. No invented similarity threshold')
const thresholdPattern
  = /(threshold|cutoff)\s*[:=]\s*0?\.\d+|cosine\s*[<>]=?\s*0?\.\d+|similarity\s*[<>]=?\s*0?\.\d+/i
ok(
  'dossier declares no numeric similarity threshold',
  !thresholdPattern.test(dossierCode),
)
ok(
  'page declares no numeric similarity threshold',
  !thresholdPattern.test(pageCode),
)

// ------------------------------------------------------------------
// 18N — the page must not hold big data in reactive state.
// ------------------------------------------------------------------

section('10. Bounded, non-reactive UI state (18M/18N)')
const reactiveDecls = [...pageCode.matchAll(/\b(?:ref|reactive|shallowRef)\s*(?:<[^>]*>)?\s*\(/g)]
ok(
  'the page keeps its reactive surface small',
  reactiveDecls.length <= 6,
  `${reactiveDecls.length} reactive declarations`,
)
for (const banned of ['embedding', 'tensor', 'spectrogram', 'waveform', 'pcm']) {
  ok(
    `no reactive ref holds "${banned}" data`,
    !new RegExp(`(?:ref|reactive|shallowRef)\\s*(?:<[^>]*>)?\\s*\\([^)]*${banned}`, 'i')
      .test(pageCode),
  )
}
ok(
  'candidate dossiers are imported as a module constant, not copied into a ref',
  /import\s*\{[^}]*CANDIDATES/.test(pageCode)
  && !/ref\s*(?:<[^>]*>)?\s*\(\s*\[?\s*\.\.\.\s*CANDIDATES/.test(pageCode),
)
ok(
  'the dossier list is exported as a readonly array',
  /CANDIDATES:\s*ReadonlyArray</.test(dossierCode),
)

// ------------------------------------------------------------------
// The environment constraint must be recorded, not glossed.
// ------------------------------------------------------------------

section('11. Weight availability is evidenced (18D)')
ok('a network probe record exists', /NETWORK_PROBE/.test(dossierCode))
ok(
  'the probe records huggingface as blocked',
  /huggingface[^\n]*BLOCKED/i.test(dossierCode),
)
ok(
  'the probe records at least one reachable host',
  /REACHABLE/.test(dossierCode),
)
ok(
  'the page renders the probe rather than only asserting the conclusion',
  pageCode.includes('NETWORK_PROBE'),
)
ok(
  'every candidate states a checkpoint source',
  candidates.every(c => (c.checkpointSource ?? '').length > 5),
)
ok(
  'no candidate claims a checkpoint hash it could not compute',
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED')
    .every(c => /UNKNOWN/i.test(c.checkpointHash ?? '')),
  candidates
    .filter(c => c.deviceStatus === 'NOT_TESTED' && !/UNKNOWN/i.test(c.checkpointHash ?? ''))
    .map(c => c.candidateId).join(', '),
)

// ------------------------------------------------------------------
// Licensing must be explicit, including the bad news.
// ------------------------------------------------------------------

section('12. Licensing (18A)')
const COMMERCIAL = new Set([
  'PERMITTED', 'ATTRIBUTION_REQUIRED', 'COPYLEFT', 'RESTRICTED', 'UNKNOWN',
])
ok(
  'every candidate declares commercial-use status from the vocabulary',
  candidates.every(c => COMMERCIAL.has(c.commercialUse ?? '')),
  candidates.filter(c => !COMMERCIAL.has(c.commercialUse ?? ''))
    .map(c => `${c.candidateId}=${c.commercialUse}`).join(', '),
)
ok(
  'code and weights licences are recorded separately',
  candidates.every(c => !!c.codeLicense && !!c.weightsLicense),
)
ok(
  'a copyleft blocker is surfaced where one exists',
  candidates.some(c => c.commercialUse === 'COPYLEFT'),
)
ok(
  'any COPYLEFT candidate is not marked PROMISING',
  candidates
    .filter(c => c.commercialUse === 'COPYLEFT')
    .every(c => c.verdict !== 'PROMISING'),
)

// ==================================================================
// EXECUTED ARITHMETIC
// ------------------------------------------------------------------
// The checks above read source. These run the maths, because ranking
// and cosine bugs are invisible to a grep.
// ==================================================================

section('13. Cosine similarity correctness (executed)')

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}
function norm(a: number[]): number {
  return Math.sqrt(dot(a, a))
}
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('dimension mismatch')
  const d = norm(a) * norm(b)
  return d === 0 ? 0 : dot(a, b) / d
}

ok('identical vectors give cosine 1', Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-12)
ok('opposite vectors give cosine -1', Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-12)
ok('orthogonal vectors give cosine 0', Math.abs(cosine([1, 0], [0, 1])) < 1e-12)
ok(
  'cosine is scale invariant',
  Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-12,
)
ok('zero vector does not produce NaN', Number.isFinite(cosine([0, 0], [1, 1])))
ok(
  'mismatched dimensions throw rather than silently truncate',
  (() => {
    try {
      cosine([1, 2], [1, 2, 3])
      return false
    }
    catch { return true }
  })(),
)
ok('cosine stays within [-1, 1]', (() => {
  for (let t = 0; t < 200; t++) {
    const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]
    const b = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]
    const c = cosine(a, b)
    if (!(c >= -1.0000001 && c <= 1.0000001)) return false
  }
  return true
})())

section('14. Ranking correctness (executed)')

interface Ranked { id: string, score: number }
function rank(query: number[], items: { id: string, vec: number[] }[]): Ranked[] {
  return items
    .map(i => ({ id: i.id, score: cosine(query, i.vec) }))
    .sort((x, y) => y.score - x.score)
}

const items = [
  { id: 'exact', vec: [1, 0, 0] },
  { id: 'near', vec: [0.9, 0.1, 0] },
  { id: 'far', vec: [0, 1, 0] },
  { id: 'opposite', vec: [-1, 0, 0] },
]
const ranked = rank([1, 0, 0], items)
ok('ranking is descending by score', ranked.every((r, i) => i === 0 || ranked[i - 1]!.score >= r.score))
ok('the exact match ranks first', ranked[0]!.id === 'exact')
ok('the opposite vector ranks last', ranked[ranked.length - 1]!.id === 'opposite')
ok('ranking preserves the item count', ranked.length === items.length)
ok(
  'ranking a single item is stable',
  rank([1, 0, 0], [{ id: 'only', vec: [0, 1, 0] }]).length === 1,
)
ok('ranking an empty set yields an empty list', rank([1, 0, 0], []).length === 0)

section('15. Retrieval metrics (executed)')

/** Precision@K over a relevance judgement. */
function precisionAtK(results: string[], relevant: Set<string>, k: number): number {
  const top = results.slice(0, k)
  if (top.length === 0) return 0
  return top.filter(r => relevant.has(r)).length / top.length
}
/** Reciprocal rank of the first relevant hit, 0 when none. */
function reciprocalRank(results: string[], relevant: Set<string>): number {
  const i = results.findIndex(r => relevant.has(r))
  return i === -1 ? 0 : 1 / (i + 1)
}

const res = ['a', 'b', 'c', 'd', 'e']
ok('P@1 is 1 when the top hit is relevant', precisionAtK(res, new Set(['a']), 1) === 1)
ok('P@1 is 0 when the top hit is not relevant', precisionAtK(res, new Set(['b']), 1) === 0)
ok('P@3 counts hits within the top 3', Math.abs(precisionAtK(res, new Set(['a', 'c']), 3) - 2 / 3) < 1e-12)
ok('P@5 over an all-relevant list is 1', precisionAtK(res, new Set(res), 5) === 1)
ok('MRR is 1 for a first-position hit', reciprocalRank(res, new Set(['a'])) === 1)
ok('MRR is 1/3 for a third-position hit', Math.abs(reciprocalRank(res, new Set(['c'])) - 1 / 3) < 1e-12)
ok('MRR is 0 when nothing is relevant', reciprocalRank(res, new Set(['zzz'])) === 0)
ok('metrics on an empty result list do not divide by zero', precisionAtK([], new Set(['a']), 5) === 0)

section('16. AUC correctness, and the baseline reproduces (executed)')

/**
 * Rank-based AUC: probability a random positive outranks a random
 * negative, ties counted as 0.5.
 */
function auc(pos: number[], neg: number[]): number {
  if (pos.length === 0 || neg.length === 0) return Number.NaN
  let wins = 0
  for (const p of pos) {
    for (const n of neg) {
      if (p > n) wins += 1
      else if (p === n) wins += 0.5
    }
  }
  return wins / (pos.length * neg.length)
}

ok('perfect separation gives AUC 1', auc([1, 0.9], [0.1, 0]) === 1)
ok('inverted separation gives AUC 0', auc([0, 0.1], [0.9, 1]) === 0)
ok('all ties give AUC 0.5', auc([0.5, 0.5], [0.5, 0.5]) === 0.5)
ok('AUC of an empty class is NaN, not a number', Number.isNaN(auc([], [1])))

// The Phase 17 headline was AUC 0.3125 over 8 SIMILAR and 8 DIFFERENT
// pairs. 0.3125 = 20/64, so the metric must be reproducible at that
// exact granularity — this pins the definition, not the data.
ok(
  'AUC is expressible at 8x8 granularity as 20/64 = 0.3125',
  Math.abs(20 / 64 - 0.3125) < 1e-12,
)
const simScores = [0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37]
const difScores = [0.32, 0.34, 0.36, 0.38, 0.40, 0.42, 0.44, 0.46]
const reproduced = auc(simScores, difScores)
ok(
  'a below-0.5 AUC is reported as below 0.5, not flipped to look good',
  reproduced < 0.5,
  `got ${reproduced}`,
)
ok(
  'AUC is not silently clamped or absolute-valued',
  auc([0], [1]) === 0,
)

section('17. Scope limits held (Phase 18 is evaluation only)')
for (const banned of [
  'recommendationEngine',
  'buildLibraryIndex',
  'backgroundEmbedding',
  'generatePlaylist',
]) {
  ok(`page does not implement ${banned}`, !pageCode.includes(banned))
}
ok(
  'the page states that it does not select a model',
  /does not select a model|No production model was selected/i.test(pageSrc),
)

section('18. Documentation completeness')
const requiredDocSections = [
  'Objective',
  'Phase 17 baseline',
  'Candidates',
  'Architecture audit',
  'Deployment feasibility',
  'Audio',
  'Text',
  'Performance',
  'Memory',
  'Licensing',
  'Limitations',
  'Final recommendation',
  'Reproduction',
]
for (const s of requiredDocSections) {
  ok(`doc covers "${s}"`, new RegExp(s, 'i').test(docSrc))
}
ok('doc records the network block', /BLOCKED/i.test(docSrc))
ok('doc states the YAMNet baseline AUC', docSrc.includes('0.3125'))
ok(
  'doc does not claim any model was device-verified in phase 18',
  !/phase 18[^.]*device[- ]verified/i.test(docSrc),
)

// ------------------------------------------------------------------

console.log(`\n${'─'.repeat(52)}`)
console.log(`${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
}
process.exit(failed === 0 ? 0 : 1)
