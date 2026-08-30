/**
 * SYSTEMA — semantic prediction storage (Phase 29).
 *
 * Extends the Phase 28 dataset record with model PREDICTIONS, kept
 * rigorously separate from human ground truth.
 *
 * WHY A SEPARATE FILE AND A SEPARATE FIELD
 * ----------------------------------------
 * A prediction and a label look identical once written down — both are
 * "mood: melancholic". The only thing that distinguishes them is where
 * they came from, and that distinction is the entire value of the
 * dataset. Merging them into one field would be a one-line change that
 * permanently destroys the ability to evaluate anything, because you
 * could no longer tell what the model said from what the human said.
 *
 * So: `groundTruth` is human-only and analysis never writes it;
 * `semantic` is model-only and a human edit never writes it. They are
 * different types with different shapes so that confusing them is a
 * type error rather than a subtle bug.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * Schema v1 rows have no `semantic` key. They read back as
 * `semantic: null`, which is a true statement about them — nothing is
 * migrated, nothing is invented, and a v1 row remains valid.
 */

import type { SemanticActivation, SemanticField } from '../music-semantics/types'

/** Bumped from 1 (Phase 28) — v2 adds the optional `semantic` region. */
export const DATASET_SCHEMA_VERSION_V2 = 2

export interface StoredPrediction {
  label: string
  score: number
}

/**
 * One head's complete output, as stored.
 *
 * `predictions` holds EVERY class the head emitted, not a top-k slice.
 * Top-k is a display choice; PR-AUC, recall and confusion matrices all
 * need the tail, and it cannot be recovered later without re-running
 * inference on audio the user may no longer have.
 */
export interface StoredSemanticHead {
  field: SemanticField
  head: string
  headVersion: string
  activation: SemanticActivation
  multiLabel: boolean
  classCount: number
  predictions: StoredPrediction[]
}

/**
 * The model-produced semantic region of a dataset row.
 *
 * Note there is no `mood: string` convenience field. A single winning
 * label would inevitably get read as fact somewhere, and for a model
 * with a published PR-AUC of 0.14 that would be actively misleading.
 * Callers that want a headline value compute it from the ranked list
 * and carry the score with it.
 */
export interface SemanticAnalysis {
  /** Embedding/backbone model identity. */
  model: string
  modelVersion: string
  /** Pipeline version, distinct from the model file version. */
  analyzerVersion: number

  heads: StoredSemanticHead[]

  /** Fields the provider could not produce, with reasons. */
  unsupported: { field: SemanticField, reason: string }[]

  /**
   * The real backbone embedding, when the provider produced one.
   *
   * Persisted because it is the actual model output in this phase and
   * because it is reusable: a classifier head added later can be run
   * over stored vectors without re-decoding every track.
   *
   * Optional so every row written before Phase 29.x stays valid — an
   * absent field means "not recorded", not "the model returned none".
   */
  embedding?: number[] | null
  embeddingDim?: number | null

  sourceDurationSec: number | null
  processedDurationSec: number | null
  sampleRate: number | null
  decodeMs: number | null
  inferenceMs: number | null

  analyzedAt: string

  /**
   * ALWAYS true. Typed as the literal so a future edit claiming
   * production readiness fails to compile.
   */
  experimental: true

  /**
   * Model output source. Always 'model'.
   *
   * The mirror of GroundTruthLabels.source === 'human'. Both regions
   * self-describe, so an exported file can be audited without knowing
   * which key it came from.
   */
  source: 'model'
}

/** The pipeline version for semantic analysis. Bump on shape changes. */
export const SEMANTIC_ANALYZER_VERSION = 1

/**
 * Structural guard for a semantic region read back from storage.
 *
 * Rejects rather than repairs. A malformed prediction set is not
 * something to patch up — it is evidence that something wrote the wrong
 * shape, and silently coercing it would hide that.
 */
