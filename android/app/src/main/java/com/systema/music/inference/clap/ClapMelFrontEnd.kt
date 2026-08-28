package com.systema.music.inference.clap

import com.systema.music.analysis.dsp.Fft
import kotlin.math.PI
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Log-mel front end for LAION-CLAP (HTSAT / PANN audio towers).
 *
 * WHY THIS IS NOT THE PHASE 13 / PANNs / MERT PREPROCESSING
 * ---------------------------------------------------------
 * A mel front end is only correct if it reproduces the one the model
 * was trained with. Reusing an existing pipeline "because it also
 * makes mels" would produce a numerically different tensor and the
 * resulting embeddings would be quietly meaningless — the failure
 * would look like a bad model rather than a bad front end.
 *
 * Every constant below was read out of the official implementation
 * rather than assumed:
 *
 *   laion_clap/clap_module/model_configs/HTSAT-tiny.json
 *     sample_rate 48000, mel_bins 64, window_size 1024, hop_size 480,
 *     fmin 50, fmax 14000, clip_samples 480000 (10 s)
 *
 *   laion_clap/clap_module/htsat.py (~line 668)
 *     window 'hann', center=True, pad_mode='reflect',
 *     ref=1.0, amin=1e-10, top_db=None
 *
 *   torchlibrosa Spectrogram: power = 2.0  (real^2 + imag^2)
 *   torchlibrosa LogmelFilterBank: librosa.filters.mel(...) defaults,
 *     i.e. the Slaney mel scale with Slaney ("area") normalisation.
 *
 * The output is therefore 10*log10(max(mel_power, 1e-10)), with no
 * top_db clamp, exactly as the reference does.
 *
 * WHAT THIS CLASS DELIBERATELY DOES NOT DO
 * ----------------------------------------
 * It does not read the Phase 13 analyzer, does not write to it, and
 * does not alter it. It borrows only the pure, stateless FFT from
 * analysis/dsp/Fft.kt, which is a numeric primitive with no Phase 13
 * behaviour attached.
 *
 * MEMORY (§4)
 * -----------
 * Buffers are allocated once per instance and reused across frames.
 * A ten-second window at 48 kHz is 480000 floats (~1.9 MB); the mel
 * output is 64 x 1001 (~256 KB). Nothing frame-level is retained after
 * [logMel] returns.
 */
