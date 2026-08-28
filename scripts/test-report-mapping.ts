/**
 * SYSTEMA — report mapping regression tests.
 *
 * THE BUG THESE EXIST FOR
 * -----------------------
 * A real YAMNet device run produced 190 scored pairs with valid
 * cosines and a full SeparationAnalysis, and the report printed
 * NOT MEASURED for every separation metric and left every Track A /
 * Track B cell blank.
 *
 * The cause was not missing data. It was three field-name mismatches
 * against the native contract:
 *
 *   separation.sameVsDifferentAuc  -> separation.comparisons[]
 *   classStats[].meanCosine        -> classStats[].stats.mean
 *   pairs[].trackA / trackB        -> pairs[].trackIdA / trackIdB
 *
 * Each read `undefined`, coalesced to null, and rendered NOT MEASURED.
 *
 * These tests assert the mapping against the PUBLISHED contract shape,
 * so the same class of bug cannot return silently. They compute no
 * statistics: every number is passed through from the device.
 *
 * NOTHING HERE RUNS THE MODEL, decodes audio, or touches a device.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  findComparison,
  finite,
  mapClassStats,
  mapNativeReport,
  mapPairs,
  mapMemory,
  tallyConsistency,
  verifyPairIntegrity,
} from '../app/services/ai-lab/reportMapping'

import { toMarkdown, toSummary } from '../app/services/ai-lab/reportExport'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) passed++
  else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(t: string) { console.log(`\n${t}`) }

// ---------------------------------------------------------------
// A structurally faithful stand-in for the native report.
//
// This is a CONTRACT fixture: it exercises the field names and
// nesting the device emits. Its numbers are arbitrary and are never
// reported as measurements of anything.
// ---------------------------------------------------------------

function nativePair(
  position: number,
  a: string,
  b: string,
  label: string,
  cosine: number | null,
  outcome = 'CONSISTENT',
) {
  return {
    position,
    indexA: 0,
    indexB: 1,
    trackIdA: a,
    trackIdB: b,
    label,
    source: 'HUMAN',
    cosine,
    outcome,
  }
}

function classStat(label: string, n: number, insufficient = false) {
  return {
    label,
    insufficient,
    stats: {
      pairCount: n,
      mean: 0.5,
      median: 0.51,
      min: 0.1,
      max: 0.9,
      range: 0.8,
      stdDev: 0.2,
      p25: 0.3,
      p75: 0.7,
      histogram: [],
      histogramBuckets: 10,
    },
  }
}

function nativeReport() {
  return {
    separation: {
      verdict: 'PARTIAL_SEPARATION',
      rationale: 'Classes order correctly but overlap.',
      comparisons: [
        {
          higher: 'SAME', lower: 'DIFFERENT', countHigher: 4, countLower: 142,
          auc: 0.9412, meanGap: 0.31, rangeOverlap: 0.22,
          overlappingPairs: 30, overlapFraction: 0.2055, insufficient: false,
        },
        {
          higher: 'SIMILAR', lower: 'DIFFERENT', countHigher: 44, countLower: 142,
          auc: 0.8251, meanGap: 0.18, rangeOverlap: 0.41,
          overlappingPairs: 62, overlapFraction: 0.3333, insufficient: false,
        },
        {
          higher: 'SAME', lower: 'SIMILAR', countHigher: 4, countLower: 44,
          auc: 0.7102, meanGap: 0.09, rangeOverlap: 0.33,
          overlappingPairs: 18, overlapFraction: 0.375, insufficient: false,
        },
      ],
    },
    classStats: [classStat('SAME', 4), classStat('SIMILAR', 44), classStat('DIFFERENT', 142)],
    // Contract field names: pairResults / rows / memory.
    pairResults: [
      nativePair(1, 'tA', 'tB', 'SAME', 0.91),
      nativePair(2, 'tA', 'tC', 'SIMILAR', 0.62),
      nativePair(3, 'tB', 'tC', 'DIFFERENT', 0.11, 'INCONSISTENT'),
    ],
    rows: [
      { index: 0, trackId: 'tA', ok: true, dimension: 1024 },
      { index: 1, trackId: 'tB', ok: true, dimension: 1024 },
      { index: 2, trackId: 'tC', ok: true, dimension: 1024 },
    ],
    memory: {
      baselineKb: 359731,
      peakKb: 1276928,
      finalKb: 1277030,
      peakDeltaKb: 917197,
      netDeltaKb: 917299,
      attribution: 'ALLOCATOR_RETENTION',
      rationale: 'Native heap did not return to baseline.',
      caveat: 'PSS alone cannot separate allocator retention from a leak.',
      checkpoints: [],
    },
  } as any
}

console.log('SYSTEMA — report mapping (YAMNet run reporting fix)')

// =====================================================================
section('1. THE REGRESSION: AUCs are no longer NOT MEASURED')
{
  const { input } = mapNativeReport(nativeReport())
  ok('SAME vs DIFFERENT AUC is mapped', input.sameVsDifferentAuc === 0.9412,
    String(input.sameVsDifferentAuc))
  ok('SIMILAR vs DIFFERENT AUC is mapped', input.similarVsDifferentAuc === 0.8251,
    String(input.similarVsDifferentAuc))
  ok('SAME vs SIMILAR AUC is mapped', input.sameVsSimilarAuc === 0.7102,
    String(input.sameVsSimilarAuc))

  const md = toMarkdown(input)
  ok('markdown no longer prints NOT MEASURED for SAME vs DIFFERENT',
    md.includes('| SAME vs DIFFERENT AUC | 0.9412 |'))
  ok('markdown no longer prints NOT MEASURED for SIMILAR vs DIFFERENT',
    md.includes('| SIMILAR vs DIFFERENT AUC | 0.8251 |'))
  ok('markdown no longer prints NOT MEASURED for SAME vs SIMILAR',
    md.includes('| SAME vs SIMILAR AUC | 0.7102 |'))

  // The exact shape of the original bug: reading the flat field.
  const sep: any = nativeReport().separation
  ok('the old flat field genuinely does not exist on the contract',
    sep.sameVsDifferentAuc === undefined)
}

// =====================================================================
section('2. THE REGRESSION: track names are no longer blank')
{
  const titles: Record<string, string> = { tA: 'Alpha', tB: 'Beta', tC: 'Gamma' }
  const { input } = mapNativeReport(nativeReport(), { resolveTitle: id => titles[id] })

  ok('Track A resolves to a title', input.pairs?.[0]?.trackA === 'Alpha')
  ok('Track B resolves to a title', input.pairs?.[0]?.trackB === 'Beta')
  ok('no pair row is blank', input.pairs?.every(p => p.trackA && p.trackB) === true)

  const md = toMarkdown(input)
  ok('markdown pair table shows names', md.includes('| Alpha | Beta | SAME |'))
  ok('markdown pair table has no empty cells', !/\|\s+\|\s+\| (SAME|SIMILAR|DIFFERENT)/.test(md))

  // Unresolvable ids must degrade to the id, never to blank.
  const { input: noTitles } = mapNativeReport(nativeReport())
  ok('unresolved title falls back to the track id', noTitles.pairs?.[0]?.trackA === 'tA')
  ok('fallback is never an empty string',
    noTitles.pairs?.every(p => p.trackA.length > 0 && p.trackB.length > 0) === true)

  // The old field name really is absent.
  ok('the old pair field genuinely does not exist',
    (nativeReport().pairResults[0] as any).trackA === undefined)
}

// =====================================================================
section('3. THE REGRESSION: class stats are read from .stats')
{
  const { input } = mapNativeReport(nativeReport())
  const same = input.classStats?.find(c => c.label === 'SAME')
  ok('n comes from stats.pairCount', same?.count === 4, String(same?.count))
  ok('mean is mapped', same?.mean === 0.5)
  ok('median is mapped', same?.median === 0.51)
  ok('P25 is mapped', same?.p25 === 0.3)
  ok('P75 is mapped', same?.p75 === 0.7)
  ok('min is mapped', same?.min === 0.1)
  ok('max is mapped', same?.max === 0.9)
  ok('stdDev is mapped', same?.stdDev === 0.2)

  const md = toMarkdown(input)
  ok('markdown class table renders all eight columns',
    md.includes('| Class | n | mean | median | P25 | P75 | min | max | sd |'))
  ok('markdown class row has no NOT MEASURED',
    md.includes('| SAME | 4 | 0.5000 | 0.5100 | 0.3000 | 0.7000 | 0.1000 | 0.9000 | 0.2000 |'))

  ok('the old nested-free field genuinely does not exist',
    (nativeReport().classStats[0] as any).meanCosine === undefined)
}

// =====================================================================
section('4. AUC direction is handled, not assumed')
{
  const comparisons = [{
    higher: 'DIFFERENT', lower: 'SAME', countHigher: 142, countLower: 4,
    auc: 0.0588, meanGap: -0.31, rangeOverlap: 0.22,
    overlappingPairs: 30, overlapFraction: 0.2055, insufficient: false,
  }] as any

  const r = findComparison(comparisons, 'SAME', 'DIFFERENT')
  ok('a reversed comparison is inverted, not mis-reported',
    Math.abs((r.auc ?? 0) - 0.9412) < 1e-9, String(r.auc))
  ok('a missing comparison yields null, not 0',
    findComparison(comparisons, 'SAME', 'SIMILAR').auc === null)
  ok('absent comparisons array yields null', findComparison(undefined, 'SAME', 'SIMILAR').auc === null)
}

// =====================================================================
section('5. NaN and Infinity are not measurements')
{
  ok('NaN maps to null', finite(Number.NaN) === null)
  ok('Infinity maps to null', finite(Number.POSITIVE_INFINITY) === null)
  ok('a real 0 survives', finite(0) === 0)

  // Kotlin emits Double.NaN for an insufficient class; it must not
  // become 0.000 in the report.
  const rep = nativeReport()
  rep.separation.comparisons[0].auc = Number.NaN
  const { input } = mapNativeReport(rep)
  ok('NaN AUC renders as NOT MEASURED, never 0.000',
    input.sameVsDifferentAuc === null
    && toMarkdown(input).includes('| SAME vs DIFFERENT AUC | NOT MEASURED |'))
}

// =====================================================================
section('6. CONSISTENT / INCONSISTENT tally')
{
  const t = tallyConsistency(nativeReport().pairResults)
  ok('consistent counted', t.consistent === 2, String(t.consistent))
  ok('inconsistent counted', t.inconsistent === 1, String(t.inconsistent))
  ok('scored total excludes unscored', t.scored === 3)
  ok('percentage is of scored pairs',
    Math.abs((t.consistentPercent ?? 0) - 66.6667) < 0.01, String(t.consistentPercent))

  const withUnscored = [...nativeReport().pairResults, nativePair(4, 'tA', 'tD', 'SAME', null, 'NOT_SCORED')]
  const t2 = tallyConsistency(withUnscored)
  ok('NOT_SCORED is not counted as inconsistent', t2.inconsistent === 1)
  ok('NOT_SCORED is tracked separately', t2.notScored === 1)
  ok('an unscored pair does not inflate the denominator', t2.scored === 3)

  ok('empty input yields null percentages, not 0%', tallyConsistency([]).consistentPercent === null)

  const md = toMarkdown(mapNativeReport(nativeReport()).input)
  ok('markdown reports consistency counts', md.includes('| CONSISTENT | 2 |'))
  ok('markdown reports consistency percent', /CONSISTENT \| 2 \| 66\.67/.test(md))
}

// =====================================================================
section('7. ONE-TO-ONE pair correspondence is verified, not assumed')
{
  const good = verifyPairIntegrity(nativeReport().pairResults,
    { same: 1, similar: 1, different: 1 })
  ok('matching dataset verifies 1:1', good.ok, good.issues.join('; '))
  ok('distinct pair count is reported', good.scoredPairCount === 3)

  // Duplicates must be identified, not silently counted.
  const dupes = [...nativeReport().pairResults, nativePair(4, 'tB', 'tA', 'SAME', 0.91)]
  const d = verifyPairIntegrity(dupes, { same: 1, similar: 1, different: 1 })
  ok('a reversed duplicate is detected as a duplicate', d.duplicatePairIds.length === 1,
    JSON.stringify(d.duplicatePairIds))
  ok('duplicates make the check fail loudly', !d.ok)
  ok('duplicate is reported as an issue', d.issues.some(i => i.includes('duplicate')))
  ok('distinct count excludes the duplicate', d.scoredPairCount === 3)

  // A count mismatch must be surfaced, never corrected.
  const mism = verifyPairIntegrity(nativeReport().pairResults, { same: 4, similar: 44, different: 142 })
  ok('count mismatch is detected', !mism.ok)
  ok('mismatch names the class', mism.unmatched.some(u => u.startsWith('SAME')))
  ok('mismatch states labels were NOT changed',
    mism.issues.some(i => i.includes('Labels were NOT changed')))

  // Malformed / self pairs.
  const bad = verifyPairIntegrity([
    nativePair(1, 'tA', 'tA', 'SAME', 0.9),
    nativePair(2, '', 'tB', 'SAME', 0.9),
    nativePair(3, 'tA', 'tB', 'MAYBE', 0.9),
  ] as any)
  ok('self-pair detected', bad.selfPairs.length === 1)
  ok('missing id detected', bad.malformedPairs.some(m => m.includes('missing track id')))
  ok('bad label detected', bad.malformedPairs.some(m => m.includes('bad label')))
  ok('malformed rows never silently counted as valid', bad.scoredPairCount === 0)

  const md = toMarkdown(mapNativeReport(nativeReport(), {
    expectedCounts: { same: 1, similar: 1, different: 1 },
  }).input)
  ok('markdown states 1:1 correspondence', md.includes('One-to-one correspondence: VERIFIED'))
}

// =====================================================================
section('8. Labels are passed through untouched')
{
  const { input } = mapNativeReport(nativeReport())
  const labels = input.pairs?.map(p => p.label)
  ok('labels are preserved verbatim',
    JSON.stringify(labels) === JSON.stringify(['SAME', 'SIMILAR', 'DIFFERENT']),
    JSON.stringify(labels))
  ok('class counts come from the scored rows',
    input.counts.same === 1 && input.counts.similar === 1 && input.counts.different === 1)

  const src = read('app/services/ai-lab/reportMapping.ts')
  ok('the mapper never reassigns a label', !/\.label\s*=\s*/.test(src))
  ok('the mapper computes no AUC of its own', !/rankSum|mannWhitney|function auc/i.test(src))
  ok('the mapper hard-codes no metric values',
    !/0\.9412|0\.8251|0\.941\b|0\.825\b/.test(src))
}

