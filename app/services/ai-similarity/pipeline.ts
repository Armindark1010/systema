/**
 * SYSTEMA — AI similarity pipeline (Phase 22).
 *
 *   Audio A ─┐
 *            ├─> AudioEmbeddingProvider ─> Embedding ─┐
 *   Audio B ─┘                                        ├─> SimilarityEngine
 *                                                     ┘        │
 *                                                              v
 *                                                      SimilarityResult
 *                                                              │
 *                                                              v
 *                                              optional persistence / logging
 *
 * This file names no model. It takes a provider and an engine, both as
 * interfaces, so replacing CLAP means constructing the pipeline with a
 * different provider and changing nothing here.
 *
 * NO THRESHOLD IS APPLIED unless the caller supplies one, and any
 * threshold a caller supplies is recorded as EXPERIMENTAL. The raw
 * cosine is always preserved: every classification we might want later
 * can be recomputed from it, and none of them can be recovered if we
 * store only a label.
 */

import {
  type SimilarityEngine,
  SimilarityError,
  cosineEngine,
} from './similarity'
import {
  type AudioEmbeddingProvider,
  type AudioInput,
  type Embedding,
  type EmbeddingSummary,
  type SimilarityFailure,
  type SimilarityOutcome,
  type SimilarityPrediction,
} from './types'

/** Optional experimental classification settings. */
export interface ExperimentalClassification {
  /**
   * Cosine at or above which a pair is called SIMILAR.
   *
   * EXPERIMENTAL. The 190-pair benchmark's best-F1 point was 0.65, but
   * that is a candidate from one run on one device with 83.3% class
   * overlap, not a production decision. There is deliberately no
   * default: a caller that wants a classification must state the number
   * it is using, so it appears in the record next to the score.
   */
  experimentalThreshold: number
}

export interface ComparePairOptions {
  /** Applies an explicitly experimental classification. Optional. */
  classification?: ExperimentalClassification
  /** Ground truth, when a human has actually labelled this pair. */
  groundTruth?: 'SAME' | 'SIMILAR' | 'DIFFERENT' | null
}

function summarise(e: Embedding, trackId: string): EmbeddingSummary {
  return {
    trackId,
    dimension: e.dimension,
    normalised: e.normalised,
    inferenceMs: e.inferenceMs,
  }
}

/**
 * Classifies a cosine against an experimental threshold.
 *
 * Exported so the rule is stated exactly once and can be tested
 * directly. `>=` matches the sweep rule the Phase 21.4 analysis used,
 * so a prediction recorded here means the same thing the threshold
 * sweep meant.
 */
export function classify(cosine: number, experimentalThreshold: number): SimilarityPrediction {
  return cosine >= experimentalThreshold ? 'SIMILAR' : 'DIFFERENT'
}

/**
 * The pipeline.
 *
 * Holds a provider and an engine and knows nothing else. Constructed
 * with whichever provider is current.
 */
export class SimilarityPipeline {
  constructor(
    private readonly provider: AudioEmbeddingProvider,
    private readonly engine: SimilarityEngine = cosineEngine,
  ) {}

  get modelId(): string {
    return this.provider.id
  }

  /**
   * Embeds two tracks and compares them.
   *
   * Never throws. Every failure becomes an explained SimilarityFailure
   * carrying the model identity, so a failed comparison is still a
   * usable diagnostic record rather than a lost one.
   */
  async comparePair(
    a: AudioInput,
    b: AudioInput,
    options: ComparePairOptions = {},
  ): Promise<SimilarityOutcome> {
    const started = Date.now()
    const t0 = now()
    const version = this.provider.version

    const fail = (
      code: SimilarityFailure['code'],
      message: string,
      failedTrackId?: string,
    ): SimilarityFailure => ({
      ok: false,
      model: this.provider.id,
      modelVersion: this.provider.version,
      trackIdA: a?.trackId ?? '',
      trackIdB: b?.trackId ?? '',
      code,
      message,
      failedTrackId,
      createdAt: new Date(started).toISOString(),
      experimental: true,
    })

    if (!a?.trackId || !b?.trackId) {
      return fail('MISSING_AUDIO', 'Two tracks are required to compare a pair.')
    }

    // Sequential, not parallel. Both embeddings come from ONE loaded
    // native session guarded by a mutex; issuing them concurrently
    // would serialise on that lock anyway while doubling peak memory.
    const ra = await this.provider.embed(a)
    if (!ra.ok) {
      return fail(ra.code, `Track A ("${a.trackId}"): ${ra.message}`, a.trackId)
    }
    const rb = await this.provider.embed(b)
    if (!rb.ok) {
      return fail(rb.code, `Track B ("${b.trackId}"): ${rb.message}`, b.trackId)
    }

    let cosine: number
    try {
      cosine = this.engine.cosine(ra.embedding.vector, rb.embedding.vector)
    } catch (e) {
      const detail = e instanceof SimilarityError ? `${e.code}: ${e.message}` : String(e)
      return fail('SIMILARITY_FAILED', `Could not compare the embeddings — ${detail}`)
    }

    return {
      ok: true,
      // Taken from the embeddings rather than the provider, so the
      // record describes what actually produced the vectors.
      model: ra.embedding.model,
      modelVersion: ra.embedding.modelVersion || version,
      trackIdA: a.trackId,
      trackIdB: b.trackId,
      cosine,
      embeddingA: summarise(ra.embedding, a.trackId),
      embeddingB: summarise(rb.embedding, b.trackId),
      totalMs: now() - t0,
      createdAt: new Date(started).toISOString(),
      experimental: true,
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}