class ClapMelFrontEnd(
    val sampleRate: Int = DEFAULT_SAMPLE_RATE,
    val nFft: Int = DEFAULT_WINDOW_SIZE,
    val hopSize: Int = DEFAULT_HOP_SIZE,
    val melBins: Int = DEFAULT_MEL_BINS,
    val fMin: Float = DEFAULT_FMIN,
    val fMax: Float = DEFAULT_FMAX,
) {

    companion object {
        // Read from HTSAT-tiny.json. Not guesses, not defaults of ours.
        const val DEFAULT_SAMPLE_RATE = 48_000
        const val DEFAULT_WINDOW_SIZE = 1024
        const val DEFAULT_HOP_SIZE = 480
        const val DEFAULT_MEL_BINS = 64
        const val DEFAULT_FMIN = 50f
        const val DEFAULT_FMAX = 14_000f

        /** clip_samples: 10 seconds at 48 kHz. */
        const val DEFAULT_CLIP_SAMPLES = 480_000

        /** torchlibrosa LogmelFilterBank amin. */
        const val AMIN = 1e-10f

        /** Slaney mel scale break point, as used by librosa. */
        private const val MIN_LOG_HZ = 1000.0
        private const val MIN_LOG_MEL = 15.0
        private const val LOG_STEP = 0.06875177742094912 // ln(6.4) / 27.0

        /** librosa.hz_to_mel(htk=False) — the Slaney scale. */
        fun hzToMel(hz: Double): Double {
            val fSp = 200.0 / 3.0
            return if (hz < MIN_LOG_HZ) {
                hz / fSp
            } else {
                MIN_LOG_MEL + ln(hz / MIN_LOG_HZ) / LOG_STEP
            }
        }

        /** librosa.mel_to_hz(htk=False). */
        fun melToHz(mel: Double): Double {
            val fSp = 200.0 / 3.0
            return if (mel < MIN_LOG_MEL) {
                mel * fSp
            } else {
                MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))
            }
        }
    }

    init {
        require(nFft > 0 && (nFft and (nFft - 1)) == 0) {
            "nFft must be a power of two, was $nFft"
        }
        require(hopSize > 0) { "hopSize must be positive" }
        require(melBins > 0) { "melBins must be positive" }
        require(fMax > fMin) { "fMax must exceed fMin" }
    }

    private val fft = Fft(nFft)
    private val spectrumBins = nFft / 2 + 1

    /** Periodic Hann, matching torch.hann_window(periodic=True). */
    private val window = FloatArray(nFft) { i ->
        (0.5 - 0.5 * Math.cos(2.0 * PI * i / nFft)).toFloat()
    }

    /** [melBins][spectrumBins], Slaney-normalised. Built once. */
    private val melFilters: Array<FloatArray> = buildSlaneyMelFilters()

    private val frame = FloatArray(nFft)
    private val power = FloatArray(spectrumBins)

    /**
     * librosa.filters.mel(htk=False, norm='slaney').
     *
     * Triangular filters on the Slaney mel scale, each scaled by
     * 2/(f[i+2]-f[i]) so that filters have unit *area* rather than
     * unit peak. Getting this normalisation wrong shifts the whole
     * spectrum by a frequency-dependent gain, which is exactly the
     * kind of error that silently degrades embeddings.
     */
    private fun buildSlaneyMelFilters(): Array<FloatArray> {
        val melLo = hzToMel(fMin.toDouble())
        val melHi = hzToMel(fMax.toDouble())

        // melBins + 2 edges define melBins triangles.
        val hzPoints = DoubleArray(melBins + 2) { i ->
            melToHz(melLo + (melHi - melLo) * i / (melBins + 1))
        }

        // Bin centre frequencies of the FFT.
        val fftFreqs = DoubleArray(spectrumBins) { i ->
            i.toDouble() * sampleRate / nFft
        }

        val filters = Array(melBins) { FloatArray(spectrumBins) }
        for (m in 0 until melBins) {
            val lower = hzPoints[m]
            val centre = hzPoints[m + 1]
            val upper = hzPoints[m + 2]

            // Slaney area normalisation.
            val enorm = 2.0 / (upper - lower)

            for (k in 0 until spectrumBins) {
                val f = fftFreqs[k]
                val ramp = when {
                    f < lower || f > upper -> 0.0
                    f <= centre ->
                        if (centre > lower) (f - lower) / (centre - lower) else 0.0
                    else ->
                        if (upper > centre) (upper - f) / (upper - centre) else 0.0
                }
                if (ramp > 0.0) filters[m][k] = (ramp * enorm).toFloat()
            }
        }
        return filters
    }

    /** Number of frames [logMel] will produce for [sampleCount] samples. */
    fun frameCountFor(sampleCount: Int): Int = sampleCount / hopSize + 1

    /**
     * Computes the log-mel spectrogram of [pcm].
     *
     * @param pcm mono float PCM already resampled to [sampleRate].
     * @return [melBins] rows x N frames, row-major: `out[mel][frame]`.
     *
     * Uses center=True with reflect padding, so frame t is centred on
     * sample t*hopSize — the same alignment the reference produces.
     */
    fun logMel(pcm: FloatArray): Array<FloatArray> {
        val frames = frameCountFor(pcm.size)
        val out = Array(melBins) { FloatArray(frames) }
        val half = nFft / 2

        for (t in 0 until frames) {
            val centre = t * hopSize
            val start = centre - half

            // center=True + pad_mode='reflect', done per-sample so the
            // whole signal is never copied into a padded buffer.
            for (i in 0 until nFft) {
                frame[i] = reflectSample(pcm, start + i) * window[i]
            }

            fft.forward(frame)

            // torchlibrosa uses power = 2.0: real^2 + imag^2. Fft
            // exposes magnitude, so square it back to power.
            for (k in 0 until spectrumBins) {
                val mag = fft.magnitudes[k]
                power[k] = mag * mag
            }

            for (m in 0 until melBins) {
                val filter = melFilters[m]
                var acc = 0f
                for (k in 0 until spectrumBins) {
                    val w = filter[k]
                    if (w != 0f) acc += w * power[k]
                }
                // 10*log10(max(x, amin)), ref=1.0, top_db=None.
                out[m][t] = (10.0 * log10(max(acc, AMIN).toDouble())).toFloat()
            }
        }
        return out
    }

    /**
     * Reflect padding at both edges, matching numpy 'reflect' (the
     * edge sample is not duplicated).
     */
    private fun reflectSample(pcm: FloatArray, index: Int): Float {
        if (pcm.isEmpty()) return 0f
        if (pcm.size == 1) return pcm[0]
        val period = 2 * (pcm.size - 1)
        var i = index % period
        if (i < 0) i += period
        if (i >= pcm.size) i = period - i
        return pcm[i]
    }

    /**
     * Flattens to NCHW `[1, 1, frames, melBins]`, the layout the HTSAT
     * ONNX graphs published for CLAP expect (time-major, mel last).
     *
     * Exposed separately from [logMel] so the transposition is
     * explicit and testable rather than hidden inside inference.
     */
    fun toNchwTimeMajor(mel: Array<FloatArray>): FloatArray {
        val bins = mel.size
        if (bins == 0) return FloatArray(0)
        val frames = mel[0].size
        val out = FloatArray(frames * bins)
        var i = 0
        for (t in 0 until frames) {
            for (m in 0 until bins) {
                out[i++] = mel[m][t]
            }
        }
        return out
    }

    /**
     * Trims or reflect-pads [pcm] to exactly [target] samples.
     *
     * CLAP's audio tower expects a fixed 10-second clip. Silence
     * padding would bias the embedding toward "quiet", so short audio
     * is reflected — the same choice the reference makes for short
     * inputs.
     */
    fun fitToClip(pcm: FloatArray, target: Int = DEFAULT_CLIP_SAMPLES): FloatArray {
        if (pcm.size == target) return pcm
        if (pcm.size > target) return pcm.copyOf(target)
        if (pcm.isEmpty()) return FloatArray(target)
        val out = FloatArray(target)
        for (i in 0 until target) out[i] = reflectSample(pcm, i)
        return out
    }
}
