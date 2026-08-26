package com.systema.music.analysis

/**
 * Result of audio DSP analysis for a single track.
 *
 * All feature values are nullable because:
 * - Some features may fail to compute for certain audio (e.g., silence detection on silent tracks)
 * - We want to distinguish "feature not computed" from "feature is zero"
 * - Future algorithm changes can gracefully handle missing values
 *
 * Loudness note: The current implementation uses RMS-derived loudness approximation.
 * This is NOT LUFS. LUFS requires a specific weighting filter (K-weighting) and
 * reference level that we do not implement here. The value is a simple RMS
 * measurement in dBFS (decibels relative to full scale).
 *
 * BPM note: Tempo estimation may return null if confidence is too low.
 * The half/double tempo ambiguity is handled by the algorithm, but perfect
 * accuracy cannot be guaranteed for all music.
 */
data class AudioAnalysisResult(
    /** The track ID this analysis belongs to. */
    val songId: String,
    
    /** Duration of the audio in milliseconds. */
    val durationMs: Long,
    
    /** Sample rate of the decoded audio in Hz. */
    val sampleRate: Int,
    
    /** Number of audio channels. */
    val channels: Int,
    
    /** Total number of samples analyzed. */
    val analyzedSampleCount: Long,
    
    // ---------------------------------------------------------------
    // Amplitude / Energy features
    // ---------------------------------------------------------------
    
    /** Root Mean Square amplitude (0.0 to 1.0, where 1.0 is full scale). */
    val rms: Float?,
    
    /** Peak amplitude (0.0 to 1.0, where 1.0 is full scale). */
    val peak: Float?,
    
    /** Dynamic range estimate (dB). Difference between peak and RMS in dB. */
    val dynamicRangeDb: Float?,
    
    /** Ratio of silent samples to total samples (0.0 to 1.0).
     * Silence is defined as samples with RMS below the threshold.
     * Uses the silenceThresholdDb from AudioAnalysisConfig. */
    val silenceRatio: Float?,
    
    // ---------------------------------------------------------------
    // Spectral features
    // ---------------------------------------------------------------
    
    /** Spectral centroid in Hz. The "center of mass" of the spectrum.
     * Higher values indicate brighter, more high-frequency content. */
    val spectralCentroid: Float?,
    
    /** Spectral bandwidth in Hz. Measure of the spread of the spectrum.
     * Higher values indicate a wider frequency distribution. */
    val spectralBandwidth: Float?,
    
    /** Spectral rolloff in Hz. The frequency below which a certain
     * percentage (typically 85-95%) of the spectral energy is contained.
     * We use 85% as a reasonable default. */
    val spectralRolloff: Float?,
    
    /** Zero-crossing rate (crossings per second). Measure of how often
     * the signal changes sign. Higher values indicate more high-frequency
     * content or noise-like signals. */
    val zeroCrossingRate: Float?,
    
    // ---------------------------------------------------------------
    // Tempo features
    // ---------------------------------------------------------------
    
    /** Estimated tempo in beats per minute. Null if confidence is too low. */
    val bpm: Float?,
    
    /** Confidence in the BPM estimate (0.0 to 1.0).
     * Null BPM implies confidence is effectively 0. */
    val bpmConfidence: Float?,
    
    // ---------------------------------------------------------------
    // Loudness
    // ---------------------------------------------------------------
    
    /** Loudness estimate in dBFS (decibels relative to full scale).
     * This is RMS-derived, NOT LUFS. LUFS requires K-weighting which
     * we do not implement. This is a simple energy measurement.
     * Range: typically -60dB to 0dB, where 0dB is maximum possible. */
    val loudnessDb: Float?,
    
    // ---------------------------------------------------------------
    // Performance metrics
    // ---------------------------------------------------------------
    
    /** Time spent decoding in milliseconds. */
    val decodeTimeMs: Long,
    
    /** Time spent in DSP computation in milliseconds. */
    val dspTimeMs: Long,
    
    /** Total analysis time in milliseconds. */
    val totalAnalysisTimeMs: Long,
    
    /** Real-time factor: analysisTime / audioDuration. */
    val realTimeFactor: Float,
    
    // ---------------------------------------------------------------
    // Versioning
    // ---------------------------------------------------------------
    
    /** Version of the analyzer that produced this result.
     * Used to detect when re-analysis is needed after algorithm changes. */
    val analyzerVersion: Int,
    
    /** Timestamp when analysis was performed (epoch milliseconds). */
    val analyzedAt: Long,
    
    // ---------------------------------------------------------------
    // Error tracking
    // ---------------------------------------------------------------
    
    /** Error code if analysis failed, null otherwise. */
    val errorCode: String? = null,
    
    /** Error message if analysis failed, null otherwise. */
    val errorMessage: String? = null,
) {
    /** True if analysis completed successfully. */
    val isSuccess: Boolean get() = errorCode == null
    
    /** True if analysis failed. */
    val isFailure: Boolean get() = errorCode != null
}
