// ============================================================
// SYSTEMA — AudioAnalysis native plugin contract
// ============================================================
// TypeScript mirror of the Kotlin `AudioAnalysisPlugin`.
//
//   Vue -> Pinia -> this service -> Capacitor -> Kotlin
//        -> AudioAnalysisRepository -> Room / WorkManager
//
// Provides real on-device audio DSP analysis for tracks.
// This is Phase 13: the reliable DSP foundation for future AI features.
// ============================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * One audio analysis result.
 *
 * All feature values are nullable because:
 * - Some features may fail to compute for certain audio
 * - We want to distinguish "feature not computed" from "feature is zero"
 * - Future algorithm changes can gracefully handle missing values
 *
 * Loudness note: The current implementation uses RMS-derived loudness
 * approximation in dBFS (decibels relative to full scale). This is NOT LUFS.
 * LUFS requires K-weighting which we do not implement.
 *
 * BPM note: Tempo estimation may return null if confidence is too low.
 * The half/double tempo ambiguity is handled by the algorithm.
 */
export interface AudioAnalysis {
  /** The track ID this analysis belongs to. */
  songId: string

  /** Duration of the audio in milliseconds. */
  durationMs: number

  /** Sample rate of the decoded audio in Hz. */
  sampleRate: number

  /** Number of audio channels. */
  channels: number

  /** Total number of samples analyzed. */
  analyzedSampleCount: number

  // ---------------------------------------------------------------
  // Amplitude / Energy features
  // ---------------------------------------------------------------

  /**
   * Root Mean Square amplitude (0.0 to 1.0, where 1.0 is full scale).
   * Null if not computed.
   */
  rms: number | null

  /**
   * Peak amplitude (0.0 to 1.0, where 1.0 is full scale).
   * Null if not computed.
   */
  peak: number | null

  /**
   * Dynamic range estimate in dB.
   * Difference between peak and RMS in dB.
   * Null if not computed.
   */
  dynamicRangeDb: number | null

  /**
   * Ratio of silent samples to total samples (0.0 to 1.0).
   * Null if not computed.
   */
  silenceRatio: number | null

  // ---------------------------------------------------------------
  // Spectral features
  // ---------------------------------------------------------------

  /**
   * Spectral centroid in Hz.
   * The "center of mass" of the spectrum.
   * Higher values indicate brighter, more high-frequency content.
   * Null if not computed.
   */
  spectralCentroid: number | null

  /**
   * Spectral bandwidth in Hz.
   * Measure of the spread of the spectrum.
   * Null if not computed.
   */
  spectralBandwidth: number | null

  /**
   * Spectral rolloff in Hz.
   * The frequency below which 85% of the spectral energy is contained.
   * Null if not computed.
   */
  spectralRolloff: number | null

  /**
   * Zero-crossing rate (crossings per second).
   * Measure of how often the signal changes sign.
   * Null if not computed.
   */
  zeroCrossingRate: number | null

  // ---------------------------------------------------------------
  // Tempo features
  // ---------------------------------------------------------------

  /**
   * Estimated tempo in beats per minute.
   * Null if confidence is too low or BPM could not be determined.
   */
  bpm: number | null

  /**
   * Confidence in the BPM estimate (0.0 to 1.0).
   * Null if BPM is null.
   */
  bpmConfidence: number | null

  // ---------------------------------------------------------------
  // Loudness
  // ---------------------------------------------------------------

  /**
   * Loudness estimate in dBFS (decibels relative to full scale).
   * This is RMS-derived, NOT LUFS.
   * Range: typically -60dB to 0dB, where 0dB is maximum possible.
   * Null if not computed.
   */
  loudnessDb: number | null

  // ---------------------------------------------------------------
  // Performance metrics
  // ---------------------------------------------------------------

  /** Time spent decoding in milliseconds. */
  decodeTimeMs: number

  /** Time spent in DSP computation in milliseconds. */
  dspTimeMs: number

  /** Total analysis time in milliseconds. */
  totalAnalysisTimeMs: number

  /** Real-time factor: analysisTime / audioDuration. */
  realTimeFactor: number

  // ---------------------------------------------------------------
  // Versioning
  // ---------------------------------------------------------------

  /** Version of the analyzer that produced this result. */
  analyzerVersion: number

  /** Timestamp when analysis was performed (epoch milliseconds). */
  analyzedAt: number

  // ---------------------------------------------------------------
  // Error tracking
  // ---------------------------------------------------------------

  /** Error code if analysis failed, null otherwise. */
  errorCode: string | null

  /** Error message if analysis failed, null otherwise. */
  errorMessage: string | null
}

