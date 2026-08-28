/**
 * SYSTEMA — threshold sweep and distribution analysis (Phase 21.4).
 *
 * WHAT THIS IS
 * ------------
 * A pure, offline reader over pair results that ALREADY EXIST. It runs
 * no model, decodes no audio, touches no device, and creates no
 * embeddings. Given the scored pairs from a completed labelled
 * evaluation it answers: where, if anywhere, does a cosine threshold
 * separate SIMILAR from DIFFERENT, and how badly do the two classes
 * overlap.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not choose a production threshold, does not write to any
 * recommendation path, and does not declare a model fit for use. It
 * reports numbers and names the ones that are degenerate. Picking a
 * threshold is a decision for a human, on data larger than this.
 *
 * SAME IS HELD OUT
 * ----------------
 * SAME pairs are summarised but are NEVER fed into the binary sweep.
 * SAME is a near-duplicate check, not the recommendation question, and
 * folding it into SIMILAR would inflate every metric here. Keeping it
 * out is the whole point of splitting the labels three ways.
 */

/** The three ground-truth labels. Anything else is not analysable. */
export type AnalysisLabel = 'SAME' | 'SIMILAR' | 'DIFFERENT'

/** The minimum a pair must provide to take part. */
export interface AnalysablePair {
  trackA?: string
  trackB?: string
  label: string
  cosine?: number | null
}

/** One pair accepted into the analysis. */
export interface ScoredPair {
  trackA: string
  trackB: string
  label: AnalysisLabel
  cosine: number
}

/** Pairs that could not be used, and why. */
export interface ExcludedPair {
  index: number
  label: string
  cosine: number | null
  reason: 'UNKNOWN_LABEL' | 'MISSING_COSINE' | 'NON_FINITE_COSINE' | 'OUT_OF_RANGE'
}

export interface PartitionResult {
  same: ScoredPair[]
  similar: ScoredPair[]
  different: ScoredPair[]
  excluded: ExcludedPair[]
  /** Pairs supplied, including the ones that were excluded. */
  inputCount: number
  /** Pairs that survived validation. */
  usableCount: number
}

/**
 * Cosine similarity of two unit vectors is bounded by [-1, 1]. A value
 * outside that is not a rounding artefact, it means something upstream
 * is wrong, so it is excluded and counted rather than clamped.
 */
const COSINE_MIN = -1
const COSINE_MAX = 1

/** A hair of tolerance for values that are 1.0 plus float noise. */
const COSINE_EPSILON = 1e-9

function isAnalysisLabel(v: string): v is AnalysisLabel {
  return v === 'SAME' || v === 'SIMILAR' || v === 'DIFFERENT'
}

/**
 * Splits scored pairs by ground truth, rejecting anything unusable.
 *
 * Rejection is explicit and counted. A pair with no cosine is not
 * silently treated as 0, which would place it at the bottom of the
 * DIFFERENT range and quietly improve every metric.
 */
export function partitionPairs(pairs: readonly AnalysablePair[]): PartitionResult {
  const same: ScoredPair[] = []
  const similar: ScoredPair[] = []
  const different: ScoredPair[] = []
  const excluded: ExcludedPair[] = []

  pairs.forEach((p, index) => {
    const rawLabel = String(p.label ?? '').trim().toUpperCase()
    const c = p.cosine

    if (!isAnalysisLabel(rawLabel)) {
      excluded.push({
        index,
        label: rawLabel,
        cosine: typeof c === 'number' ? c : null,
        reason: 'UNKNOWN_LABEL',
      })
      return
    }
    if (c === null || c === undefined) {
      excluded.push({ index, label: rawLabel, cosine: null, reason: 'MISSING_COSINE' })
      return
    }
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      excluded.push({ index, label: rawLabel, cosine: null, reason: 'NON_FINITE_COSINE' })
      return
    }
    if (c < COSINE_MIN - COSINE_EPSILON || c > COSINE_MAX + COSINE_EPSILON) {
      excluded.push({ index, label: rawLabel, cosine: c, reason: 'OUT_OF_RANGE' })
      return
    }

    const row: ScoredPair = {
      trackA: String(p.trackA ?? ''),
      trackB: String(p.trackB ?? ''),
      label: rawLabel,
      cosine: c,
    }
    if (rawLabel === 'SAME') same.push(row)
    else if (rawLabel === 'SIMILAR') similar.push(row)
    else different.push(row)
  })

  return {
    same,
    similar,
    different,
    excluded,
    inputCount: pairs.length,
    usableCount: same.length + similar.length + different.length,
  }
}

