/**
 * SYSTEMA — single-track analysis (Phase 22.1).
 *
 * WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
 * -----------------------------------------------------
 * The Full Player shows ONE track. Cosine similarity is a relationship
 * between TWO embeddings — it has no meaning for a single song. There
 * is no reference embedding in the player session, and picking one
 * (the previous track, a queue neighbour, an arbitrary song) would
 * manufacture a number that looks like a measurement and is not.
 *
 * So this module runs the half of the pipeline that IS valid for one
 * track: it generates the embedding and reports what was actually
 * produced — model, version, dimension, normalisation, timing. Cosine
 * is reported as UNAVAILABLE with the reason, not as 0, not as a
 * plausible-looking float.
 *
 * When a reference IS supplied, the full pipeline runs and a real
 * cosine comes back. The UI does not decide this; it just renders
 * whichever result it is handed.
 *
 * MODEL-AGNOSTIC. This file names no model. It takes a provider.
 */

import type { SimilarityPipeline } from './pipeline'
import {
  type SimilarityObservation,
  canonicalPairId,
  recordObservation,
} from './store'
import type {
  AudioEmbeddingProvider,
  AudioInput,
  EmbeddingFailureCode,
} from './types'

/** Why a cosine could not be produced for a single track. */
export const NO_REFERENCE_REASON
  = 'Similarity compares two tracks. This analysis embedded one track, so there '
    + 'is no second embedding to measure against. Cosine needs a reference.'

/** What a completed single-track analysis produced. */
export interface TrackAnalysisResult {
  ok: true
  trackId: string
  model: string
  modelVersion: string
  dimension: number
  normalised: boolean
  inferenceMs: number
  /**
   * The similarity score, or NULL when no reference track was given.
   *
   * Null is the honest answer for a single track. It is never 0: zero
   * is a real cosine meaning "orthogonal", and reporting it here would
   * be a fabricated measurement.
   */
  cosine: number | null
  /** Present when `cosine` is null. Explains what is missing. */
  cosineUnavailableReason: string | null
  /** The track compared against, when there was one. */
  referenceTrackId: string | null
  /** True for every provider currently available. */
  experimental: true
  createdAt: string
}

export interface TrackAnalysisFailure {
  ok: false
  trackId: string
  code: EmbeddingFailureCode | 'SIMILARITY_FAILED'
  message: string
  model: string
  modelVersion: string
  experimental: true
  createdAt: string
}

export type TrackAnalysisOutcome = TrackAnalysisResult | TrackAnalysisFailure

export interface AnalyseTrackOptions {
  /**
   * Optional reference track. When supplied, the full pair pipeline
   * runs and a real cosine is produced. When absent, only the
   * embedding is generated.
   */
  reference?: AudioInput | null
  /** Persist the observation. Defaults to true. */
  persist?: boolean
  /** Pipeline used when a reference is supplied. */
  pipeline?: SimilarityPipeline | null
}

let counter = 0
function nextId(): string {
  counter += 1
  return `trk-${Date.now().toString(36)}-${counter.toString(36)}`
}

/**
 * Embeds one track, optionally comparing it against a reference.
 *
 * Never throws. Never fabricates a score. A failure to embed is
 * reported as a failure, not as an empty or zero result.
 */
export async function analyseTrack(
  provider: AudioEmbeddingProvider,
  track: AudioInput,
  options: AnalyseTrackOptions = {},
): Promise<TrackAnalysisOutcome> {
  const persist = options.persist ?? true
  const createdAt = new Date().toISOString()

  const fail = (
    code: TrackAnalysisFailure['code'],
    message: string,
  ): TrackAnalysisFailure => ({
    ok: false,
    trackId: track?.trackId ?? '',
    code,
    message,
    model: provider.id,
    modelVersion: provider.version,
    experimental: true,
    createdAt,
  })

  if (!track || !track.trackId) {
    return fail('MISSING_AUDIO', 'No track was supplied, or it had no id.')
  }

  // ---- PAIR PATH -------------------------------------------------
  // A reference makes a real cosine possible, so use the existing
  // pipeline rather than reimplementing comparison here.
  const reference = options.reference
  if (reference && reference.trackId && options.pipeline) {
    const outcome = await options.pipeline.comparePair(track, reference, {})
    if (!outcome.ok) {
      return fail(outcome.code, outcome.message)
    }
    const result: TrackAnalysisResult = {
      ok: true,
      trackId: track.trackId,
      model: outcome.model,
      modelVersion: outcome.modelVersion,
      dimension: outcome.embeddingA.dimension,
      normalised: outcome.embeddingA.normalised,
      inferenceMs: outcome.embeddingA.inferenceMs,
      cosine: outcome.cosine,
      cosineUnavailableReason: null,
      referenceTrackId: reference.trackId,
      experimental: true,
      createdAt: outcome.createdAt,
    }
    if (persist) {
      recordObservation({
        id: nextId(),
        pairId: canonicalPairId(track.trackId, reference.trackId),
        trackIdA: track.trackId,
        trackIdB: reference.trackId,
        model: outcome.model,
        modelVersion: outcome.modelVersion,
        cosine: outcome.cosine,
        prediction: null,
        experimentalThreshold: null,
        // Never fabricated. A player analysis has no human label.
        groundTruth: null,
        createdAt: outcome.createdAt,
        experimental: true,
      })
    }
    return result
  }

  // ---- SINGLE-TRACK PATH -----------------------------------------
  const embedded = await provider.embed(track)
  if (!embedded.ok) {
    return fail(embedded.code, embedded.message)
  }

  const e = embedded.embedding
  const result: TrackAnalysisResult = {
    ok: true,
    trackId: track.trackId,
    model: e.model,
    modelVersion: e.modelVersion,
    dimension: e.dimension,
    normalised: e.normalised,
    inferenceMs: e.inferenceMs,
    // NOT zero. There is nothing to compare against.
    cosine: null,
    cosineUnavailableReason: NO_REFERENCE_REASON,
    referenceTrackId: null,
    experimental: true,
    createdAt,
  }

  if (persist) {
    // Recorded so the embedding attempt is not lost, with the pair
    // fields collapsed onto the single track and a null score. The
    // existing `toAnalysablePairs` filter drops null-cosine and
    // null-groundTruth records, so this cannot leak into evaluation.
    const observation: SimilarityObservation = {
      id: nextId(),
      pairId: canonicalPairId(track.trackId, track.trackId),
      trackIdA: track.trackId,
      trackIdB: track.trackId,
      model: e.model,
      modelVersion: e.modelVersion,
      cosine: null,
      prediction: null,
      experimentalThreshold: null,
      groundTruth: null,
      createdAt,
      experimental: true,
    }
    recordObservation(observation)
  }

  return result
}
