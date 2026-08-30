package com.systema.music.inference.effnet

import com.systema.music.analysis.dsp.Fft
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min

/**
 * Mel front end for Discogs-EffNet (`discogs-effnet-bs64-1`).
 *
 * WHY THIS IS NOT ClapMelFrontEnd
 * -------------------------------
 * SYSTEMA already has a log-mel front end for CLAP. It is NOT reusable
 * here, and reusing it would be the single easiest way to produce
 * embeddings that look plausible and mean nothing. The two differ in
 * every stage that matters:
 *
 *                     CLAP (HTSAT)          Discogs-EffNet (MusiCNN)
 *   sample rate       48000                 16000
 *   window / hop      1024 / 480            512 / 256
 *   mel bands         64                    96
 *   fmin / fmax       50 / 14000            0 / 8000
 *   spectrum          POWER (re^2+im^2)     MAGNITUDE
 *   filter norm       Slaney "area"         unit_tri
 *   compression       10*log10(max(p,1e-10)) log10(1 + 10000*m)
 *
 * A mel front end is only correct if it reproduces the one used at
 * training time. Every constant below was read out of Essentia's own
 * source rather than assumed:
 *
 *   src/algorithms/spectral/tensorflowinputmusicnn.cpp
 *     TensorflowInputMusiCNN::configure()
 *       frameSize 512, numberBands 96, sampleRate 16000,
 *       warpingFormula "slaneyMel", weighting "linear",
 *       normalize "unit_tri", shift 1, scale 10000, comp "log10",
 *       windowing normalized=false
 *
 *   src/algorithms/machinelearning/tensorflowpredicteffnetdiscogs.h
 *       _frameSize 512, _hopSize 256
 *
 *   TensorflowPredictEffnetDiscogs parameters (official reference docs)
 *       patchSize 128, patchHopSize 62, batchSize 64,
 *       lastPatchMode "discard"
 *
 * Essentia's own documentation states this algorithm "uses
 * TensorflowInputMusiCNN for the input feature extraction", which is
 * why a MusiCNN front end is correct for an EffNet model.
 *
 * WHAT THIS CLASS DOES NOT DO
 * ---------------------------
 * It does not classify anything. It turns PCM into the exact tensor
 * the embedding model expects and stops. It borrows only the pure,
 * stateless FFT from analysis/dsp/Fft.kt — a numeric primitive with no
 * Phase 13 behaviour attached — and touches no analysis, playback or
 * recommendation state.
 *
 * MEMORY
 * ------
 * Buffers are allocated once per instance and reused across frames.
 * One patch is 128 x 96 floats (48 KB); a full batch of 64 is ~3.1 MB.
 * Nothing frame-level is retained after [melFrames] returns.
 */