// --------------------------------------------------------------------
// Distributions
// --------------------------------------------------------------------

export interface DistributionStats {
  label: AnalysisLabel | string
  count: number
  min: number
  max: number
  mean: number
  median: number
  p10: number
  p25: number
  p75: number
  p90: number
  /** Population standard deviation; context for the mean. */
  stdDev: number
}

/**
 * Linear-interpolated percentile (the R-7 / NumPy default).
 *
 * The method is named because percentiles are not unique: nearest-rank
 * would give different P10/P90 on 60-odd samples, and a reader
 * comparing these numbers to another tool needs to know which was used.
 */
export function percentile(sortedAsc: readonly number[], q: number): number {
  const n = sortedAsc.length
  if (n === 0) return Number.NaN
  if (n === 1) return sortedAsc[0]!
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]!
  return sortedAsc[lo]! + (pos - lo) * (sortedAsc[hi]! - sortedAsc[lo]!)
}

export function describe(label: string, values: readonly number[]): DistributionStats {
  const n = values.length
  if (n === 0) {
    return {
      label,
      count: 0,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      median: Number.NaN,
      p10: Number.NaN,
      p25: Number.NaN,
      p75: Number.NaN,
      p90: Number.NaN,
      stdDev: Number.NaN,
    }
  }
  const s = [...values].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / n
  const variance = s.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / n
  return {
    label,
    count: n,
    min: s[0]!,
    max: s[n - 1]!,
    mean,
    median: percentile(s, 0.5),
    p10: percentile(s, 0.1),
    p25: percentile(s, 0.25),
    p75: percentile(s, 0.75),
    p90: percentile(s, 0.9),
    stdDev: Math.sqrt(variance),
  }
}

// --------------------------------------------------------------------
// Threshold sweep
// --------------------------------------------------------------------

export interface ThresholdRow {
  threshold: number
  tp: number
  fp: number
  tn: number
  fn: number
  /** TP / (TP + FP). NaN when nothing is predicted SIMILAR. */
  precision: number
  /** TP / (TP + FN). NaN when there are no SIMILAR pairs. */
  recall: number
  /** Harmonic mean of precision and recall. NaN when either is NaN. */
  f1: number
  /** (TP + TN) / total. */
  accuracy: number
  /** How many pairs the rule calls SIMILAR at this threshold. */
  predictedPositive: number
  /** |precision - recall|; the balance measure. NaN if either is NaN. */
  balanceGap: number
}

/**
 * The decision rule, stated once so it cannot drift between the sweep
 * and the reported picks: a pair is predicted SIMILAR when its cosine
 * is GREATER THAN OR EQUAL TO the threshold.
 *
 * SIMILAR is the positive class. At threshold 0.00 every pair is
 * predicted SIMILAR, so recall is 1 by construction — that row is real,
 * but it is not a finding, and `isDegenerate` marks it.
 */
export const SWEEP_RULE = 'predict SIMILAR when cosine >= threshold'

export interface SweepOptions {
  /** Inclusive lower bound. Default 0. */
  from?: number
  /** Inclusive upper bound. Default 1. */
  to?: number
  /** Step. Default 0.01. */
  step?: number
}

/**
 * Sweeps the threshold and scores SIMILAR (positive) against DIFFERENT
 * (negative).
 *
 * Thresholds are generated from integer counts and then divided, not
 * accumulated by repeated addition: adding 0.01 a hundred times drifts
 * to 0.9999999999999999 and would silently produce 100 rows where 101
 * were asked for.
 */
