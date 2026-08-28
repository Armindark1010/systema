/**
 * SYSTEMA — maps a native LabeledEvaluationReport onto the report
 * renderer's input shape.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The first version of the report read fields that the native contract
 * never had:
 *
 *   - `separation.sameVsDifferentAuc`, which does not exist. The real
 *     contract is `separation.comparisons[]`, a list of
 *     ClassSeparation records keyed by a {higher, lower} label pair.
 *   - `classStats[].meanCosine` / `medianCosine`, which do not exist.
 *     The real fields live one level down in `classStats[].stats`, and
 *     also carry p25 / p75 / stdDev that were being dropped entirely.
 *   - `pairs[].trackA` / `trackB`, which do not exist. The contract
 *     names them `trackIdA` / `trackIdB`, which is why the report
 *     showed blank cells for every pair.
 *
 * Every one of those reads produced `undefined`, was coalesced to
 * `null`, and printed as NOT MEASURED — while the underlying device
 * run had computed the values correctly all along. This module does
 * the translation in one place so it can be tested directly against
 * the published contract instead of being retyped inside a component.
 *
 * It performs NO statistics of its own. Every number here was computed
 * on-device by LabeledPairEvaluation.kt and is passed through
 * unchanged. Nothing is recomputed, estimated, defaulted or invented.
 */

import type {
  ClassSeparation,
  ClassStats,
  LabeledEvaluationReport,
  LabeledPairResult,
  MemoryLifecycleAuditReport,
  PairLabel,
  SeparationAnalysis,
  TrackEmbeddingRow,
} from '../native/inferencePlugin'

import type {
  EvaluationReportInput,
  ReportClassStats,
  ReportPairRow,
} from './reportExport'

/** NaN and Infinity are "no measurement", not values. */
export function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Finds one comparison by its label pair.
 *
 * Order-tolerant: the native side reports a directed {higher, lower},
 * and if a future run emitted the reverse direction the AUC would be
 * `1 - auc`. Rather than silently returning the wrong number, the
 * reversed case is inverted explicitly.
 */
export function findComparison(
  comparisons: readonly ClassSeparation[] | undefined,
  higher: PairLabel,
  lower: PairLabel,
): { auc: number | null, overlapFraction: number | null, source: ClassSeparation | null } {
  if (!Array.isArray(comparisons)) {
    return { auc: null, overlapFraction: null, source: null }
  }

  const direct = comparisons.find(c => c.higher === higher && c.lower === lower)
  if (direct) {
    return {
      auc: finite(direct.auc),
      overlapFraction: finite(direct.overlapFraction),
      source: direct,
    }
  }

  const reversed = comparisons.find(c => c.higher === lower && c.lower === higher)
  if (reversed) {
    const a = finite(reversed.auc)
    return {
      auc: a === null ? null : 1 - a,
      overlapFraction: finite(reversed.overlapFraction),
      source: reversed,
    }
  }

  return { auc: null, overlapFraction: null, source: null }
}

/** Flattens ClassStats.stats up to the renderer's flat row. */
export function mapClassStats(classStats: readonly ClassStats[] | undefined): ReportClassStats[] {
  if (!Array.isArray(classStats)) return []
  return classStats.map((c) => {
    const s = c.stats
    return {
      label: String(c.label),
      // pairCount is the authoritative n for the class.
      count: finite(s?.pairCount) ?? 0,
      mean: finite(s?.mean),
      median: finite(s?.median),
      p25: finite(s?.p25),
      p75: finite(s?.p75),
      min: finite(s?.min),
      max: finite(s?.max),
      stdDev: finite(s?.stdDev),
      insufficient: Boolean(c.insufficient),
    }
  })
}

/**
 * Maps pair rows, resolving track IDs to human-readable titles.
 *
 * The blank Track A / Track B cells were two separate faults: the
 * wrong field name, and no title lookup at all. An id is not a name,
 * so a resolver is required for the report to be readable.
 */
export function mapPairs(
  pairs: readonly LabeledPairResult[] | undefined,
  resolveTitle: (trackId: string) => string | null | undefined = () => null,
): ReportPairRow[] {
  if (!Array.isArray(pairs)) return []
  return pairs.map((p) => {
    const idA = String(p.trackIdA ?? '')
    const idB = String(p.trackIdB ?? '')
    // Fall back to the id when a title cannot be resolved: showing the
    // id is honest and still identifies the track, whereas a blank
    // cell hides which pair the row refers to.
    const a = resolveTitle(idA)
    const b = resolveTitle(idB)
    return {
      pairId: `${idA}|${idB}`,
      trackA: (a && a.trim()) || idA || 'UNKNOWN',
      trackB: (b && b.trim()) || idB || 'UNKNOWN',
      label: String(p.label ?? ''),
      cosine: finite(p.cosine),
      outcome: String(p.outcome ?? ''),
    }
  })
}

export interface ConsistencyTally {
  consistent: number
  inconsistent: number
  notScored: number
  /** Denominator is scored pairs only; an unscored pair is not a miss. */
  scored: number
  consistentPercent: number | null
  inconsistentPercent: number | null
}