class EffnetDiscogsMelFrontEnd(
    val sampleRate: Int = SAMPLE_RATE,
    val frameSize: Int = FRAME_SIZE,
    val hopSize: Int = HOP_SIZE,
    val melBands: Int = MEL_BANDS,
) {

    companion object {
        /** MonoLoader(sampleRate=16000) in the documented pipeline. */
        const val SAMPLE_RATE = 16_000

        /** TensorflowPredictEffnetDiscogs::_frameSize. */
        const val FRAME_SIZE = 512

        /** TensorflowPredictEffnetDiscogs::_hopSize. 50% overlap. */
        const val HOP_SIZE = 256

        /** TensorflowInputMusiCNN numberBands. */
        const val MEL_BANDS = 96

        /** Frames per patch — the model's time axis. */
        const val PATCH_SIZE = 128

        /** Frames between patch starts. ~1.008 Hz prediction rate. */
        const val PATCH_HOP = 62

        /**
         * Default batch, matching the `bs64` checkpoint.
         *
         * NOT a property of the front end. Essentia publishes both a
         * fixed-batch (`bs64`) and a dynamic-batch (`bsdynamic`) export
         * of the same network, and the batch axis is the ONLY
         * difference. [toBatch] therefore takes the size as an
         * argument and the caller passes whatever the loaded graph
         * actually declares. Baking 64 in here would silently
         * zero-pad 61 slots for a three-patch track on a model that
         * never needed padding at all.
         */
        const val DEFAULT_BATCH_SIZE = 64

        /** TensorflowInputMusiCNN shift. */
        const val LOG_SHIFT = 1.0f

        /** TensorflowInputMusiCNN scale. */
        const val LOG_SCALE = 10_000.0f

        /** Slaney mel break point, as used by librosa and Essentia. */
        private const val MIN_LOG_HZ = 1000.0
        private const val MIN_LOG_MEL = 15.0
        private const val LOG_STEP = 0.06875177742094911

        /** Slaney mel scale. Linear below 1 kHz, logarithmic above. */
        fun hzToMel(hz: Double): Double =
            if (hz < MIN_LOG_HZ) 3.0 * hz / 200.0
            else MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP

        fun melToHz(mel: Double): Double =
            if (mel < MIN_LOG_MEL) 200.0 * mel / 3.0
            else MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))
    }

    init {
        require(frameSize > 0 && (frameSize and (frameSize - 1)) == 0) {
            "frameSize must be a power of two, was $frameSize"
        }
        require(hopSize > 0) { "hopSize must be positive, was $hopSize" }
        require(melBands > 0) { "melBands must be positive, was $melBands" }
    }

    private val fft = Fft(frameSize)
    private val spectrumSize = frameSize / 2 + 1

    /**
     * Hann window, UNNORMALISED.
     *
     * Essentia configures `normalized=false`, so the window is the
     * plain raised cosine with no 1/sum(w) gain correction. Applying
     * librosa's default normalisation here would scale every mel band
     * and shift the whole log curve.
     */
    private val window = FloatArray(frameSize) { i ->
        (0.5 - 0.5 * cos(2.0 * PI * i / frameSize)).toFloat()
    }

    private val filters: Array<FloatArray> = buildUnitTriMelFilters()
    private val windowed = FloatArray(frameSize)
    private val frame = FloatArray(frameSize)

    /**
     * Triangular mel filterbank with `unit_tri` normalisation.
     *
     * `unit_tri` means each triangle has unit HEIGHT (peak 1.0). This
     * differs from librosa's default Slaney normalisation, which scales
     * each filter by 2/(hz[i+2]-hz[i]) to give unit AREA. Using the
     * wrong one tilts the spectrum systematically toward one end of the
     * band range — subtle enough to look like a working model.
     */
    private fun buildUnitTriMelFilters(): Array<FloatArray> {
        val fMin = 0.0
        val fMax = sampleRate / 2.0

        val melMin = hzToMel(fMin)
        val melMax = hzToMel(fMax)

        // melBands + 2 edges: each filter spans three consecutive points.
        val points = DoubleArray(melBands + 2) { i ->
            melToHz(melMin + (melMax - melMin) * i / (melBands + 1))
        }

        val binHz = sampleRate.toDouble() / frameSize
        return Array(melBands) { m ->
            val left = points[m]
            val centre = points[m + 1]
            val right = points[m + 2]
            FloatArray(spectrumSize) { bin ->
                val hz = bin * binHz
                val w = when {
                    hz <= left || hz >= right -> 0.0
                    hz <= centre ->
                        if (centre > left) (hz - left) / (centre - left) else 0.0
                    else ->
                        if (right > centre) (right - hz) / (right - centre) else 0.0
                }
                // Peak 1.0 — unit_tri, NOT divided by bandwidth.
                w.toFloat()
            }
        }
    }

    /**
     * Number of frames FrameCutter yields for [sampleCount] samples.
     *
     * Mirrors the arithmetic in TensorflowPredictEffnetDiscogs::
     * padSignal: the first frame is zero-CENTRED, so the effective
     * start is -frameSize/2, and the final partial frame is zero-padded
     * rather than dropped.
     */
    fun frameCountFor(sampleCount: Int): Int {
        if (sampleCount <= 0) return 0
        val hops = (sampleCount - frameSize / 2.0) / hopSize
        return 1 + ceil(hops).toInt()
    }

    /** Patches available for [frameCount] frames, lastPatchMode=discard. */
    fun patchCountFor(frameCount: Int): Int {
        if (frameCount < PATCH_SIZE) return 0
        return 1 + ((frameCount - PATCH_SIZE) / PATCH_HOP)
    }

    /**
     * Minimum samples needed for one full patch.
     *
     * Below this the model cannot run at all. Callers must treat that
     * as "too short to analyse", never as a zero-filled patch: padding
     * silence into a batch and reading the output as a prediction about
     * the music is fabrication.
     */
    fun minimumSamplesForOnePatch(): Int =
        (PATCH_SIZE - 1) * hopSize + frameSize / 2 + 1

    /**
     * PCM -> log-mel frames, one FloatArray of [melBands] per frame.
     *
     * [pcm] must be mono float at [sampleRate]. Producing that is the
     * decoder's job (PcmDecoder already downmixes and resamples); this
     * class does not resample, because a second resampler would be a
     * second thing to get subtly wrong.
     */
    fun melFrames(pcm: FloatArray): Array<FloatArray> {
        val frameCount = frameCountFor(pcm.size)
        if (frameCount <= 0) return emptyArray()

        return Array(frameCount) { f ->
            // Zero-centred first frame: FrameCutter starts at -frameSize/2.
            val start = f * hopSize - frameSize / 2
            fillFrame(pcm, start)
            computeBands()
        }
    }

    /** Copies one frame, zero-padding outside the signal. */
    private fun fillFrame(pcm: FloatArray, start: Int) {
        for (i in 0 until frameSize) {
            val idx = start + i
            // Zero-pad, NOT reflect. Essentia's FrameCutter pads with
            // silence; reflection is CLAP/torchlibrosa's convention and
            // would put real energy where the model expects none.
            frame[i] = if (idx < 0 || idx >= pcm.size) 0f else pcm[idx]
            windowed[i] = frame[i] * window[i]
        }
    }

    /** Windowed frame -> 96 log-compressed mel bands. */
    private fun computeBands(): FloatArray {
        fft.forward(windowed)

        // Essentia's Spectrum yields MAGNITUDE, not power. Fft.magnitudes
        // is already magnitude, so no squaring here — squaring would be
        // the CLAP convention and would double the log slope.
        val mags = fft.magnitudes

        val out = FloatArray(melBands)
        for (m in 0 until melBands) {
            val filt = filters[m]
            var sum = 0.0f
            for (bin in 0 until spectrumSize) {
                val w = filt[bin]
                if (w != 0f) sum += w * mags[bin]
            }
            // UnaryOperator shift/scale then log10:
            //   log10(1 + 10000 * band)
            out[m] = log10(LOG_SHIFT + LOG_SCALE * max(0f, sum))
        }
        return out
    }

    /**
     * Frames -> one flat [batch, PATCH_SIZE, MEL_BANDS] tensor.
     *
     * Returns null when there is not one complete patch, so a caller
     * cannot accidentally run inference on padding alone.
     *
     * `lastBatchMode = "same"`: the final batch is zero-padded to
     * [BATCH_SIZE] because the bs64 graph has a fixed batch dimension,
     * and [realPatchCount] reports how many of those slots contain
     * signal. Predictions from the padding slots MUST be discarded —
     * they describe silence, not the track.
     */
    fun toBatch(
        frames: Array<FloatArray>,
        batchIndex: Int = 0,
        batchSize: Int = DEFAULT_BATCH_SIZE,
    ): PatchBatch? {
        require(batchSize > 0) { "batchSize must be positive, was $batchSize" }

        val available = patchCountFor(frames.size)
        if (available <= 0) return null

        val first = batchIndex * batchSize
        if (first >= available) return null
        val real = min(batchSize, available - first)

        val tensor = FloatArray(batchSize * PATCH_SIZE * melBands)
        for (p in 0 until real) {
            val frameStart = (first + p) * PATCH_HOP
            for (t in 0 until PATCH_SIZE) {
                val src = frames[frameStart + t]
                val dst = (p * PATCH_SIZE + t) * melBands
                System.arraycopy(src, 0, tensor, dst, melBands)
            }
        }
        // Slots [real, batchSize) stay zero — deliberately. On a
        // dynamic-batch graph the caller passes batchSize == real and
        // there are none.
        return PatchBatch(
            data = tensor,
            shape = listOf(batchSize.toLong(), PATCH_SIZE.toLong(), melBands.toLong()),
            realPatchCount = real,
            totalPatchCount = available,
        )
    }

    /** Number of batches needed to cover every patch. */
    fun batchCountFor(frameCount: Int, batchSize: Int = DEFAULT_BATCH_SIZE): Int {
        require(batchSize > 0) { "batchSize must be positive, was $batchSize" }
        val patches = patchCountFor(frameCount)
        if (patches <= 0) return 0
        return ceil(patches.toDouble() / batchSize).toInt()
    }

    /**
     * Every patch in ONE tensor, for a dynamic-batch graph.
     *
     * `bsdynamic` accepts any batch size, so the whole track can go
     * through in a single session run with no padding. Returns null
     * when there is not one complete patch — never a padded stand-in.
     */
    fun toSingleBatch(frames: Array<FloatArray>): PatchBatch? {
        val available = patchCountFor(frames.size)
        if (available <= 0) return null
        return toBatch(frames, batchIndex = 0, batchSize = available)
    }
}

/**
 * One batch of mel patches, ready for the embedding model.
 *
 * [realPatchCount] exists so the caller can drop the zero-padded tail.
 * Without it, a 3-patch track would silently contribute 61 predictions
 * about silence to its own average.
 */
data class PatchBatch(
    val data: FloatArray,
    val shape: List<Long>,
    val realPatchCount: Int,
    val totalPatchCount: Int,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PatchBatch) return false
        return realPatchCount == other.realPatchCount &&
            totalPatchCount == other.totalPatchCount &&
            shape == other.shape &&
            data.contentEquals(other.data)
    }

    override fun hashCode(): Int {
        var result = data.contentHashCode()
        result = 31 * result + shape.hashCode()
        result = 31 * result + realPatchCount
        result = 31 * result + totalPatchCount
        return result
    }
}