export function sweepThresholds(
  similar: readonly number[],
  different: readonly number[],
  options: SweepOptions = {},
): ThresholdRow[] {
  const from = options.from ?? 0
  const to = options.to ?? 1
  const step = options.step ?? 0.01
  if (!(step > 0)) throw new Error('sweepThresholds: step must be positive')
  if (to < from) throw new Error('sweepThresholds: `to` must be >= `from`')

  const steps = Math.round((to - from) / step)
  const total = similar.length + different.length
  const rows: ThresholdRow[] = []

  for (let i = 0; i <= steps; i++) {
    // Rebuild from the index every time; never accumulate.
    const threshold = from + (i * step)
    // Snap to the step's own precision so 0.7000000000000001 is 0.7.
    const decimals = decimalsOf(step)
    const t = Number(threshold.toFixed(decimals))

    let tp = 0
    let fn = 0
    for (const c of similar) {
      if (c >= t) tp++
      else fn++
    }
    let fp = 0
    let tn = 0
    for (const c of different) {
      if (c >= t) fp++
      else tn++
    }

    const predictedPositive = tp + fp
    const precision = predictedPositive === 0 ? Number.NaN : tp / predictedPositive
    const recall = (tp + fn) === 0 ? Number.NaN : tp / (tp + fn)
    const f1 = (!Number.isFinite(precision) || !Number.isFinite(recall) || (precision + recall) === 0)
      ? (Number.isFinite(precision) && Number.isFinite(recall) ? 0 : Number.NaN)
      : (2 * precision * recall) / (precision + recall)
    const accuracy = total === 0 ? Number.NaN : (tp + tn) / total
    const balanceGap = (Number.isFinite(precision) && Number.isFinite(recall))
      ? Math.abs(precision - recall)
      : Number.NaN

    rows.push({
      threshold: t,
      tp,
      fp,
      tn,
      fn,
      precision,
      recall,
      f1,
      accuracy,
      predictedPositive,
      balanceGap,
    })
  }
  return rows
}

function decimalsOf(step: number): number {
  const s = String(step)
  const dot = s.indexOf('.')
  if (dot < 0) return 0
  // Guard against exponent notation like 1e-3.
  if (s.includes('e') || s.includes('E')) return 10
  return Math.min(s.length - dot - 1, 10)
}

// --------------------------------------------------------------------
// Picking rows out of the sweep
// --------------------------------------------------------------------

export interface ThresholdPick {
  criterion: string
  row: ThresholdRow | null
  /** How many thresholds tie on this criterion. */
  tieCount: number
  /**
   * True when the pick is an artefact of the metric rather than a
   * finding — e.g. recall 1.0 at threshold 0, or precision 1.0 from a
   * single prediction.
   */
  isDegenerate: boolean
  /** Plain-language reason the pick is degenerate, or null. */
  degenerateReason: string | null
}

/**
 * Minimum predictions before a precision figure is treated as
 * meaningful. Precision 1.0 from one lucky pair is not a threshold.
 */
export const MIN_SUPPORT_FOR_PRECISION = 5

function pick(
  rows: readonly ThresholdRow[],
  criterion: string,
  better: (a: ThresholdRow, b: ThresholdRow) => number,
  eligible: (r: ThresholdRow) => boolean,
): ThresholdPick {
  const usable = rows.filter(eligible)
  if (usable.length === 0) {
    return { criterion, row: null, tieCount: 0, isDegenerate: false, degenerateReason: null }
  }
  const sorted = [...usable].sort(better)
  const best = sorted[0]!
  const tieCount = sorted.filter(r => better(r, best) === 0).length
  return { criterion, row: best, tieCount, isDegenerate: false, degenerateReason: null }
}

function flagDegenerate(p: ThresholdPick, similarCount: number): ThresholdPick {
  const r = p.row
  if (!r) return p
  const reasons: string[] = []
  if (r.threshold <= 0 && r.fn === 0 && r.tn === 0) {
    reasons.push('every pair is predicted SIMILAR at this threshold, so recall is 1 by construction')
  }
  if (r.predictedPositive > 0 && r.predictedPositive < MIN_SUPPORT_FOR_PRECISION) {
    reasons.push(`only ${r.predictedPositive} pair(s) are predicted SIMILAR, too few to trust the precision`)
  }
  if (r.tp === 0) {
    reasons.push('no SIMILAR pair is retrieved at all')
  }
  if (similarCount > 0 && r.tp === similarCount && r.fp === 0 && reasons.length === 0) {
    // Perfect separation. Not degenerate, but worth not glossing over.
    return p
  }
  return reasons.length === 0
    ? p
    : { ...p, isDegenerate: true, degenerateReason: reasons.join('; ') }
}

export interface ThresholdPicks {
  bestF1: ThresholdPick
  bestBalance: ThresholdPick
  highestPrecision: ThresholdPick
  highestRecall: ThresholdPick
}

/**
 * Reports the notable thresholds.
 *
 * Ties are broken deterministically and the tie count is reported, so a
 * "best threshold" that is one of forty equally good ones cannot be
 * read as a precise number.
 */
