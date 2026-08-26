// ============================================================
// SYSTEMA — Audio analysis service (Phase 13)
// ============================================================
// Browser-safe wrapper around the native DSP plugin.
//
// Every function here is callable from anywhere in the app, including
// the web build where no analyser exists. The browser path returns
// null/empty rather than throwing, which is what keeps `npm run dev`
// and the mock catalog working untouched.
//
// Errors are normalised the same way the music library service does
// it: a structured code the caller can branch on, never a raw
// Capacitor exception.
// ============================================================

import {
  AudioAnalysisNative,
  isAudioAnalysisAvailable,
  type AudioAnalysis,
  type AudioAnalysisErrorCode,
  type AudioAnalysisStatus,
  type AudioAnalysisSummary,
} from './audioAnalysisPlugin'

export interface AudioAnalysisFailure {
  code: AudioAnalysisErrorCode
  message: string
}

/** Normalises an unknown thrown value into a structured failure. */
export function toAnalysisError(error: unknown): AudioAnalysisFailure {
  const raw = error as { code?: string, message?: string } | undefined
  const code = (raw?.code ?? 'UNKNOWN') as AudioAnalysisErrorCode
  return { code, message: raw?.message ?? 'Audio analysis failed.' }
}

/**
 * Analyses one track, returning null in the browser.
 *
 * Throws only for genuine native failures, so a caller can distinguish
 * "not supported here" (null) from "this file is broken" (throw with a
 * structured code).
 */
export async function analyzeTrack(
  trackId: string,
  options: { force?: boolean } = {},
): Promise<AudioAnalysis | null> {
  if (!isAudioAnalysisAvailable()) return null
  return AudioAnalysisNative.analyzeTrack({ trackId, force: options.force ?? false })
}

/** Reads a stored analysis. Null when absent, or in the browser. */
export async function getAnalysis(trackId: string): Promise<AudioAnalysis | null> {
  if (!isAudioAnalysisAvailable()) return null
  try {
    const { analysis } = await AudioAnalysisNative.getAnalysis({ trackId })
    return analysis
  } catch (error) {
    // A missing row is an absence, not an error.
    if (toAnalysisError(error).code === 'NOT_FOUND') return null
    throw error
  }
}

export async function getAnalysisStatus(trackId: string): Promise<AudioAnalysisStatus | null> {
  if (!isAudioAnalysisAvailable()) return null
  return AudioAnalysisNative.getAnalysisStatus({ trackId })
}

export async function getAnalysisSummary(): Promise<AudioAnalysisSummary | null> {
  if (!isAudioAnalysisAvailable()) return null
  return AudioAnalysisNative.getAnalysisSummary()
}

/**
 * Queues a bounded background batch.
 *
 * Nothing calls this automatically in Phase 13 — whole-library
 * analysis is deliberately not switched on yet.
 */
export async function enqueueAnalysisBatch(batchSize = 10): Promise<boolean> {
  if (!isAudioAnalysisAvailable()) return false
  const { enqueued } = await AudioAnalysisNative.enqueueBatch({ batchSize })
  return enqueued
}

export async function cancelAnalysis(): Promise<boolean> {
  if (!isAudioAnalysisAvailable()) return false
  const { cancelled } = await AudioAnalysisNative.cancelAnalysis()
  return cancelled
}

// ---- Presentation helpers ------------------------------------
// Formatting only — no DSP knowledge, no thresholds that would
// duplicate a decision the analyser already made.

/** Formats a value for the debug readout, or a dash when unavailable. */
export function formatAnalysisValue(
  value: number | null | undefined,
  unit = '',
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}${unit}`
}

/**
 * Human summary of a tempo reading.
 *
 * A null BPM with a confidence is a real, meaningful outcome: the
 * analyser looked and could not tell. That is shown as such rather
 * than hidden behind a dash.
 */
export function formatBpm(analysis: Pick<AudioAnalysis, 'bpm' | 'bpmConfidence'>): string {
  if (analysis.bpm === null) {
    const confidence = analysis.bpmConfidence
    if (confidence !== null && confidence > 0) {
      return `undetermined (confidence ${(confidence * 100).toFixed(0)}%)`
    }
    return 'undetermined'
  }
  const confidence = analysis.bpmConfidence === null
    ? ''
    : ` (${(analysis.bpmConfidence * 100).toFixed(0)}% confident)`
  return `${analysis.bpm.toFixed(1)} BPM${confidence}`
}
