/**
 * SYSTEMA — volatile dataset gateway (Phase 28).
 *
 * Used by the test process and the web dev build, where no Room
 * database exists. It reports `durable: false`, and the UI shows a
 * warning banner when the active gateway is not durable — a labeling
 * session that silently evaporates would be worse than no labeling UI
 * at all.
 *
 * The filtering/sorting/pagination logic lives here rather than in the
 * service so it can be exercised without a device. The native gateway
 * pushes the same semantics down into SQL.
 */

import type { DatasetGateway, DatasetPage, DatasetQuery } from './datasetGateway'
import type { DatasetRecord } from './datasetRecord'
import { assessRecord } from './datasetRecord'
import type { GroundTruthLabels } from './labels'
import { hasAnyLabel } from './labels'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * Applies a query to a row set.
 *
 * Exported so the native gateway's SQL can be checked against the same
 * expectations, and so tests cover the semantics once.
 */
export function applyQuery(all: DatasetRecord[], q: DatasetQuery): DatasetPage {
  let rows = all.slice()

  if (q.currentOnly) rows = rows.filter(r => r.supersededAt === null)
  if (q.status) rows = rows.filter(r => r.status === q.status)
  if (q.model) rows = rows.filter(r => r.embedding?.model === q.model)
  if (q.modelVersion) rows = rows.filter(r => r.embedding?.modelVersion === q.modelVersion)

  if (q.labelled === 'labelled') rows = rows.filter(r => hasAnyLabel(r.groundTruth))
  else if (q.labelled === 'unlabelled') rows = rows.filter(r => !hasAnyLabel(r.groundTruth))

  const search = q.search?.trim().toLowerCase()
  if (search) {
    rows = rows.filter((r) => {
      const t = (r.track.title ?? '').toLowerCase()
      const a = (r.track.artist ?? '').toLowerCase()
      return t.includes(search) || a.includes(search)
    })
  }

  const total = rows.length

  const dir = q.sortDir === 'asc' ? 1 : -1
  const by = q.sortBy ?? 'updatedAt'
  rows.sort((x, y) => {
    let a: string | number
    let b: string | number
    switch (by) {
      case 'title':
        a = (x.track.title ?? '').toLowerCase(); b = (y.track.title ?? '').toLowerCase(); break
      case 'artist':
        a = (x.track.artist ?? '').toLowerCase(); b = (y.track.artist ?? '').toLowerCase(); break
      case 'completeness':
        a = assessRecord(x).completeness; b = assessRecord(y).completeness; break
      case 'createdAt':
        a = x.createdAt; b = y.createdAt; break
      default:
        a = x.updatedAt; b = y.updatedAt; break
    }
    if (a < b) return -1 * dir
    if (a > b) return 1 * dir
    // Stable tiebreak so pagination cannot drop or repeat a row.
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  })

  const offset = Math.max(0, q.offset ?? 0)
  const limit = q.limit ?? rows.length
  return { rows: rows.slice(offset, offset + limit), total }
}

export class MemoryDatasetGateway implements DatasetGateway {
  readonly id = 'memory'
  /** Volatile by construction. Callers must not treat this as storage. */
  readonly durable = false

  private rows = new Map<string, DatasetRecord>()

  async isAvailable(): Promise<boolean> {
    return true
  }

  async upsert(record: DatasetRecord): Promise<DatasetRecord> {
    const stored = deepClone(record)
    this.rows.set(stored.id, stored)
    return deepClone(stored)
  }

  async getById(id: string): Promise<DatasetRecord | null> {
    const r = this.rows.get(id)
    return r ? deepClone(r) : null
  }

  async getByTrackId(trackId: string): Promise<DatasetRecord[]> {
    return [...this.rows.values()]
      .filter(r => r.track.trackId === trackId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map(deepClone)
  }

  async query(q: DatasetQuery): Promise<DatasetPage> {
    const page = applyQuery([...this.rows.values()], q)
    return { rows: page.rows.map(deepClone), total: page.total }
  }

  async saveLabels(id: string, labels: GroundTruthLabels): Promise<DatasetRecord | null> {
    const existing = this.rows.get(id)
    if (!existing) return null
    // Only the label region is replaced; measurements and the vector
    // are carried over untouched.
    const updated: DatasetRecord = {
      ...existing,
      groundTruth: deepClone(labels),
      updatedAt: new Date().toISOString(),
    }
    this.rows.set(id, updated)
    return deepClone(updated)
  }

  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id)
  }

  async count(): Promise<number> {
    return this.rows.size
  }

  async all(): Promise<DatasetRecord[]> {
    return [...this.rows.values()].map(deepClone)
  }

  /** Test seam. */
  reset(): void {
    this.rows.clear()
  }
}