export function findPicks(rows: readonly ThresholdRow[], similarCount: number): ThresholdPicks {
  const fin = (v: number) => Number.isFinite(v)

  // Best F1. Tie-break toward the higher threshold, which retrieves
  // less and is the more conservative of two equal options.
  const bestF1 = flagDegenerate(
    pick(
      rows,
      'highest F1',
      (a, b) => (b.f1 - a.f1) || (b.threshold - a.threshold),
      r => fin(r.f1),
    ),
    similarCount,
  )

  // Balance. Smallest |precision - recall|, requiring both to exist and
  // something to actually be retrieved.
  const bestBalance = flagDegenerate(
    pick(
      rows,
      'closest precision/recall balance',
      (a, b) => (a.balanceGap - b.balanceGap) || (b.f1 - a.f1),
      r => fin(r.balanceGap) && r.tp > 0,
    ),
    similarCount,
  )

  // Highest precision, among thresholds that predict enough to mean
  // anything. Tie-break toward higher recall.
  const highestPrecision = flagDegenerate(
    pick(
      rows,
      'highest precision',
      (a, b) => (b.precision - a.precision) || (b.recall - a.recall),
      r => fin(r.precision) && r.predictedPositive >= MIN_SUPPORT_FOR_PRECISION,
    ),
    similarCount,
  )

  // Highest recall. Tie-break toward higher precision, which is what
  // stops this from always landing on threshold 0.00.
  const highestRecall = flagDegenerate(
    pick(
      rows,
      'highest recall',
      (a, b) => (b.recall - a.recall) || (b.precision - a.precision) || (b.threshold - a.threshold),
      r => fin(r.recall),
    ),
    similarCount,
  )

  return { bestF1, bestBalance, highestPrecision, highestRecall }
}

// --------------------------------------------------------------------
// Overlap
// --------------------------------------------------------------------

export interface OverlapAnalysis {
  /** [lo, hi] cosine interval the two classes share, or null. */
  interval: [number, number] | null
  /** Width of that interval; 0 when the ranges are disjoint. */
  width: number
  /** SIMILAR pairs sitting inside the DIFFERENT range. */
  similarInsideDifferentRange: number
  /** DIFFERENT pairs sitting inside the SIMILAR range. */
  differentInsideSimilarRange: number
  /**
   * Both of the above over all SIMILAR+DIFFERENT pairs. This is the
   * same definition the device-side SeparationAnalysis already uses,
   * kept identical so the two numbers can be compared.
   */
  overlapFraction: number
  overlapPercent: number
  /**
   * Rank-based separability: the chance a random SIMILAR pair scores
   * above a random DIFFERENT pair, ties counting half. 0.5 is chance.
   */
  auc: number
  /** Mean(SIMILAR) - mean(DIFFERENT). */
  meanGap: number
  /**
   * Best accuracy any single threshold achieves, and the accuracy of
   * always guessing the larger class. If the first does not beat the
   * second, a threshold adds nothing.
   */
  bestAccuracy: number
  majorityClassAccuracy: number
}

/**
 * Rank-based AUC with tie correction (Mann-Whitney U).
 *
 * Mirrors the device implementation in LabeledPairEvaluation.kt so the
 * offline number and the on-device number agree.
 */
export function rankAuc(higher: readonly number[], lower: readonly number[]): number {
  if (higher.length === 0 || lower.length === 0) return Number.NaN
  const combined = [
    ...higher.map(v => ({ v, isHigher: true })),
    ...lower.map(v => ({ v, isHigher: false })),
  ].sort((a, b) => a.v - b.v)

  const ranks = new Array<number>(combined.length)
  let i = 0
  while (i < combined.length) {
    let j = i
    while (j + 1 < combined.length && combined[j + 1]!.v === combined[i]!.v) j++
    const avg = (i + j + 2) / 2 // 1-based ranks, tie group shares the mean
    for (let k = i; k <= j; k++) ranks[k] = avg
    i = j + 1
  }

  let rankSumHigher = 0
  for (let k = 0; k < combined.length; k++) {
    if (combined[k]!.isHigher) rankSumHigher += ranks[k]!
  }
  const n1 = higher.length
  const n2 = lower.length
  const u = rankSumHigher - (n1 * (n1 + 1)) / 2
  return u / (n1 * n2)
}

