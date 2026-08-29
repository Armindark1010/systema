package com.systema.music.inference

/**
 * The boundary between decoded PCM and what a specific model eats.
 *
 * WHY THIS IS A SEPARATE LAYER (§10)
 * ----------------------------------
 * It is tempting to treat Phase 13's analysis output — BPM, spectral
 * centroid, loudness — as "the features" and hand them to a model.
 * That would be a category error. Phase 13 produces a human-readable
 * DESCRIPTION of a track; a neural model consumes a specific tensor
 * with a specific sample rate, length and normalisation. They are not
 * interchangeable, and quietly substituting one for the other would
 * produce confident nonsense.
 *
 * So this class does one honest job: turn raw PCM into the exact
 * tensor a descriptor asks for, and REFUSE when the requested format
 * is not implemented rather than approximating it.
 *
 * IMPLEMENTED IN PHASE 15
 * -----------------------
 *   RAW_WAVEFORM — resample, mono-mix, fixed length, normalise
 *   RAW_TENSOR   — pass through, for the deterministic test model
 *
 * DELIBERATELY NOT IMPLEMENTED
 * ----------------------------
 *   MEL_SPECTROGRAM, LOG_MEL_SPECTROGRAM — these need a mel filterbank
 *   matching the model's training exactly (bin count, fmin/fmax, power
 *   vs magnitude, log base, per-model normalisation). Getting any of
 *   those subtly wrong yields embeddings that look plausible and are
 *   meaningless. They arrive with the model that needs them, verified
 *   against a reference implementation — not guessed at now.
 */
object ModelInputPreparer {

    /**
     * Prepares PCM for a model.
     *
     * @param pcm mono float samples in [-1, 1]
     * @param pcmSampleRate the rate [pcm] is actually at
     * @throws InferenceException INPUT_SHAPE_MISMATCH when the format
     *   is unsupported or the request is impossible
     */
    fun prepare(
        pcm: FloatArray,
        pcmSampleRate: Int,
        model: ModelDescriptor,
    ): PreparedInput {
        val startNs = System.nanoTime()

        val prepared = when (model.inputFormat) {
            InputFormat.RAW_TENSOR -> pcm.copyOf()

            InputFormat.RAW_WAVEFORM -> prepareWaveform(pcm, pcmSampleRate, model)

            // Phase 29 implements a log-mel front end for ONE model:
            // Discogs-EffNet. Its filterbank was transcribed from
            // Essentia's own source (see EffnetDiscogsMelFrontEnd), so
            // it is correct for that model and no other.
            //
            // Every other mel-consuming model still hits the refusal
            // below. That is deliberate: "we have a mel front end now"
            // must not become "any mel model will work", because a
            // filterbank that does not match training produces
            // confident, meaningless output.
            InputFormat.LOG_MEL_SPECTROGRAM ->
                if (EffnetDiscogsModel.isEffnetDiscogs(model)) {
                    EffnetDiscogsModel.prepareMel(pcm, pcmSampleRate, model)
                } else {
                    throw InferenceException(
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                        "Model ${model.modelId} requires ${model.inputFormat}, and " +
                            "SYSTEMA has no front end matching ITS training " +
                            "configuration. A mel front end is only valid for the " +
                            "model it was transcribed from; reusing another model's " +
                            "would produce meaningless embeddings. Refusing rather " +
                            "than guessing.",
                    )
                }

            InputFormat.MEL_SPECTROGRAM
            -> throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Model ${model.modelId} requires ${model.inputFormat}, which SYSTEMA " +
                    "does not implement. A mel front end must match the model's training " +
                    "configuration exactly; approximating it would produce meaningless " +
                    "embeddings. Refusing rather than guessing.",
            )
        }

        return PreparedInput(
            data = prepared,
            sampleRate = model.inputSampleRate ?: pcmSampleRate,
            preparationMs = (System.nanoTime() - startNs) / 1_000_000.0,
            format = model.inputFormat,
        )
    }

    private fun prepareWaveform(
        pcm: FloatArray,
        pcmSampleRate: Int,
        model: ModelDescriptor,
    ): FloatArray {
        if (pcm.isEmpty()) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Cannot prepare model input from an empty PCM buffer.",
            )
        }

        val targetRate = model.inputSampleRate
            ?: throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "Model ${model.modelId} declares RAW_WAVEFORM input but no sample rate.",
            )

        val resampled = if (targetRate == pcmSampleRate) {
            pcm
        } else {
            resampleLinear(pcm, pcmSampleRate, targetRate)
        }

        // Fit to the declared length: pad short input with silence,
        // truncate long input. Both are explicit choices — a model
        // with a fixed input size cannot be handed a different length.
        val required = model.inputElementCount()
        val fitted = if (required == null) {
            resampled
        } else {
            val n = required.toInt()
            when {
                resampled.size == n -> resampled
                resampled.size > n -> resampled.copyOf(n)
                else -> resampled.copyOf(n) // zero-padded by copyOf
            }
        }

        return peakNormalise(fitted)
    }

    /**
     * Linear-interpolation resampling.
     *
     * Honest about what it is: adequate for benchmark timing, but not
     * a high-quality resampler. It has no anti-aliasing filter, so
     * downsampling folds content above the new Nyquist limit back into
     * the audible band. For measuring how long a model takes that is
     * irrelevant; for judging embedding QUALITY it would not be, and
     * that limitation is recorded here rather than discovered later.
     */
    fun resampleLinear(input: FloatArray, fromRate: Int, toRate: Int): FloatArray {
        if (fromRate <= 0 || toRate <= 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Invalid sample rates: $fromRate -> $toRate",
            )
        }
        if (fromRate == toRate) return input.copyOf()
        if (input.isEmpty()) return FloatArray(0)

        val ratio = toRate.toDouble() / fromRate.toDouble()
        val outLength = maxOf(1, Math.round(input.size * ratio).toInt())
        val out = FloatArray(outLength)

        for (i in 0 until outLength) {
            val sourcePos = i / ratio
            val index = sourcePos.toInt()
            if (index >= input.size - 1) {
                out[i] = input[input.size - 1]
            } else {
                val frac = (sourcePos - index).toFloat()
                out[i] = input[index] * (1f - frac) + input[index + 1] * frac
            }
        }
        return out
    }

    /** Scales so the loudest sample sits at 0.95. Silence stays silent. */
    fun peakNormalise(input: FloatArray): FloatArray {
        var peak = 0f
        for (v in input) {
            val a = kotlin.math.abs(v)
            if (a > peak) peak = a
        }
        // An all-zero buffer must stay all-zero, not become NaN.
        if (peak <= 0f) return input
        val gain = 0.95f / peak
        val out = FloatArray(input.size)
        for (i in input.indices) out[i] = input[i] * gain
        return out
    }
}

data class PreparedInput(
    val data: FloatArray,
    val sampleRate: Int,
    val preparationMs: Double,
    val format: InputFormat,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PreparedInput) return false
        return data.contentEquals(other.data) &&
            sampleRate == other.sampleRate &&
            preparationMs == other.preparationMs &&
            format == other.format
    }

    override fun hashCode(): Int {
        var result = data.contentHashCode()
        result = 31 * result + sampleRate
        result = 31 * result + preparationMs.hashCode()
        result = 31 * result + format.hashCode()
        return result
    }
}
