/**
 * SYSTEMA — model-agnostic music semantic analysis contracts (Phase 29).
 *
 * WHY A SEPARATE LAYER FROM ai-similarity
 * ---------------------------------------
 * `ai-similarity` answers "how close are these two tracks?" and its
 * unit is a vector. This layer answers "what is this track?" and its
 * unit is a ranked list of labelled scores. Same shape of problem,
 * genuinely different contract — forcing semantics through the
 * embedding interface would mean pretending a 56-way sigmoid output is
 * an embedding, which it is not.
 *
 * NOTHING IN THIS FILE MAY NAME A MODEL.
 * No "essentia", no "jamendo", no "effnet". Those names appear only
 * inside providers/. That is what makes the model replaceable.
 *
 * WHAT A SCORE IS AND IS NOT
 * --------------------------
 * A score is the model's raw output for a label. It is NOT a
 * probability that the label is true, it is NOT calibrated, and for the
 * primary mood model it comes from a classifier with a published test
 * PR-AUC of 0.14. Scores are stored and displayed as the model's own
 * numbers so they can be evaluated against human labels later. They are
 * never rounded into a verdict, and never used to drive behaviour.
 */

/**
 * Audio handed to a semantic provider.
 *
 * Deliberately identical in shape to the similarity layer's AudioInput
 * so a caller can pass the same object to both. Kept as its own type
 * rather than imported: this layer must not depend on ai-similarity.
 */
export interface SemanticAudioInput {
  trackId: string
  /** Playable content:// URI. Absent for mock catalogue entries. */
  uri?: string
  /** For logs only. Never used in logic, never used as a label source. */
  title?: string
}

/**
 * The semantic fields this layer can carry.
 *
 * A field existing here does NOT mean any model produces it. Support is
 * declared per provider at runtime.
 */
export type SemanticField =
  | 'mood'
  | 'genre'
  | 'tags'
  | 'vocalInstrumental'
  | 'instrument'

/**
 * How a head's raw outputs are activated.
 *
 * This matters and is not cosmetic. A sigmoid head emits independent
 * per-label probabilities that need not sum to 1, so several labels can
 * legitimately be strong at once. A softmax head emits a distribution
 * over mutually exclusive classes. Reading one as the other silently
 * changes the meaning of every number: "top-1 accuracy" is meaningful
 * for softmax and misleading for multi-label sigmoid.
 */
export type SemanticActivation = 'sigmoid' | 'softmax'

/** One labelled model output. */
export interface SemanticPrediction {
  /** The model's own label string, verbatim. Never translated. */
  label: string
  /**
   * The model's raw output for that label, as produced.
   *
   * Not rescaled, not calibrated, not thresholded.
   */
  score: number
}

/**
 * Everything one classifier head produced for one track.
 *
 * `predictions` is the COMPLETE ranked output, not a top-k slice. The
 * whole point of the dataset is later evaluation, and you cannot
 * compute recall, PR-AUC or a confusion matrix from the top 3.
 */
export interface SemanticHeadResult {
  field: SemanticField
  /** Head identity, distinct from the embedding model's identity. */
  head: string
  headVersion: string
  activation: SemanticActivation
  /** True when several labels may be simultaneously correct. */
  multiLabel: boolean
  /** Number of classes the head emits. Lets truncation be detected. */
  classCount: number
  /** COMPLETE output, descending by score. */
  predictions: SemanticPrediction[]
}

/** Why a semantic analysis could not be produced. */
export type SemanticFailureCode =
  | 'MISSING_AUDIO'
  | 'NO_AUDIO_SOURCE'
  /** No provider is usable in this environment (e.g. running in a browser). */
  | 'PROVIDER_UNAVAILABLE'
  /** Weights are not imported / not loaded / not validated. */
  | 'PROVIDER_NOT_READY'
  | 'DECODE_FAILED'
  | 'INFERENCE_FAILED'
  /** Output shape did not match the declared taxonomy. */
  | 'INVALID_OUTPUT'

/**
 * A field the active provider cannot produce, and why.
 *
 * Stored WITH the result so a later reader can tell "the model does not
 * do this" from "this was lost". The UI renders these as explicitly
 * unsupported rather than hiding them, because an absent row looks
 * identical to a row the model scored zero on.
 */