export function analyseOverlap(
  similar: readonly number[],
  different: readonly number[],
  rows: readonly ThresholdRow[],
): OverlapAnalysis {
  const empty = similar.length === 0 || different.length === 0
  if (empty) {
    return {
      interval: null,
      width: Number.NaN,
      similarInsideDifferentRange: 0,
      differentInsideSimilarRange: 0,
      overlapFraction: Number.NaN,
      overlapPercent: Number.NaN,
      auc: Number.NaN,
      meanGap: Number.NaN,
      bestAccuracy: Number.NaN,
      majorityClassAccuracy: Number.NaN,
    }
  }

  const sMin = Math.min(...similar)
  const sMax = Math.max(...similar)
  const dMin = Math.min(...different)
  const dMax = Math.max(...different)

  const lo = Math.max(sMin, dMin)
  const hi = Math.min(sMax, dMax)
  const width = Math.max(hi - lo, 0)
  const interval: [number, number] | null = width > 0 ? [lo, hi] : null

  const sInD = similar.filter(v => v >= dMin && v <= dMax).length
  const dInS = different.filter(v => v >= sMin && v <= sMax).length
  const totalPairs = similar.length + different.length
  const overlapFraction = (sInD + dInS) / totalPairs

  const meanS = similar.reduce((a, b) => a + b, 0) / similar.length
  const meanD = different.reduce((a, b) => a + b, 0) / different.length

  const accuracies = rows.map(r => r.accuracy).filter(Number.isFinite)
  const bestAccuracy = accuracies.length ? Math.max(...accuracies) : Number.NaN
  const majorityClassAccuracy = Math.max(similar.length, different.length) / totalPairs

  return {
    interval,
    width,
    similarInsideDifferentRange: sInD,
    differentInsideSimilarRange: dInS,
    overlapFraction,
    overlapPercent: overlapFraction * 100,
    auc: rankAuc(similar, different),
    meanGap: meanS - meanD,
    bestAccuracy,
    majorityClassAccuracy,
  }
}

// --------------------------------------------------------------------
// Top-level
// --------------------------------------------------------------------

export interface TypicalRange {
  /** The P25..P75 band: where the middle half of the class sits. */
  interquartile: [number, number] | null
  /** The P10..P90 band. */
  centralEighty: [number, number] | null
  full: [number, number] | null
}

export interface ThresholdAnalysis {
  partition: PartitionResult
  /** SAME, reported and held out of the sweep. */
  sameStats: DistributionStats
  similarStats: DistributionStats
  differentStats: DistributionStats
  similarRange: TypicalRange
  differentRange: TypicalRange
  sweep: ThresholdRow[]
  picks: ThresholdPicks
  overlap: OverlapAnalysis
  /** SAME vs the rest, for context only. Never part of the sweep. */
  sameVsSimilarAuc: number
  sameVsDifferentAuc: number
  /** True when there is enough of both classes to say anything at all. */
  analysable: boolean
  /** Reasons the analysis is weak or impossible. */
  caveats: string[]
}

function rangeOf(s: DistributionStats): TypicalRange {
  if (s.count === 0) return { interquartile: null, centralEighty: null, full: null }
  return {
    interquartile: [s.p25, s.p75],
    centralEighty: [s.p10, s.p90],
    full: [s.min, s.max],
  }
}

/** Below this many pairs in a class, percentiles are noise. */
export const MIN_CLASS_SIZE = 10

/**
 * Runs the whole analysis over already-scored pairs.
 *
 * The input is pair results that exist. Nothing here regenerates them.
 */
