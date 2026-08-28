/**
 * SYSTEMA — Phase 20 persistent human-label dataset (§12).
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Labels used to live in a bare `ref` on the labelling page. They were
 * lost on refresh, on navigation, on rerun, and on reinstall. Labelling
 * 190 pairs is hours of irreplaceable human judgement, and the app was
 * throwing it away. Human labels are RESEARCH DATA, not UI state.
 *
 * THE KEYING BUG THIS FIXES
 * -------------------------
 * The old label keys were "i:j" against the CURRENT SELECTION ORDER.
 * That works only while the selection never changes: reorder or
 * deselect a track and every later key silently repoints onto a
 * different pair. The page's own comment admitted this and wiped all
 * labels whenever the selection changed.
 *
 * A portable dataset cannot use positional keys. Everything here is
 * keyed by STABLE TRACK ID, and pair keys are canonicalised by sorting
 * the two ids, so "1x5" and "5x1" are the same pair (§12 requirement).
 * Positional keys are converted at the boundary, never stored.
 *
 * SAFETY RULES ENFORCED HERE
 * --------------------------
 *  - Merge NEVER silently overwrites a differing human label. It
 *    reports a CONFLICT and keeps the existing one.
 *  - Replace is a separate, explicit operation.
 *  - Provenance (source, dataset version, timestamps) travels with
 *    every label.
 *  - Import validates before applying; an invalid file changes nothing.
 */

import type { PairLabel } from '../../data/labeledPairs'
import { createLocalStorageAdapter } from '../persistence/storageAdapter'
import type { StorageAdapter } from '../persistence/storageAdapter'

export const LABEL_DATASET_STORAGE_KEY = 'systema:ai-lab:label-dataset'
export const LABEL_DATASET_SCHEMA_VERSION = 1

export type LabelSource = 'HUMAN' | 'DOCUMENTED_SEED'

/** A track as identified in the portable dataset. */
export interface DatasetTrack {
  /** Stable library id. The join key. */
  id: string
  title: string
  /** Content URI, kept so a track can be re-resolved after reinstall. */
  uri?: string
  artist?: string
  durationMs?: number
}

export interface DatasetPair {
  /** Canonical "a|b" with a <= b. Order-independent by construction. */
  pairId: string
  trackA: string
  trackB: string
  label: PairLabel
  source: LabelSource
  datasetVersion: string
  createdAt?: string
  updatedAt?: string
  /** Free-text human justification, when one was recorded. */
  note?: string
}

export interface LabelDataset {
  schemaVersion: number
  datasetVersion: string
  exportedAt: string
  tracks: DatasetTrack[]
  pairs: DatasetPair[]
  /**
   * Denormalised counts. Redundant with `pairs` on purpose: it lets a
   * human (or another tool) sanity-check an export without parsing it.
   */
  statistics: {
    same: number
    similar: number
    different: number
    pairCount: number
    trackCount: number
  }
}

/**
 * Canonical pair id. Sorting the two ids is what makes "1x5" and "5x1"
 * the same pair regardless of which order the user clicked them in.
 */
export function canonicalPairId(a: string, b: string): string {
  if (!a || !b) throw new Error('canonicalPairId requires two track ids')
  if (a === b) throw new Error(`self-pair is not a valid pair: ${a}`)
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

export function splitPairId(pairId: string): [string, string] {
  const at = pairId.indexOf('|')
  if (at < 0) throw new Error(`malformed pairId: ${pairId}`)
  return [pairId.slice(0, at), pairId.slice(at + 1)]
}

export function countByLabel(pairs: readonly DatasetPair[]) {
  let same = 0, similar = 0, different = 0
  for (const p of pairs) {
    if (p.label === 'SAME') same++
    else if (p.label === 'SIMILAR') similar++
    else if (p.label === 'DIFFERENT') different++
  }
  return { same, similar, different }
}

export function buildDataset(
  tracks: readonly DatasetTrack[],
  pairs: readonly DatasetPair[],
  datasetVersion = 'phase-19',
): LabelDataset {
  const counts = countByLabel(pairs)
  return {
    schemaVersion: LABEL_DATASET_SCHEMA_VERSION,
    datasetVersion,
    exportedAt: new Date().toISOString(),
    tracks: [...tracks],
    pairs: [...pairs],
    statistics: {
      ...counts,
      pairCount: pairs.length,
      trackCount: tracks.length,
    },
  }
}

// ------------------------------------------------------------------
// Validation. Runs BEFORE anything is applied (§12).
// ------------------------------------------------------------------

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  trackCount: number
  pairCount: number
  counts: { same: number, similar: number, different: number }
  /** Pairs referencing a track that is not in the tracks array. */
  missingTrackRefs: string[]
  duplicatePairIds: string[]
}