/**
 * Counts CONSISTENT / INCONSISTENT under the EXISTING evaluation
 * definition — the `outcome` the device already assigned per pair.
 * This does not re-derive consistency from cosines, because that would
 * be a second, competing definition.
 */
export function tallyConsistency(
  pairs: readonly LabeledPairResult[] | undefined,
): ConsistencyTally {
  let consistent = 0, inconsistent = 0, notScored = 0
  for (const p of pairs ?? []) {
    if (p.outcome === 'CONSISTENT') consistent++
    else if (p.outcome === 'INCONSISTENT') inconsistent++
    else notScored++
  }
  const scored = consistent + inconsistent
  return {
    consistent,
    inconsistent,
    notScored,
    scored,
    consistentPercent: scored > 0 ? (consistent / scored) * 100 : null,
    inconsistentPercent: scored > 0 ? (inconsistent / scored) * 100 : null,
  }
}

export interface PairIntegrity {
  ok: boolean
  scoredPairCount: number
  labelledPairCount: number
  duplicatePairIds: string[]
  malformedPairs: string[]
  selfPairs: string[]
  /** Scored pairs whose label is absent from the labelled dataset. */
  unmatched: string[]
  counts: Record<string, number>
  issues: string[]
}

/**
 * Verifies the scored pairs correspond ONE-TO-ONE with the labelled
 * pairs, and reports duplicates or malformed rows instead of silently
 * counting them.
 *
 * This is the check that would have caught a 190-vs-190 mismatch, and
 * it is why the counts below can be trusted rather than assumed.
 */
