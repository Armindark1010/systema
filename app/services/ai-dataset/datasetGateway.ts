/**
 * SYSTEMA — dataset persistence port (Phase 28).
 *
 * The seam between the dataset service and whatever actually stores
 * the rows. The service depends on THIS interface, never on Room, so
 * the storage backend can be replaced without touching business logic.
 *
 * WHY A PORT AND NOT A DIRECT CALL
 * --------------------------------
 * The real backend is the on-device Room database, reached through a
 * Capacitor plugin. That code is Kotlin: it cannot run in a browser
 * (`npm run dev`) and cannot run in the test process. Without this
 * boundary, every test would need an Android device and the web build
 * would crash on load.
 *
 * Two implementations exist:
 *   · NativeDatasetGateway  — Room via the Capacitor bridge. Real
 *                             persistence, the source of truth.
 *   · MemoryDatasetGateway  — an in-process map for tests and the web
 *                             dev build. Explicitly NOT persistent, and
 *                             it says so via `durable: false` so no
 *                             caller can mistake it for storage.
 *
 * `durable` matters: the UI must be able to tell the user their labels
 * are not being saved, rather than showing a reassuring "Saved" toast
 * backed by a map that dies with the tab.
 */

import type { DatasetRecord } from './datasetRecord'
import type { GroundTruthLabels } from './labels'

export interface DatasetQuery {
  /** Case-insensitive match against title and artist. */
  search?: string
  status?: 'COMPLETED' | 'FAILED'
  /** 'labelled' = has at least one human label. */
  labelled?: 'labelled' | 'unlabelled'
  model?: string
  modelVersion?: string
  /** Exclude rows retired by a newer model build. */
  currentOnly?: boolean
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'artist' | 'completeness'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface DatasetPage {
  rows: DatasetRecord[]
  /** Total matching the filter, ignoring pagination. */
  total: number
}

/**
 * The persistence contract.
 *
 * Every method is async because the real implementation crosses a
 * bridge to SQLite. Making the memory version async too keeps the
 * tests honest about ordering.
 */
export interface DatasetGateway {
  readonly id: string
  /** False for volatile backends. The UI warns when false. */
  readonly durable: boolean

  isAvailable(): Promise<boolean>

  upsert(record: DatasetRecord): Promise<DatasetRecord>
  getById(id: string): Promise<DatasetRecord | null>
  /** Current (non-superseded) rows for a track, newest first. */
  getByTrackId(trackId: string): Promise<DatasetRecord[]>
  query(q: DatasetQuery): Promise<DatasetPage>
  /** Writes ONLY the label region. Never touches measurements. */
  saveLabels(id: string, labels: GroundTruthLabels): Promise<DatasetRecord | null>
  remove(id: string): Promise<boolean>
  count(): Promise<number>
  /** Every row, for export. Vectors included in full. */
  all(): Promise<DatasetRecord[]>
}
