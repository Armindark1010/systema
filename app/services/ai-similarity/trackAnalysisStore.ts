/**
 * SYSTEMA — persistence for single-track analyses (Phase 24).
 *
 * Uses the app's existing `StorageAdapter` contract rather than
 * touching localStorage directly, so the eventual move to Capacitor
 * Preferences or the Room database is a one-line swap here.
 *
 * WHY NOT ROOM DIRECTLY
 * ---------------------
 * `MusicLibraryDatabase` (v2) is the right long-term home and its own
 * docblock anticipates AI analysis. But adding a Room entity means a
 * schema migration in Kotlin that CANNOT be compiled or tested in this
 * environment, and a botched migration risks the user's library index
 * — which the migration policy explicitly protects. So the record is
 * stored through the existing web persistence adapter now, with a
 * versioned envelope and a stable shape that maps 1:1 onto a future
 * `track_ai_analysis` table.
 *
 * SIZE
 * ----
 * A 512-d vector is ~6 KB as JSON. The raw embedding IS the dataset,
 * so it is never truncated; instead the store keeps a bounded number
 * of analyses and evicts the oldest, and it reports quota failures
 * rather than pretending a write succeeded.
 */

import {
  type StoredTrackAnalysis,
  type TrackAnalysisRecord,
  TRACK_ANALYSIS_SCHEMA_VERSION,
  isTrackAnalysisRecord,
} from './trackAnalysis'

export const TRACK_ANALYSIS_STORAGE_KEY = 'systema:ai-analysis:tracks'

/**
 * How many analyses to retain.
 *
 * At ~6 KB each this is roughly 1.2 MB, comfortably inside a 5 MB
 * localStorage budget while leaving room for the rest of the app.
 */
export const MAX_STORED_ANALYSES = 200

export interface StorageAdapter {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

function createDefaultAdapter(): StorageAdapter {
  return {
    get: (k) => {
      if (typeof localStorage === 'undefined') return null
      try { return localStorage.getItem(k) } catch { return null }
    },
    set: (k, v) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.setItem(k, v) } catch { /* see MAX_STORED_ANALYSES */ }
    },
    remove: (k) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.removeItem(k) } catch { /* nothing useful to do */ }
    },
  }
}

let storage: StorageAdapter = createDefaultAdapter()

export function setTrackAnalysisStorage(adapter: StorageAdapter): void {
  storage = adapter
}
export function resetTrackAnalysisStorage(): void {
  storage = createDefaultAdapter()
}
export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>()
  return {
    get: k => map.get(k) ?? null,
    set: (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
  }
}

/** Everything on disk, keyed by trackId. Corrupt rows are dropped. */
export function loadAllAnalyses(): Record<string, TrackAnalysisRecord> {
  const raw = storage.get(TRACK_ANALYSIS_STORAGE_KEY)
  if (!raw) return {}

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object') return {}

  const out: Record<string, TrackAnalysisRecord> = {}
  for (const [trackId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const envelope = value as Partial<StoredTrackAnalysis>
    // A record from a different schema version is not readable as this
    // shape. Dropping it is safer than coercing it into one.
    if (envelope?.schemaVersion !== TRACK_ANALYSIS_SCHEMA_VERSION) continue
    if (!isTrackAnalysisRecord(envelope.record)) continue
    out[trackId] = envelope.record
  }
  return out
}

/** One track's stored analysis, or null. */
export function loadAnalysis(trackId: string | null | undefined): TrackAnalysisRecord | null {
  if (!trackId) return null
  return loadAllAnalyses()[trackId] ?? null
}

export interface SaveOutcome {
  ok: boolean
  /** Set when the write failed, e.g. storage quota. */
  error?: string
}

/**
 * Persists one analysis, replacing any previous one for that track.
 *
 * Returns an outcome instead of throwing: a failed save must not lose
 * the result the user is currently looking at.
 */
export function saveAnalysis(record: TrackAnalysisRecord): SaveOutcome {
  if (!isTrackAnalysisRecord(record)) {
    return { ok: false, error: 'Refusing to store a malformed analysis record.' }
  }

  const all = loadAllAnalyses()
  all[record.trackId] = record

  // Evict oldest first when over budget. Sorting by analyzedAt keeps
  // the most recent work, which is what an evaluation run needs.
  let entries = Object.entries(all)
  if (entries.length > MAX_STORED_ANALYSES) {
    entries = entries
      .sort((a, b) => Date.parse(b[1].analyzedAt) - Date.parse(a[1].analyzedAt))
      .slice(0, MAX_STORED_ANALYSES)
  }

  const payload: Record<string, StoredTrackAnalysis> = {}
  for (const [id, rec] of entries) {
    payload[id] = { schemaVersion: TRACK_ANALYSIS_SCHEMA_VERSION, record: rec }
  }

  try {
    storage.set(TRACK_ANALYSIS_STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? 'Could not save the analysis.' }
  }

  // Verify the write actually landed: a quota-exceeded localStorage
  // set can fail silently, and reporting a save that did not happen
  // would be a lie the next reload exposes.
  const readBack = loadAnalysis(record.trackId)
  if (!readBack) {
    return {
      ok: false,
      error: 'The analysis could not be saved, most likely because device '
        + 'storage is full. The result on screen is still valid.',
    }
  }
  return { ok: true }
}

export function removeAnalysis(trackId: string): void {
  const all = loadAllAnalyses()
  if (!(trackId in all)) return
  delete all[trackId]
  const payload: Record<string, StoredTrackAnalysis> = {}
  for (const [id, rec] of Object.entries(all)) {
    payload[id] = { schemaVersion: TRACK_ANALYSIS_SCHEMA_VERSION, record: rec }
  }
  storage.set(TRACK_ANALYSIS_STORAGE_KEY, JSON.stringify(payload))
}

export function clearAllAnalyses(): void {
  storage.remove(TRACK_ANALYSIS_STORAGE_KEY)
}

/** How many analyses are stored. For diagnostics only. */
export function countAnalyses(): number {
  return Object.keys(loadAllAnalyses()).length
}
