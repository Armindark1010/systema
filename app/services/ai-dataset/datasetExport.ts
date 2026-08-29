/**
 * SYSTEMA — dataset export/import (Phase 28).
 *
 * JSON is the archival format: it carries the COMPLETE embedding
 * vector, so an export is a real training set rather than a summary.
 * CSV is for tabular inspection (spreadsheets, quick class counts) and
 * deliberately omits the vector — 512 columns per row would make the
 * file unusable, and a truncated vector in a CSV would be worse than
 * no vector at all.
 *
 * Exports state plainly that groundTruth is human-assigned and that no
 * model prediction is present. Nothing in this file can write a label.
 */

import type { DatasetRecord } from './datasetRecord'
import { topFor } from './semanticRecord'
import { assessRecord, coerceDatasetRecord } from './datasetRecord'

export const DATASET_EXPORT_VERSION = 1

export interface DatasetExportEnvelope {
  format: 'systema-ai-dataset'
  version: number
  exportedAt: string
  recordCount: number
  /** Self-describing provenance so a stray file cannot be misread. */
  notice: string
  records: unknown[]
}

/**
 * Full-fidelity JSON export.
 *
 * `pretty` costs file size but makes the output diffable and
 * inspectable, which matters more than bytes for a dataset this size.
 */
export function exportJson(records: DatasetRecord[], pretty = false): string {
  const envelope: DatasetExportEnvelope = {
    format: 'systema-ai-dataset',
    version: DATASET_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    notice:
      'groundTruth values are HUMAN-assigned labels. prediction values are '
      + 'RAW MODEL OUTPUT and are never ground truth. The two are separate '
      + 'keys and must stay separate. All models are experimental and none '
      + 'is production-selected.',
    records: records.map(r => ({
      id: r.id,
      // Carried so an export can be re-imported: the validator needs
      // it, and a file without it could not be checked for age.
      schemaVersion: r.schemaVersion,
      track: r.track,
      audio: r.measurements,
      embedding: r.embedding
        ? {
            model: r.embedding.model,
            version: r.embedding.modelVersion,
            dimension: r.embedding.dimension,
            normalized: r.embedding.normalized,
            preNormalizationL2: r.embedding.preNormalizationL2,
            // The complete vector. Never sliced.
            vector: r.embedding.vector,
          }
        : null,
      processing: r.processing,
      /**
       * MODEL OUTPUT. Deliberately a sibling of groundTruth, never
       * merged into it. Complete ranked predictions per head — the
       * whole list, because recall and PR-AUC cannot be recomputed
       * from a top-3 slice.
       */
      prediction: r.semantic
        ? {
            source: r.semantic.source,
            model: r.semantic.model,
            version: r.semantic.modelVersion,
            analyzerVersion: r.semantic.analyzerVersion,
            experimental: r.semantic.experimental,
            analyzedAt: r.semantic.analyzedAt,
            sampleRate: r.semantic.sampleRate,
            sourceDurationSec: r.semantic.sourceDurationSec,
            processedDurationSec: r.semantic.processedDurationSec,
            decodeMs: r.semantic.decodeMs,
            inferenceMs: r.semantic.inferenceMs,
            heads: r.semantic.heads.map(h => ({
              field: h.field,
              head: h.head,
              version: h.headVersion,
              activation: h.activation,
              multiLabel: h.multiLabel,
              classCount: h.classCount,
              predictions: h.predictions,
            })),
            unsupported: r.semantic.unsupported,
          }
        : null,
      groundTruth: {
        language: r.groundTruth.language,
        genre: r.groundTruth.genres,
        mood: r.groundTruth.moods,
        vocal: r.groundTruth.vocal,
        energy: r.groundTruth.energy,
        contexts: r.groundTruth.contexts,
        source: r.groundTruth.source,
        notes: r.groundTruth.notes,
        labelledAt: r.groundTruth.labelledAt,
        revision: r.groundTruth.revision,
      },
      status: r.status,
      errorCode: r.errorCode,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      supersededAt: r.supersededAt,
      completeness: assessRecord(r).completeness,
    })),
  }
  return pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)
}

