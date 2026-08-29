/**
 * SYSTEMA — comparison recorder and observability (Phase 22).
 *
 * Joins the pipeline to the store and emits the debug trace. Kept
 * separate from the pipeline so that running a comparison and KEEPING
 * one remain independent decisions: the UI can compare without
 * persisting, and persistence can be tested without a provider.
 *
 * LOGGING
 * -------
 * Off by default, matching `musicLibraryDebug`: a similarity comparison
 * can run per pair in a sweep, and an always-on log would flood the
 * console. Enable with `setSimilarityDebug(true)`.
 *
 * PRIVACY: vectors are never logged. Ids, dimensions, timings and the
 * score only — the same rule ClapLog follows natively.
 */

import type { SimilarityPipeline, ComparePairOptions } from './pipeline'
import { classify } from './pipeline'
import {
  type SimilarityObservation,
  canonicalPairId,
  recordObservation,
} from './store'
import type { AudioInput, SimilarityOutcome } from './types'

const PREFIX = 'AI-SIM'

let debugEnabled = false

/** Enables the debug trace. Off by default; see the note above. */
export function setSimilarityDebug(on: boolean): void {
  debugEnabled = on
}
export function isSimilarityDebugEnabled(): boolean {
  return debugEnabled
}

function debug(stage: string, detail?: Record<string, unknown>): void {
  if (!debugEnabled) return
  if (detail === undefined) console.log(`[${PREFIX}] ${stage}`)
  else console.log(`[${PREFIX}] ${stage}`, detail)
}

function warn(stage: string, detail?: Record<string, unknown>): void {
  // Failures are warned unconditionally. A silent failure in a data
  // collection phase is worse than a noisy one: it produces a gap that
  // looks like a result.
  console.warn(`[${PREFIX}] ${stage}`, detail ?? {})
}

let counter = 0
function nextId(): string {
  counter += 1
  return `sim-${Date.now().toString(36)}-${counter.toString(36)}`
}

export interface RecordOptions extends ComparePairOptions {
  /** Persist the observation. Defaults to true. */
  persist?: boolean
}

export interface RecordedComparison {
  outcome: SimilarityOutcome
  /** The stored record, or null when persistence was skipped. */
  observation: SimilarityObservation | null
}

/**
 * Runs a comparison, traces it, and records it.
 *
 * A FAILED comparison is still recorded, with its error and a NaN-free
 * absence of a score. Knowing that a pair could not be embedded is
 * itself data — silently dropping failures would make the collected set
 * look healthier than it is.
 */
export async function compareAndRecord(
  pipeline: SimilarityPipeline,
  a: AudioInput,
  b: AudioInput,
  options: RecordOptions = {},
): Promise<RecordedComparison> {
  const persist = options.persist ?? true
  debug('COMPARE_START', { trackIdA: a?.trackId, trackIdB: b?.trackId, model: pipeline.modelId })

  const outcome = await pipeline.comparePair(a, b, options)

  if (!outcome.ok) {
    warn('COMPARE_FAILED', {
      trackIdA: outcome.trackIdA,
      trackIdB: outcome.trackIdB,
      model: outcome.model,
      code: outcome.code,
      message: outcome.message,
      failedTrackId: outcome.failedTrackId,
    })
    const failed: SimilarityObservation = {
      id: nextId(),
      pairId: canonicalPairId(outcome.trackIdA, outcome.trackIdB),
      trackIdA: outcome.trackIdA,
      trackIdB: outcome.trackIdB,
      model: outcome.model,
      modelVersion: outcome.modelVersion,
      // A failed comparison has no score. NULL rather than NaN:
      // JSON.stringify writes NaN as null, so storing NaN would mean
      // the record changed shape between memory and disk.
      cosine: null,
      prediction: null,
      experimentalThreshold: null,
      groundTruth: options.groundTruth ?? null,
      createdAt: outcome.createdAt,
      experimental: true,
      error: { code: outcome.code, message: outcome.message },
    }
    if (persist) recordObservation(failed)
    return { outcome, observation: persist ? failed : null }
  }

  const threshold = options.classification?.experimentalThreshold ?? null
  const prediction = threshold === null ? null : classify(outcome.cosine, threshold)

  debug('COMPARE_OK', {
    trackIdA: outcome.trackIdA,
    trackIdB: outcome.trackIdB,
    model: outcome.model,
    modelVersion: outcome.modelVersion,
    cosine: outcome.cosine,
    dimension: outcome.embeddingA.dimension,
    inferenceMsA: outcome.embeddingA.inferenceMs,
    inferenceMsB: outcome.embeddingB.inferenceMs,
    totalMs: outcome.totalMs,
    experimentalThreshold: threshold,
    prediction,
    experimental: true,
  })

  const observation: SimilarityObservation = {
    id: nextId(),
    pairId: canonicalPairId(outcome.trackIdA, outcome.trackIdB),
    trackIdA: outcome.trackIdA,
    trackIdB: outcome.trackIdB,
    model: outcome.model,
    modelVersion: outcome.modelVersion,
    cosine: outcome.cosine,
    prediction,
    experimentalThreshold: threshold,
    // Never inferred from the score.
    groundTruth: options.groundTruth ?? null,
    createdAt: outcome.createdAt,
    experimental: true,
  }

  if (persist) recordObservation(observation)
  return { outcome, observation: persist ? observation : null }
}