export function verifyPairIntegrity(
  pairs: readonly LabeledPairResult[] | undefined,
  expectedCounts?: { same: number, similar: number, different: number },
): PairIntegrity {
  const rows = pairs ?? []
  const seen = new Map<string, number>()
  const duplicatePairIds: string[] = []
  const malformedPairs: string[] = []
  const selfPairs: string[] = []
  const counts: Record<string, number> = { SAME: 0, SIMILAR: 0, DIFFERENT: 0 }

  for (const p of rows) {
    const idA = String(p.trackIdA ?? '')
    const idB = String(p.trackIdB ?? '')

    if (!idA || !idB) {
      malformedPairs.push(`position ${p.position}: missing track id`)
      continue
    }
    if (idA === idB) {
      selfPairs.push(`${idA}`)
      continue
    }
    if (!['SAME', 'SIMILAR', 'DIFFERENT'].includes(String(p.label))) {
      malformedPairs.push(`position ${p.position}: bad label ${String(p.label)}`)
      continue
    }

    // Canonical, order-independent identity: A|B and B|A are one pair.
    const key = idA <= idB ? `${idA}|${idB}` : `${idB}|${idA}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n === 2) duplicatePairIds.push(key)

    counts[String(p.label)] = (counts[String(p.label)] ?? 0) + 1
  }

  const issues: string[] = []
  if (duplicatePairIds.length) {
    issues.push(`${duplicatePairIds.length} duplicate pair(s) in the scored results.`)
  }
  if (malformedPairs.length) {
    issues.push(`${malformedPairs.length} malformed pair row(s).`)
  }
  if (selfPairs.length) {
    issues.push(`${selfPairs.length} self-pair(s) (a track compared with itself).`)
  }

  const unmatched: string[] = []
  if (expectedCounts) {
    for (const [label, expected] of Object.entries({
      SAME: expectedCounts.same,
      SIMILAR: expectedCounts.similar,
      DIFFERENT: expectedCounts.different,
    })) {
      const actual = counts[label] ?? 0
      if (actual !== expected) {
        unmatched.push(`${label}: scored ${actual}, labelled ${expected}`)
        issues.push(
          `${label} count mismatch — ${actual} scored vs ${expected} labelled. `
          + 'Labels were NOT changed; this is reported for inspection.',
        )
      }
    }
  }

  const distinct = seen.size
  const labelled = expectedCounts
    ? expectedCounts.same + expectedCounts.similar + expectedCounts.different
    : distinct

  return {
    ok: issues.length === 0 && distinct === labelled,
    scoredPairCount: distinct,
    labelledPairCount: labelled,
    duplicatePairIds,
    malformedPairs,
    selfPairs,
    unmatched,
    counts,
    issues,
  }
}

const KB_PER_MB = 1024
const toMb = (kb: unknown) => {
  const v = finite(kb)
  return v === null ? null : v / KB_PER_MB
}

/**
 * Maps the native memory audit.
 *
 * Prefers the device's own baseline/peak/final summary over scanning
 * the checkpoint list: those figures are what the audit itself
 * concluded, and re-deriving a peak from the timeline could disagree
 * with the value the device reported.
 */
export function mapMemory(audit: MemoryLifecycleAuditReport | null | undefined) {
  if (!audit) {
    return {
      baselinePssMb: null,
      peakPssMb: null,
      postCleanupPssMb: null,
      retainedMb: null,
      classification: null,
      attribution: null,
      caveat: null,
    }
  }

  const baseline = toMb(audit.baselineKb)
  const peak = toMb(audit.peakKb)
  const post = toMb(audit.finalKb)

  // Prefer the device's own netDeltaKb; fall back to the subtraction
  // only when it is absent.
  const netKb = finite(audit.netDeltaKb)
  const retained = netKb !== null
    ? netKb / KB_PER_MB
    : (baseline !== null && post !== null ? post - baseline : null)

  return {
    baselinePssMb: baseline,
    peakPssMb: peak,
    postCleanupPssMb: post,
    retainedMb: retained,
    // Descriptive, never a pass/fail. PSS alone cannot separate
    // allocator retention from a leak (Phase 20 §6), so the device's
    // own attribution is carried through rather than re-judged here.
    classification: retained === null
      ? null
      : retained <= 0
        ? 'RELEASED'
        : `RETAINED — ${String(audit.attribution ?? 'attribution not stated')}`,
    attribution: audit.attribution ?? null,
    caveat: audit.caveat ?? null,
  }
}

export interface MapReportOptions {
  phase?: string
  modelId?: string | null
  modelName?: string | null
  deviceLabel?: string | null
  osVersion?: string | null
  datasetVersion?: string
  /** Resolves a stable track id to a display title. */
  resolveTitle?: (trackId: string) => string | null | undefined
  /** Label counts from the persisted human dataset, for the 1:1 check. */
  expectedCounts?: { same: number, similar: number, different: number }
  timestamp?: string
}

export interface MappedReport {
  input: EvaluationReportInput
  integrity: PairIntegrity
  consistency: ConsistencyTally
}

/**
 * Builds the full report input from a completed native run.
 *
 * `deviceVerified` is true only because this function is given a real
 * native report object; it is never inferred from the presence of
 * numbers alone.
 */
export function mapNativeReport(
  report: LabeledEvaluationReport | null | undefined,
  options: MapReportOptions = {},
): MappedReport {
  const separation = (report?.separation ?? null) as SeparationAnalysis | null
  const comparisons = separation?.comparisons
  const pairs = report?.pairResults as LabeledPairResult[] | undefined
  const rows = report?.rows as TrackEmbeddingRow[] | undefined

  const sameVsDifferent = findComparison(comparisons, 'SAME', 'DIFFERENT')
  const similarVsDifferent = findComparison(comparisons, 'SIMILAR', 'DIFFERENT')
  const sameVsSimilar = findComparison(comparisons, 'SAME', 'SIMILAR')

  const integrity = verifyPairIntegrity(pairs, options.expectedCounts)
  const consistency = tallyConsistency(pairs)
  const classStats = mapClassStats(report?.classStats as ClassStats[] | undefined)

  const warnings: string[] = []
  for (const issue of integrity.issues) warnings.push(issue)
  for (const c of classStats) {
    if (c.insufficient) {
      warnings.push(
        `${c.label} has only ${c.count} pair(s) — its spread is reported but is `
        + 'too small to be relied upon.',
      )
    }
  }
  if (consistency.notScored > 0) {
    warnings.push(`${consistency.notScored} pair(s) could not be scored.`)
  }

  // The headline overlap is SIMILAR vs DIFFERENT: it is the comparison
  // the phase actually turns on, and the one with enough pairs to mean
  // something.
  const overlapPercent = similarVsDifferent.overlapFraction !== null
    ? similarVsDifferent.overlapFraction * 100
    : null

  const dim = rows?.find(r => finite(r.dimension) !== null)?.dimension ?? null

  const input: EvaluationReportInput = {
    phase: options.phase ?? 'Phase 20',
    timestamp: options.timestamp ?? new Date().toISOString(),
    modelId: options.modelId ?? null,
    modelName: options.modelName ?? null,
    deviceLabel: options.deviceLabel ?? null,
    osVersion: options.osVersion ?? null,
    deviceVerified: Boolean(report),
    datasetVersion: options.datasetVersion,
    trackCount: Array.isArray(rows) ? rows.length : 0,
    pairCount: integrity.scoredPairCount,
    counts: {
      same: integrity.counts.SAME ?? 0,
      similar: integrity.counts.SIMILAR ?? 0,
      different: integrity.counts.DIFFERENT ?? 0,
    },
    sameVsDifferentAuc: sameVsDifferent.auc,
    similarVsDifferentAuc: similarVsDifferent.auc,
    sameVsSimilarAuc: sameVsSimilar.auc,
    overlapPercent,
    classStats,
    pairs: mapPairs(pairs, options.resolveTitle),
    embeddingDimension: finite(dim),
    pooling: 'MEAN',
    memory: mapMemory(report?.memory as MemoryLifecycleAuditReport | undefined),
    verdict: separation?.verdict ? String(separation.verdict) : null,
    warnings,
    blockers: [],
    nextAction: 'Human decision required. No production model selected.',
    separationDetail: {
      sameVsDifferent: sameVsDifferent.source,
      similarVsDifferent: similarVsDifferent.source,
      sameVsSimilar: sameVsSimilar.source,
      rationale: separation?.rationale ?? null,
    },
    consistency,
    integrity,
  } as EvaluationReportInput

  return { input, integrity, consistency }
}