export function analyseThresholds(
  pairs: readonly AnalysablePair[],
  options: SweepOptions = {},
): ThresholdAnalysis {
  const partition = partitionPairs(pairs)
  const sameV = partition.same.map(p => p.cosine)
  const similarV = partition.similar.map(p => p.cosine)
  const differentV = partition.different.map(p => p.cosine)

  const sweep = sweepThresholds(similarV, differentV, options)
  const picks = findPicks(sweep, similarV.length)
  const overlap = analyseOverlap(similarV, differentV, sweep)

  const sameStats = describe('SAME', sameV)
  const similarStats = describe('SIMILAR', similarV)
  const differentStats = describe('DIFFERENT', differentV)

  const caveats: string[] = []
  if (similarV.length === 0) caveats.push('No SIMILAR pairs: the binary analysis cannot run.')
  if (differentV.length === 0) caveats.push('No DIFFERENT pairs: the binary analysis cannot run.')
  if (similarV.length > 0 && similarV.length < MIN_CLASS_SIZE) {
    caveats.push(`Only ${similarV.length} SIMILAR pairs; percentiles are unstable below ${MIN_CLASS_SIZE}.`)
  }
  if (differentV.length > 0 && differentV.length < MIN_CLASS_SIZE) {
    caveats.push(`Only ${differentV.length} DIFFERENT pairs; percentiles are unstable below ${MIN_CLASS_SIZE}.`)
  }
  if (partition.excluded.length > 0) {
    caveats.push(`${partition.excluded.length} pair(s) were excluded as unusable and are not in any figure.`)
  }
  if (Number.isFinite(overlap.bestAccuracy) && Number.isFinite(overlap.majorityClassAccuracy)
    && overlap.bestAccuracy <= overlap.majorityClassAccuracy) {
    caveats.push(
      'No threshold beats always guessing the larger class, so cosine adds no usable signal here.',
    )
  }

  return {
    partition,
    sameStats,
    similarStats,
    differentStats,
    similarRange: rangeOf(similarStats),
    differentRange: rangeOf(differentStats),
    sweep,
    picks,
    overlap,
    sameVsSimilarAuc: rankAuc(sameV, similarV),
    sameVsDifferentAuc: rankAuc(sameV, differentV),
    analysable: similarV.length > 0 && differentV.length > 0,
    caveats,
  }
}

// --------------------------------------------------------------------
// Interpretation
// --------------------------------------------------------------------

/**
 * How much signal is present, as a coarse band.
 *
 * This is a DESCRIPTION OF THE MEASUREMENT, not a recommendation and
 * not a production decision. The bands come from AUC, which is the
 * least threshold-dependent thing available: 0.5 is chance, and a
 * value below 0.5 means the score is ordering the classes backwards.
 */
export type SignalVerdict =
  | 'NO_SIGNAL'
  | 'INVERTED'
  | 'WEAK'
  | 'MODERATE'
  | 'STRONG'
  | 'INSUFFICIENT_DATA'

export interface SignalAssessment {
  verdict: SignalVerdict
  auc: number
  /** One sentence a human can read. */
  summary: string
  /**
   * Always true here. This module never authorises production use; the
   * field exists so a caller cannot accidentally read a verdict as a
   * go-ahead.
   */
  analysisOnly: true
}

export function assessSignal(a: ThresholdAnalysis): SignalAssessment {
  const auc = a.overlap.auc
  if (!a.analysable || !Number.isFinite(auc)) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      auc,
      summary: 'Not enough labelled pairs in both classes to measure separability.',
      analysisOnly: true,
    }
  }
  // Distance from chance in either direction.
  let verdict: SignalVerdict
  if (auc < 0.45) verdict = 'INVERTED'
  else if (auc < 0.55) verdict = 'NO_SIGNAL'
  else if (auc < 0.65) verdict = 'WEAK'
  else if (auc < 0.8) verdict = 'MODERATE'
  else verdict = 'STRONG'

  const pct = (auc * 100).toFixed(1)
  const summary = {
    INVERTED: `AUC ${auc.toFixed(4)}: the score orders the classes BACKWARDS — DIFFERENT pairs tend to score HIGHER than SIMILAR ones. A threshold cannot fix a sign error.`,
    NO_SIGNAL: `AUC ${auc.toFixed(4)}: indistinguishable from chance (0.5). Cosine carries no usable SIMILAR/DIFFERENT signal on this data.`,
    WEAK: `AUC ${auc.toFixed(4)}: a ${pct}% chance a SIMILAR pair outranks a DIFFERENT one. Better than chance, too weak to threshold reliably.`,
    MODERATE: `AUC ${auc.toFixed(4)}: usable ordering, with substantial overlap still present.`,
    STRONG: `AUC ${auc.toFixed(4)}: the classes are well separated on this data.`,
    INSUFFICIENT_DATA: '',
  }[verdict]

  return { verdict, auc, summary, analysisOnly: true }
}

/** Formats a range as "0.31–0.58", or a dash when absent. */
export function formatRange(r: [number, number] | null, digits = 3): string {
  if (!r || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) return '—'
  return `${r[0].toFixed(digits)}–${r[1].toFixed(digits)}`
}
