/**
 * SYSTEMA — the gateway used when persistence is genuinely broken
 * (Phase 28).
 *
 * WHY THIS EXISTS
 * ---------------
 * On device, the dataset is supposed to be Room. If the AiDataset
 * plugin is missing — not registered, an older APK, a failed
 * PluginLoadException — the app has a choice:
 *
 *   a) fall back to the in-memory gateway, or
 *   b) refuse to pretend.
 *
 * (a) is the dangerous option, and it was the previous behaviour. The
 * in-memory gateway accepts every write and returns success, so the
 * user labels fifty tracks, sees "SAVED" fifty times, closes the app,
 * and loses all of it. The data-collection phase would produce nothing
 * while looking like it was working perfectly. Losing an evening of
 * labeling is worse than being told up front that labeling is
 * unavailable.
 *
 * So on a native platform every operation here FAILS LOUDLY. Reads
 * return empty (there is genuinely nothing to read) but every write
 * throws, and `durable` is false so the UI shows its warning.
 *
 * The in-memory gateway is still the right answer in a browser and in
 * tests, where nobody expects a device database. This class is only
 * for the case where persistence was expected and is absent.
 */

import type { DatasetGateway, DatasetPage, DatasetQuery } from './datasetGateway'
import type { DatasetRecord } from './datasetRecord'
import type { GroundTruthLabels } from './labels'

export const DATASET_UNAVAILABLE_MESSAGE
  = 'The dataset database is unavailable on this build, so nothing can be saved. '
    + 'The AiDataset plugin is not registered with the native bridge.'

export class UnavailableDatasetGateway implements DatasetGateway {
  readonly id = 'unavailable'
  /** Nothing is stored, so nothing is durable. */
  readonly durable = false

  /**
   * Why the gateway ended up here, for diagnostics on the page.
   * Never contains a path, a URI or anything user-identifying.
   */
  readonly reason: string

  constructor(reason: string) {
    this.reason = reason
  }

  async isAvailable(): Promise<boolean> {
    return false
  }

  private fail(): never {
    throw new Error(DATASET_UNAVAILABLE_MESSAGE)
  }

  // Writes must never appear to succeed.
  async upsert(_record: DatasetRecord): Promise<DatasetRecord> {
    this.fail()
  }

  async saveLabels(_id: string, _labels: GroundTruthLabels): Promise<DatasetRecord | null> {
    this.fail()
  }

  async remove(_id: string): Promise<boolean> {
    this.fail()
  }

  // Reads are honest about emptiness rather than throwing: the page
  // should render its warning, not a stack trace.
  async getById(_id: string): Promise<DatasetRecord | null> {
    return null
  }

  async getByTrackId(_trackId: string): Promise<DatasetRecord[]> {
    return []
  }

  async query(_q: DatasetQuery): Promise<DatasetPage> {
    return { rows: [], total: 0 }
  }

  async count(): Promise<number> {
    return 0
  }

  async all(): Promise<DatasetRecord[]> {
    return []
  }
}