// =====================================================================
section('9. Memory is mapped in MB from KB')
{
  const m = mapMemory(nativeReport().memory)
  ok('baseline converted KB -> MB',
    Math.abs((m.baselinePssMb ?? 0) - 351.3) < 0.1, String(m.baselinePssMb))
  ok('peak uses runningPeakKb',
    Math.abs((m.peakPssMb ?? 0) - 1247.0) < 0.1, String(m.peakPssMb))
  ok('retained = post - baseline',
    Math.abs((m.retainedMb ?? 0) - 895.7) < 0.2, String(m.retainedMb))
  ok('retention is described, not passed/failed',
    (m.classification ?? '').startsWith('RETAINED'), String(m.classification))
  ok('the device attribution is carried through',
    m.attribution === 'ALLOCATOR_RETENTION')
  ok('the device caveat is carried through',
    (m.caveat ?? '').includes('PSS alone cannot separate'))
  ok('empty timeline yields nulls, not zeros',
    mapMemory(null).peakPssMb === null && mapMemory(null).retainedMb === null)
}

// =====================================================================
section('10. deviceVerified reflects a real run only')
{
  ok('a native report marks the run verified', mapNativeReport(nativeReport()).input.deviceVerified)
  ok('no report means NOT verified', !mapNativeReport(null).input.deviceVerified)
  ok('no report yields null AUCs, not 0',
    mapNativeReport(null).input.sameVsDifferentAuc === null)
  ok('no report still renders NOT MEASURED',
    toMarkdown(mapNativeReport(null).input).includes('NOT MEASURED'))
}

