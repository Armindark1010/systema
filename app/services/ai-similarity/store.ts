/**
 * SYSTEMA — similarity observation store (Phase 22).
 *
 * WHY A NEW STORE RATHER THAN EXTENDING AN EXISTING ONE
 * -----------------------------------------------------
 * Three stores already exist and none of them fits:
 *
 *   `resultStore` (systema:ai-lab:runs) holds BenchmarkRun — a whole
 *   benchmark execution with performance, memory, reliability and
 *   reproducibility blocks. A single pair comparison is not a run.
 *
 *   `labelDataset` (systema:ai-lab:label-dataset) holds GROUND TRUTH
 *   only, by design. Writing model output into it would mix what a
 *   human asserted with what a model predicted — exactly the confusion
 *   this phase must avoid.
 *
 *   The labelled evaluation's cosines are held in a Vue ref and never
 *   persisted at all.
 *
 * So this is the smallest new thing that covers the gap: one flat
 * record per comparison, keyed by its own storage key, following the
 * same adapter pattern the other two stores use.
 *
 * PREDICTION AND GROUND TRUTH ARE SEPARATE FIELDS and always will be.
 * `prediction` is what a model said under some experimental threshold;
 * `groundTruth` is what a human asserted. They may disagree — that
 * disagreement is the entire point of collecting this data. Ground
 * truth is null when unknown, never inferred from the score.
 */

import type { GroundTruth, SimilarityPrediction } from './types'

export const SIMILARITY_OBSERVATIONS_KEY = 'systema:ai-similarity:observations'
export const SIMILARITY_SCHEMA_VERSION = 1

/**
 * Cap on retained observations.
 *
 * localStorage is a small shared quota that also holds the user's
 * library, playlists and playback state. Losing the oldest experimental
 * measurements is recoverable; evicting the user's data is not.
 */
export const MAX_OBSERVATIONS = 2000

/** One recorded comparison. */
export interface SimilarityObservation {
  /** Stable id for this observation. */
  id: string
  /** Canonical pair identity, order-independent. */
  pairId: string
  trackIdA: string
  trackIdB: string
  model: string
  modelVersion: string
  /**
   * The raw score. Preserved exactly; never rounded or bucketed.
   *
   * NULL for a failed comparison. Not NaN: JSON.stringify turns NaN
   * into null on write, so a NaN here would silently change type
   * across a save/load cycle. Making the absence explicit keeps the
   * stored shape and the in-memory shape identical.
   */
  cosine: number | null
  /**
   * What the model said, under `experimentalThreshold`. Null when no
   * classification was requested — the common case, since the raw
   * score is what evaluation needs.
   */
  prediction: SimilarityPrediction | null
  /**
   * The threshold that produced `prediction`. EXPERIMENTAL. Recorded
   * alongside the prediction so an old record can always be reread
   * under a different rule.
   */
  experimentalThreshold: number | null
  /**
   * What a human asserted. NULL when unknown. Never inferred from the
   * cosine, and never filled in to make a record look complete.
   */
  groundTruth: GroundTruth | null
  createdAt: string
  /** True for every provider we currently have. */
  experimental: boolean
  /** Set when the comparison failed; the record is kept as a diagnostic. */
  error?: { code: string, message: string }
}

export interface SimilarityObservationSet {
  schemaVersion: number
  observations: SimilarityObservation[]
}

export interface StorageAdapter {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

function createLocalStorageAdapter(): StorageAdapter {
  return {
    get: (k) => {
      if (typeof localStorage === 'undefined') return null
      try { return localStorage.getItem(k) } catch { return null }
    },
    set: (k, v) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.setItem(k, v) } catch { /* quota; see MAX_OBSERVATIONS */ }
    },
    remove: (k) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.removeItem(k) } catch { /* nothing useful to do */ }
    },
  }
}

let storage: StorageAdapter = createLocalStorageAdapter()

/** Replaces the backing store. Same rationale as the other ai-lab stores. */
export function setStorageAdapter(adapter: StorageAdapter): void {
  storage = adapter
}
export function resetStorageAdapter(): void {
  storage = createLocalStorageAdapter()
}

export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>()
  return {
    get: k => map.get(k) ?? null,
    set: (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
  }
}

/**
 * Order-independent pair identity.
 *
 * cos(a,b) == cos(b,a), so a pair recorded in either order is the same
 * observation and must collapse to one key.
 */
export function canonicalPairId(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

function isObservation(v: unknown): v is SimilarityObservation {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.pairId === 'string'
    && typeof o.model === 'string'
    // null is valid: a failed comparison has no score.
    && (o.cosine === null || typeof o.cosine === 'number')
}

/** Loads stored observations. A corrupt store returns empty, not partial. */
export function loadObservations(): SimilarityObservation[] {
  const raw = storage.get(SIMILARITY_OBSERVATIONS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SimilarityObservationSet
    if (!parsed || !Array.isArray(parsed.observations)) return []
    return parsed.observations.filter(isObservation)
  } catch {
    return []
  }
}

export function saveObservations(observations: readonly SimilarityObservation[]): void {
  // Keep the newest. Oldest experimental data is the cheapest to lose.
  const trimmed = observations.slice(-MAX_OBSERVATIONS)
  const payload: SimilarityObservationSet = {
    schemaVersion: SIMILARITY_SCHEMA_VERSION,
    observations: trimmed,
  }
  storage.set(SIMILARITY_OBSERVATIONS_KEY, JSON.stringify(payload))
}

/** Appends one observation and persists. Returns the stored list. */
export function recordObservation(o: SimilarityObservation): SimilarityObservation[] {
  const all = [...loadObservations(), o]
  saveObservations(all)
  return loadObservations()
}

export function clearObservations(): void {
  storage.remove(SIMILARITY_OBSERVATIONS_KEY)
}

/**
 * Attaches ground truth to an existing observation.
 *
 * Separate from recording, because ground truth usually arrives later —
 * a human labels the pair after the model has already scored it.
 */
export function attachGroundTruth(
  pairId: string,
  groundTruth: GroundTruth | null,
): SimilarityObservation[] {
  const all = loadObservations().map(o =>
    o.pairId === pairId ? { ...o, groundTruth } : o,
  )
  saveObservations(all)
  return loadObservations()
}

/**
 * Converts observations into the shape the EXISTING threshold analysis
 * already consumes.
 *
 * This is the bridge to the evaluation infrastructure: `analyseThresholds`
 * takes `{ label, cosine }` pairs, so collected real-world data can be
 * fed into the same AUC / sweep / overlap code that produced the
 * 190-pair report — without either side knowing about the other.
 *
 * Only observations with KNOWN ground truth are emitted. An unlabelled
 * pair has nothing to be evaluated against, and defaulting it to a
 * label would fabricate exactly the data this phase must not invent.
 */
export function toAnalysablePairs(
  observations: readonly SimilarityObservation[] = loadObservations(),
): { trackA: string, trackB: string, label: string, cosine: number }[] {
  return observations
    .filter(o =>
      o.groundTruth !== null && o.groundTruth !== undefined
      && !o.error
      && typeof o.cosine === 'number' && Number.isFinite(o.cosine),
    )
    .map(o => ({
      trackA: o.trackIdA,
      trackB: o.trackIdB,
      label: o.groundTruth as string,
      cosine: o.cosine as number,
    }))
}
