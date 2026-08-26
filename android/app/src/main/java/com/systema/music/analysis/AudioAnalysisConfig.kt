package com.systema.music.analysis

/**
 * Configuration for audio analysis.
 *
 * These values are chosen based on DSP requirements and mobile constraints:
 * - targetSampleRate: 22050 Hz is sufficient for most audio features while
 *   reducing computation. Human hearing range is ~20Hz-20kHz, and 22050Hz
 *   (Nyquist: 11025Hz) covers the audible spectrum adequately for analysis.
 * - mono: true converts stereo to mono by averaging channels, reducing
 *   computation by ~50% with minimal feature impact.
 * - windowSize: 2048 samples at 22050Hz = ~93ms windows. This provides good
 *   frequency resolution (22050/2048 ≈ 10.77Hz per bin) while being small
 *   enough for real-time processing.
 * - hopSize: 1024 samples = 50% overlap. Overlapping windows reduce spectral
 *   leakage and provide smoother feature transitions.
 * - fftSize: Must be >= windowSize and a power of 2 for efficient FFT.
 *   Using 2048 to match window size.
 */
data class AudioAnalysisConfig(
    /** Target sample rate for analysis (Hz). Default: 22050 */
    val targetSampleRate: Int = 22050,
    
    /** Convert stereo to mono. Default: true */
    val mono: Boolean = true,
    
    /** Window size in samples. Default: 2048 */
    val windowSize: Int = 2048,
    
    /** Hop size in samples (window advance). Default: 1024 (50% overlap) */
    val hopSize: Int = 1024,
    
    /** FFT size (must be power of 2, >= windowSize). Default: 2048 */
    val fftSize: Int = 2048,
    
    /** Silence threshold in dB. Samples below this are considered silent. Default: -60dB */
    val silenceThresholdDb: Float = -60f,
    
    /** Minimum samples required for valid analysis. Default: 44100 (1 second at 44.1kHz) */
    val minSamplesForAnalysis: Int = 44100,
    
    /** Maximum samples to analyze per track (for very long tracks). Default: 60 seconds at 22050Hz */
    val maxSamplesToAnalyze: Int = 22050 * 60,
) {
    init {
        require(targetSampleRate > 0) { "targetSampleRate must be positive" }
        require(windowSize > 0) { "windowSize must be positive" }
        require(hopSize > 0) { "hopSize must be positive" }
        require(fftSize >= windowSize) { "fftSize must be >= windowSize" }
        require(fftSize and (fftSize - 1) == 0) { "fftSize must be a power of 2" }
        require(hopSize <= windowSize) { "hopSize must be <= windowSize" }
    }
}

/** Default configuration for Phase 13 audio analysis. */
val DEFAULT_ANALYSIS_CONFIG = AudioAnalysisConfig()
