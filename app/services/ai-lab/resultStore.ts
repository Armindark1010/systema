// ============================================================
// SYSTEMA — Phase 14: benchmark result persistence
// ============================================================
// Storage for benchmark runs, deliberately kept OUTSIDE the Phase 13
// Room database.
//
// Why isolated storage (§21, §22)
// -------------------------------
// The Phase 13 analysis database is production data with a migration
// history and a schema version. Benchmark results are throwaway
// research artefacts whose shape will change every time a metric is
// added. Putting them in the same database would force a Room
// migration for every experiment and put real user data at risk for
// no benefit. So Phase 14 uses its own key-value namespace and leaves
// the Room schema at version 2, untouched.
//
// What is stored: metrics and metadata only. Never audio, never
// embeddings, never file paths (§11, §20).
// ============================================================

import type { BenchmarkRun } from './types'
// Relative rather than aliased so this module can be imported directly
// by the tsx test suites, matching the convention in services/search
// and services/persistence.
import { createLocalStorageAdapter } from '../persistence/storageAdapter'
import type { StorageAdapter } from '../persistence/storageAdapter'

export const BENCHMARK_RUNS_KEY = 'systema:ai-lab:runs'
export const PRODUCTION_MODEL_KEY = 'systema:ai-lab:production-model'
export const BENCHMARK_TARGETS_KEY = 'systema:ai-lab:targets'

/**
 * Ceiling on retained runs.
 *
 * Benchmark history is useful but unbounded growth in localStorage is
 * not. Oldest runs are dropped first; export before you hit this.
 */
export const MAX_STORED_RUNS = 50

let storage: StorageAdapter = createLocalStorageAdapter()

/**
 * Replaces the backing store.
 *
 * Exists for the test suite, which runs outside a browser: the
 * localStorage adapter guards on `import.meta.client` and correctly
 * no-ops under a bare Node runner. Injecting an in-memory adapter
 * lets the persistence contract be tested for real rather than
 * asserted from the source text.
 */
export function setStorageAdapter(adapter: StorageAdapter): void {
  storage = adapter
}

/** Restores the default browser-backed adapter. */
export function resetStorageAdapter(): void {
  storage = createLocalStorageAdapter()
}

/** A simple in-memory adapter, for tests and non-browser contexts. */
export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>()
  return {
    get: key => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: key => void map.delete(key),
  }
}

/**
 * Reads all stored runs, newest first.
 *
 * Tolerates corrupt data by returning an empty list: a broken
 * research store must never prevent the app from starting.
 */
export function loadRuns(): BenchmarkRun[] {
  const raw = storage.get(BENCHMARK_RUNS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isPlausibleRun)
      .sort((a, b) => b.timestamp - a.timestamp)
  } catch {
    return []
  }
}

/** Minimal shape check so one malformed entry cannot poison the list. */
function isPlausibleRun(value: unknown): value is BenchmarkRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<BenchmarkRun>
  return typeof run.id === 'string'
    && typeof run.timestamp === 'number'
    && typeof run.modelId === 'string'
    && Array.isArray(run.samples)
}

/** Persists a run, trimming the oldest beyond the cap. */
export function saveRun(run: BenchmarkRun): void {
  const runs = [run, ...loadRuns().filter(r => r.id !== run.id)]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_STORED_RUNS)
  write(runs)
}

export function deleteRun(runId: string): void {
  write(loadRuns().filter(r => r.id !== runId))
}

export function clearRuns(): void {
  storage.remove(BENCHMARK_RUNS_KEY)
}

export function getRun(runId: string): BenchmarkRun | null {
  return loadRuns().find(r => r.id === runId) ?? null
}

function write(runs: BenchmarkRun[]): void {
  try {
    storage.set(BENCHMARK_RUNS_KEY, JSON.stringify(runs))
  } catch {
    // Quota exhaustion must not crash the lab.
  }
}

// ---- Production model selection (§28) ---------------------------

export interface ProductionSelection {
  selectedModelId: string
  selectedAt: number
  /** The run that justified the choice, for traceability. */
  justifyingRunId: string | null
  /** Required: a human must say why. */
  rationale: string
}

/**
 * Reads the production model selection.
 *
 * Null is a valid, expected answer and the UI renders it as
 * "NO PRODUCTION MODEL SELECTED". Phase 14 never writes this
 * automatically — only an explicit human action does.
 */
export function loadProductionSelection(): ProductionSelection | null {
  const raw = storage.get(PRODUCTION_MODEL_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ProductionSelection>
    if (typeof parsed.selectedModelId !== 'string' || !parsed.selectedModelId) return null
    return {
      selectedModelId: parsed.selectedModelId,
      selectedAt: typeof parsed.selectedAt === 'number' ? parsed.selectedAt : 0,
      justifyingRunId: typeof parsed.justifyingRunId === 'string' ? parsed.justifyingRunId : null,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch {
    return null
  }
}

export function saveProductionSelection(selection: ProductionSelection): void {
  storage.set(PRODUCTION_MODEL_KEY, JSON.stringify(selection))
}

export function clearProductionSelection(): void {
  storage.remove(PRODUCTION_MODEL_KEY)
}

// ---- Export (§20) -----------------------------------------------

export interface BenchmarkExport {
  exportVersion: number
  exportedAt: string
  /** Restated in the payload so a shared file cannot be misread. */
  disclaimer: string
  runs: BenchmarkRun[]
}

/**
 * Serialises runs to JSON.
 *
 * Metrics and metadata only. There is no code path that could put
 * audio in here — the runner never retains audio past a frame, and
 * SampleResult has no field for it.
 */
export function exportRuns(runs: BenchmarkRun[]): string {
  const payload: BenchmarkExport = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    disclaimer:
      'SYSTEMA Phase 14 benchmark export. Metrics and metadata only — contains no '
      + 'audio, no embeddings and no file paths. Runs marked DESKTOP were not measured '
      + 'on a phone and must not be read as device performance. Runs marked SYNTHETIC '
      + 'validate the harness, not a real model.',
    runs,
  }
  return JSON.stringify(payload, null, 2)
}

/** Suggested filename for an export. */
export function exportFilename(runs: BenchmarkRun[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const scope = runs.length === 1 ? runs[0]!.modelId : `${runs.length}-runs`
  return `systema-benchmark-${scope}-${stamp}.json`
}
