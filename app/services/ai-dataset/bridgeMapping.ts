/**
 * SYSTEMA — bridge record mapping (Phase 28).
 *
 * Split out of nativeGateway so it carries NO Capacitor import. The
 * mapping is the part most likely to break silently on a real device —
 * a dropped measurement or a mangled vector — and it must be unit
 * testable in a plain Node process, which cannot load @capacitor/core.
 *
 * Pure functions only: flat bridge JSON in, nested DatasetRecord out,
 * and back.
 */

import type { DatasetRecord } from './datasetRecord'
import { DATASET_SCHEMA_VERSION, emptyMeasurements } from './datasetRecord'
import { coerceSemanticAnalysis } from './semanticRecord'
import type { GroundTruthLabels } from './labels'
import { emptyLabels, sanitiseLabels } from './labels'

export interface BridgeRecord {
  [key: string]: unknown
}

// ---------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function isoOrNull(v: unknown): string | null {
  const n = num(v)
  return n === null ? null : new Date(n).toISOString()
}

/** Bridge JSON → domain record. */
export function fromBridge(raw: BridgeRecord): DatasetRecord | null {
  const id = str(raw.id)
  const trackId = str(raw.trackId)
  if (!id || !trackId) return null

  const vector = Array.isArray(raw.embeddingVector)
    ? (raw.embeddingVector as unknown[]).filter((n): n is number => typeof n === 'number')
    : null

  const dimension = num(raw.embeddingDimension)

  // A vector whose length disagrees with the stored dimension is
  // corrupt. Surfaced as "no embedding" rather than silently accepted,
  // so the quality report flags it instead of poisoning a training set.
  const embeddingValid = vector !== null && dimension !== null && vector.length === dimension

  const labels: GroundTruthLabels = sanitiseLabels({
    ...emptyLabels(),
    language: raw.labelLanguage,
    genres: list(raw.labelGenres),
    moods: list(raw.labelMoods),
    vocal: raw.labelVocal,
    energy: raw.labelEnergy,
    contexts: list(raw.labelContexts),
    notes: raw.labelNotes,
    labelledAt: isoOrNull(raw.labelledAt),
    revision: num(raw.labelRevision) ?? 0,
  })

  return {
    id,
    schemaVersion: num(raw.schemaVersion) ?? DATASET_SCHEMA_VERSION,
    track: {
      trackId,
      title: str(raw.title),
      artist: str(raw.artist),
      album: str(raw.album),
      sourceUri: str(raw.sourceUri),
    },
    measurements: {
      ...emptyMeasurements(),
      bpm: num(raw.bpm),
      bpmConfidence: num(raw.bpmConfidence),
      loudnessDbfs: num(raw.loudnessDbfs),
      dynamicRangeDb: num(raw.dynamicRangeDb),
      peak: num(raw.peak),
      rms: num(raw.rms),
      spectralCentroid: num(raw.spectralCentroid),
      spectralBandwidth: num(raw.spectralBandwidth),
      spectralRolloff: num(raw.spectralRolloff),
      zeroCrossingRate: num(raw.zeroCrossingRate),
      silenceRatio: num(raw.silenceRatio),
      sourceDurationSec: num(raw.sourceDurationSec),
      analysedDurationSec: num(raw.analysedDurationSec),
      sourceSampleRate: num(raw.sourceSampleRate),
      modelSampleRate: num(raw.modelSampleRate),
      windowsProcessed: num(raw.windowsProcessed),
    },
    embedding: embeddingValid
      ? {
          vector: vector!,
          dimension: dimension!,
          model: str(raw.embeddingModel) ?? 'unknown',
          modelVersion: str(raw.embeddingModelVersion) ?? 'unknown',
          normalized: raw.normalized === true,
          preNormalizationL2: num(raw.preNormalizationL2),
        }
      : null,
    processing: {
      analyzerVersion: num(raw.analyzerVersion) ?? 1,
      analysisDurationMs: num(raw.analysisDurationMs),
      decodeDurationMs: num(raw.decodeDurationMs),
      inferenceDurationMs: num(raw.inferenceDurationMs),
      experimental: raw.experimental !== false,
    },
    // Stored as a JSON blob in one column rather than exploded into
    // columns: the shape is a variable-length ranked list per head, and
    // a relational encoding would need a second table plus a join for
    // data nothing queries by. A corrupt blob degrades to null.
    semantic: coerceSemanticAnalysis(parseJson(raw.semanticJson)),
    groundTruth: labels,
    status: raw.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
    errorCode: str(raw.errorCode),
    errorMessage: str(raw.errorMessage),
    createdAt: isoOrNull(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: isoOrNull(raw.updatedAt) ?? new Date().toISOString(),
    supersededAt: isoOrNull(raw.supersededAt),
  }
}

/**
 * Parses a JSON column, tolerating an already-parsed object.
 *
 * Returns null on malformed JSON instead of throwing: one bad row must
 * not take down the whole dataset read.
 */
function parseJson(v: unknown): unknown {
  if (v == null) return null
  if (typeof v === 'object') return v
  if (typeof v !== 'string') return null
  try { return JSON.parse(v) } catch { return null }
}

/** Domain record → the analysis half of the bridge payload. */
export function toBridge(r: DatasetRecord): Record<string, unknown> {
  return {
    id: r.id,
    schemaVersion: r.schemaVersion,
    trackId: r.track.trackId,
    title: r.track.title,
    artist: r.track.artist,
    album: r.track.album,
    sourceUri: r.track.sourceUri,
    ...r.measurements,
    // Complete ranked predictions, serialised whole. Never top-k'd on
    // the way to storage — the tail is what evaluation needs.
    semanticJson: r.semantic ? JSON.stringify(r.semantic) : null,
    // The complete vector. Never sliced on the way to storage.
    embeddingVector: r.embedding?.vector ?? null,
    embeddingDimension: r.embedding?.dimension ?? null,
    embeddingModel: r.embedding?.model ?? null,
    embeddingModelVersion: r.embedding?.modelVersion ?? null,
    normalized: r.embedding?.normalized ?? null,
    preNormalizationL2: r.embedding?.preNormalizationL2 ?? null,
    analyzerVersion: r.processing.analyzerVersion,
    analysisDurationMs: r.processing.analysisDurationMs,
    decodeDurationMs: r.processing.decodeDurationMs,
    inferenceDurationMs: r.processing.inferenceDurationMs,
    experimental: r.processing.experimental,
    status: r.status,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    // Deliberately absent: every label field. The bridge's saveAnalysis
    // cannot carry ground truth, so it cannot overwrite it.
  }
}

