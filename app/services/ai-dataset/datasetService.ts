/**
 * SYSTEMA — dataset service (Phase 28).
 *
 * UI → composable → THIS → gateway → database.
 *
 * The UI never persists anything itself and never sees a gateway. This
 * layer owns the two rules that keep the dataset scientifically usable:
 *
 *   1. Re-analysis NEVER overwrites human labels. An analysis write
 *      carries measurements and a vector; it copies the existing
 *      groundTruth forward verbatim.
 *   2. Identity is (trackId, model, modelVersion, analyzerVersion).
 *      Same tuple → update in place. Different tuple → a new versioned
 *      row, with the previous current row marked superseded.
 */

import type { DatasetGateway, DatasetPage, DatasetQuery } from './datasetGateway'
import { MemoryDatasetGateway } from './memoryGateway'
import type {
  DatasetEmbedding,
  DatasetMeasurements,
  DatasetRecord,
  DatasetTrackIdentity,
} from './datasetRecord'
import {
  DATASET_SCHEMA_VERSION,
  datasetRecordId,
  emptyMeasurements,
} from './datasetRecord'
import type { GroundTruthLabels } from './labels'
import { emptyLabels, sanitiseLabels } from './labels'

// ---------------------------------------------------------------------
// Gateway wiring
// ---------------------------------------------------------------------

let gateway: DatasetGateway = new MemoryDatasetGateway()

export function setDatasetGateway(g: DatasetGateway): void {
  gateway = g
}

export function getDatasetGateway(): DatasetGateway {
  return gateway
}

export function resetDatasetGateway(): void {
  gateway = new MemoryDatasetGateway()
}

// ---------------------------------------------------------------------

export interface SaveAnalysisInput {
  track: DatasetTrackIdentity
  measurements?: Partial<DatasetMeasurements>
  embedding?: DatasetEmbedding | null
  analyzerVersion: number
  analysisDurationMs?: number | null
  decodeDurationMs?: number | null
  inferenceDurationMs?: number | null
  status?: 'COMPLETED' | 'FAILED'
  errorCode?: string | null
  errorMessage?: string | null
}

export interface SaveAnalysisResult {
  ok: boolean
  record: DatasetRecord | null
  /** 'created' | 'updated' | 'versioned' — what actually happened. */
  action: 'created' | 'updated' | 'versioned' | 'failed'
  /** True when labels from a previous row were carried forward. */
  labelsPreserved: boolean
  error?: string
}

/**
 * Persists one analysis.
 *
 * Label preservation works across model versions as well as within
 * one: when a new versioned row is created, the labels from the
 * track's most recently labelled row are copied forward. A human's
 * judgement about a song does not stop being true because the
 * embedding model changed.
 */
export async function saveAnalysis(input: SaveAnalysisInput): Promise<SaveAnalysisResult> {
  const trackId = input.track?.trackId
  if (!trackId) {
    return { ok: false, record: null, action: 'failed', labelsPreserved: false, error: 'A trackId is required.' }
  }

  const model = input.embedding?.model ?? 'none'
  const modelVersion = input.embedding?.modelVersion ?? 'none'
  const id = datasetRecordId(trackId, model, modelVersion, input.analyzerVersion)
  const now = new Date().toISOString()

  try {
    const existing = await gateway.getById(id)
    const siblings = await gateway.getByTrackId(trackId)

    // Carry labels forward: the same row first, otherwise the most
    // recently labelled row for this track.
    let labels: GroundTruthLabels = existing?.groundTruth ?? emptyLabels()
    let labelsPreserved = Boolean(existing && existing.groundTruth.revision > 0)

    if (!existing || existing.groundTruth.revision === 0) {
      const best = siblings
        .filter(r => r.id !== id && r.groundTruth.revision > 0)
        .sort((a, b) => b.groundTruth.revision - a.groundTruth.revision)[0]
      if (best) {
        labels = sanitiseLabels(best.groundTruth)
        labelsPreserved = true
      }
    }

    const record: DatasetRecord = {
      id,
      schemaVersion: DATASET_SCHEMA_VERSION,
      track: {
        trackId,
        title: input.track.title ?? null,
        artist: input.track.artist ?? null,
        album: input.track.album ?? null,
        sourceUri: input.track.sourceUri ?? null,
      },
      measurements: { ...emptyMeasurements(), ...(input.measurements ?? {}) },
      embedding: input.embedding ?? null,
      processing: {
        analyzerVersion: input.analyzerVersion,
        analysisDurationMs: input.analysisDurationMs ?? null,
        decodeDurationMs: input.decodeDurationMs ?? null,
        inferenceDurationMs: input.inferenceDurationMs ?? null,
        experimental: true,
      },
      // The one line that guarantees rule 1.
      groundTruth: labels,
      status: input.status ?? 'COMPLETED',
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      supersededAt: null,
    }

    const saved = await gateway.upsert(record)

    // Retire older model builds for this track, keeping their data.
    let versioned = false
    for (const s of siblings) {
      if (s.id === id || s.supersededAt !== null) continue
      versioned = true
      await gateway.upsert({ ...s, supersededAt: now })
    }

    return {
      ok: true,
      record: saved,
      action: existing ? 'updated' : versioned ? 'versioned' : 'created',
      labelsPreserved,
    }
  } catch (e) {
    return {
      ok: false,
      record: null,
      action: 'failed',
      labelsPreserved: false,
      error: (e as Error)?.message ?? 'The dataset write failed.',
    }
  }
}

/**
 * Writes human labels.
 *
 * The ONLY path that may modify groundTruth. It bumps `revision` and
 * stamps `labelledAt`, which is what later re-analyses use to decide
 * which labels to carry forward.
 */
export async function saveLabels(
  id: string,
  labels: GroundTruthLabels,
): Promise<{ ok: boolean, record: DatasetRecord | null, error?: string }> {
  try {
    const existing = await gateway.getById(id)
    if (!existing) return { ok: false, record: null, error: 'No dataset record with that id.' }

    const clean = sanitiseLabels(labels)
    const next: GroundTruthLabels = {
      ...clean,
      source: 'human',
      labelledAt: new Date().toISOString(),
      revision: existing.groundTruth.revision + 1,
    }

    const record = await gateway.saveLabels(id, next)
    return { ok: Boolean(record), record, error: record ? undefined : 'The label write did not persist.' }
  } catch (e) {
    return { ok: false, record: null, error: (e as Error)?.message ?? 'The label write failed.' }
  }
}

export async function getRecord(id: string): Promise<DatasetRecord | null> {
  try { return await gateway.getById(id) } catch { return null }
}

/** Current (non-superseded) rows for a track, newest first. */
export async function getRecordsForTrack(trackId: string): Promise<DatasetRecord[]> {
  try { return await gateway.getByTrackId(trackId) } catch { return [] }
}

/** The row the Full Player should display: newest current row. */
export async function getCurrentRecord(trackId: string): Promise<DatasetRecord | null> {
  const rows = await getRecordsForTrack(trackId)
  return rows.find(r => r.supersededAt === null) ?? null
}

export async function queryDataset(q: DatasetQuery = {}): Promise<DatasetPage> {
  try { return await gateway.query(q) } catch { return { rows: [], total: 0 } }
}

export async function deleteRecord(id: string): Promise<boolean> {
  try { return await gateway.remove(id) } catch { return false }
}

export async function allRecords(): Promise<DatasetRecord[]> {
  try { return await gateway.all() } catch { return [] }
}
