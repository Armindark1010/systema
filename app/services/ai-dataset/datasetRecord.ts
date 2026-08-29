/**
 * SYSTEMA — persistent AI dataset record (Phase 28).
 *
 * The shape of one row in the collected dataset. This is a data
 * COLLECTION contract, not a production inference contract.
 *
 * Three strictly separated regions:
 *
 *   measurements  — what the DSP analyser measured from the audio.
 *   embedding     — what the model produced. Opaque numbers.
 *   groundTruth   — what a HUMAN said. Never derived from the above.
 *
 * Keeping them apart is what makes the dataset usable for training
 * later. If a mood could be written by the analysis pipeline, every
 * model trained on it would be learning its own output.
 *
 * Model independence: nothing here names CLAP. `embeddingModel` and
 * `embeddingModelVersion` are free strings, and the dimension is
 * stored per record, so replacing the model later is a data question
 * ("which rows share a model build?") rather than a schema change.
 */

import type { GroundTruthLabels } from './labels'
import { emptyLabels, sanitiseLabels } from './labels'

/** Bumped when the RECORD shape changes. Distinct from analyzerVersion. */
export const DATASET_SCHEMA_VERSION = 1

export type DatasetStatus = 'COMPLETED' | 'FAILED'

// ---------------------------------------------------------------------

/**
 * Track identity.
 *
 * `sourceUri` is stored because re-decoding the same file is required
 * to reproduce an embedding. It is a MediaStore content URI, not a
 * filesystem path — no directory names, no SD-card layout, nothing
 * describing the user's storage. Logs never print it.
 */
export interface DatasetTrackIdentity {
  trackId: string
  title: string | null
  artist: string | null
  album: string | null
  sourceUri: string | null
}

/** Everything measured from the audio itself. All optional: absent ≠ zero. */
export interface DatasetMeasurements {
  bpm: number | null
  bpmConfidence: number | null
  loudnessDbfs: number | null
  dynamicRangeDb: number | null
  peak: number | null
  rms: number | null
  spectralCentroid: number | null
  spectralBandwidth: number | null
  spectralRolloff: number | null
  zeroCrossingRate: number | null
  silenceRatio: number | null
  sourceDurationSec: number | null
  analysedDurationSec: number | null
  sourceSampleRate: number | null
  modelSampleRate: number | null
  windowsProcessed: number | null
}

export function emptyMeasurements(): DatasetMeasurements {
  return {
    bpm: null,
    bpmConfidence: null,
    loudnessDbfs: null,
    dynamicRangeDb: null,
    peak: null,
    rms: null,
    spectralCentroid: null,
    spectralBandwidth: null,
    spectralRolloff: null,
    zeroCrossingRate: null,
    silenceRatio: null,
    sourceDurationSec: null,
    analysedDurationSec: null,
    sourceSampleRate: null,
    modelSampleRate: null,
    windowsProcessed: null,
  }
}

/**
 * The model output.
 *
 * `vector` holds every component. It is never truncated for storage or
 * display; a partial vector is not a smaller dataset, it is a corrupt
 * one.
 */
export interface DatasetEmbedding {
  vector: number[]
  dimension: number
  model: string
  modelVersion: string
  normalized: boolean
  preNormalizationL2: number | null
}

export interface DatasetProcessing {
  analyzerVersion: number
  analysisDurationMs: number | null
  decodeDurationMs: number | null
  inferenceDurationMs: number | null
  /** Always true in this phase. The model is under evaluation. */
  experimental: boolean
}

// ---------------------------------------------------------------------

/**
 * One dataset row.
 *
 * IDENTITY AND VERSIONING (documented decision)
 * ---------------------------------------------
 * `id` = `${trackId}::${embeddingModel}::${embeddingModelVersion}::${analyzerVersion}`.
 *
 * The system CREATES A NEW VERSIONED ROW when any component of that
 * tuple changes, and UPDATES IN PLACE when they all match. Re-running
 * the same model on the same track therefore refreshes one row instead
 * of accumulating duplicates, while switching models keeps both rows.
 *
 * Versioned rows were chosen over overwrite because reproducibility is
 * the point of the dataset: an embedding is only meaningful next to the
 * model build that produced it, and silently replacing v1 vectors with
 * v2 vectors would leave a mixed set that cannot be evaluated.
 *
 * `supersededAt` marks a row as no longer current for its track while
 * keeping it readable, so an older model's data is retired rather than
 * destroyed.
 */
export interface DatasetRecord {
  id: string
  schemaVersion: number

  track: DatasetTrackIdentity
  measurements: DatasetMeasurements
  embedding: DatasetEmbedding | null
  processing: DatasetProcessing

  /** HUMAN labels. Analysis writes never touch this. */
  groundTruth: GroundTruthLabels

  status: DatasetStatus
  errorCode: string | null
  errorMessage: string | null

  createdAt: string
  updatedAt: string
  /** ISO timestamp when a newer model build replaced this row. */
  supersededAt: string | null
}