/** Analysis status for a track. */
export type AnalysisStatusState = 'pending' | 'in_progress' | 'complete' | 'failed'

export interface AnalysisStatus {
  state: AnalysisStatusState
  errorCode?: string
  errorMessage?: string
}

/** Statistics about analysis coverage. */
export interface AnalysisStatistics {
  /** Total number of tracks in the library. */
  totalTracks: number

  /** Number of tracks that have been successfully analyzed. */
  analyzedCount: number

  /** Number of tracks where analysis failed. */
  failedCount: number

  /** Number of tracks pending analysis. */
  pendingCount: number
}

/** Result of scheduling analysis. */
export interface ScheduleAnalysisResult {
  scheduled: boolean
  alreadyExists?: boolean
}

/** Result of cancelling analysis. */
export interface CancelAnalysisResult {
  cancelled: boolean
}

/** Result of checking if reanalysis is needed. */
export interface NeedsReanalysisResult {
  needsReanalysis: boolean
}

/**
 * The native surface for audio analysis.
 *
 * Analysis is asynchronous and event-driven. The frontend can:
 * - Request analysis for specific tracks
 * - Query analysis results
 * - Check analysis status
 * - Get statistics
 *
 * Events are NOT emitted by this plugin (unlike MusicLibrary).
 * Instead, the frontend polls for status using getAnalysisStatus().
 * This keeps the API simple for Phase 13.
 */
export interface AudioAnalysisPlugin {
  /**
   * Start analysis for a single track.
   * Returns immediately; analysis happens in the background.
   * 
   * @param trackId ID of the track to analyze
   * @returns { scheduled: boolean, alreadyExists?: boolean }
   */
  analyzeTrack(options: { trackId: string }): Promise<ScheduleAnalysisResult>

  /**
   * Start analysis for multiple tracks.
   * Returns immediately; analysis happens in the background.
   * 
   * @param trackIds Array of track IDs to analyze
   * @returns { scheduled: number } Number of tracks scheduled
   */
  analyzeTracks(options: { trackIds: string[] }): Promise<{ scheduled: number }>

  /**
   * Get analysis result for a track.
   * 
   * @param trackId ID of the track
   * @returns { analysis: AudioAnalysis | null }
   */
  getAnalysis(options: { trackId: string }): Promise<{ analysis: AudioAnalysis | null }>

  /**
   * Get analysis status for a track.
   * 
   * @param trackId ID of the track
   * @returns { status: AnalysisStatus }
   */
  getAnalysisStatus(options: { trackId: string }): Promise<{ status: AnalysisStatus }>

  /**
   * Get overall analysis statistics.
   * 
   * @returns { statistics: AnalysisStatistics }
   */
  getStatistics(): Promise<{ statistics: AnalysisStatistics }>

  /**
   * Check if a track needs re-analysis.
   * 
   * @param trackId ID of the track
   * @returns { needsReanalysis: boolean }
   */
  needsReanalysis(options: { trackId: string }): Promise<NeedsReanalysisResult>

  /**
   * Cancel analysis for a specific track.
   * 
   * @param trackId ID of the track
   * @returns { cancelled: boolean }
   */
  cancelAnalysis(options: { trackId: string }): Promise<CancelAnalysisResult>

  /**
   * Cancel all pending analysis.
   * 
   * @returns { cancelled: boolean }
   */
  cancelAllAnalysis(): Promise<CancelAnalysisResult>
}

/**
 * Must match @CapacitorPlugin(name = "AudioAnalysis") in
 * AudioAnalysisPlugin.kt exactly.
 */
export const PLUGIN_NAME = 'AudioAnalysis'

export const AudioAnalysis = registerPlugin<AudioAnalysisPlugin>(PLUGIN_NAME)

/**
 * Current Capacitor platform, or 'unknown' when Capacitor is absent.
 */
export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'unknown'
  }
}

/**
 * True only on a native Android build that actually registered the plugin.
 */
export function isNativeAnalysisAvailable(): boolean {
  try {
    const native = Capacitor.isNativePlatform()
    const platform = Capacitor.getPlatform()
    const registered = Capacitor.isPluginAvailable(PLUGIN_NAME)

    if (native && platform === 'android' && !registered) {
      console.warn(
        `[SYSTEMA/ANALYSIS] Running on Android but the "${PLUGIN_NAME}" plugin is not `
        + 'registered. Check registerPlugin(AudioAnalysisPlugin.class) in MainActivity.',
      )
    }

    return native && platform === 'android' && registered
  } catch {
    return false
  }
}
