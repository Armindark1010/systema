/**
 * SYSTEMA — single-track analysis service (Phase 24).
 *
 * Track -> embedding -> TrackAnalysis -> persistence.
 *
 * No second track. No cosine. Similarity is a downstream consumer of
 * the embedding this produces, not a precondition for producing it.
 *
 * WHAT IT WILL AND WILL NOT REPORT
 * --------------------------------
 * It reports what the device measured: the embedding, its dimension
 * and normalisation, the audio facts native returned, DSP features
 * when the Phase 13 analyser has already stored them, and timings.
 *
 * It reports NO mood, language, genre, tags or context suitability,
 * because no classifier for those exists in this repo. Those are
 * declared in `unsupported` with a reason instead of being guessed.
 */

import {
  type AnalysisDspFeatures,
  type TrackAnalysisFailureRecord,
  type TrackAnalysisRecord,
  UNSUPPORTED_SEMANTICS,
  isSameModelBuild,
} from './trackAnalysis'
import { loadAnalysis, saveAnalysis } from './trackAnalysisStore'
import type { AudioEmbeddingProvider, AudioInput } from './types'

/** Optional DSP lookup, injected so this module stays testable. */
export type DspLookup = (trackId: string) => Promise<AnalysisDspFeatures | null>

export interface AnalyseOptions {
  /** Skip the cache and run inference again. */
  force?: boolean
  /** Persist the result. Defaults to true. */
  persist?: boolean
  /** Reads stored Phase 13 DSP features. Optional. */
  dsp?: DspLookup
}

export type AnalyseOutcome =
  | { ok: true, record: TrackAnalysisRecord, fromCache: boolean, saveError?: string }
  | { ok: false, failure: TrackAnalysisFailureRecord }

/**
 * Analyses one track.
 *
 * Never throws. Never fabricates. A failure is reported as a failure,
 * never as an empty or zeroed result.
 */
export async function analyseSingleTrack(
  provider: AudioEmbeddingProvider,
  track: AudioInput,
  options: AnalyseOptions = {},
): Promise<AnalyseOutcome> {
  const persist = options.persist ?? true
  const force = options.force ?? false

  const fail = (
    code: TrackAnalysisFailureRecord['code'],
    message: string,
  ): AnalyseOutcome => ({
    ok: false,
    failure: {
      trackId: track?.trackId ?? '',
      code,
      message,
      model: { id: provider?.id ?? '', version: provider?.version ?? '' },
      failedAt: new Date().toISOString(),
    },
  })

  if (!track || !track.trackId) {
    return fail('MISSING_AUDIO', 'No track was supplied, or it had no id.')
  }

  // ---- CACHE ------------------------------------------------------
  // Identity is (trackId, model id, model version). A model version
  // change invalidates the cache rather than silently mixing vectors
  // from two builds, which would produce meaningless comparisons later.
  if (!force) {
    const cached = loadAnalysis(track.trackId)
    if (cached) {
      const status = await provider.status().catch(() => null)
      const currentVersion = status?.version ?? provider.version
      if (isSameModelBuild(cached, provider.id, currentVersion)) {
        return { ok: true, record: cached, fromCache: true }
      }
    }
  }

  // ---- EMBED ------------------------------------------------------
  const embedded = await provider.embed(track)
  if (!embedded.ok) {
    return fail(embedded.code, embedded.message)
  }

  const e = embedded.embedding
  const vector = Array.from(e.vector)

  // Provider-reported audio facts arrive in the generic `detail` bag,
  // so this layer stays model-agnostic: a provider that reports none
  // of them yields nulls rather than an error.
  const detail = (e.detail ?? {}) as Record<string, unknown>
  const num = (key: string): number | null => {
    const v = detail[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  // The provider already refuses empty, non-finite and all-zero
  // vectors. This is a last structural check before something enters
  // the dataset permanently.
  if (vector.length === 0) {
    return fail('INVALID_EMBEDDING', 'The model returned an empty embedding.')
  }

  // ---- DSP (measured, optional) -----------------------------------
  // Read-only: this never triggers a DSP run. If the Phase 13
  // analyser has not been run for this track, the field is null and
  // the UI says so, rather than showing an invented tempo.
  let dsp: AnalysisDspFeatures | null = null
  if (options.dsp) {
    try {
      dsp = await options.dsp(track.trackId)
    } catch {
      dsp = null
    }
  }

  const record: TrackAnalysisRecord = {
    trackId: track.trackId,
    model: { id: e.model, version: e.modelVersion, experimental: true },
    embedding: {
      // The RAW vector, kept in full. This is the dataset.
      vector,
      dimension: e.dimension,
      normalised: e.normalised,
      preNormL2: num('preNormL2'),
    },
    audio: {
      // -1 is how the device says "the container omitted it".
      durationSec: (num('sourceDurationSec') ?? -1) >= 0 ? num('sourceDurationSec') : null,
      processedDurationSec: num('processedDurationSec'),
      sourceSampleRate: num('sourceSampleRate'),
      modelSampleRate: num('audioSampleRate'),
      windowsProcessed: num('windowsProcessed'),
    },
    dsp,
    timings: {
      decodeMs: num('decodeMs'),
      inferenceMs: Number.isFinite(e.inferenceMs) ? e.inferenceMs : null,
      totalMs: num('totalProcessingMs'),
    },
    analyzedAt: new Date().toISOString(),
    unsupported: UNSUPPORTED_SEMANTICS,
    // Never fabricated. An automatic analysis has no human label.
    groundTruth: null,
  }

  let saveError: string | undefined
  if (persist) {
    const outcome = saveAnalysis(record)
    if (!outcome.ok) saveError = outcome.error
  }

  return { ok: true, record, fromCache: false, saveError }
}