/** The stable identity tuple. */
export function datasetRecordId(
  trackId: string,
  model: string,
  modelVersion: string,
  analyzerVersion: number,
): string {
  return `${trackId}::${model}::${modelVersion}::${analyzerVersion}`
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

function isFiniteOrNull(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

/**
 * Structural check for anything crossing the storage boundary.
 *
 * Rejects a record whose embedding vector length disagrees with its
 * declared dimension. That mismatch is the signature of a truncated or
 * partially written vector, and a silently short vector would poison
 * every downstream experiment.
 */
export function isDatasetRecord(value: unknown): value is DatasetRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>

  if (typeof r.id !== 'string' || !r.id) return false
  if (typeof r.schemaVersion !== 'number') return false
  if (r.status !== 'COMPLETED' && r.status !== 'FAILED') return false

  const t = r.track as Record<string, unknown> | undefined
  if (!t || typeof t.trackId !== 'string' || !t.trackId) return false

  const p = r.processing as Record<string, unknown> | undefined
  if (!p || typeof p.analyzerVersion !== 'number') return false

  if (r.embedding !== null) {
    const e = r.embedding as Record<string, unknown> | undefined
    if (!e) return false
    if (!Array.isArray(e.vector)) return false
    if (typeof e.dimension !== 'number') return false
    if (e.vector.length !== e.dimension) return false
    if (typeof e.model !== 'string' || !e.model) return false
    if (typeof e.modelVersion !== 'string') return false
    if (!isFiniteOrNull(e.preNormalizationL2)) return false
  }

  const g = r.groundTruth as Record<string, unknown> | undefined
  if (!g) return false
  // A predicted label must never masquerade as ground truth.
  if (g.source !== 'human') return false

  return true
}

/** Normalises an untrusted record read back from storage. */
export function coerceDatasetRecord(value: unknown): DatasetRecord | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const withLabels = {
    ...r,
    groundTruth: sanitiseLabels(r.groundTruth ?? emptyLabels()),
  }
  return isDatasetRecord(withLabels) ? (withLabels as DatasetRecord) : null
}

// ---------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------

export type QualityIssue =
  | 'MISSING_EMBEDDING'
  | 'MISSING_LANGUAGE'
  | 'MISSING_GENRE'
  | 'MISSING_MOOD'
  | 'MISSING_VOCAL'
  | 'MISSING_ENERGY'
  | 'INCOMPLETE_CONTEXTS'
  | 'MISSING_MEASUREMENTS'
  | 'FAILED_ANALYSIS'
  | 'MODEL_VERSION_MISMATCH'
  | 'SUPERSEDED'

export interface QualityReport {
  issues: QualityIssue[]
  /** 0–100, how much of the intended dataset content is present. */
  completeness: number
}

/**
 * The eight things a complete row needs.
 *
 * Weighted equally and deliberately simple: this is a progress
 * indicator for the human doing the labeling, not a scientific score.
 */
export function assessRecord(
  record: DatasetRecord,
  currentModelVersion?: string,
): QualityReport {
  const issues: QualityIssue[] = []
  const g = record.groundTruth

  if (record.status === 'FAILED') issues.push('FAILED_ANALYSIS')
  if (!record.embedding || record.embedding.vector.length === 0) issues.push('MISSING_EMBEDDING')
  if (!g.language || g.language === 'unknown') issues.push('MISSING_LANGUAGE')
  if (g.genres.length === 0) issues.push('MISSING_GENRE')
  if (g.moods.length === 0) issues.push('MISSING_MOOD')
  if (!g.vocal || g.vocal === 'unknown') issues.push('MISSING_VOCAL')
  if (!g.energy || g.energy === 'unknown') issues.push('MISSING_ENERGY')
  if (g.contexts.length === 0) issues.push('INCOMPLETE_CONTEXTS')

  const m = record.measurements
  if (m.bpm === null && m.loudnessDbfs === null && m.rms === null) {
    issues.push('MISSING_MEASUREMENTS')
  }

  if (
    currentModelVersion
    && record.embedding
    && record.embedding.modelVersion !== currentModelVersion
  ) {
    issues.push('MODEL_VERSION_MISMATCH')
  }

  if (record.supersededAt) issues.push('SUPERSEDED')

  // Eight scored components; mismatch/superseded are advisory flags.
  const checks = [
    Boolean(record.embedding && record.embedding.vector.length > 0),
    Boolean(g.language && g.language !== 'unknown'),
    g.genres.length > 0,
    g.moods.length > 0,
    Boolean(g.vocal && g.vocal !== 'unknown'),
    Boolean(g.energy && g.energy !== 'unknown'),
    g.contexts.length > 0,
    !(m.bpm === null && m.loudnessDbfs === null && m.rms === null),
  ]
  const done = checks.filter(Boolean).length
  const completeness = Math.round((done / checks.length) * 100)

  return { issues, completeness }
}