// =====================================================================
section('11. Small classes are flagged, not hidden')
{
  const rep = nativeReport()
  rep.classStats[0] = classStat('SAME', 4, true)
  const { input } = mapNativeReport(rep)
  ok('an insufficient class raises a warning',
    input.warnings?.some(w => w.includes('SAME') && w.includes('4')) === true,
    JSON.stringify(input.warnings))
  ok('the value is still reported alongside the caveat',
    input.classStats?.find(c => c.label === 'SAME')?.mean === 0.5)
}

// =====================================================================
section('12. Summary and no-auto-selection guarantee')
{
  const { input } = mapNativeReport(nativeReport(), {
    modelName: 'YAMNet',
    expectedCounts: { same: 1, similar: 1, different: 1 },
  })
  const s = toSummary(input)
  ok('summary carries the three AUCs',
    s.includes('0.9412') && s.includes('0.8251') && s.includes('0.7102'))
  ok('summary carries consistency', /Consistency: 2\/3/.test(s))
  ok('summary carries the 1:1 verification', s.includes('VERIFIED 1:1'))
  ok('summary states no automatic selection',
    s.includes('No production model was selected automatically.'))
  ok('mapper never sets a production model',
    !/productionModel|selectModel|setProduction/i.test(read('app/services/ai-lab/reportMapping.ts')))
  ok('next action defers to a human',
    input.nextAction?.includes('Human decision required') === true)
}

// =====================================================================
section('13. The page uses the mapper (no re-typed field names)')
{
  const page = read('app/pages/dev/ai-benchmark/labeled.vue')
  ok('page imports the mapper', page.includes("from '~/services/ai-lab/reportMapping'"))
  ok('page maps a completed native report', page.includes('mapNativeReport(report.value'))
  ok('page resolves track titles', page.includes('resolveTrackTitle'))
  ok('page no longer reads separation.sameVsDifferentAuc',
    !page.includes('sep?.sameVsDifferentAuc'))
  ok('page no longer reads meanCosine', !page.includes('meanCosine'))
  ok('page no longer reads pairs[].trackA directly',
    !/\(p as any\)\.trackA/.test(page))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`REPORT MAPPING — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All report-mapping tests passed.')
