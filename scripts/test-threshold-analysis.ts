/**
 * SYSTEMA — threshold sweep and distribution analysis tests.
 *
 * These exercise the analysis logic against hand-computed answers and
 * against degenerate inputs that a real dataset can produce: empty
 * classes, single-element classes, every score identical, perfect
 * separation, perfectly inverted separation, missing cosines and
 * out-of-range cosines.
 *
 * NOTHING HERE RUNS A MODEL, decodes audio, or reads a device. The
 * analysis module is pure arithmetic over pairs that already exist.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MIN_SUPPORT_FOR_PRECISION,
  type AnalysablePair,
  analyseOverlap,
  analyseThresholds,
  assessSignal,
  describe as describeDist,
  findPicks,
  formatRange,
  partitionPairs,
  percentile,
  rankAuc,
  sweepThresholds,
} from '../app/services/ai-lab/thresholdAnalysis'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title: string) {
  console.log(`\n${title}`)
}
function near(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps
}

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

function pair(label: string, cosine: number | null, i = 0): AnalysablePair {
  return { trackA: `a${i}`, trackB: `b${i}`, label, cosine }
}

// =====================================================================
section('1. Partitioning by ground truth')
{
  const input: AnalysablePair[] = [
    pair('SAME', 0.99, 1),
    pair('SIMILAR', 0.6, 2),
    pair('DIFFERENT', 0.2, 3),
    pair('SIMILAR', 0.55, 4),
  ]
  const p = partitionPairs(input)
  ok('SAME is separated', p.same.length === 1)
  ok('SIMILAR is separated', p.similar.length === 2)
  ok('DIFFERENT is separated', p.different.length === 1)
  ok('nothing is excluded from clean input', p.excluded.length === 0)
  ok('input count is reported', p.inputCount === 4)
  ok('usable count is reported', p.usableCount === 4)

  // Labels arrive from a native bridge as strings; case and padding
  // must not silently drop a pair.
  const messy = partitionPairs([pair(' similar ', 0.5), pair('Different', 0.1)])
  ok('lower-case labels are accepted', messy.similar.length === 1)
  ok('padded labels are accepted', messy.different.length === 1)
}

// =====================================================================
section('2. Unusable pairs are excluded, not coerced')
{
  const p = partitionPairs([
    pair('SIMILAR', null, 1),
    pair('SIMILAR', Number.NaN, 2),
    pair('DIFFERENT', undefined as unknown as number, 3),
    pair('UNLABELLED', 0.4, 4),
    pair('', 0.4, 5),
    pair('SIMILAR', 1.5, 6),
    pair('SIMILAR', -2, 7),
    pair('SIMILAR', Number.POSITIVE_INFINITY, 8),
  ])
  ok('every unusable pair is excluded', p.usableCount === 0, `usable=${p.usableCount}`)
  ok('all eight are accounted for', p.excluded.length === 8)

  const reasons = p.excluded.map(e => e.reason)
  ok('a null cosine is MISSING_COSINE', reasons[0] === 'MISSING_COSINE')
  ok('NaN is NON_FINITE_COSINE', reasons[1] === 'NON_FINITE_COSINE')
  ok('undefined is MISSING_COSINE', reasons[2] === 'MISSING_COSINE')
  ok('an unknown label is UNKNOWN_LABEL', reasons[3] === 'UNKNOWN_LABEL')
  ok('an empty label is UNKNOWN_LABEL', reasons[4] === 'UNKNOWN_LABEL')
  ok('cosine above 1 is OUT_OF_RANGE', reasons[5] === 'OUT_OF_RANGE')
  ok('cosine below -1 is OUT_OF_RANGE', reasons[6] === 'OUT_OF_RANGE')
  ok('Infinity is NON_FINITE_COSINE', reasons[7] === 'NON_FINITE_COSINE')

  // THE POINT: a missing cosine must never become 0.0, which would sit
  // at the bottom of the DIFFERENT range and flatter every metric.
  const mixed = partitionPairs([pair('SIMILAR', null), pair('SIMILAR', 0.8)])
  ok('a missing cosine does not become 0', mixed.similar.length === 1
    && mixed.similar[0]!.cosine === 0.8)

  // Float noise just past 1.0 is tolerated, not rejected.
  const noisy = partitionPairs([pair('SAME', 1 + 1e-12)])
  ok('1.0 plus float noise is kept', noisy.same.length === 1)
}

// =====================================================================
section('3. Percentiles (linear interpolation, R-7)')
{
  const s = [1, 2, 3, 4]
  ok('median of an even sample interpolates', near(percentile(s, 0.5), 2.5))
  ok('P25 of [1,2,3,4] is 1.75', near(percentile(s, 0.25), 1.75))
  ok('P75 of [1,2,3,4] is 3.25', near(percentile(s, 0.75), 3.25))
  ok('P0 is the minimum', near(percentile(s, 0), 1))
  ok('P100 is the maximum', near(percentile(s, 1), 4))

  const odd = [1, 2, 3, 4, 5]
  ok('median of an odd sample is the middle', near(percentile(odd, 0.5), 3))
  ok('P10 of [1..5] is 1.4', near(percentile(odd, 0.1), 1.4))
  ok('P90 of [1..5] is 4.6', near(percentile(odd, 0.9), 4.6))

  ok('a single value returns itself', near(percentile([7], 0.5), 7))
  ok('a single value ignores the quantile', near(percentile([7], 0.9), 7))
  ok('an empty sample is NaN', Number.isNaN(percentile([], 0.5)))
}

// =====================================================================
section('4. Distribution stats')
{
  const d = describeDist('SIMILAR', [0.1, 0.2, 0.3, 0.4, 0.5])
  ok('count', d.count === 5)
  ok('min', near(d.min, 0.1))
  ok('max', near(d.max, 0.5))
  ok('mean', near(d.mean, 0.3, 1e-12))
  ok('median', near(d.median, 0.3, 1e-12))
  ok('P25', near(d.p25, 0.2, 1e-12))
  ok('P75', near(d.p75, 0.4, 1e-12))
  ok('stdDev is population, not sample',
    near(d.stdDev, Math.sqrt(0.02), 1e-12), `got ${d.stdDev}`)

  // Unsorted input must give the same answer as sorted.
  const shuffled = describeDist('X', [0.5, 0.1, 0.4, 0.2, 0.3])
  ok('input order does not matter',
    near(shuffled.median, d.median, 1e-12) && near(shuffled.p25, d.p25, 1e-12))

  const empty = describeDist('EMPTY', [])
  ok('an empty class has count 0', empty.count === 0)
  ok('an empty class reports NaN, not 0', Number.isNaN(empty.mean)
    && Number.isNaN(empty.median) && Number.isNaN(empty.min))

  const one = describeDist('ONE', [0.42])
  ok('a single value: every statistic is that value',
    one.count === 1 && near(one.min, 0.42) && near(one.max, 0.42)
    && near(one.mean, 0.42) && near(one.median, 0.42) && near(one.p10, 0.42))
  ok('a single value has zero deviation', near(one.stdDev, 0))

  const flat = describeDist('FLAT', [0.3, 0.3, 0.3, 0.3])
  ok('identical values have zero deviation', near(flat.stdDev, 0))
  ok('identical values: min equals max', near(flat.min, flat.max))
}

// =====================================================================
section('5. Threshold sweep arithmetic')
{
  // Hand-computable: SIMILAR {0.8, 0.6}, DIFFERENT {0.4, 0.2}.
  const rows = sweepThresholds([0.8, 0.6], [0.4, 0.2])

  ok('0.00 to 1.00 by 0.01 is 101 rows', rows.length === 101, `got ${rows.length}`)
  ok('the first threshold is 0.00', near(rows[0]!.threshold, 0))
  ok('the last threshold is 1.00', near(rows[100]!.threshold, 1))

  // Floating-point drift check: accumulating 0.01 a hundred times
  // lands on 0.9999999999999999, not 1.
  ok('thresholds are exact, not accumulated',
    rows.every((r, i) => near(r.threshold, Number((i / 100).toFixed(2)), 1e-12)))
  ok('0.07 is exactly 0.07', rows[7]!.threshold === 0.07)
  ok('0.29 is exactly 0.29', rows[29]!.threshold === 0.29)

  // At 0.00 everything is predicted SIMILAR.
  const t0 = rows[0]!
  ok('at 0.00 every pair is predicted positive', t0.tp === 2 && t0.fp === 2)
  ok('at 0.00 nothing is predicted negative', t0.tn === 0 && t0.fn === 0)
  ok('at 0.00 recall is 1', near(t0.recall, 1))
  ok('at 0.00 precision is the class balance', near(t0.precision, 0.5))
  ok('at 0.00 accuracy is 0.5', near(t0.accuracy, 0.5))

  // At 0.50 the split is perfect.
  const t50 = rows.find(r => r.threshold === 0.5)!
  ok('at 0.50 both SIMILAR are retrieved', t50.tp === 2)
  ok('at 0.50 no DIFFERENT is retrieved', t50.fp === 0)
  ok('at 0.50 both DIFFERENT are rejected', t50.tn === 2)
  ok('at 0.50 nothing is missed', t50.fn === 0)
  ok('at 0.50 precision is 1', near(t50.precision, 1))
  ok('at 0.50 recall is 1', near(t50.recall, 1))
  ok('at 0.50 F1 is 1', near(t50.f1, 1))
  ok('at 0.50 accuracy is 1', near(t50.accuracy, 1))

  // At 1.00 nothing is retrieved.
  const t100 = rows[100]!
  ok('at 1.00 nothing is predicted positive', t100.predictedPositive === 0)
  ok('at 1.00 precision is NaN, not 0', Number.isNaN(t100.precision))
  ok('at 1.00 recall is 0', near(t100.recall, 0))
  ok('at 1.00 F1 is NaN when precision is undefined', Number.isNaN(t100.f1))
  ok('at 1.00 accuracy is still defined', near(t100.accuracy, 0.5))

  // The confusion matrix must always account for every pair.
  ok('TP+FP+TN+FN equals the pair count at every threshold',
    rows.every(r => r.tp + r.fp + r.tn + r.fn === 4))
  ok('predictedPositive is TP+FP at every threshold',
    rows.every(r => r.predictedPositive === r.tp + r.fp))

  // Monotonicity: raising the threshold can only reduce retrieval.
  let monotonic = true
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.predictedPositive > rows[i - 1]!.predictedPositive) monotonic = false
    if (rows[i]!.tp > rows[i - 1]!.tp) monotonic = false
  }
  ok('retrieval never increases as the threshold rises', monotonic)
}

// =====================================================================
section('6. Sweep options and boundaries')
{
  const coarse = sweepThresholds([0.9], [0.1], { step: 0.1 })
  ok('a 0.1 step gives 11 rows', coarse.length === 11, `got ${coarse.length}`)
  ok('a 0.1 step stays exact', coarse.every((r, i) => near(r.threshold, i / 10, 1e-12)))

  const narrow = sweepThresholds([0.9], [0.1], { from: 0.5, to: 0.6, step: 0.01 })
  ok('a narrow range is honoured', narrow.length === 11)
  ok('the narrow range starts at 0.50', near(narrow[0]!.threshold, 0.5))
  ok('the narrow range ends at 0.60', near(narrow[10]!.threshold, 0.6))

  // Cosine can legitimately be negative; the sweep must be able to
  // cover that, even though the default range starts at 0.
  const neg = sweepThresholds([0.5], [-0.5], { from: -1, to: 1, step: 0.5 })
  ok('a negative range is supported', neg.length === 5)
  ok('the negative range starts at -1', near(neg[0]!.threshold, -1))

  let threwStep = false
  try { sweepThresholds([0.5], [0.1], { step: 0 }) } catch { threwStep = true }
  ok('a zero step is rejected', threwStep)

  let threwNeg = false
  try { sweepThresholds([0.5], [0.1], { step: -0.1 }) } catch { threwNeg = true }
  ok('a negative step is rejected', threwNeg)

  let threwOrder = false
  try { sweepThresholds([0.5], [0.1], { from: 1, to: 0 }) } catch { threwOrder = true }
  ok('an inverted range is rejected', threwOrder)
}

// =====================================================================
section('7. Empty and single-class sweeps')
{
  const noSimilar = sweepThresholds([], [0.1, 0.2])
  ok('with no SIMILAR the sweep still runs', noSimilar.length === 101)
  ok('with no SIMILAR recall is NaN', Number.isNaN(noSimilar[0]!.recall))
  ok('with no SIMILAR TP is 0 everywhere', noSimilar.every(r => r.tp === 0))

  const noDifferent = sweepThresholds([0.8, 0.9], [])
  ok('with no DIFFERENT the sweep still runs', noDifferent.length === 101)
  ok('with no DIFFERENT precision is 1 while retrieving',
    near(noDifferent[0]!.precision, 1))
  ok('with no DIFFERENT FP is 0 everywhere', noDifferent.every(r => r.fp === 0))

  const bothEmpty = sweepThresholds([], [])
  ok('two empty classes still produce rows', bothEmpty.length === 101)
  ok('two empty classes give NaN accuracy', Number.isNaN(bothEmpty[0]!.accuracy))
  ok('two empty classes never claim a hit', bothEmpty.every(r => r.tp === 0 && r.fp === 0))
}

// =====================================================================
section('8. Picking thresholds')
{
  // Perfect separation at 0.50. The class must be large enough to
  // clear MIN_SUPPORT_FOR_PRECISION, otherwise the low-support guard
  // fires — correctly — and this would be testing the wrong thing.
  const sPerfect = [0.8, 0.75, 0.7, 0.65, 0.6, 0.55]
  const dPerfect = [0.4, 0.35, 0.3, 0.25, 0.2, 0.15]
  const rows = sweepThresholds(sPerfect, dPerfect)
  const picks = findPicks(rows, sPerfect.length)

  ok('best F1 is found', picks.bestF1.row !== null)
  ok('best F1 achieves 1.0', near(picks.bestF1.row!.f1, 1))
  ok('best F1 lands inside the separating gap',
    picks.bestF1.row!.threshold > 0.4 && picks.bestF1.row!.threshold <= 0.55)
  ok('perfect separation is not flagged degenerate', !picks.bestF1.isDegenerate)
  ok('ties are counted', picks.bestF1.tieCount >= 1)

  ok('balance is found', picks.bestBalance.row !== null)
  ok('balance has zero gap here', near(picks.bestBalance.row!.balanceGap, 0))

  ok('highest recall is found', picks.highestRecall.row !== null)
  ok('highest recall is 1.0', near(picks.highestRecall.row!.recall, 1))

  // THE DEGENERACY GUARD: highest recall must not be reported as a
  // useful threshold when it comes from "predict everything".
  const alwaysPositive = findPicks(sweepThresholds([0.5], [0.5]), 1)
  ok('threshold 0.00 with no rejections is flagged degenerate',
    alwaysPositive.highestRecall.isDegenerate,
    `reason=${alwaysPositive.highestRecall.degenerateReason}`)
  ok('the degeneracy is explained',
    (alwaysPositive.highestRecall.degenerateReason ?? '').length > 0)

  // Precision is not trusted from a tiny number of predictions.
  const tiny = sweepThresholds([0.99], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
  const tinyPicks = findPicks(tiny, 1)
  ok('precision requires minimum support',
    tinyPicks.highestPrecision.row === null
    || tinyPicks.highestPrecision.row.predictedPositive >= MIN_SUPPORT_FOR_PRECISION,
    `predictedPositive=${tinyPicks.highestPrecision.row?.predictedPositive}`)

  // No usable rows at all.
  const nothing = findPicks(sweepThresholds([], []), 0)
  ok('no SIMILAR pairs: F1 pick is null', nothing.bestF1.row === null)
  ok('no SIMILAR pairs: balance pick is null', nothing.bestBalance.row === null)
  ok('a null pick is not flagged degenerate', !nothing.bestF1.isDegenerate)
}

// =====================================================================
section('9. Overlap analysis')
{
  // Disjoint.
  const disjoint = analyseOverlap([0.8, 0.9], [0.1, 0.2],
    sweepThresholds([0.8, 0.9], [0.1, 0.2]))
  ok('disjoint classes have no overlap interval', disjoint.interval === null)
  ok('disjoint classes have zero width', near(disjoint.width, 0))
  ok('disjoint classes have zero crossing pairs',
    disjoint.similarInsideDifferentRange === 0
    && disjoint.differentInsideSimilarRange === 0)
  ok('disjoint classes have AUC 1', near(disjoint.auc, 1))
  ok('disjoint classes reach accuracy 1', near(disjoint.bestAccuracy, 1))

  // Total overlap: identical distributions.
  const same = analyseOverlap([0.5, 0.5], [0.5, 0.5],
    sweepThresholds([0.5, 0.5], [0.5, 0.5]))
  ok('identical classes overlap completely', near(same.overlapFraction, 1))
  ok('identical classes report 100%', near(same.overlapPercent, 100))
  ok('identical classes have AUC 0.5 (ties count half)', near(same.auc, 0.5))
  ok('identical classes have zero mean gap', near(same.meanGap, 0))
  ok('identical classes cannot beat the majority guess',
    same.bestAccuracy <= same.majorityClassAccuracy + 1e-12)

  // Partial overlap, hand-checked.
  const s = [0.3, 0.5, 0.7]
  const d = [0.2, 0.4, 0.6]
  const partial = analyseOverlap(s, d, sweepThresholds(s, d))
  ok('the overlap interval is the shared span',
    partial.interval !== null
    && near(partial.interval[0], 0.3) && near(partial.interval[1], 0.6))
  ok('SIMILAR inside the DIFFERENT range is counted',
    partial.similarInsideDifferentRange === 2, // 0.3, 0.5
    `got ${partial.similarInsideDifferentRange}`)
  ok('DIFFERENT inside the SIMILAR range is counted',
    partial.differentInsideSimilarRange === 2, // 0.4, 0.6
    `got ${partial.differentInsideSimilarRange}`)
  ok('overlap fraction uses both classes as the denominator',
    near(partial.overlapFraction, 4 / 6))
  ok('the mean gap is positive', partial.meanGap > 0)

  // Inverted: DIFFERENT scores above SIMILAR.
  const inverted = analyseOverlap([0.1, 0.2], [0.8, 0.9],
    sweepThresholds([0.1, 0.2], [0.8, 0.9]))
  ok('inverted classes give AUC 0', near(inverted.auc, 0))
  ok('inverted classes give a negative mean gap', inverted.meanGap < 0)

  // Empty.
  const none = analyseOverlap([], [0.5], sweepThresholds([], [0.5]))
  ok('an empty class gives NaN overlap', Number.isNaN(none.overlapFraction))
  ok('an empty class gives NaN AUC', Number.isNaN(none.auc))
  ok('an empty class gives no interval', none.interval === null)
}

// =====================================================================
section('10. Rank AUC matches the device implementation')
{
  ok('perfect ordering is 1', near(rankAuc([3, 4], [1, 2]), 1))
  ok('perfect inversion is 0', near(rankAuc([1, 2], [3, 4]), 0))
  ok('all ties are 0.5', near(rankAuc([1, 1], [1, 1]), 0.5))
  ok('one tie splits the difference', near(rankAuc([2], [2]), 0.5))
  ok('an empty input is NaN', Number.isNaN(rankAuc([], [1])))
  ok('AUC is bounded in [0,1]', (() => {
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: 5 }, () => Math.random())
      const b = Array.from({ length: 7 }, () => Math.random())
      const v = rankAuc(a, b)
      if (!(v >= 0 && v <= 1)) return false
    }
    return true
  })())

  // AUC and the sweep must agree about direction: if AUC > 0.5 then
  // some threshold must beat chance-level accuracy on balanced classes.
  const s = [0.6, 0.7, 0.8, 0.9]
  const d = [0.1, 0.2, 0.3, 0.4]
  const rows = sweepThresholds(s, d)
  const best = Math.max(...rows.map(r => r.accuracy).filter(Number.isFinite))
  ok('a high AUC implies a threshold beats chance',
    rankAuc(s, d) > 0.5 && best > 0.5)
}

// =====================================================================
section('11. SAME is held out of the binary analysis')
{
  const pairs: AnalysablePair[] = [
    ...Array.from({ length: 10 }, (_, i) => pair('SAME', 0.98, i)),
    ...Array.from({ length: 10 }, (_, i) => pair('SIMILAR', 0.5, 100 + i)),
    ...Array.from({ length: 10 }, (_, i) => pair('DIFFERENT', 0.45, 200 + i)),
  ]
  const a = analyseThresholds(pairs)

  ok('SAME is counted', a.sameStats.count === 10)
  ok('SAME is described', near(a.sameStats.mean, 0.98, 1e-12))

  // THE CRITICAL SEPARATION: every confusion-matrix cell across the
  // whole sweep must sum to SIMILAR+DIFFERENT only. If SAME leaked in,
  // these would be 30, not 20.
  ok('the sweep never sees SAME',
    a.sweep.every(r => r.tp + r.fp + r.tn + r.fn === 20),
    `got ${a.sweep[0]!.tp + a.sweep[0]!.fp + a.sweep[0]!.tn + a.sweep[0]!.fn}`)
  ok('SAME does not inflate the overlap denominator',
    near(a.overlap.overlapFraction * 20, a.overlap.similarInsideDifferentRange
      + a.overlap.differentInsideSimilarRange))

  // SAME is still reported against the others, for context.
  ok('SAME vs SIMILAR AUC is available', near(a.sameVsSimilarAuc, 1))
  ok('SAME vs DIFFERENT AUC is available', near(a.sameVsDifferentAuc, 1))

  // A dataset of only SAME cannot be analysed binarily.
  const onlySame = analyseThresholds([pair('SAME', 0.9), pair('SAME', 0.95)])
  ok('a SAME-only dataset is not analysable', !onlySame.analysable)
  ok('a SAME-only dataset explains itself', onlySame.caveats.length > 0)
  ok('a SAME-only dataset still describes SAME', onlySame.sameStats.count === 2)
}

// =====================================================================
section('12. End-to-end analysis and caveats')
{
  const pairs: AnalysablePair[] = [
    ...Array.from({ length: 20 }, (_, i) => pair('SIMILAR', 0.4 + (i % 10) * 0.02, i)),
    ...Array.from({ length: 20 }, (_, i) => pair('DIFFERENT', 0.3 + (i % 10) * 0.02, 100 + i)),
    pair('SIMILAR', null, 900),
    pair('BOGUS', 0.5, 901),
  ]
  const a = analyseThresholds(pairs)

  ok('usable pairs exclude the bad ones', a.partition.usableCount === 40)
  ok('excluded pairs are surfaced', a.partition.excluded.length === 2)
  ok('the exclusion is called out in the caveats',
    a.caveats.some(c => c.includes('excluded')))
  ok('the analysis is marked analysable', a.analysable)
  ok('typical ranges are produced',
    a.similarRange.interquartile !== null && a.differentRange.interquartile !== null)
  ok('the full range spans min to max',
    a.similarRange.full !== null
    && near(a.similarRange.full[0], a.similarStats.min)
    && near(a.similarRange.full[1], a.similarStats.max))

  // Small classes must be called out rather than silently reported.
  const small = analyseThresholds([
    pair('SIMILAR', 0.6, 1), pair('SIMILAR', 0.7, 2),
    pair('DIFFERENT', 0.2, 3), pair('DIFFERENT', 0.3, 4),
  ])
  ok('a small SIMILAR class is flagged',
    small.caveats.some(c => c.includes('SIMILAR pairs')))
  ok('a small DIFFERENT class is flagged',
    small.caveats.some(c => c.includes('DIFFERENT pairs')))

  // The no-signal case must be named explicitly.
  const noSignal = analyseThresholds([
    ...Array.from({ length: 20 }, (_, i) => pair('SIMILAR', 0.5, i)),
    ...Array.from({ length: 20 }, (_, i) => pair('DIFFERENT', 0.5, 100 + i)),
  ])
  ok('a useless threshold is called out',
    noSignal.caveats.some(c => c.includes('no usable signal')),
    JSON.stringify(noSignal.caveats))
}

// =====================================================================
section('13. Signal assessment is descriptive, never a green light')
{
  const strong = assessSignal(analyseThresholds([
    ...Array.from({ length: 15 }, (_, i) => pair('SIMILAR', 0.7 + i * 0.01, i)),
    ...Array.from({ length: 15 }, (_, i) => pair('DIFFERENT', 0.1 + i * 0.01, 100 + i)),
  ]))
  ok('clean separation reads STRONG', strong.verdict === 'STRONG', strong.verdict)
  ok('the verdict carries its AUC', near(strong.auc, 1))

  const chance = assessSignal(analyseThresholds([
    ...Array.from({ length: 15 }, (_, i) => pair('SIMILAR', 0.5, i)),
    ...Array.from({ length: 15 }, (_, i) => pair('DIFFERENT', 0.5, 100 + i)),
  ]))
  ok('identical distributions read NO_SIGNAL', chance.verdict === 'NO_SIGNAL', chance.verdict)

  const inverted = assessSignal(analyseThresholds([
    ...Array.from({ length: 15 }, (_, i) => pair('SIMILAR', 0.1 + i * 0.01, i)),
    ...Array.from({ length: 15 }, (_, i) => pair('DIFFERENT', 0.7 + i * 0.01, 100 + i)),
  ]))
  ok('backwards ordering reads INVERTED', inverted.verdict === 'INVERTED', inverted.verdict)
  ok('the inverted summary says so plainly',
    inverted.summary.toUpperCase().includes('BACKWARD'))

  const none = assessSignal(analyseThresholds([]))
  ok('no data reads INSUFFICIENT_DATA', none.verdict === 'INSUFFICIENT_DATA')

  ok('every assessment is marked analysis-only',
    strong.analysisOnly === true && chance.analysisOnly === true
    && inverted.analysisOnly === true && none.analysisOnly === true)
}

// =====================================================================
section('14. Formatting')
{
  ok('a range formats with an en dash', formatRange([0.3125, 0.5875]) === '0.313–0.588')
  ok('a null range is a dash', formatRange(null) === '—')
  ok('a NaN range is a dash', formatRange([Number.NaN, 0.5]) === '—')
  ok('digits are configurable', formatRange([0.5, 0.6], 1) === '0.5–0.6')
}

// =====================================================================
section('15. The module runs no inference and picks no production value')
{
  const rawSrc = read('app/services/ai-lab/thresholdAnalysis.ts')

  // Assert on CODE, not prose. This module's comments necessarily
  // discuss recommendation and inference in order to say it does
  // NEITHER, and a naive grep matches its own explanation. Strip block
  // comments, line comments and string literals first.
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')

  ok('the comment stripper left real code behind',
    /export function analyseThresholds/.test(src) && src.length > 1000)
  ok('the stripper actually removed the prose',
    !/never authorises production use/.test(src))

  ok('nothing calls the inference bridge',
    !/runLabeledEvaluation|runEvaluation|inferencePlugin|Capacitor/.test(src))
  ok('nothing decodes audio', !/PcmDecoder|decodeAudio|AudioContext/.test(src))
  ok('no ONNX runtime is referenced', !/onnx|ort\.|InferenceSession/i.test(src))
  ok('no embeddings are produced', !/embed\(|createEmbedding|infer\(/.test(src))
  ok('it does not write a production threshold',
    !/saveProductionSelection|PRODUCTION_MODEL_KEY|setProductionThreshold/.test(src))
  ok('it does not touch recommendation code',
    !/recommend|playlistGenerator|similarTracks/i.test(src))

  // The degeneracy guard must exist in the source, not just in a test.
  ok('degenerate picks are detectable', /isDegenerate/.test(src))
  ok('the decision rule is stated once', /SWEEP_RULE/.test(rawSrc))
  ok('the rule is >= not >', /cosine >= threshold/.test(rawSrc))

  // The analysis panel must not present a verdict as authorisation.
  ok('the assessment type is explicitly analysis-only', /analysisOnly: true/.test(src))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`THRESHOLD ANALYSIS — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All threshold analysis tests passed.')
console.log(`
NOT PROVEN HERE: that the CLAP embedding is musically meaningful, that
any threshold generalises beyond the labelled set, or that this model
is fit for production. This file tests arithmetic only.`)
