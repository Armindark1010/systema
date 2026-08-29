/**
 * SYSTEMA — Full Player → dataset (Phase 28).
 *
 * Maps a Phase 27 single-track analysis onto a dataset row and
 * persists it, so pressing Analyze in the player collects data without
 * anyone visiting /dev/ai-dataset.
 *
 * This adapter exists so neither side has to know the other: the
 * analysis service stays a pure "analyse one track" contract, and the
 * dataset layer stays model-agnostic. Nothing here can write a label —
 * `saveAnalysis` carries measurements and a vector only, and the
 * service copies any existing ground truth forward untouched.
 */

import { initDataset } from './index'
import { saveAnalysis } from './datasetService'
import type { DatasetTrackIdentity } from './datasetRecord'
import type { TrackAnalysisRecord } from '../ai-similarity/trackAnalysis'
import type { AudioInput } from '../ai-similarity/types'

/**
 * Version of the analysis PIPELINE that produced a row.
 *
 * Distinct from the model version: the same model behind different
 * windowing or pooling produces different vectors, and a dataset that
 * cannot tell those apart is not reproducible. Bump this when the
 * pipeline changes shape, not when the model file changes.
 */
export const ANALYZER_VERSION = 1

/** The DSP fields the player already reads. */
export interface DspSnapshot {
  bpm: number | null
  bpmConfidence: number | null
  loudnessDbfs: number | null
  dynamicRangeDb: number | null
  rms: number | null
  spectralCentroid: number | null
  zeroCrossingRate: number | null
  silenceRatio: number | null
  peak?: number | null
  spectralBandwidth?: number | null
  spectralRolloff?: number | null
}

export interface PersistOutcome {
  ok: boolean
  id: string | null
  error?: string
}

/**
 * Writes one analysis into the dataset.
 *
 * Never throws: a data-collection failure must not break the player's
 * result display. A problem is returned so the sheet can mention it
 * rather than silently losing the row.
 */
export async function persistAnalysisToDataset(
  record: TrackAnalysisRecord,
  track: AudioInput,
  dsp: DspSnapshot | null,
): Promise<PersistOutcome> {
  try {
    await initDataset()

    const identity: DatasetTrackIdentity = {
      trackId: record.trackId,
      title: track.title ?? null,
      artist: (track as { artist?: string }).artist ?? null,
      album: (track as { album?: string }).album ?? null,
      // Needed to re-decode for reproducibility. Never logged.
      sourceUri: track.uri ?? null,
    }

    const res = await saveAnalysis({
      track: identity,
      measurements: {
        bpm: dsp?.bpm ?? null,
        bpmConfidence: dsp?.bpmConfidence ?? null,
        loudnessDbfs: dsp?.loudnessDbfs ?? null,
        dynamicRangeDb: dsp?.dynamicRangeDb ?? null,
        peak: dsp?.peak ?? null,
        rms: dsp?.rms ?? null,
        spectralCentroid: dsp?.spectralCentroid ?? null,
        spectralBandwidth: dsp?.spectralBandwidth ?? null,
        spectralRolloff: dsp?.spectralRolloff ?? null,
        zeroCrossingRate: dsp?.zeroCrossingRate ?? null,
        silenceRatio: dsp?.silenceRatio ?? null,
        sourceDurationSec: record.audio.durationSec,
        analysedDurationSec: record.audio.processedDurationSec,
        sourceSampleRate: record.audio.sourceSampleRate,
        modelSampleRate: record.audio.modelSampleRate,
        windowsProcessed: record.audio.windowsProcessed,
      },
      embedding: record.embedding.vector.length
        ? {
            // The complete vector, exactly as produced.
            vector: record.embedding.vector,
            dimension: record.embedding.dimension,
            model: record.model.id,
            modelVersion: record.model.version,
            normalized: record.embedding.normalised,
            preNormalizationL2: record.embedding.preNormL2,
          }
        : null,
      analyzerVersion: ANALYZER_VERSION,
      analysisDurationMs: record.timings.totalMs,
      decodeDurationMs: record.timings.decodeMs,
      inferenceDurationMs: record.timings.inferenceMs,
      status: 'COMPLETED',
    })

    return {
      ok: res.ok,
      id: res.record?.id ?? null,
      error: res.ok ? undefined : (res.error ?? 'The analysis was not saved to the dataset.'),
    }
  } catch (e) {
    return {
      ok: false,
      id: null,
      error: (e as Error)?.message ?? 'The analysis was not saved to the dataset.',
    }
  }
}
