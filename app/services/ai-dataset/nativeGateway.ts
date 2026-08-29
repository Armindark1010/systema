/**
 * SYSTEMA — Room-backed dataset gateway (Phase 28).
 *
 * The durable implementation of DatasetGateway. Talks to the AiDataset
 * Capacitor plugin, which owns the SQLite table.
 *
 * Everything here is mapping: flat bridge JSON in one direction, the
 * nested DatasetRecord in the other. Query semantics are NOT
 * reimplemented — `applyQuery` from the memory gateway is reused, so
 * filtering and sorting behave identically on device and in tests, and
 * there is only one implementation to keep correct.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

import type { BridgeRecord } from './bridgeMapping'
import { fromBridge, toBridge } from './bridgeMapping'
import type { DatasetGateway, DatasetPage, DatasetQuery } from './datasetGateway'
import type { DatasetRecord } from './datasetRecord'
import type { GroundTruthLabels } from './labels'
import { applyQuery } from './memoryGateway'

interface AiDatasetPlugin {
  isAvailable(): Promise<{ available: boolean, durable: boolean }>
  saveAnalysis(o: Record<string, unknown>): Promise<{ record: BridgeRecord | null }>
  saveLabels(o: Record<string, unknown>): Promise<{ record: BridgeRecord | null }>
  getById(o: { id: string }): Promise<{ record: BridgeRecord | null }>
  getByTrackId(o: { trackId: string }): Promise<{ records: BridgeRecord[] }>
  getAll(): Promise<{ records: BridgeRecord[] }>
  deleteById(o: { id: string }): Promise<{ deleted: boolean }>
  stats(): Promise<{ total: number, labelled: number, withEmbedding: number }>
}

export const AiDatasetNative = registerPlugin<AiDatasetPlugin>('AiDataset')

export function isNativeDatasetAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AiDataset')
}

// ---------------------------------------------------------------------

export class NativeDatasetGateway implements DatasetGateway {
  readonly id = 'room'
  /** SQLite on device: survives restart, update, reboot, cache clear. */
  readonly durable = true

  async isAvailable(): Promise<boolean> {
    if (!isNativeDatasetAvailable()) return false
    try {
      return (await AiDatasetNative.isAvailable()).available === true
    } catch {
      return false
    }
  }

  async upsert(record: DatasetRecord): Promise<DatasetRecord> {
    const res = await AiDatasetNative.saveAnalysis(toBridge(record))
    const back = res.record ? fromBridge(res.record) : null
    // The plugin verifies its own read-back; if it still returns
    // nothing, report the write rather than inventing success.
    if (!back) throw new Error('The dataset write did not persist.')
    return back
  }

  async getById(id: string): Promise<DatasetRecord | null> {
    const res = await AiDatasetNative.getById({ id })
    return res.record ? fromBridge(res.record) : null
  }

  async getByTrackId(trackId: string): Promise<DatasetRecord[]> {
    const res = await AiDatasetNative.getByTrackId({ trackId })
    return res.records.map(fromBridge).filter((r): r is DatasetRecord => r !== null)
  }

  async query(q: DatasetQuery): Promise<DatasetPage> {
    const all = await this.all()
    return applyQuery(all, q)
  }

  async saveLabels(id: string, labels: GroundTruthLabels): Promise<DatasetRecord | null> {
    const res = await AiDatasetNative.saveLabels({
      id,
      language: labels.language,
      genres: labels.genres,
      moods: labels.moods,
      vocal: labels.vocal,
      energy: labels.energy,
      contexts: labels.contexts,
      notes: labels.notes,
      revision: labels.revision,
    })
    return res.record ? fromBridge(res.record) : null
  }

  async remove(id: string): Promise<boolean> {
    return (await AiDatasetNative.deleteById({ id })).deleted === true
  }

  async count(): Promise<number> {
    return (await AiDatasetNative.stats()).total
  }

  async all(): Promise<DatasetRecord[]> {
    const res = await AiDatasetNative.getAll()
    return res.records.map(fromBridge).filter((r): r is DatasetRecord => r !== null)
  }
}
