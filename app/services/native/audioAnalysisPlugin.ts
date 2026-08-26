// ============================================================
// SYSTEMA — Audio analysis plugin contract (Phase 13)
// ============================================================
// Typed surface of the native on-device DSP analyser.
//
// This file describes WHAT the analyser returns, never HOW it is
// computed. FFT sizes, window functions, onset detection and tempo
// scoring all live in Kotlin; the web layer sees numbers. Phase 14 can
// replace the entire DSP implementation without touching this file.
//
// Everything is optional-by-nullability on purpose: `null` means the
// analyser could not determine the value, and is meaningfully
// different from `0`. A track whose tempo could not be established
// reports `bpm: null` alongside a `bpmConfidence`, rather than an
// invented number that later phases would treat as fact.
// ============================================================

import { registerPlugin, Capacitor } from '@capacitor/core'

/** Lifecycle of one track's analysis, mirroring the native enum. */
export type AnalysisStatusValue = 'PENDING' | 'COMPLETED' | 'FAILED'

/**
 * Structured failure codes. These cross the bridge as the Capacitor
 * error code, so the UI can distinguish "this file is not supported"
 * from "something went wrong".
 */
export type AudioAnalysisErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'DECODER_ERROR'
  | 'INVALID_URI'
  | 'EMPTY_AUDIO'
  | 'INVALID_PCM'
  | 'DSP_ERROR'
  | 'BPM_UNAVAILABLE'
  | 'CANCELLED'
  | 'OUT_OF_MEMORY'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'
  | 'UNKNOWN'

export interface AudioAnalysis {
  trackId: string

  // ---- Basic -------------------------------------------------
  durationMs: number
  /** Rate the DSP ran at, after downsampling — not the file's rate. */
  sampleRate: number
  /** Channel count of the source file, before the mono downmix. */
  channels: number
  analyzedSampleCount: number

  // ---- Amplitude / energy ------------------------------------
  /** Mean RMS amplitude, linear 0..1. */
  rms: number | null
  /** Highest absolute sample, linear 0..1. */
  peak: number | null
  /** Spread between loud and quiet passages, in dB. */
  dynamicRangeDb: number | null
  /** Fraction of windows below the silence threshold, 0..1. */
  silenceRatio: number | null

  // ---- Spectral (Hz) -----------------------------------------
  spectralCentroid: number | null
  spectralCentroidMin: number | null
  spectralCentroidMax: number | null
  spectralBandwidth: number | null
  spectralRolloff: number | null
  /** 0..1 — fraction of adjacent samples that change sign. */
  zeroCrossingRate: number | null

  // ---- Tempo -------------------------------------------------
  /** Null when confidence was too low to report a number honestly. */
  bpm: number | null
  /** 0..1. Present even when `bpm` is null. */
  bpmConfidence: number | null

  // ---- Loudness ----------------------------------------------
  /**
   * RMS-DERIVED loudness in dBFS. Deliberately NOT called LUFS: a true
   * ITU-R BS.1770 measurement needs K-weighting and gated blocks,
   * which this pipeline does not implement. Comparable between tracks
   * analysed by this same analyzer version; not comparable with
   * broadcast loudness figures.
   */
  loudnessDbfs: number | null

  // ---- Provenance & instrumentation --------------------------
  analyzerVersion: number
  analyzedAt: number
  decodeTimeMs: number
  dspTimeMs: number
  totalAnalysisTimeMs: number
  /** analysisTime / audioDuration. 0.1 = ten times faster than real time. */
  realTimeFactor: number | null
}

export interface AudioAnalysisStatus {
  trackId: string
  status: AnalysisStatusValue
  /** DSP version that produced the stored result, if any. */
  analyzerVersion: number | null
  /** True when missing, stale, or retryable. */
  needsAnalysis: boolean
  errorCode: AudioAnalysisErrorCode | null
  attemptCount: number
}

export interface AudioAnalysisSummary {
  analyzerVersion: number
  completed: number
  failed: number
  pending: number
  /** True when a WorkManager analysis job is queued or running. */
  busy: boolean
}

export interface AudioAnalysisPlugin {
  analyzeTrack(options: { trackId: string, force?: boolean }): Promise<AudioAnalysis>
  getAnalysis(options: { trackId: string }): Promise<{ analysis: AudioAnalysis | null }>
  getAnalysisStatus(options: { trackId: string }): Promise<AudioAnalysisStatus>
  getAnalysisSummary(): Promise<AudioAnalysisSummary>
  enqueueBatch(options: { batchSize?: number }): Promise<{ enqueued: boolean }>
  cancelAnalysis(): Promise<{ cancelled: boolean }>
}

export const AudioAnalysisNative = registerPlugin<AudioAnalysisPlugin>('AudioAnalysis')

/**
 * True only when the real native analyser is present.
 *
 * In the browser there is no decoder and no MediaStore, so every entry
 * point in the service layer short-circuits rather than throwing. The
 * web build must keep working — that is what `npm run dev` uses.
 */
export function isAudioAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AudioAnalysis')
}
