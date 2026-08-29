/**
 * SYSTEMA — semantic model evaluation (Phase 29).
 *
 * Compares MODEL PREDICTIONS against HUMAN LABELS to answer the only
 * question this phase exists to answer: is this model worth keeping?
 *
 * WHY MULTI-LABEL METRICS ARE NOT OPTIONAL
 * ----------------------------------------
 * The mood head emits 56 independent sigmoids and a track can genuinely
 * be `melancholic` AND `calm` AND `emotional`. Ordinary accuracy is
 * meaningless there, and worse, it is meaningless in a flattering
 * direction: predict "no" for all 56 labels on a track with 3 true
 * labels and per-label accuracy is 53/56 = 95%. A model that predicts
 * nothing at all would score 95% and look excellent.
 *
 * So multi-label fields report per-example precision, recall and F1,
 * where predicting nothing scores zero recall — which is the truth.
 * Single-label fields (voice/instrumental is softmax over two mutually
 * exclusive classes) use top-1 accuracy, which IS appropriate there.
 *
 * The distinction is driven by the head's declared `multiLabel` flag,
 * not by guessing from the field name.
 *
 * NOT ENOUGH DATA IS A RESULT
 * ---------------------------
 * With four labelled tracks, any F1 is noise. Every metric here reports
 * its sample size and refuses to compute below a minimum, returning an
 * explicit "not enough labelled data" state instead of a number that
 * would be quoted later as if it meant something.
 */

import type { SemanticField } from '../music-semantics/types'
import type { DatasetRecord } from './datasetRecord'
import type { SemanticAnalysis } from './semanticRecord'

/**
 * Below this many labelled examples, no metric is reported.
 *
 * Not a statistically derived threshold — it is a guard against
 * quoting a number computed from three tracks. Raise it as the dataset
 * grows.
 */
export const MIN_LABELLED_FOR_METRICS = 10

/**
 * Score above which a multi-label prediction counts as "predicted".
 *
 * EXPERIMENTAL and configurable. Deliberately NOT named
 * `productionThreshold` and deliberately not tuned: picking the value
 * that maximises F1 on the same data you then report F1 on is how you
 * fool yourself. The raw scores are always preserved, so any threshold
 * can be re-applied later.
 */
export const DEFAULT_EXPERIMENTAL_THRESHOLD = 0.1

export interface FieldCoverage {
  field: SemanticField
  /** Rows with a model prediction for this field. */
  analysed: number
  /** Rows with a human label for this field. */
  labelled: number
  /** Rows with BOTH — the only rows a metric can use. */
  evaluable: number
  /** evaluable / analysed, or null when nothing was analysed. */
  coverage: number | null
}

export interface MultiLabelMetrics {
  kind: 'multi-label'
  field: SemanticField
  samples: number
  /** Mean over examples of |predicted ∩ true| / |predicted|. */
  precision: number
  /** Mean over examples of |predicted ∩ true| / |true|. */
  recall: number
  /** Harmonic mean of the two means. */
  f1: number
  /** Fraction of examples where the top-1 prediction was a true label. */
  topOneHit: number
  /** Fraction where ANY of the top 3 was a true label. */
  topThreeHit: number
  threshold: number
}

export interface SingleLabelMetrics {
  kind: 'single-label'
  field: SemanticField
  samples: number
  topOneAccuracy: number
  /** Per-class counts: label -> { predicted, actual, correct }. */
  confusion: Record<string, { predicted: number, actual: number, correct: number }>
}

export interface InsufficientData {
  kind: 'insufficient'
  field: SemanticField
  samples: number
  required: number
  message: string
}

export type FieldMetrics = MultiLabelMetrics | SingleLabelMetrics | InsufficientData

/**
 * How a human label maps onto model vocabulary for one field.
 *
 * REQUIRED, never inferred. SYSTEMA's mood list and the model's 56
 * mood/theme tags are different vocabularies: `energetic` exists in
 * both, `nostalgic` exists only in ours, `corporate` only in theirs.
 * Comparing them without a written mapping would silently count every
 * unmapped label as a miss and make the model look worse than it is.
 *
 * The mapping is data, declared here, reviewable, and reported
 * alongside the metrics.
 */