const VALID_LABELS: ReadonlySet<string> = new Set(['SAME', 'SIMILAR', 'DIFFERENT'])
const VALID_SOURCES: ReadonlySet<string> = new Set(['HUMAN', 'DOCUMENTED_SEED'])

/**
 * Validates a parsed object as a dataset.
 *
 * Returns issues rather than throwing, so the UI can show a summary
 * before the user commits to anything. `ok` is false if any ERROR is
 * present; warnings are informational and do not block.
 */
export function validateDataset(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  const missingTrackRefs: string[] = []
  const duplicatePairIds: string[] = []

  const fail = (code: string, message: string) =>
    issues.push({ severity: 'ERROR', code, message })
  const warn = (code: string, message: string) =>
    issues.push({ severity: 'WARNING', code, message })

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('NOT_AN_OBJECT', 'The file does not contain a JSON object.')
    return {
      ok: false, issues, trackCount: 0, pairCount: 0,
      counts: { same: 0, similar: 0, different: 0 },
      missingTrackRefs, duplicatePairIds,
    }
  }

  const d = input as Record<string, unknown>

  if (typeof d.schemaVersion !== 'number') {
    fail('NO_SCHEMA_VERSION', 'Missing schemaVersion.')
  }
  else if (d.schemaVersion > LABEL_DATASET_SCHEMA_VERSION) {
    fail('SCHEMA_TOO_NEW',
      `File schemaVersion ${d.schemaVersion} is newer than this app supports `
      + `(${LABEL_DATASET_SCHEMA_VERSION}). Refusing to guess at its meaning.`)
  }

  const tracks = Array.isArray(d.tracks) ? d.tracks as unknown[] : null
  const pairs = Array.isArray(d.pairs) ? d.pairs as unknown[] : null
  if (!tracks) fail('NO_TRACKS', 'Missing or invalid tracks array.')
  if (!pairs) fail('NO_PAIRS', 'Missing or invalid pairs array.')

  const trackIds = new Set<string>()
  if (tracks) {
    for (const [i, t] of tracks.entries()) {
      if (typeof t !== 'object' || t === null) {
        fail('BAD_TRACK', `tracks[${i}] is not an object.`)
        continue
      }
      const tr = t as Record<string, unknown>
      if (typeof tr.id !== 'string' || !tr.id) {
        fail('BAD_TRACK_ID', `tracks[${i}] has no stable id.`)
        continue
      }
      if (trackIds.has(tr.id)) warn('DUPLICATE_TRACK', `Duplicate track id: ${tr.id}`)
      trackIds.add(tr.id)
    }
  }

  const seenPairs = new Set<string>()
  let same = 0, similar = 0, different = 0
  if (pairs) {
    for (const [i, p] of pairs.entries()) {
      if (typeof p !== 'object' || p === null) {
        fail('BAD_PAIR', `pairs[${i}] is not an object.`)
        continue
      }
      const pr = p as Record<string, unknown>
      const a = pr.trackA, b = pr.trackB
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
        fail('BAD_PAIR_REF', `pairs[${i}] does not reference two track ids.`)
        continue
      }
      if (a === b) {
        fail('SELF_PAIR', `pairs[${i}] is a self-pair (${a}), which cannot be labelled.`)
        continue
      }
      if (typeof pr.label !== 'string' || !VALID_LABELS.has(pr.label)) {
        fail('BAD_LABEL', `pairs[${i}] has invalid label ${JSON.stringify(pr.label)}.`)
        continue
      }
      if (pr.source !== undefined && typeof pr.source === 'string'
        && !VALID_SOURCES.has(pr.source)) {
        warn('BAD_SOURCE', `pairs[${i}] has unrecognised source ${pr.source}.`)
      }

      const id = canonicalPairId(a, b)
      if (seenPairs.has(id)) duplicatePairIds.push(id)
      seenPairs.add(id)

      if (trackIds.size > 0) {
        if (!trackIds.has(a)) missingTrackRefs.push(a)
        if (!trackIds.has(b)) missingTrackRefs.push(b)
      }

      if (pr.label === 'SAME') same++
      else if (pr.label === 'SIMILAR') similar++
      else different++
    }
  }

  if (duplicatePairIds.length) {
    warn('DUPLICATE_PAIRS',
      `${duplicatePairIds.length} duplicate pair(s) found; they will be deduplicated.`)
  }
  if (missingTrackRefs.length) {
    warn('MISSING_TRACKS',
      `${new Set(missingTrackRefs).size} pair reference(s) point at tracks not in the file. `
      + 'Those pairs are kept but cannot be resolved until the tracks are present.')
  }

  return {
    ok: !issues.some(i => i.severity === 'ERROR'),
    issues,
    trackCount: trackIds.size,
    pairCount: seenPairs.size,
    counts: { same, similar, different },
    missingTrackRefs: [...new Set(missingTrackRefs)],
    duplicatePairIds: [...new Set(duplicatePairIds)],
  }
}