export interface UnsupportedSemanticField {
  field: SemanticField
  reason: string
}

/**
 * The result of one semantic analysis pass.
 *
 * One audio decode, one embedding, many heads.
 */
export interface SemanticAnalysisResult {
  trackId: string

  /** Embedding/backbone model identity. */
  model: string
  modelVersion: string

  /**
   * Present only for fields the provider actually ran.
   *
   * Absent key === not produced. There is deliberately no "empty
   * result" placeholder, because an empty prediction list and a
   * missing field mean different things.
   */
  heads: SemanticHeadResult[]

  /** Declared-but-unavailable fields, with reasons. */
  unsupported: UnsupportedSemanticField[]

  /** Audio actually seen by the model. */
  sourceDurationSec: number | null
  processedDurationSec: number | null
  sampleRate: number | null

  decodeMs: number | null
  inferenceMs: number
  analyzedAt: string

  /**
   * ALWAYS true in this phase.
   *
   * Typed as the literal so a provider cannot claim production
   * readiness without a compile error.
   */
  experimental: true
}

export type SemanticAnalysisOutcome =
  | { ok: true, result: SemanticAnalysisResult }
  | {
    ok: false
    code: SemanticFailureCode
    /** Safe for display. Never a native stack trace, never a URI. */
    message: string
    /** Present when known; a failure may occur before identity is read. */
    model?: string
    modelVersion?: string
  }

/** Runtime readiness of a provider. */
export interface SemanticProviderStatus {
  /** The environment could host this provider (i.e. we are on device). */
  available: boolean
  /** Weights are imported, loaded and validated. */
  ready: boolean
  model: string | null
  modelVersion: string | null
  /** Fields this provider would produce if ready. */
  supports: SemanticField[]
  /** Plain-language reason when not ready. Shown to the user. */
  detail: string | null
}

/**
 * The contract every semantic provider implements.
 *
 * Deliberately tiny. A provider decodes audio, runs a model, and
 * returns labelled scores. It does not persist, does not cache, does
 * not decide what is "good enough", and does not know about the UI.
 */
export interface MusicSemanticAnalysisProvider {
  /** Stable id naming the model family, not a file. */
  readonly id: string

  status(): Promise<SemanticProviderStatus>

  analyze(input: SemanticAudioInput): Promise<SemanticAnalysisOutcome>

  /** Frees native resources. Safe to call when nothing is loaded. */
  release(): Promise<void>
}

// ---------------------------------------------------------------------
// Helpers — pure, model-agnostic
// ---------------------------------------------------------------------

/**
 * Sorts predictions by score, descending, WITHOUT truncating.
 *
 * Returns a new array; the caller's order is never mutated.
 */
export function rankPredictions(
  predictions: readonly SemanticPrediction[],
): SemanticPrediction[] {
  return [...predictions].sort((a, b) => b.score - a.score)
}

/**
 * The highest-scoring prediction, or null for an empty list.
 *
 * Returns null rather than a zero-score placeholder: a head that
 * produced nothing must not look like a head that scored everything 0.
 */
export function topPrediction(
  head: SemanticHeadResult | null | undefined,
): SemanticPrediction | null {
  if (!head || head.predictions.length === 0) return null
  return rankPredictions(head.predictions)[0] ?? null
}

/** The result for one field, or null when the provider did not run it. */
export function headFor(
  result: SemanticAnalysisResult | null | undefined,
  field: SemanticField,
): SemanticHeadResult | null {
  if (!result) return null
  return result.heads.find(h => h.field === field) ?? null
}

/**
 * Validates a head's output against its declared class count.
 *
 * A mismatch means the model file and the taxonomy disagree — usually a
 * wrong or re-exported model. That must surface as INVALID_OUTPUT
 * rather than being silently zipped against the wrong label names,
 * which would produce confident, wrongly-named predictions.
 */
export function isHeadConsistent(head: SemanticHeadResult): boolean {
  return head.predictions.length === head.classCount
}

/**
 * True when every score is inside the range its activation permits.
 *
 * Both sigmoid and softmax outputs are bounded to [0, 1]. Anything
 * outside means logits were read instead of activations.
 */
export function areScoresInRange(head: SemanticHeadResult): boolean {
  return head.predictions.every(p =>
    Number.isFinite(p.score) && p.score >= 0 && p.score <= 1)
}