export interface LabelMapping {
  field: SemanticField
  /** human label -> equivalent model labels (may be several). */
  humanToModel: Record<string, string[]>
  /** Human labels with no model equivalent. Excluded from metrics. */
  unmappable: string[]
}

/**
 * Mood mapping between SYSTEMA's human vocabulary and MTG-Jamendo's.
 *
 * Only genuine equivalences. Where the model has no comparable tag the
 * human label is listed as unmappable rather than forced onto the
 * nearest-sounding word — `nostalgic` is not `retro`, and pretending
 * otherwise would fabricate agreement.
 */
export const MOOD_LABEL_MAPPING: LabelMapping = {
  field: 'mood',
  humanToModel: {
    happy: ['happy'],
    sad: ['sad'],
    calm: ['calm', 'relaxing'],
    energetic: ['energetic'],
    melancholic: ['melancholic'],
    romantic: ['romantic', 'love'],
    dark: ['dark'],
    uplifting: ['uplifting', 'hopeful'],
  },
  // `angry`, `nostalgic` and `neutral` have no MTG-Jamendo equivalent.
  // Listed so their absence is visible rather than silently a miss.
  unmappable: ['angry', 'nostalgic', 'neutral'],
}

/** Vocal mapping. The model's two classes line up cleanly here. */
export const VOCAL_LABEL_MAPPING: LabelMapping = {
  field: 'vocalInstrumental',
  humanToModel: {
    vocal: ['voice'],
    instrumental: ['instrumental'],
  },
  // 'mixed' has no model equivalent: the head is binary softmax.
  unmappable: ['mixed'],
}

// ---------------------------------------------------------------------

function labelsAbove(
  semantic: SemanticAnalysis,
  field: SemanticField,
  threshold: number,
): string[] {
  const head = semantic.heads.find(h => h.field === field)
  if (!head) return []
  return head.predictions.filter(p => p.score >= threshold).map(p => p.label)
}

function rankedLabels(semantic: SemanticAnalysis, field: SemanticField): string[] {
  const head = semantic.heads.find(h => h.field === field)
  if (!head) return []
  return [...head.predictions].sort((a, b) => b.score - a.score).map(p => p.label)
}

/** Human labels for a field, translated into model vocabulary. */
function mappedHumanLabels(record: DatasetRecord, mapping: LabelMapping): string[] {
  const gt = record.groundTruth
  const raw: string[] = mapping.field === 'mood'
    ? gt.moods
    : mapping.field === 'vocalInstrumental'
      ? (gt.vocal ? [gt.vocal] : [])
      : mapping.field === 'genre'
        ? gt.genres
        : []

  const out = new Set<string>()
  for (const h of raw) {
    for (const m of mapping.humanToModel[h] ?? []) out.add(m)
  }
  return [...out]
}

/** Rows carrying both a prediction and a usable human label. */
function evaluableRows(
  records: readonly DatasetRecord[],
  semanticOf: (r: DatasetRecord) => SemanticAnalysis | null,
  mapping: LabelMapping,
): { predicted: SemanticAnalysis, truth: string[] }[] {
  const out: { predicted: SemanticAnalysis, truth: string[] }[] = []
  for (const r of records) {
    const s = semanticOf(r)
    if (!s) continue
    if (!s.heads.some(h => h.field === mapping.field)) continue
    const truth = mappedHumanLabels(r, mapping)
    if (truth.length === 0) continue
    out.push({ predicted: s, truth })
  }
  return out
}

export function computeCoverage(
  records: readonly DatasetRecord[],
  semanticOf: (r: DatasetRecord) => SemanticAnalysis | null,
  mapping: LabelMapping,
): FieldCoverage {
  let analysed = 0
  let labelled = 0
  let evaluable = 0

  for (const r of records) {
    const s = semanticOf(r)
    const hasPrediction = Boolean(s?.heads.some(h => h.field === mapping.field))
    const hasLabel = mappedHumanLabels(r, mapping).length > 0
    if (hasPrediction) analysed++
    if (hasLabel) labelled++
    if (hasPrediction && hasLabel) evaluable++
  }

  return {
    field: mapping.field,
    analysed,
    labelled,
    evaluable,
    coverage: analysed > 0 ? evaluable / analysed : null,
  }
}

/**
 * Multi-label precision / recall / F1, averaged per example.
 *
 * Per-example (not micro-averaged over all label slots) because
 * micro-averaging over 56 mostly-negative labels is dominated by true
 * negatives and flatters a silent model.
 */
