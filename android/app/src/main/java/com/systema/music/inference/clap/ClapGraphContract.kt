package com.systema.music.inference.clap

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.inference.TensorSignature

/**
 * What the imported ONNX graph ACTUALLY expects (§1, §2).
 *
 * WHY THIS EXISTS
 * ---------------
 * The first CLAP adapter assumed every model wanted an externally
 * computed log-mel of shape [1,1,T,64]. That is true of the raw HTSAT
 * audio tower, and false of the pre-converted exports people actually
 * download: `muzaiten/clap-htsat-base-onnx/audio.onnx` takes a bare
 * 48 kHz waveform of shape [batch, 480000] and computes the mel
 * spectrogram INSIDE the graph.
 *
 * Feeding a log-mel to that model would not throw. 64064 floats would
 * be accepted by a dynamic axis and interpreted as audio samples, and
 * the model would return a perfectly finite, perfectly L2-normalised,
 * perfectly meaningless 512-dimensional vector. Every downstream
 * number — cosine, AUC, separation — would be noise wearing the
 * costume of a result.
 *
 * So the format is never assumed. It is DERIVED from the graph and,
 * when the graph is too dynamic to be conclusive, the model is
 * refused rather than guessed at.
 */
data class ClapGraphContract(
    val inputName: String,
    val inputShape: List<Long>,
    val inputType: String,
    val outputName: String,
    val outputShape: List<Long>,
    val inputKind: InputKind,
    /** Samples per window for WAVEFORM models; null otherwise. */
    val waveformSamples: Int?,
    /** Mel bins for LOG_MEL models; null otherwise. */
    val melBins: Int?,
    /** Frames per window for LOG_MEL models; null otherwise. */
    val melFrames: Int?,
    /** Trailing output dimension when the graph fixes it. */
    val embeddingDimension: Int?,
    /** How the decision was reached, shown verbatim in the UI. */
    val rationale: String,
) {

    enum class InputKind {
        /** Raw mono PCM; the graph computes its own spectrogram. */
        WAVEFORM,

        /** Externally computed log-mel, [batch, 1, frames, mels]. */
        LOG_MEL,

        /** Could not be determined. Inference must be refused. */
        UNKNOWN,
    }

    /** Element count for one window, or null when not yet determined. */
    fun elementsPerWindow(): Int? = when (inputKind) {
        InputKind.WAVEFORM -> waveformSamples
        InputKind.LOG_MEL -> {
            val f = melFrames
            val m = melBins
            if (f != null && m != null) f * m else null
        }
        InputKind.UNKNOWN -> null
    }

    /**
     * The concrete shape to declare to the runtime, batch pinned to 1.
     *
     * The runtime builds its ONNX tensor from the DESCRIPTOR's shape,
     * so any dynamic axis left in place would be resolved by dividing
     * the element count — which silently produces the wrong rank. Every
     * dimension returned here is fixed.
     */
    fun concreteInputShape(): List<Long>? = when (inputKind) {
        InputKind.WAVEFORM -> waveformSamples?.let { listOf(1L, it.toLong()) }
        InputKind.LOG_MEL -> {
            val f = melFrames
            val m = melBins
            if (f != null && m != null) listOf(1L, 1L, f.toLong(), m.toLong()) else null
        }
        InputKind.UNKNOWN -> null
    }

    fun toJs(): JSObject = JSObject().apply {
        put("inputName", inputName)
        put("inputShape", JSArray(inputShape.toTypedArray()))
        put("inputType", inputType)
        put("outputName", outputName)
        put("outputShape", JSArray(outputShape.toTypedArray()))
        put("inputKind", inputKind.name)
        put("waveformSamples", waveformSamples ?: -1)
        put("melBins", melBins ?: -1)
        put("melFrames", melFrames ?: -1)
        put("embeddingDimension", embeddingDimension ?: -1)
        put("rationale", rationale)
        concreteInputShape()?.let { put("concreteInputShape", JSArray(it.toTypedArray())) }
    }

    companion object {

        /** 10 s at 48 kHz — LAION-CLAP's clip length. */
        const val EXPECTED_WAVEFORM_SAMPLES = 480_000

        /** LAION-CLAP uses 64 mel bins across every published config. */
        const val EXPECTED_MEL_BINS = 64

        /**
         * A waveform input is at least this long. A log-mel's frame
         * axis is ~1001 and its mel axis 64, so nothing legitimate
         * sits between "a few thousand" and "half a million" — the
         * threshold does not have to be delicate to be safe.
         */
        private const val MIN_WAVEFORM_SAMPLES = 8_000

        /**
         * Derives the contract from the graph's declared signatures.
         *
         * RANK IS THE PRIMARY SIGNAL, not the tensor name. A name is a
         * convention an exporter may or may not follow; rank 2 vs
         * rank 4 is structural.
         */
        fun derive(
            inputs: List<TensorSignature>,
            outputs: List<TensorSignature>,
            /** Default clip length when the graph leaves the axis dynamic. */
            defaultWaveformSamples: Int = EXPECTED_WAVEFORM_SAMPLES,
            defaultMelBins: Int = EXPECTED_MEL_BINS,
            defaultMelFrames: Int = 1001,
        ): ClapGraphContract {
            val input = inputs.firstOrNull()
                ?: return unknown("The graph declares no inputs at all.")
            val output = outputs.firstOrNull()
                ?: return unknown("The graph declares no outputs at all.")

            val shape = input.shape
            val rank = shape.size

            // The trailing output dim is the embedding width when fixed.
            val embedDim = output.shape.lastOrNull()?.takeIf { it > 0 }?.toInt()

            // ---- RANK 2: [batch, samples] -> raw waveform ----
            if (rank == 2) {
                val declared = shape[1]
                val samples = if (declared > 0) declared.toInt() else defaultWaveformSamples

                if (declared > 0 && declared < MIN_WAVEFORM_SAMPLES) {
                    return unknown(
                        "Input '${input.name}' is rank 2 with a fixed second " +
                            "dimension of $declared, which is too short to be a " +
                            "10-second waveform and does not match a log-mel " +
                            "layout either. Refusing to guess.",
                    )
                }

                val note = if (declared > 0) {
                    "fixed at $declared samples by the graph"
                } else {
                    "dynamic, so the LAION-CLAP clip length of " +
                        "$defaultWaveformSamples samples (10 s at 48 kHz) is used"
                }
                return ClapGraphContract(
                    inputName = input.name,
                    inputShape = shape,
                    inputType = input.type,
                    outputName = output.name,
                    outputShape = output.shape,
                    inputKind = InputKind.WAVEFORM,
                    waveformSamples = samples,
                    melBins = null,
                    melFrames = null,
                    embeddingDimension = embedDim,
                    rationale =
                        "Input '${input.name}' has rank 2 ${shape}, so the graph " +
                            "takes a raw mono waveform and computes its own " +
                            "spectrogram. Window length is $note. No external " +
                            "log-mel is applied.",
                )
            }

            // ---- RANK 3 or 4: log-mel ----
            // Rank 4 is [batch, 1, frames, mels]; rank 3 is the same
            // without the channel axis.
            if (rank == 3 || rank == 4) {
                val melAxis = shape.last()
                val frameAxis = shape[shape.size - 2]

                val mels = if (melAxis > 0) melAxis.toInt() else defaultMelBins
                val frames = if (frameAxis > 0) frameAxis.toInt() else defaultMelFrames

                if (melAxis > 0 && melAxis > 512) {
                    return unknown(
                        "Input '${input.name}' is rank $rank with a trailing " +
                            "dimension of $melAxis, which is far too wide for a " +
                            "mel axis. This does not look like a CLAP log-mel " +
                            "input and will not be guessed at.",
                    )
                }

                return ClapGraphContract(
                    inputName = input.name,
                    inputShape = shape,
                    inputType = input.type,
                    outputName = output.name,
                    outputShape = output.shape,
                    inputKind = InputKind.LOG_MEL,
                    waveformSamples = null,
                    melBins = mels,
                    melFrames = frames,
                    embeddingDimension = embedDim,
                    rationale =
                        "Input '${input.name}' has rank $rank ${shape}, so the " +
                            "graph expects an externally computed log-mel of " +
                            "$frames frames x $mels mels. SYSTEMA computes it.",
                )
            }

            return unknown(
                "Input '${input.name}' has rank $rank ${shape}. Only rank 2 " +
                    "(waveform) and rank 3/4 (log-mel) are supported, so the " +
                    "preprocessing cannot be determined.",
            )
        }

        private fun unknown(reason: String) = ClapGraphContract(
            inputName = "",
            inputShape = emptyList(),
            inputType = "UNKNOWN",
            outputName = "",
            outputShape = emptyList(),
            inputKind = InputKind.UNKNOWN,
            waveformSamples = null,
            melBins = null,
            melFrames = null,
            embeddingDimension = null,
            rationale = reason,
        )
    }
}