const CSV_COLUMNS = [
  'id', 'trackId', 'title', 'artist', 'album',
  'bpm', 'bpmConfidence', 'loudnessDbfs', 'dynamicRangeDb', 'peak', 'rms',
  'spectralCentroid', 'spectralBandwidth', 'spectralRolloff',
  'zeroCrossingRate', 'silenceRatio',
  'sourceDurationSec', 'analysedDurationSec', 'sourceSampleRate',
  'modelSampleRate', 'windowsProcessed',
  'embeddingModel', 'embeddingVersion', 'embeddingDimension', 'normalized',
  // HUMAN labels.
  'language', 'genres', 'moods', 'vocal', 'energy', 'contexts',
  'labelSource', 'labelRevision',
  // MODEL predictions. Prefixed `predicted*` so a column can never be
  // mistaken for its human counterpart in a spreadsheet — the CSV is
  // where that confusion would be easiest and most damaging.
  'semanticModel', 'semanticVersion',
  'predictedMoodTop', 'predictedMoodScore',
  'predictedGenreTop', 'predictedGenreScore',
  'predictedVocalTop', 'predictedVocalScore',
  'predictionSource',
  'status', 'analyzerVersion', 'completeness', 'createdAt', 'updatedAt',
] as const

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join('|') : String(v)
  // Quote when the value could break the row, and double embedded quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Tabular metadata + labels. No embedding vector — by design. */
export function exportCsv(records: DatasetRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')]

  for (const r of records) {
    const m = r.measurements
    const g = r.groundTruth
    const row: unknown[] = [
      r.id, r.track.trackId, r.track.title, r.track.artist, r.track.album,
      m.bpm, m.bpmConfidence, m.loudnessDbfs, m.dynamicRangeDb, m.peak, m.rms,
      m.spectralCentroid, m.spectralBandwidth, m.spectralRolloff,
      m.zeroCrossingRate, m.silenceRatio,
      m.sourceDurationSec, m.analysedDurationSec, m.sourceSampleRate,
      m.modelSampleRate, m.windowsProcessed,
      r.embedding?.model ?? '', r.embedding?.modelVersion ?? '',
      r.embedding?.dimension ?? '', r.embedding?.normalized ?? '',
      g.language, g.genres, g.moods, g.vocal, g.energy, g.contexts,
      g.source, g.revision,
      r.semantic?.model ?? '', r.semantic?.modelVersion ?? '',
      // Top-1 only in CSV, because a 56-value ranked list does not fit a
      // cell. The COMPLETE output is in the JSON export; the CSV is a
      // convenience view and says so in the column names.
      topFor(r.semantic, 'mood')?.label ?? '',
      topFor(r.semantic, 'mood')?.score ?? '',
      topFor(r.semantic, 'genre')?.label ?? '',
      topFor(r.semantic, 'genre')?.score ?? '',
      topFor(r.semantic, 'vocalInstrumental')?.label ?? '',
      topFor(r.semantic, 'vocalInstrumental')?.score ?? '',
      r.semantic?.source ?? '',
      r.status, r.processing.analyzerVersion,
      assessRecord(r).completeness, r.createdAt, r.updatedAt,
    ]
    lines.push(row.map(csvCell).join(','))
  }

  return lines.join('\n')
}

export interface ImportResult {
  ok: boolean
  records: DatasetRecord[]
  skipped: number
  error?: string
}

/**
 * Parses a previously exported JSON file.
 *
 * Rows that fail validation are SKIPPED and counted, never repaired.
 * A record with a vector length that disagrees with its dimension is
 * corrupt; guessing which is right would silently fabricate data.
 */
export function importJson(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, records: [], skipped: 0, error: 'The file is not valid JSON.' }
  }

  const env = parsed as Partial<DatasetExportEnvelope>
  if (!env || env.format !== 'systema-ai-dataset' || !Array.isArray(env.records)) {
    return { ok: false, records: [], skipped: 0, error: 'Not a SYSTEMA dataset export.' }
  }
  if (typeof env.version === 'number' && env.version > DATASET_EXPORT_VERSION) {
    return {
      ok: false,
      records: [],
      skipped: 0,
      error: `Export version ${env.version} is newer than this build supports.`,
    }
  }

  const records: DatasetRecord[] = []
  let skipped = 0

  for (const raw of env.records) {
    const r = raw as Record<string, unknown>
    const gt = (r.groundTruth ?? {}) as Record<string, unknown>
    // Map the export's flattened field names back onto the record.
    const candidate = {
      ...r,
      measurements: r.audio ?? r.measurements,
      groundTruth: {
        ...gt,
        genres: gt.genre ?? gt.genres,
        moods: gt.mood ?? gt.moods,
      },
      embedding: r.embedding
        ? {
            ...(r.embedding as Record<string, unknown>),
            modelVersion:
              (r.embedding as Record<string, unknown>).version
              ?? (r.embedding as Record<string, unknown>).modelVersion,
          }
        : null,
    }

    const coerced = coerceDatasetRecord(candidate)
    if (coerced) records.push(coerced)
    else skipped++
  }

  return { ok: true, records, skipped }
}
