/**
 * SYSTEMA — single-track analysis contract (Phase 24).
 *
 * WHAT THIS IS
 * ------------
 * The domain shape for analysing ONE track. Similarity is a separate
 * concern: it consumes embeddings, it does not define them. Nothing
 * here requires a second track.
 *
 * THE RULE THAT SHAPES THIS FILE
 * ------------------------------
 * Every field is either backed by a real implementation on this device
 * or it is absent. There are no placeholder moods, no invented
 * languages, no guessed "good for driving". A field that no classifier
 * can produce is not modelled as `null` and rendered as a dash — it is
 * declared in `unsupported` so the UI can say plainly that the feature
 * does not exist yet.
 *
 * The repo currently has:
 *   - CLAP: a 512-d audio EMBEDDING. It is a vector, not a label. It
 *     carries no explicit mood/language/BPM field.
 *   - Phase 13 DSP: real measured tempo, loudness, dynamics, spectral
 *     shape. Measured, not predicted.
 * It has NO mood, language, genre, vocal or context classifier. The
 * `TrackAI` type in app/types is mock catalogue data (`makeLocalAI`)
 * and must never be presented as analysis output.
 */

import type { EmbeddingFailureCode } from './types'

/** Semantic fields a classifier would produce — none exist yet. */
export type SemanticFeature =
  | 'mood'
  | 'language'
  | 'genre'
  | 'tags'
  | 'vocalInstrumental'
  | 'danceability'
  | 'acousticness'
  | 'contextSuitability'

/**
 * Why a semantic feature is missing.
 *
 * Stored WITH the analysis so a future reader knows the field was
 * absent by design, not lost.
 */
export interface UnsupportedFeature {
  feature: SemanticFeature
  /** Plain-language reason. Shown to the user; never a stack trace. */
  reason: string
  /**
   * Set when a DIFFERENT subsystem addresses this field.
   *
   * The field remains unsupported by this analysis either way — this
   * only lets the UI say "see SEMANTIC" instead of "nothing exists".
   * It must never be read as a claim that a value is available here.
   */
  handledBy?: 'semantic-provider'
}

/**
 * The single source of truth for what is not implemented.
 *
 * Listed explicitly rather than inferred from `undefined`, so adding a
 * real classifier later is a deliberate edit here.
 */
/**
 * What the EMBEDDING analysis cannot tell you.
 *
 * Phase 29 added a separate semantic provider that targets some of
 * these fields. These entries are deliberately NOT deleted: they
 * describe this provider, and this provider still produces none of
 * them. A CLAP vector did not become a mood label because a different
 * model elsewhere can predict one.
 *
 * `handledBy` records where a field is addressed instead, so the UI can
 * point at the semantic sheet rather than implying nothing exists.
 * A field with `handledBy` set is still unsupported HERE.
 */
export const UNSUPPORTED_SEMANTICS: readonly UnsupportedFeature[] = [
  {
    feature: 'mood',
    reason: 'This analysis produces an embedding, not a mood label. A '
      + 'separate experimental semantic model predicts mood; its output '
      + 'is shown under SEMANTIC and is never merged into this section.',
    handledBy: 'semantic-provider',
  },
  {
    feature: 'language',
    reason: 'No language detector is implemented anywhere in the app. '
      + 'Lyrics are never transcribed on this device, and an artist or '
      + 'file name is not evidence of a language.',
  },
  {
    feature: 'genre',
    reason: 'Not produced by the embedding. Discogs-EffNet predicts '
      + 'Discogs styles (Discogs-400), not a universal genre taxonomy.',
    handledBy: 'semantic-provider',
  },
  {
    feature: 'tags',
    reason: 'Not produced by the embedding. A semantic tagging head '
      + 'exists but its official label vocabulary could not be '
      + 'retrieved, so it is disabled rather than guessed at.',
  },
  {
    feature: 'vocalInstrumental',
    reason: 'Not produced by the embedding. A separate experimental '
      + 'semantic model predicts vocal versus instrumental.',
    handledBy: 'semantic-provider',
  },
  { feature: 'danceability', reason: 'No danceability model is implemented.' },
  { feature: 'acousticness', reason: 'No acousticness model is implemented.' },
  {
    feature: 'contextSuitability',
    reason: 'Driving/workout/study/relaxing suitability needs a trained '
      + 'model or a validated rule set. Neither exists, and guessing '
      + 'from tempo or from a predicted mood would be a fabricated '
      + 'recommendation.',
  },
] as const

