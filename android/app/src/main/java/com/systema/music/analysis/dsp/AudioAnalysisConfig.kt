package com.systema.music.analysis.dsp

/**
 * Every tunable number the analyser uses, in one place.
 *
 * These are deliberately not scattered as literals through the DSP
 * code: the values below are a set of trade-offs that only make sense
 * relative to each other, and changing one in isolation silently
 * degrades the results.
 *
 * Rationale for the defaults
 * --------------------------
 * targetSampleRate = 22050
 *   Half of CD rate, so the Nyquist limit is ~11 kHz. Every feature
 *   here (centroid, rolloff, onset envelope, tempo) is dominated by
 *   energy well below that, while halving the rate halves the decode
 *   and FFT cost. Music above 11 kHz is mostly cymbal shimmer and air;
 *   it moves the centroid a little but changes no decision we make.
 *
 * mono = true
 *   Tempo and timbre are near-identical across channels, and stereo
 *   would double the DSP work for no analytical gain. Downmix happens
 *   during decoding so nothing downstream ever sees two channels.
 *
 * windowSize = 2048
 *   At 22050 Hz this is ~93 ms, giving ~10.8 Hz per FFT bin. Fine
 *   enough to resolve musical spectra, long enough to stay stable, and
 *   a power of two for the radix-2 FFT.
 *
 * hopSize = 1024
 *   50% overlap. Standard for spectral flux: enough temporal
 *   resolution to place onsets within ~46 ms, which is precise enough
 *   for tempo estimation, without doubling the frame count again.
 *
 * silenceThresholdDb = -50 dBFS
 *   Below this a window is treated as silence. Quiet enough not to
 *   catch genuine soft passages (a pianissimo passage typically sits
 *   above -45 dBFS), loud enough to catch lead-in/lead-out digital
 *   near-silence and encoder noise floors.
 *
 * maxAnalysisDurationMs = 300000 (5 minutes)
 *   A guard for pathological inputs (DJ sets, audiobooks). Analysis
 *   stops after this much audio and reports what it measured; the
 *   features are all averages, so a five-minute sample is
 *   representative. Prevents unbounded work on a phone.
 */
data class AudioAnalysisConfig(
    val targetSampleRate: Int = 22_050,
    val mono: Boolean = true,
    val windowSize: Int = 2048,
    val hopSize: Int = 1024,
    val silenceThresholdDb: Float = -50f,
    val rolloffPercentile: Float = 0.85f,
    val maxAnalysisDurationMs: Long = 300_000L,
    /**
     * Tempo search range. Outside 50–200 BPM the autocorrelation peaks
     * are almost always octave errors rather than real tempi.
     */
    val minBpm: Float = 50f,
    val maxBpm: Float = 200f,
    /**
     * Below this, [AudioAnalysisResult.bpm] is reported as null. A
     * confidently wrong tempo is worse than an honest absence, and
     * downstream phases must be able to trust a non-null BPM.
     */
    val minBpmConfidence: Float = 0.15f,
) {
    init {
        require(windowSize > 0 && (windowSize and (windowSize - 1)) == 0) {
            "windowSize must be a power of two, was $windowSize"
        }
        require(hopSize in 1..windowSize) { "hopSize must be within 1..windowSize" }
        require(targetSampleRate > 0) { "targetSampleRate must be positive" }
        require(rolloffPercentile > 0f && rolloffPercentile < 1f) {
            "rolloffPercentile must be between 0 and 1"
        }
        require(minBpm > 0f && maxBpm > minBpm) { "invalid BPM range" }
    }

    /** Seconds of audio advanced per window. Drives the tempo grid. */
    val hopSeconds: Float get() = hopSize.toFloat() / targetSampleRate

    /** Width of one FFT bin in Hz. */
    val binHz: Float get() = targetSampleRate.toFloat() / windowSize

    companion object {
        /**
         * DSP algorithm version.
         *
         * Bump this whenever a change would produce different numbers
         * for the same audio. Stored alongside every result so tracks
         * analysed by an older pipeline can be detected and re-queued.
         *
         * Deliberately NOT called modelVersion: there is no model here,
         * only deterministic signal processing.
         */
        const val AUDIO_ANALYZER_VERSION: Int = 1
    }
}
