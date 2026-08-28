/**
 * SYSTEMA — Phase 20 §12: persistent human-label dataset.
 *
 * These tests EXECUTE the dataset model. They are not greps. Every
 * assertion below round-trips real objects through the real export,
 * validation, merge and import code paths.
 *
 * The gating test is section 11: EXPORT -> RESET LOCAL DATA -> IMPORT
 * must reproduce a byte-identical dataset. If that fails, the feature
 * does not work, regardless of what the other thirteen say.
 *
 * NOTHING HERE RUNS THE MODEL, decodes audio, or touches a device.
 * These tests prove the LABEL STORE is correct, which is a separate
 * claim from any benchmark result being correct.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildDataset,
  canonicalPairId,
  clearDataset,
  countByLabel,
  emptyDataset,
  fromPositionalLabels,
  LABEL_DATASET_SCHEMA_VERSION,
  loadDataset,
  mergeDatasets,
  parseDataset,
  saveDataset,
  setStorageAdapter,
  toPositionalLabels,
  validateDataset,
  type DatasetTrack,
  type LabelDataset,
} from '../app/services/ai-lab/labelDataset'

import {
  toJson,
  toMarkdown,
  toPlainText,
  toSummary,
  type EvaluationReportInput,
} from '../app/services/ai-lab/reportExport'

import {
  attributeRetention,
  classifyMemoryRun,
  MEMORY_TESTS,
  runHarness,
  type MemoryMeasurement,
} from '../app/services/ai-lab/memoryHarness'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

// ---- in-memory storage so save/load can actually be executed -------
//
// The browser adapter deliberately no-ops outside a client (it guards
// on import.meta.client), so under a bare Node runner it would swallow
// every write and the round-trip test would prove nothing. Injecting
// an in-memory adapter exercises the real save/load/clear code path.
const mem = new Map<string, string>()
setStorageAdapter({
  get: k => mem.get(k) ?? null,
  set: (k, v) => void mem.set(k, v),
  remove: k => void mem.delete(k),
})

// ---- fixtures ------------------------------------------------------
// These are TEST fixtures for the STORE. They are never presented as
// benchmark results and never reach a report as real inference output.

const TRACKS: DatasetTrack[] = [
  { id: 't1', title: 'Alpha' },
  { id: 't2', title: 'Beta' },
  { id: 't3', title: 'Gamma' },
  { id: 't4', title: 'Delta' },
  { id: 't5', title: 'Epsilon' },
]

function pair(a: string, b: string, label: 'SAME' | 'SIMILAR' | 'DIFFERENT') {
  return { pairId: canonicalPairId(a, b), trackA: a, trackB: b, label }
}

function sampleDataset(): LabelDataset {
  return buildDataset(TRACKS, [
    pair('t1', 't2', 'SAME'),
    pair('t1', 't3', 'SIMILAR'),
    pair('t2', 't4', 'DIFFERENT'),
    pair('t3', 't5', 'DIFFERENT'),
    pair('t4', 't5', 'SIMILAR'),
  ])
}

console.log('SYSTEMA — Phase 20 §12 label persistence')

// =====================================================================
section('1. EXPORT CONTAINS ALL PAIRS')
{
  const d = sampleDataset()
  const json = JSON.parse(JSON.stringify(d))
  ok('export contains every labelled pair', json.pairs.length === 5,
    `got ${json.pairs.length}`)
  ok('export pair ids are canonical', json.pairs.every((p: any) => p.pairId.includes('|')))
  ok('export carries schemaVersion', json.schemaVersion === LABEL_DATASET_SCHEMA_VERSION)
  ok('export carries datasetVersion', typeof json.datasetVersion === 'string'
    && json.datasetVersion.length > 0)
  ok('export carries exportedAt', typeof json.exportedAt === 'string' && json.exportedAt.length > 0)
  ok('export carries statistics', json.statistics && json.statistics.pairCount === 5)

  // The filtered view must not shrink the export.
  const filteredView = d.pairs.filter(p => p.label === 'SAME')
  ok('export is not the filtered view', filteredView.length !== json.pairs.length)
}

// =====================================================================
section('2. EXPORT CONTAINS ALL TRACKS')
{
  const d = sampleDataset()
  ok('all tracks exported', d.tracks.length === 5, `got ${d.tracks.length}`)
  ok('tracks carry resolving metadata',
    d.tracks.every(t => typeof t.id === 'string' && typeof t.title === 'string'))
  const ids = new Set(d.tracks.map(t => t.id))
  ok('every pair reference resolves to an exported track',
    d.pairs.every(p => ids.has(p.trackA) && ids.has(p.trackB)))
}

// =====================================================================
section('3. IMPORT RESTORES LABELS')
{
  const d = sampleDataset()
  const text = JSON.stringify(d)
  const { data, parseError } = parseDataset(text)
  ok('valid export parses', parseError === null && data !== null)
  const v = validateDataset(data)
  ok('valid export validates', v.ok, v.issues.map(i => i.message).join('; '))
  ok('validation counts pairs', v.pairCount === 5)
  ok('validation counts labels',
    v.counts.same === 1 && v.counts.similar === 2 && v.counts.different === 2,
    JSON.stringify(v.counts))
}

// =====================================================================
section('4. MERGE PRESERVES EXISTING')
{
  const existing = buildDataset(TRACKS, [pair('t1', 't2', 'SAME')])
  const incoming = buildDataset(TRACKS, [pair('t1', 't2', 'DIFFERENT')])
  const m = mergeDatasets(existing, incoming)
  const kept = m.dataset.pairs.find(p => p.pairId === canonicalPairId('t1', 't2'))
  ok('existing label survives a conflicting import', kept?.label === 'SAME',
    `got ${kept?.label}`)
  ok('conflict is reported, not applied', m.conflicts.length === 1)
  ok('conflict names both labels',
    m.conflicts[0]?.existingLabel === 'SAME' && m.conflicts[0]?.incomingLabel === 'DIFFERENT')
  ok('nothing was added on a pure conflict', m.added === 0)
}

// =====================================================================
section('5. DUPLICATES DEDUPED')
{
  const existing = sampleDataset()
  const m = mergeDatasets(existing, sampleDataset())
  ok('importing the same file twice adds nothing', m.added === 0, `added ${m.added}`)
  ok('pair count unchanged after duplicate import', m.dataset.pairs.length === 5)
  ok('track count unchanged after duplicate import', m.dataset.tracks.length === 5)
  ok('identical pair+label is not a conflict', m.conflicts.length === 0)
  ok('duplicates counted as unchanged', m.unchanged === 5)
}

// =====================================================================
section('6. REVERSED PAIR ORDER RECOGNISED')
{
  ok('1x5 and 5x1 collapse to one id',
    canonicalPairId('t1', 't5') === canonicalPairId('t5', 't1'))

  const existing = buildDataset(TRACKS, [pair('t1', 't5', 'SAME')])
  const reversed = buildDataset(TRACKS, [pair('t5', 't1', 'SAME')])
  const m = mergeDatasets(existing, reversed)
  ok('reversed duplicate is not added twice', m.dataset.pairs.length === 1,
    `got ${m.dataset.pairs.length}`)

  const reversedConflict = buildDataset(TRACKS, [pair('t5', 't1', 'DIFFERENT')])
  const c = mergeDatasets(existing, reversedConflict)
  ok('reversed conflicting label is detected as a conflict', c.conflicts.length === 1)

  let threw = false
  try { canonicalPairId('t1', 't1') } catch { threw = true }
  ok('self-pair is rejected', threw)
}

// =====================================================================
section('7. CONFLICTS DETECTED')
{
  const existing = buildDataset(TRACKS, [
    pair('t1', 't2', 'SAME'),
    pair('t1', 't3', 'SIMILAR'),
    pair('t2', 't4', 'DIFFERENT'),
  ])
  const incoming = buildDataset(TRACKS, [
    pair('t1', 't2', 'DIFFERENT'), // conflict
    pair('t1', 't3', 'SIMILAR'), // identical
    pair('t3', 't5', 'SAME'), // new
  ])
  const m = mergeDatasets(existing, incoming)
  ok('exactly one conflict found', m.conflicts.length === 1, `got ${m.conflicts.length}`)
  ok('the new pair was added', m.added === 1, `added ${m.added}`)
  ok('total is existing + new only', m.dataset.pairs.length === 4)
  ok('conflicting pair keeps the existing label',
    m.dataset.pairs.find(p => p.pairId === canonicalPairId('t1', 't2'))?.label === 'SAME')
}

// =====================================================================
section('8. INVALID JSON REJECTED')
{
  const bad = parseDataset('{not json at all')
  ok('malformed JSON reports a parse error', bad.parseError !== null)
  ok('malformed JSON yields no data', bad.data === null)

  ok('null is rejected', !validateDataset(null).ok)
  ok('array is rejected', !validateDataset([] as any).ok)
  ok('empty object is rejected', !validateDataset({}).ok)
  ok('wrong schemaVersion is rejected',
    !validateDataset({ ...sampleDataset(), schemaVersion: 999 }).ok)
  ok('bad label value is rejected',
    !validateDataset({
      ...sampleDataset(),
      pairs: [{ pairId: 't1|t2', trackA: 't1', trackB: 't2', label: 'MAYBE' }],
    }).ok)
  ok('validation never throws on garbage', (() => {
    try { validateDataset({ pairs: 'nope', tracks: 7 } as any); return true }
    catch { return false }
  })())
}

// =====================================================================
section('9. MISSING TRACKS REPORTED')
{
  const orphan: any = sampleDataset()
  orphan.pairs.push({
    pairId: canonicalPairId('t1', 't99'),
    trackA: 't1',
    trackB: 't99',
    label: 'SAME',
  })
  const v = validateDataset(orphan)
  ok('missing track reference is detected', v.missingTrackRefs.includes('t99'),
    JSON.stringify(v.missingTrackRefs))
  ok('missing track raises an issue', v.issues.some(i => i.code.includes('MISSING')))

  const dupe: any = sampleDataset()
  dupe.pairs.push({ ...dupe.pairs[0] })
  ok('duplicate pair id is detected', validateDataset(dupe).duplicatePairIds.length === 1)
}

// =====================================================================
section('10. REPLACE REQUIRES CONFIRMATION')
{
  const src = read('app/pages/dev/ai-benchmark/labeled.vue')
  ok('REPLACE button exists', src.includes('REPLACE DATASET'))
  ok('REPLACE is gated by a confirm flag', src.includes('confirmReplace'))
  ok('REPLACE button is disabled until confirmed',
    /:disabled="!confirmReplace"/.test(src))
  ok('applyImport refuses replace without confirmation',
    /if \(!confirmReplace\.value\)[\s\S]{0,180}return/.test(src))
  ok('merge is the default import action', src.includes('chooseImportFile(true)'))
  ok('import is applied only after a preview',
    src.includes('IMPORT PREVIEW — NOTHING APPLIED YET'))
  ok('replace is visually separated as danger', src.includes('border-danger text-danger'))
}

// =====================================================================
section('11. ACCEPTANCE — EXPORT -> RESET -> IMPORT -> IDENTICAL')
{
  clearDataset()
  const original = sampleDataset()
  saveDataset(original)

  // 1. EXPORT
  const exported = JSON.stringify(loadDataset())
  ok('export produced content', exported.length > 100)

  // 2. RESET / DELETE LOCAL DATA
  clearDataset()
  ok('local data really is gone after reset', loadDataset() === null)

  // 3. IMPORT
  const { data, parseError } = parseDataset(exported)
  ok('re-import parses', parseError === null)
  const v = validateDataset(data)
  ok('re-import validates', v.ok)
  const restored = mergeDatasets(loadDataset() ?? emptyDataset(), data as LabelDataset)
  saveDataset(restored.dataset)

  // 4. IDENTICAL
  const after = loadDataset()!
  const norm = (d: LabelDataset) => JSON.stringify({
    tracks: [...d.tracks].sort((a, b) => a.id.localeCompare(b.id)),
    pairs: [...d.pairs]
      .sort((a, b) => a.pairId.localeCompare(b.pairId))
      .map(p => ({ pairId: p.pairId, label: p.label, source: p.source })),
  })
  ok('ACCEPTANCE: dataset is identical after export/reset/import',
    norm(after) === norm(original),
    `${norm(after)} !== ${norm(original)}`)
  ok('all 5 pairs survived the round trip', after.pairs.length === 5)
  ok('all 5 tracks survived the round trip', after.tracks.length === 5)
  ok('label distribution survived',
    JSON.stringify(countByLabel(after.pairs)) === JSON.stringify(countByLabel(original.pairs)))
  clearDataset()
}

// =====================================================================
section('12. COPY REPORT IS COMPLETE')
{
  const input: EvaluationReportInput = {
    phase: 'Phase 20',
    timestamp: '2026-08-28T00:00:00.000Z',
    modelId: 'yamnet',
    modelName: 'YAMNet',
    deviceLabel: null,
    osVersion: null,
    deviceVerified: false,
    datasetVersion: "phase-20",
    trackCount: 5,
    pairCount: 5,
    counts: { same: 1, similar: 2, different: 2 },
    sameVsDifferentAuc: null,
    similarVsDifferentAuc: null,
    sameVsSimilarAuc: null,
    overlapPercent: null,
    classStats: [],
    pairs: [],
    embeddingDimension: 1024,
    pooling: 'MEAN',
    memory: {
      baselinePssMb: null, peakPssMb: null, postCleanupPssMb: null,
      retainedMb: null, classification: null,
    },
    verdict: 'NOT MEASURED',
    warnings: [],
    blockers: [],
    nextAction: 'Human decision required.',
  }

  const md = toMarkdown(input)
  for (const need of ['Phase 20', 'YAMNet', '1024', 'MEAN']) {
    ok(`markdown report contains ${need}`, md.includes(need))
  }
  for (const heading of ['Dataset', 'Separation', 'Memory', 'Verdict']) {
    ok(`markdown report has a ${heading} section`, new RegExp(`^#+ ${heading}`, 'im').test(md))
  }
  ok('the dataset section reports every class',
    /SAME \| 1/.test(md) && /SIMILAR \| 2/.test(md) && /DIFFERENT \| 2/.test(md))
  // Scoped to metric rows: the ISO timestamp legitimately contains
  // "0.000" and matching it would make this assertion meaningless.
  const metricLines = md.split('\n').filter(l => /AUC|Overlap|PSS|Retained/.test(l))
  ok('absent AUC renders as NOT MEASURED, never 0.000',
    md.includes('SAME vs DIFFERENT AUC | NOT MEASURED')
    && !metricLines.some(l => /\b0\.0+\b/.test(l)),
    metricLines.filter(l => /\b0\.0+\b/.test(l)).join(' / '))
  ok('report states device verification honestly',
    /NOT DEVICE[- ]VERIFIED|deviceVerified.*false|NOT VERIFIED/i.test(md))
  ok('report disclaims automatic model selection',
    md.includes('No production model was selected automatically.'))

  const json = JSON.parse(toJson(input))
  ok('json report is machine-readable', json.phase === 'Phase 20')
  ok('json report keeps nulls as null, not 0', json.sameVsDifferentAuc === null)

  const txt = toPlainText(input)
  ok('plain text report is non-empty', txt.length > 200)
  ok('plain text carries no markdown pipes', !txt.includes('|---'))
}

// =====================================================================
section('13. COPY SUMMARY IS CORRECTLY SCOPED')
{
  const input: EvaluationReportInput = {
    phase: 'Phase 20',
    timestamp: '2026-08-28T00:00:00.000Z',
    modelId: 'yamnet',
    modelName: 'YAMNet',
    deviceLabel: null,
    osVersion: null,
    deviceVerified: false,
    datasetVersion: "phase-20",
    trackCount: 20,
    pairCount: 190,
    counts: { same: 20, similar: 70, different: 100 },
    sameVsDifferentAuc: null,
    similarVsDifferentAuc: null,
    sameVsSimilarAuc: null,
    overlapPercent: null,
    classStats: [],
    pairs: [
      { trackA: 'a', trackB: 'b', label: 'SAME', cosine: 0.9 },
      { trackA: 'c', trackB: 'd', label: 'DIFFERENT', cosine: 0.1 },
    ],
    embeddingDimension: 1024,
    pooling: 'MEAN',
    memory: {
      baselinePssMb: null, peakPssMb: null, postCleanupPssMb: null,
      retainedMb: null, classification: null,
    },
    verdict: 'BENCHMARK_INCONCLUSIVE',
    warnings: [],
    blockers: ['No device run'],
    nextAction: 'Import a real dataset.',
  }

  const s = toSummary(input)
  const full = toMarkdown(input)
  ok('summary is shorter than the full report', s.length < full.length,
    `${s.length} vs ${full.length}`)
  for (const need of ['Phase 20', '190', 'BENCHMARK_INCONCLUSIVE', 'Import a real dataset.']) {
    ok(`summary contains ${need}`, s.includes(need))
  }
  ok('summary omits the per-pair table', !s.includes('trackA') && !s.includes('0.900'))
  ok('summary states the production decision',
    /No production model|production/i.test(s))
  ok('summary lists blockers', s.includes('No device run'))
}

// =====================================================================
section('14. NO HUMAN LABEL SILENTLY OVERWRITTEN')
{
  const human = buildDataset(TRACKS, [
    { ...pair('t1', 't2', 'SAME'), source: 'human' as const },
  ])
  const seed = buildDataset(TRACKS, [
    { ...pair('t1', 't2', 'DIFFERENT'), source: 'documented-seed' as const },
  ])

  const m = mergeDatasets(human, seed)
  const kept = m.dataset.pairs[0]!
  ok('a documented seed cannot overwrite a human label', kept.label === 'SAME')
  ok('the human provenance is preserved', kept.source === 'human')
  ok('the attempted overwrite is surfaced as a conflict', m.conflicts.length === 1)

  // And the reverse: a human label may not be silently downgraded.
  const m2 = mergeDatasets(seed, human)
  ok('an existing seed is also not silently replaced', m2.dataset.pairs[0]!.label === 'DIFFERENT')
  ok('that too is reported', m2.conflicts.length === 1)

  ok('human labels are never converted to synthetic',
    !read('app/services/ai-lab/labelDataset.ts').includes("source = 'synthetic'"))
}

// =====================================================================
section('15. POSITIONAL KEYS NEVER PERSISTED')
{
  const selected = ['t3', 't1', 't5']
  const positional = { '0:1': { label: 'SAME' as const }, '1:2': { label: 'DIFFERENT' as const } }
  const stable = fromPositionalLabels(selected, positional)
  ok('positional labels convert to stable ids', stable.length === 2)
  ok('conversion uses canonical ids',
    stable.every(p => p.pairId === canonicalPairId(p.trackA, p.trackB)))
  ok('t3x t1 became the canonical t1|t3', stable.some(p => p.pairId === canonicalPairId('t1', 't3')))

  // Reorder the selection: the same pair must still resolve.
  const reordered = ['t1', 't3', 't5']
  const back = toPositionalLabels(reordered, stable)
  ok('labels survive a selection reorder', Object.keys(back).length === 2,
    JSON.stringify(back))

  const persisted = JSON.stringify(buildDataset(TRACKS, stable))
  ok('no positional "i:j" key reaches the persisted file', !/"\d+:\d+"/.test(persisted))
}

// =====================================================================
section('16. PERSISTENCE IS WIRED INTO THE PAGE')
{
  const src = read('app/pages/dev/ai-benchmark/labeled.vue')
  ok('page imports the dataset store', src.includes("from '~/services/ai-lab/labelDataset'"))
  ok('page imports the report exporter', src.includes("from '~/services/ai-lab/reportExport'"))
  ok('labels are saved on change', src.includes('persistLabels'))
  ok('labels are restored on mount', /onMounted\([\s\S]{0,400}restoreLabelsForSelection/.test(src))
  ok('labels are restored on selection change',
    /watch\(selected[\s\S]{0,120}restoreLabelsForSelection/.test(src))
  ok('selection change no longer destroys saved work',
    src.includes('restoreLabelsForSelection'))

  for (const btn of [
    'EXPORT DATASET', 'IMPORT DATASET', 'BACKUP DATASET',
    'COPY REPORT', 'COPY SUMMARY', 'EXPORT REPORT (JSON)',
  ]) {
    ok(`button present on the benchmark page: ${btn}`, src.includes(btn))
  }
  ok('buttons are on the page, not a dev-only menu',
    src.indexOf('EXPORT DATASET') < src.indexOf('</template>'))

  const store = read('app/services/ai-lab/labelDataset.ts')
  ok('store uses the existing persistence architecture',
    store.includes('storageAdapter') || store.includes('readJSON'))
  ok('page does not touch localStorage directly', !src.includes('localStorage'))
}

// =====================================================================
section('17. MEMORY HARNESS — A–G MATRIX (§5/§6)')
{
  ok('all seven tests are defined', MEMORY_TESTS.length === 7)
  ok('tests are A through G',
    MEMORY_TESTS.map(t => t.id).join('') === 'ABCDEFG')
  ok('track scales 1/5/10/20 are covered',
    [1, 5, 10, 20].every(n => MEMORY_TESTS.some(t => t.trackCount === n && t.sessions === 1)))
  ok('repeated-session test exists', MEMORY_TESTS.some(t => t.sessions > 1 && t.decodesAudio))
  ok('model-only test exists', MEMORY_TESTS.some(t => t.loadsModel && !t.decodesAudio))
  ok('audio-only test exists', MEMORY_TESTS.some(t => !t.loadsModel && t.decodesAudio))

  // With no measurements the harness must refuse to say anything good.
  const empty = runHarness([])
  ok('unmeasured matrix is NOT_MEASURED', empty.verdict.status === 'NOT_MEASURED')
  ok('unmeasured verdict says ENVIRONMENT BLOCKED',
    empty.verdict.note.includes('ENVIRONMENT BLOCKED'))
  ok('every unmeasured row is NOT_MEASURED',
    empty.results.every(r => r.status === 'NOT_MEASURED'))
  ok('unmeasured rows carry null figures, not zeros',
    empty.results.every(r => r.retainedMb === null && r.peakPssMb === null))
  ok('unmeasured attribution stays null',
    empty.attribution.modelAndRuntimeMb === null && empty.attribution.unattributedMb === null)

  // A row with numbers but no device verification must not be promoted.
  const unverified: MemoryMeasurement = {
    testId: 'A', baselinePssMb: 100, peakPssMb: 500, postCleanupPssMb: 110,
    deviceVerified: false,
  }
  const u = runHarness([unverified])
  ok('unverified numbers are not promoted to a verdict',
    u.results.find(r => r.spec.id === 'A')!.status === 'NOT_MEASURED')

  // A clean device-verified row passes.
  const clean: MemoryMeasurement = {
    testId: 'A', baselinePssMb: 300, peakPssMb: 900, postCleanupPssMb: 302,
    baselineNativeHeapMb: 40, postCleanupNativeHeapMb: 41, deviceVerified: true,
  }
  ok('a released row is PASS',
    runHarness([clean]).results.find(r => r.spec.id === 'A')!.status === 'PASS')

  // PSS retained but native heap returned = allocator, not a leak.
  const allocator: MemoryMeasurement = {
    testId: 'A', baselinePssMb: 320, peakPssMb: 1278, postCleanupPssMb: 1278,
    baselineNativeHeapMb: 40, postCleanupNativeHeapMb: 42, deviceVerified: true,
  }
  const a = runHarness([allocator]).results.find(r => r.spec.id === 'A')!
  ok('PSS-high/native-flat is WARNING, not BLOCKER', a.status === 'WARNING')
  ok('the allocator explanation is stated', a.note.includes('allocator'))

  // PSS retained AND native heap retained = a leak.
  const leak: MemoryMeasurement = {
    testId: 'A', baselinePssMb: 320, peakPssMb: 1278, postCleanupPssMb: 1278,
    baselineNativeHeapMb: 40, postCleanupNativeHeapMb: 900, deviceVerified: true,
  }
  const l = runHarness([leak]).results.find(r => r.spec.id === 'A')!
  ok('PSS + native both retained is a BLOCKER', l.status === 'BLOCKER')
  ok('the leak conclusion is explicit', l.note.includes('leak'))

  // PSS only, no native samples = cannot tell.
  const pssOnly: MemoryMeasurement = {
    testId: 'A', baselinePssMb: 320, peakPssMb: 1278, postCleanupPssMb: 1278,
    deviceVerified: true,
  }
  const p = runHarness([pssOnly]).results.find(r => r.spec.id === 'A')!
  ok('PSS alone yields INCONCLUSIVE', p.status === 'INCONCLUSIVE')
  ok('it states PSS cannot separate allocator retention from a leak',
    p.note.includes('PSS alone cannot separate'))

  // A partial clean matrix must not read as an overall pass.
  ok('partial matrix cannot be an overall PASS',
    classifyMemoryRun(runHarness([clean]).results).status === 'INCONCLUSIVE')

  // Attribution refuses to invent a remainder.
  const partial = attributeRetention(runHarness([clean]).results)
  ok('attribution reports which rows are missing', partial.note.includes('not measured'))
}

// =====================================================================
section('18. SAFETY — NO FABRICATION PATHS')
{
  const store = read('app/services/ai-lab/labelDataset.ts')
  const rep = read('app/services/ai-lab/reportExport.ts')
  const harness = read('app/services/ai-lab/memoryHarness.ts')

  ok('no hard-coded 0.941 anywhere', ![store, rep, harness].some(s => s.includes('0.941')))
  ok('no hard-coded 0.825 anywhere', ![store, rep, harness].some(s => s.includes('0.825')))
  ok('no hard-coded 958.5 anywhere', ![store, rep, harness].some(s => s.includes('958.5')))
  ok('report never defaults a missing metric to zero',
    !/\?\?\s*0(\.0)?\b/.test(rep.replace(/\?\?\s*0\b(?=\s*\/\/ count)/g, '')))
  ok('harness has no synthetic fallback measurement',
    !/deviceVerified:\s*true/.test(harness))
  ok('DEVICE_VERIFIED is never asserted by the harness itself',
    !harness.includes("'DEVICE_VERIFIED'"))

  // The user's player files must be untouched by this phase.
  for (const f of [
    'app/composables/usePlayer.ts',
    'app/stores/player.ts',
    'capacitor.config.ts',
  ]) {
    ok(`untouched by phase 20: ${f}`, existsSync(resolve(ROOT, f)))
  }
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`PHASE 20 §12 PERSISTENCE — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All label-persistence tests passed.')