/** Identity of the model that produced an embedding. */
export interface AnalysisModel {
  id: string
  version: string
  /** True for every model currently available. No production model. */
  experimental: true
}

/** The raw model output. The embedding is preserved in full. */
export interface AnalysisEmbedding {
  /**
   * The RAW vector, all `dimension` values. Deliberately kept: it is
   * the actual dataset. Discarding it after rendering would mean
   * re-running inference to evaluate anything later.
   */
  vector: number[]
  dimension: number
  normalised: boolean
  /** L2 norm before normalisation, straight from the device. */
  preNormL2: number | null
}

/**
 * Facts about the audio, measured during inference.
 *
 * These are MEASUREMENTS reported by the native pipeline, not
 * predictions. `null` means the device did not report it.
 */
export interface AnalysisAudioFacts {
  /** The file's full duration in seconds. */
  durationSec: number | null
  /** Seconds actually embedded (windows overlap, so < duration). */
  processedDurationSec: number | null
  /** The file's own rate, before the decoder resampled it. */
  sourceSampleRate: number | null
  /** The rate the model actually saw. */
  modelSampleRate: number | null
  windowsProcessed: number | null
}

/**
 * DSP features from the Phase 13 analyser, when it has run.
 *
 * MEASURED, not inferred. Present only when a stored DSP result exists
 * for this track; this layer never triggers a DSP run of its own.
 */
export interface AnalysisDspFeatures {
  /** Null when confidence was too low to report a number honestly. */
  bpm: number | null
  bpmConfidence: number | null
  /** RMS-derived dBFS. NOT LUFS — no K-weighting, no gating. */
  loudnessDbfs: number | null
  dynamicRangeDb: number | null
  rms: number | null
  spectralCentroid: number | null
  zeroCrossingRate: number | null
  silenceRatio: number | null
}

/** Timings, for cost analysis. */
export interface AnalysisTimings {
  decodeMs: number | null
  inferenceMs: number | null
  totalMs: number | null
}

/** A completed single-track analysis. */
export interface TrackAnalysisRecord {
  trackId: string
  model: AnalysisModel
  embedding: AnalysisEmbedding
  audio: AnalysisAudioFacts
  /** Null when the DSP analyser has no stored result for this track. */
  dsp: AnalysisDspFeatures | null
  timings: AnalysisTimings
  /** ISO timestamp. */
  analyzedAt: string
  /**
   * Features a classifier would provide, and why they are missing.
   * Never fabricated, never silently omitted.
   */
  unsupported: readonly UnsupportedFeature[]
  /**
   * Human-supplied evaluation label. ALWAYS null here: an automatic
   * analysis has no ground truth, and inventing one would poison the
   * dataset it exists to build.
   */
  groundTruth: null
}

export type TrackAnalysisFailureCode =
  | EmbeddingFailureCode
  | 'ANALYSIS_FAILED'

export interface TrackAnalysisFailureRecord {
  trackId: string
  code: TrackAnalysisFailureCode
  message: string
  model: { id: string, version: string }
  failedAt: string
}

/** Storage envelope. Versioned so a schema change is detectable. */
export interface StoredTrackAnalysis {
  schemaVersion: number
  record: TrackAnalysisRecord
}

export const TRACK_ANALYSIS_SCHEMA_VERSION = 1

/**
 * True when a stored analysis was produced by this exact model build.
 *
 * Model version is part of cache identity on purpose: mixing vectors
 * from two model versions in one dataset produces cosines that look
 * valid and mean nothing.
 */
export function isSameModelBuild(
  stored: TrackAnalysisRecord | null | undefined,
  modelId: string,
  modelVersion: string,
): boolean {
  if (!stored) return false
  return stored.model.id === modelId && stored.model.version === modelVersion
}

/** Structural guard for data coming back out of storage. */
export function isTrackAnalysisRecord(v: unknown): v is TrackAnalysisRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  const model = r.model as Record<string, unknown> | undefined
  const embedding = r.embedding as Record<string, unknown> | undefined
  return typeof r.trackId === 'string'
    && r.trackId.length > 0
    && !!model
    && typeof model.id === 'string'
    && typeof model.version === 'string'
    && !!embedding
    && Array.isArray(embedding.vector)
    && typeof embedding.dimension === 'number'
    && typeof r.analyzedAt === 'string'
    // groundTruth must be absent or null. A stored label would mean
    // something fabricated one.
    && (r.groundTruth === null || r.groundTruth === undefined)
}