export function parseDataset(json: string): { data: unknown, parseError: string | null } {
  try {
    return { data: JSON.parse(json), parseError: null }
  }
  catch (e) {
    return { data: null, parseError: (e as Error).message }
  }
}

// ------------------------------------------------------------------
// Merge (§12 "MOST IMPORTANT").
// ------------------------------------------------------------------

export interface MergeConflict {
  pairId: string
  existingLabel: PairLabel
  incomingLabel: PairLabel
}

export interface MergeResult {
  dataset: LabelDataset
  added: number
  unchanged: number
  conflicts: MergeConflict[]
  tracksAdded: number
}

/**
 * Merges `incoming` into `existing` WITHOUT destroying human work.
 *
 * Rules, exactly as specified:
 *  - identical pair + identical label  -> keep one copy (unchanged)
 *  - existing pair + different label   -> CONFLICT, existing WINS
 *  - new pair                          -> added
 *  - new track                         -> added
 *  - existing track, matching id       -> reused
 *
 * The conflict rule is the important one. Overwriting on import would
 * mean a stale backup could silently destroy newer judgements, and the
 * user would have no way to notice.
 */
export function mergeDatasets(
  existing: LabelDataset | null | undefined,
  incoming: LabelDataset | null | undefined,
): MergeResult {
  // Merging is reachable from the import path, where either side can be
  // absent (first-ever import, or an empty store). Treating that as an
  // empty dataset is correct and keeps callers from having to guard.
  const base = existing ?? emptyDataset()
  const other = incoming ?? emptyDataset()
  existing = base
  incoming = other

  const tracks = new Map(existing.tracks.map(t => [t.id, t]))
  let tracksAdded = 0
  for (const t of incoming.tracks) {
    if (!tracks.has(t.id)) {
      tracks.set(t.id, t)
      tracksAdded++
    }
  }

  const pairs = new Map<string, DatasetPair>()
  for (const p of existing.pairs) {
    pairs.set(p.pairId ?? canonicalPairId(p.trackA, p.trackB), p)
  }

  const conflicts: MergeConflict[] = []
  let added = 0
  let unchanged = 0

  for (const p of incoming.pairs) {
    const id = p.pairId ?? canonicalPairId(p.trackA, p.trackB)
    const current = pairs.get(id)
    if (!current) {
      pairs.set(id, { ...p, pairId: id })
      added++
    }
    else if (current.label === p.label) {
      unchanged++
    }
    else {
      // Existing label is preserved. Reported, never overwritten.
      conflicts.push({
        pairId: id,
        existingLabel: current.label,
        incomingLabel: p.label,
      })
    }
  }

  const merged = buildDataset(
    [...tracks.values()],
    [...pairs.values()],
    existing.datasetVersion || incoming.datasetVersion,
  )
  return { dataset: merged, added, unchanged, conflicts, tracksAdded }
}

