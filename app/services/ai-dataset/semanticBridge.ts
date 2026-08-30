/**
 * SYSTEMA — semantic analysis → dataset bridge (Phase 29).
 *
 * The seam between the model-agnostic provider layer and persistence.
 * Maps a `SemanticAnalysisResult` onto the stored `SemanticAnalysis`
 * and writes it to the row the embedding analysis already created.
 *
 * WHY THIS IS A SEPARATE FILE FROM datasetBridge.ts
 * -------------------------------------------------
 * datasetBridge writes measurements and the embedding; this writes
 * predictions. They target the same row but different regions, run at
 * different times, and can fail independently — a semantic model that
 * is not installed must not stop DSP and embedding data being
 * collected. Keeping them apart makes that independence structural
 * rather than something a future edit has to remember.
 */

import type { SemanticAnalysisResult } from '../music-semantics/types'
import { datasetRecordId } from './datasetRecord'
import { getRecord, saveSemanticAnalysis } from './datasetService'
import {
  SEMANTIC_ANALYZER_VERSION,
  type SemanticAnalysis,
  isSameSemanticBuild,
} from './semanticRecord'

export interface SemanticPersistOutcome {
  ok: boolean
  /** The dataset row id that was written, when known. */
  id: string | null
  error?: string
}

/**
 * Converts a provider result into the stored shape.
 *
 * A pure mapping with no defaults invented: every value comes from the
 * result. `source: 'model'` is stamped here and nowhere else, so there
 * is exactly one place a prediction can be marked as model output.
 */
export function toStoredSemantic(result: SemanticAnalysisResult): SemanticAnalysis {
  return {
    model: result.model,
    modelVersion: result.modelVersion,
    analyzerVersion: SEMANTIC_ANALYZER_VERSION,
    heads: result.heads.map(h => ({
      field: h.field,
      head: h.head,
      headVersion: h.headVersion,
      activation: h.activation,
      multiLabel: h.multiLabel,
      classCount: h.classCount,
      // The complete ranked list, copied wholesale. Never sliced.
      predictions: h.predictions.map(p => ({ label: p.label, score: p.score })),
    })),
    unsupported: result.unsupported.map(u => ({ field: u.field, reason: u.reason })),
    // Copied, not referenced: the caller keeps its own array and a
    // later mutation there must not rewrite what was stored.
    embedding: result.embedding ? [...result.embedding] : null,
    embeddingDim: result.embeddingDim ?? result.embedding?.length ?? null,
    sourceDurationSec: result.sourceDurationSec,
    processedDurationSec: result.processedDurationSec,
    sampleRate: result.sampleRate,
    decodeMs: result.decodeMs,
    inferenceMs: result.inferenceMs,
    analyzedAt: result.analyzedAt,
    experimental: true,
    source: 'model',
  }
}

/**
 * Writes a semantic result onto an existing dataset row.
 *
 * The row is located by the SAME identity tuple the embedding analysis
 * used, so predictions land on the row that already holds the audio
 * measurements for that model build rather than creating a parallel
 * one.
 *
 * Never throws: a data-collection failure must not break the player.
 */
export async function persistSemanticToDataset(
  result: SemanticAnalysisResult,
  embeddingModel: string,
  embeddingModelVersion: string,
  embeddingAnalyzerVersion: number,
): Promise<SemanticPersistOutcome> {
  try {
    const id = datasetRecordId(
      result.trackId,
      embeddingModel,
      embeddingModelVersion,
      embeddingAnalyzerVersion,
    )

    const res = await saveSemanticAnalysis(id, toStoredSemantic(result))
    return {
      ok: res.ok,
      id: res.record?.id ?? (res.ok ? id : null),
      error: res.ok ? undefined : (res.error ?? 'The semantic analysis was not saved.'),
    }
  } catch (e) {
    return {
      ok: false,
      id: null,
      error: (e as Error)?.message ?? 'The semantic analysis was not saved.',
    }
  }
}

/**
 * A stored semantic analysis for this track and model build, if any.
 *
 * This is the cache. It is the DATABASE, not a second in-memory store:
 * the row is already the source of truth, and adding a parallel cache
 * would create two things that can disagree.
 *
 * Returns null when the stored analysis came from a different model or
 * analyzer version — scores from two builds are not comparable, so an
 * old one must not be shown as if it were current.
 */
export async function cachedSemanticFor(
  trackId: string,
  embeddingModel: string,
  embeddingModelVersion: string,
  embeddingAnalyzerVersion: number,
  semanticModel: string,
  semanticModelVersion: string,
): Promise<SemanticAnalysis | null> {
  try {
    const id = datasetRecordId(
      trackId,
      embeddingModel,
      embeddingModelVersion,
      embeddingAnalyzerVersion,
    )
    const record = await getRecord(id)
    const stored = record?.semantic ?? null
    if (!stored) return null

    return isSameSemanticBuild(stored, semanticModel, semanticModelVersion)
      ? stored
      : null
  } catch {
    return null
  }
}
