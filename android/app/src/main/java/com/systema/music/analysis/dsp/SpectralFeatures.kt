package com.systema.music.analysis.dsp

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Stateless per-window feature maths.
 *
 * Everything here is a pure function of the buffer it is handed, which
 * is what makes the DSP testable on a desktop JVM with synthetic
 * signals — no Android, no decoder, no device.
 *
 * Feature-aware preprocessing
 * ---------------------------
 * A Hann window must be applied before the FFT (to stop spectral
 * leakage) but must NOT be applied before amplitude features: it
 * tapers the frame to zero at both edges, which would deflate RMS and
 * destroy peak. So the pipeline computes time-domain features on the
 * RAW frame and spectral features on the WINDOWED copy. Mixing those
 * up is the classic way to get plausible-looking but wrong numbers.
 */
object SpectralFeatures {

    /** Root mean square amplitude of a raw (unwindowed) frame. */
    fun rms(frame: FloatArray, length: Int = frame.size): Float {
        if (length <= 0) return 0f
        var sum = 0.0
        for (i in 0 until length) {
            val v = frame[i].toDouble()
            sum += v * v
        }
        return sqrt(sum / length).toFloat()
    }

    /** Largest absolute sample in a raw frame. */
    fun peak(frame: FloatArray, length: Int = frame.size): Float {
        var max = 0f
        for (i in 0 until length) {
            val v = abs(frame[i])
            if (v > max) max = v
        }
        return max
    }

    /**
     * Zero-crossing rate: fraction of adjacent sample pairs whose sign
     * differs. High for noise and unvoiced/percussive content, low for
     * tonal bass-heavy material.
     *
     * Computed on the raw frame — windowing would not change the signs
     * but would add pointless work.
     */
    fun zeroCrossingRate(frame: FloatArray, length: Int = frame.size): Float {
        if (length < 2) return 0f
        var crossings = 0
        for (i in 1 until length) {
            val prev = frame[i - 1]
            val curr = frame[i]
            // Treat exact zero as non-negative consistently, so a
            // sample sitting on zero is not counted as two crossings.
            if ((prev < 0f) != (curr < 0f)) crossings++
        }
        return crossings.toFloat() / (length - 1)
    }

    /**
     * Spectral centroid in Hz: the magnitude-weighted mean frequency,
     * i.e. where the "centre of mass" of the spectrum sits. Correlates
     * strongly with perceived brightness.
     *
     * Returns 0 for an empty spectrum rather than NaN, so a silent
     * window cannot poison the running average.
     */
    fun spectralCentroid(magnitudes: FloatArray, binHz: Float): Float {
        var weighted = 0.0
        var total = 0.0
        for (i in magnitudes.indices) {
            val m = magnitudes[i].toDouble()
            weighted += m * i * binHz
            total += m
        }
        if (total <= 0.0) return 0f
        return (weighted / total).toFloat()
    }

    /**
     * Spectral bandwidth: magnitude-weighted standard deviation of
     * frequency about [centroid]. Narrow for a pure tone, wide for
     * noise or dense mixes.
     */
    fun spectralBandwidth(magnitudes: FloatArray, binHz: Float, centroid: Float): Float {
        var weighted = 0.0
        var total = 0.0
        for (i in magnitudes.indices) {
            val m = magnitudes[i].toDouble()
            val delta = i * binHz - centroid
            weighted += m * delta * delta
            total += m
        }
        if (total <= 0.0) return 0f
        return sqrt(weighted / total).toFloat()
    }

    /**
     * Spectral rolloff: the frequency below which [percentile] of the
     * total spectral energy lies. A robust "where does this signal
     * stop" measure, less sensitive to isolated high-frequency spikes
     * than the maximum frequency would be.
     */
    fun spectralRolloff(magnitudes: FloatArray, binHz: Float, percentile: Float): Float {
        var total = 0.0
        for (m in magnitudes) total += m
        if (total <= 0.0) return 0f

        val target = total * percentile
        var running = 0.0
        for (i in magnitudes.indices) {
            running += magnitudes[i]
            if (running >= target) return i * binHz
        }
        return (magnitudes.size - 1) * binHz
    }

    /**
     * Spectral flux: total positive change in magnitude since the
     * previous window (half-wave rectified). Energy appearing in a
     * band raises it; energy decaying does not. That asymmetry is what
     * makes it an onset detector rather than a change detector.
     *
     * Feeds the tempo estimator.
     */
    fun spectralFlux(current: FloatArray, previous: FloatArray): Float {
        var flux = 0.0
        val n = minOf(current.size, previous.size)
        for (i in 0 until n) {
            val diff = current[i] - previous[i]
            if (diff > 0f) flux += diff.toDouble()
        }
        return flux.toFloat()
    }

    /** Linear amplitude (0..1) to dBFS. Floors at -120 dB. */
    fun amplitudeToDb(amplitude: Float): Float {
        if (amplitude <= 0.0000001f) return -120f
        return (20.0 * Math.log10(amplitude.toDouble())).toFloat()
    }

    /** Applies a periodic Hann window from [source] into [dest]. */
    fun applyHann(source: FloatArray, dest: FloatArray, window: FloatArray, length: Int) {
        for (i in 0 until length) dest[i] = source[i] * window[i]
        // Zero any tail so a short final frame cannot leave stale data
        // from the previous window in the FFT input.
        for (i in length until dest.size) dest[i] = 0f
    }

    /**
     * Precomputes a periodic Hann window.
     *
     * Periodic (dividing by N) rather than symmetric (N-1) because the
     * frames overlap and are treated as a continuous stream; the
     * periodic form is what sums to a constant under 50% overlap.
     */
    fun hannWindow(size: Int): FloatArray = FloatArray(size) { i ->
        (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / size)).toFloat()
    }
}