export function isSemanticAnalysis(value: unknown): value is SemanticAnalysis {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>

  if (typeof s.model !== 'string' || !s.model) return false
  if (typeof s.modelVersion !== 'string') return false
  if (typeof s.analyzerVersion !== 'number') return false
  if (!Array.isArray(s.heads)) return false

  // A model prediction must never claim to be a human label.
  if (s.source !== 'model') return false
  if (s.experimental !== true) return false

  for (const raw of s.heads) {
    const h = raw as Record<string, unknown>
    if (!h || typeof h !== 'object') return false
    if (typeof h.head !== 'string' || !h.head) return false
    if (typeof h.headVersion !== 'string') return false
    if (typeof h.classCount !== 'number') return false
    if (!Array.isArray(h.predictions)) return false

    // The stored output must be complete. A truncated list would make
    // every later metric quietly wrong, so it is rejected outright.
    if (h.predictions.length !== h.classCount) return false

    for (const rawP of h.predictions) {
      const p = rawP as Record<string, unknown>
      if (!p || typeof p.label !== 'string' || !p.label) return false
      if (typeof p.score !== 'number' || !Number.isFinite(p.score)) return false
      // Activations are bounded. Out-of-range means logits were stored.
      if (p.score < 0 || p.score > 1) return false
    }
  }

  // THE EMBEDDING, WHEN PRESENT (Phase 29.x).
  //
  // Optional, because rows written before this phase have none and are
  // still valid. But if one IS present it must be a real vector: a
  // corrupt embedding stored here is indistinguishable from a good one
  // later, and it would silently poison every similarity computation
  // that reads it back.
  if (s.embedding !== undefined && s.embedding !== null) {
    if (!Array.isArray(s.embedding)) return false
    if (s.embedding.length === 0) return false
    if (!s.embedding.every(v => typeof v === 'number' && Number.isFinite(v))) return false
    // All-zero is the signature of a graph fed silence or an
    // uninitialised buffer, not of a track.
    if (s.embedding.every(v => v === 0)) return false
    // The recorded dimension must agree with the actual length, or a
    // truncated write would go undetected.
    if (s.embeddingDim !== undefined && s.embeddingDim !== null) {
      if (typeof s.embeddingDim !== 'number') return false
      if (s.embeddingDim !== s.embedding.length) return false
    }
  }
  else if (
    s.embeddingDim !== undefined
    && s.embeddingDim !== null
    && s.embeddingDim !== 0
  ) {
    // A dimension without a vector means the vector was lost in
    // transit. Better to reject than to store a claim with no data.
    return false
  }

  return true
}

/**
 * Normalises an untrusted semantic region.
 *
 * Returns null when it is not usable, so the row degrades to "no
 * semantic analysis" rather than carrying corrupt predictions.
 */
export function coerceSemanticAnalysis(value: unknown): SemanticAnalysis | null {
  if (!value) return null
  return isSemanticAnalysis(value) ? value : null
}

/** The highest-scoring prediction for a field, or null. */
export function topFor(
  semantic: SemanticAnalysis | null | undefined,
  field: SemanticField,
): StoredPrediction | null {
  const head = semantic?.heads.find(h => h.field === field)
  if (!head || head.predictions.length === 0) return null
  return head.predictions.reduce((best, p) => (p.score > best.score ? p : best))
}

/** The top `n` predictions for a field. Display helper only. */
export function topNFor(
  semantic: SemanticAnalysis | null | undefined,
  field: SemanticField,
  n: number,
): StoredPrediction[] {
  const head = semantic?.heads.find(h => h.field === field)
  if (!head) return []
  return [...head.predictions].sort((a, b) => b.score - a.score).slice(0, Math.max(0, n))
}

/**
 * True when a stored analysis came from this exact model build.
 *
 * Used for cache invalidation. Model version is part of the identity
 * because scores from two model builds are not comparable, and a mixed
 * dataset produces evaluation numbers that look fine and mean nothing.
 */
export function isSameSemanticBuild(
  stored: SemanticAnalysis | null | undefined,
  model: string,
  modelVersion: string,
  analyzerVersion: number = SEMANTIC_ANALYZER_VERSION,
): boolean {
  if (!stored) return false
  return stored.model === model
    && stored.modelVersion === modelVersion
    && stored.analyzerVersion === analyzerVersion
}
