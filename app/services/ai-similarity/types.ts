/**
 * SYSTEMA — model-agnostic AI similarity contracts (Phase 22).
 *
 * WHY THIS LAYER EXISTS
 * ---------------------
 * CLAP is an EXPERIMENTAL provider, not a chosen production model. The
 * 190-pair benchmark gave AUC 0.7720 with 83.3% SIMILAR/DIFFERENT
 * overlap: enough signal to keep experimenting, nowhere near enough to
 * commit to. So nothing above this file may name CLAP. Replacing the
 * model must mean writing one new provider and deleting one old one —
 * not touching the similarity engine, the pipeline, the storage or the
 * evaluation code.
 *
 * WHAT LIVES WHERE
 * ----------------
 *   types.ts        the contracts (this file). Knows no model.
 *   similarity.ts   cosine. Knows no model, no provider, no pipeline.
 *   pipeline.ts     audio -> provider -> similarity -> result.
 *   providers/      one file per model. Only these know a model exists.
 *   store.ts        persistence of scores. Knows no model.
 *
 * Dependencies point one way only: providers and the pipeline depend on
 * these contracts; the contracts depend on nothing.
 */

/**
 * Audio handed to a provider.
 *
 * This is deliberately the shape the app already has: a library track
 * carries an optional `uri`, present only for real device audio. Mock
 * catalogue tracks have none, and a provider must reject those rather
 * than invent an embedding for them.
 */
export interface AudioInput {
  /** Stable track identifier, used to tie a score back to a pair. */
  trackId: string
  /** Playable content:// URI. Absent for mock catalogue entries. */
  uri?: string
  /** Optional label for logs and debugging only; never used in logic. */
  title?: string
}

/** Why an embedding could not be produced. */
export type EmbeddingFailureCode =
  /** No audio was supplied, or it had no id. */
  | 'MISSING_AUDIO'
  /** The track has no playable URI (e.g. a mock catalogue entry). */
  | 'NO_AUDIO_SOURCE'
  /** The provider is not usable in this environment (e.g. no device). */
  | 'PROVIDER_UNAVAILABLE'
  /** The model is not loaded / validated / ready. */
  | 'PROVIDER_NOT_READY'
  /** Decode or inference failed inside the provider. */
  | 'INFERENCE_FAILED'
  /** Inference returned something that is not a usable vector. */
  | 'INVALID_EMBEDDING'

/**
 * A successfully produced embedding.
 *
 * `vector` is the real thing. A provider must never fabricate one, and
 * must never substitute a zero vector for a failure — a zero vector has
 * a defined cosine against everything and would silently pollute the
 * dataset we are collecting.
 */
export interface Embedding {
  /** Provider id, e.g. the registered model identifier. */
  model: string
  /**
   * Provider version. Must come from the model/graph itself, never
   * from a hand-written constant.
   */
  modelVersion: string
  /** The embedding. Length equals `dimension`. */
  vector: Float32Array
  dimension: number
  /** Whether the provider guarantees this vector is L2-normalised. */
  normalised: boolean
  /** Milliseconds spent producing it, for observability. */
  inferenceMs: number
  /** Free-form provider detail for debugging. Never used in logic. */
  detail?: Record<string, unknown>
}

/** The outcome of an embedding attempt. Success or failure, never both. */
export type EmbeddingResult =
  | { ok: true, embedding: Embedding }
  | {
    ok: false
    code: EmbeddingFailureCode
    /** Human-readable reason. Surfaced in the UI and logs. */
    message: string
    /** The provider that failed, when one was reached. */
    model?: string
    modelVersion?: string
  }

/**
 * Describes a provider without running it.
 *
 * `ready` is the honest answer to "can this actually embed right now",
 * which on a device means a model is loaded and validated. A provider
 * that is installed but not loaded is NOT ready, and saying so is the
 * difference between a clear error and a mysterious one.
 */
export interface ProviderStatus {
  id: string
  version: string
  available: boolean
  ready: boolean
  /** Why it is not ready, when it is not. */
  reason?: string
  /** Embedding width once known; -1 until a real forward pass proves it. */
  dimension: number
  /**
   * Always true for every provider we currently have. No model has been
   * approved for production; see the Phase 21.4 analysis.
   */
  experimental: boolean
}

/**
 * The model-agnostic embedding contract.
 *
 * Deliberately small. A provider owns its own preprocessing, because
 * preprocessing belongs to the model: CLAP wants 48 kHz waveform
 * windows, another model will want something else, and a caller that
 * owns preprocessing has to change every time the model does.
 */
export interface AudioEmbeddingProvider {
  readonly id: string
  readonly version: string
  /** Cheap, side-effect-free readiness check. */
  status(): Promise<ProviderStatus>
  /** Produces an embedding, or an explained failure. Never throws. */
  embed(audio: AudioInput): Promise<EmbeddingResult>
}

/**
 * An experimental classification of a cosine score.
 *
 * NOT a production decision. The threshold that produces this is
 * supplied by the caller and is explicitly labelled experimental; the
 * raw cosine is always preserved alongside it so that any future
 * threshold can be applied retrospectively to collected data.
 */
export type SimilarityPrediction = 'SIMILAR' | 'DIFFERENT'

/** Ground truth, when a human has actually labelled the pair. */
export type GroundTruth = 'SAME' | 'SIMILAR' | 'DIFFERENT'

/** A completed comparison of two tracks. */
export interface SimilarityResult {
  ok: true
  model: string
  modelVersion: string
  trackIdA: string
  trackIdB: string
  /** The raw score. Always preserved, never rounded away. */
  cosine: number
  embeddingA: EmbeddingSummary
  embeddingB: EmbeddingSummary
  /** Total wall time for both embeddings plus the comparison. */
  totalMs: number
  createdAt: string
  /** True for every provider we currently have. */
  experimental: true
}

/** A failed comparison, explained. */
export interface SimilarityFailure {
  ok: false
  model: string
  modelVersion: string
  trackIdA: string
  trackIdB: string
  code: EmbeddingFailureCode | 'SIMILARITY_FAILED'
  message: string
  /** Which side failed, when it was one side. */
  failedTrackId?: string
  createdAt: string
  experimental: true
}

export type SimilarityOutcome = SimilarityResult | SimilarityFailure

/**
 * What we keep about an embedding after the comparison.
 *
 * The raw vector is deliberately NOT here. A 512-float vector per track
 * in localStorage would be ~4 KB serialised as JSON, and the app's only
 * persistence is localStorage with a hard quota shared with the user's
 * library, playlists and playback state. The cosine is what evaluation
 * needs; the vector can be regenerated from the audio, which cannot be
 * said of the user's data we would evict to store it.
 */
export interface EmbeddingSummary {
  trackId: string
  dimension: number
  normalised: boolean
  inferenceMs: number
}