// ------------------------------------------------------------------
// Persistence (§12 persistence requirement).
// ------------------------------------------------------------------

export function emptyDataset(datasetVersion = 'phase-19'): LabelDataset {
  return buildDataset([], [], datasetVersion)
}

let storage: StorageAdapter = createLocalStorageAdapter()

/**
 * Replaces the backing store.
 *
 * Same rationale as resultStore: the localStorage adapter guards on
 * `import.meta.client` and correctly no-ops under a bare Node runner,
 * so the round-trip contract could otherwise only be asserted by
 * reading the source rather than executing it.
 */
export function setStorageAdapter(adapter: StorageAdapter): void {
  storage = adapter
}

/** Restores the default browser-backed adapter. */
export function resetStorageAdapter(): void {
  storage = createLocalStorageAdapter()
}

export function saveDataset(d: LabelDataset): void {
  storage.set(LABEL_DATASET_STORAGE_KEY, JSON.stringify(d))
}

/**
 * Loads the persisted dataset.
 *
 * A corrupt or invalid stored value returns null rather than a
 * partially-populated dataset: silently resurrecting half of someone's
 * labels is worse than reporting that the store is unreadable.
 */
export function loadDataset(): LabelDataset | null {
  const raw = storage.get(LABEL_DATASET_STORAGE_KEY)
  if (!raw) return null
  const { data, parseError } = parseDataset(raw)
  if (parseError) return null
  const v = validateDataset(data)
  if (!v.ok) return null
  return data as LabelDataset
}

export function clearDataset(): void {
  storage.remove(LABEL_DATASET_STORAGE_KEY)
}

// ------------------------------------------------------------------
// Boundary conversion: positional keys <-> stable ids.
// ------------------------------------------------------------------

/**
 * Converts the labelling page's positional "i:j" map into stable
 * id-keyed pairs. Positional keys never leave the page.
 */
export function fromPositionalLabels(
  selectedTrackIds: readonly string[],
  labels: Readonly<Record<string, { label: PairLabel, source: string }>>,
  datasetVersion = 'phase-19',
): DatasetPair[] {
  const now = new Date().toISOString()
  const out: DatasetPair[] = []
  for (const [key, value] of Object.entries(labels)) {
    const [iRaw, jRaw] = key.split(':')
    const i = Number(iRaw), j = Number(jRaw)
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue
    const a = selectedTrackIds[i]
    const b = selectedTrackIds[j]
    // A label whose track is no longer selected cannot be resolved to
    // a stable id. Dropping it is correct: guessing which track was
    // meant would corrupt the dataset.
    if (!a || !b || a === b) continue
    out.push({
      pairId: canonicalPairId(a, b),
      trackA: a <= b ? a : b,
      trackB: a <= b ? b : a,
      label: value.label,
      source: value.source === 'FIXTURE' ? 'DOCUMENTED_SEED' : 'HUMAN',
      datasetVersion,
      createdAt: now,
      updatedAt: now,
    })
  }
  return out
}

/** Converts stable pairs back to positional keys for the current selection. */
export function toPositionalLabels(
  selectedTrackIds: readonly string[],
  pairs: readonly DatasetPair[],
): Record<string, { label: PairLabel, source: 'HUMAN' | 'FIXTURE' }> {
  const index = new Map(selectedTrackIds.map((id, i) => [id, i]))
  const out: Record<string, { label: PairLabel, source: 'HUMAN' | 'FIXTURE' }> = {}
  for (const p of pairs) {
    const i = index.get(p.trackA)
    const j = index.get(p.trackB)
    if (i === undefined || j === undefined) continue
    const lo = Math.min(i, j), hi = Math.max(i, j)
    out[`${lo}:${hi}`] = {
      label: p.label,
      source: p.source === 'DOCUMENTED_SEED' ? 'FIXTURE' : 'HUMAN',
    }
  }
  return out
}