export function evaluateMultiLabel(
  records: readonly DatasetRecord[],
  semanticOf: (r: DatasetRecord) => SemanticAnalysis | null,
  mapping: LabelMapping,
  threshold: number = DEFAULT_EXPERIMENTAL_THRESHOLD,
): MultiLabelMetrics | InsufficientData {
  const rows = evaluableRows(records, semanticOf, mapping)

  if (rows.length < MIN_LABELLED_FOR_METRICS) {
    return {
      kind: 'insufficient',
      field: mapping.field,
      samples: rows.length,
      required: MIN_LABELLED_FOR_METRICS,
      message: 'Not enough labelled data',
    }
  }

  let pSum = 0
  let rSum = 0
  let top1 = 0
  let top3 = 0

  for (const { predicted, truth } of rows) {
    const truthSet = new Set(truth)
    const chosen = labelsAbove(predicted, mapping.field, threshold)
    const hits = chosen.filter(l => truthSet.has(l)).length

    // Predicting nothing scores zero precision AND zero recall. It must
    // not score 1.0 precision on an empty set, which is the classic way
    // a silent model looks perfect.
    pSum += chosen.length > 0 ? hits / chosen.length : 0
    rSum += truthSet.size > 0 ? hits / truthSet.size : 0

    const ranked = rankedLabels(predicted, mapping.field)
    if (ranked[0] && truthSet.has(ranked[0])) top1++
    if (ranked.slice(0, 3).some(l => truthSet.has(l))) top3++
  }

  const n = rows.length
  const precision = pSum / n
  const recall = rSum / n
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return {
    kind: 'multi-label',
    field: mapping.field,
    samples: n,
    precision,
    recall,
    f1,
    topOneHit: top1 / n,
    topThreeHit: top3 / n,
    threshold,
  }
}

/**
 * Top-1 accuracy plus a confusion breakdown.
 *
 * Only valid for mutually exclusive classes — i.e. a softmax head.
 */
export function evaluateSingleLabel(
  records: readonly DatasetRecord[],
  semanticOf: (r: DatasetRecord) => SemanticAnalysis | null,
  mapping: LabelMapping,
): SingleLabelMetrics | InsufficientData {
  const rows = evaluableRows(records, semanticOf, mapping)

  if (rows.length < MIN_LABELLED_FOR_METRICS) {
    return {
      kind: 'insufficient',
      field: mapping.field,
      samples: rows.length,
      required: MIN_LABELLED_FOR_METRICS,
      message: 'Not enough labelled data',
    }
  }

  const confusion: Record<string, { predicted: number, actual: number, correct: number }> = {}
  const bump = (label: string) => {
    confusion[label] ??= { predicted: 0, actual: 0, correct: 0 }
    return confusion[label] as { predicted: number, actual: number, correct: number }
  }

  let correct = 0
  for (const { predicted, truth } of rows) {
    const ranked = rankedLabels(predicted, mapping.field)
    const top = ranked[0]
    const actual = truth[0]
    if (!top || !actual) continue

    bump(top).predicted++
    bump(actual).actual++
    if (top === actual) {
      bump(top).correct++
      correct++
    }
  }

  return {
    kind: 'single-label',
    field: mapping.field,
    samples: rows.length,
    topOneAccuracy: correct / rows.length,
    confusion,
  }
}

/**
 * Evaluates a field using the metric its head's shape demands.
 *
 * Reads `multiLabel` off the stored head rather than assuming from the
 * field name, so a future single-label genre model is handled correctly
 * without editing this function.
 */
export function evaluateField(
  records: readonly DatasetRecord[],
  semanticOf: (r: DatasetRecord) => SemanticAnalysis | null,
  mapping: LabelMapping,
  threshold: number = DEFAULT_EXPERIMENTAL_THRESHOLD,
): FieldMetrics {
  const sample = records
    .map(semanticOf)
    .find(s => s?.heads.some(h => h.field === mapping.field))
  const head = sample?.heads.find(h => h.field === mapping.field)

  if (head && !head.multiLabel) {
    return evaluateSingleLabel(records, semanticOf, mapping)
  }
  return evaluateMultiLabel(records, semanticOf, mapping, threshold)
}
