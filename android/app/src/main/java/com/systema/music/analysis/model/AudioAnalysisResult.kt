package com.systema.music.analysis.model

/**
 * Everything one analysis pass measured about one track.
 *
 * Nullability is meaningful throughout: null means "could not be
 * determined", never "zero". A track whose tempo could not be
 * established reports bpm = null with a confidence, rather than a
 * fabricated number that later phases would treat as fact.
 *
 * All spectral frequencies are in Hz, amplitudes are linear 0..1
 * (relative to full scale), and loudness is dBFS — see [loudness].
 */
data class AudioAnalysisResult(
    val trackId: String,

    // ---- Basic -------------------------------------------------
    val durationMs: Long,
    /** Rate the DSP actually ran at, after downsampling. */
    val sampleRate: Int,
    /** Channel count of the SOURCE, before the mono downmix. */
    val channels: Int,
    /** Mono samples that reached the analyser. */
    val analyzedSampleCount: Long,

    // ---- Amplitude / energy ------------------------------------
    /** Mean RMS across analysis windows, linear 0..1. */
    val rms: Float?,
    /** Highest absolute sample encountered, linear 0..1. */
    val peak: Float?,
    /**
     * Dynamic range estimate in dB: the spread between loud and quiet
     * passages, measured as the difference between the 95th and 10th
     * percentile of per-window RMS. Not an EBU/DR-meter value.
     */
    val dynamicRangeDb: Float?,
    /** Fraction of windows below the silence threshold, 0..1. */
    val silenceRatio: Float?,

    // ---- Spectral ----------------------------------------------
    val spectralCentroid: Float?,
    val spectralCentroidMin: Float?,
    val spectralCentroidMax: Float?,
    val spectralBandwidth: Float?,
    val spectralRolloff: Float?,
    val zeroCrossingRate: Float?,

    // ---- Tempo -------------------------------------------------
    /** Null when confidence fell below the configured floor. */
    val bpm: Float?,
    /** 0..1. Present even when [bpm] is null, so callers can see why. */
    val bpmConfidence: Float?,

    // ---- Loudness ----------------------------------------------
    /**
     * RMS-DERIVED LOUDNESS IN dBFS. This is NOT LUFS.
     *
     * Deliberately not labelled LUFS: a true ITU-R BS.1770 measurement
     * requires K-weighting (a shelving + high-pass filter pair), 400 ms
     * gated blocks, and absolute/relative gating. This value is
     * 20*log10 of the mean window RMS — useful for relative comparison
     * between tracks analysed by this same pipeline, but not
     * interchangeable with a broadcast loudness figure.
     *
     * Phase 14+ may add real BS.1770 as a separate field rather than
     * redefining this one.
     */
    val loudnessDbfs: Float?,

    // ---- Provenance & instrumentation --------------------------
    val analyzerVersion: Int,
    val analyzedAt: Long,
    val decodeTimeMs: Long,
    val dspTimeMs: Long,
    val totalAnalysisTimeMs: Long,
) {
    /**
     * Analysis time relative to audio duration. 0.1 means a 3-minute
     * track analysed in 18 seconds. Lower is better; anything above
     * 1.0 is slower than real time.
     */
    val realTimeFactor: Float?
        get() = if (durationMs > 0) totalAnalysisTimeMs.toFloat() / durationMs else null
}
