package com.systema.music.inference

import com.systema.music.inference.effnet.EffnetDiscogsMelFrontEnd
import com.systema.music.inference.effnet.EffnetDiscogsModel

/**
 * The registry of mel front ends SYSTEMA actually implements.
 *
 * WHY THIS EXISTS AS A LOOKUP RATHER THAN AN IF
 * ---------------------------------------------
 * "Does a mel front end exist for this model?" is asked in three
 * places: the contract gate in [ModelRegistry.declareContract], the
 * format dispatch in [ModelInputPreparer], and the import report. If
 * each answered it inline, they would drift, and the failure mode of
 * that drift is a model being declared VERIFIED in one place and
 * refused in another — or worse, accepted everywhere while being fed a
 * filterbank it was not trained on.
 *
 * THE RULE THIS ENCODES
 * ---------------------
 * A mel front end is valid ONLY for the model it was transcribed from.
 * There is no generic "log-mel" preparation, because the parameters
 * that matter — band count, normalisation, spectrum convention,
 * compression curve — differ per model and none of them are recorded
 * in an ONNX graph. So this file maps specific models to specific
 * implementations, and anything not listed is BLOCKED.
 *
 * Adding a model here is a deliberate act that should require reading
 * that model's reference implementation first. It is not a place to
 * add a wildcard.
 */
object MelFrontEnds {

    /** One implemented front end and the models it is valid for. */
    data class Entry(
        val id: String,
        /** Human-readable source of the parameters, for reports. */
        val transcribedFrom: String,
        val sampleRate: Int,
        val melBands: Int,
        val frameSize: Int,
        val hopSize: Int,
        /** True when [modelId] is one this front end was built for. */
        val matches: (String) -> Boolean,
    )

    /**
     * Every implemented front end.
     *
     * CLAP is deliberately ABSENT. It has a mel front end
     * (ClapMelFrontEnd) but it is reached through the CLAP embedding
     * path, not through the generic importer, and listing it here
     * would invite the importer to apply it to an arbitrary imported
     * model whose parameters merely happen to look similar.
     */
    val IMPLEMENTED: List<Entry> = listOf(
        Entry(
            id = "musicnn-effnet-discogs",
            transcribedFrom = "Essentia TensorflowInputMusiCNN " +
                "(tensorflowinputmusicnn.cpp) + TensorflowPredictEffnetDiscogs",
            sampleRate = EffnetDiscogsMelFrontEnd.SAMPLE_RATE,
            melBands = EffnetDiscogsMelFrontEnd.MEL_BANDS,
            frameSize = EffnetDiscogsMelFrontEnd.FRAME_SIZE,
            hopSize = EffnetDiscogsMelFrontEnd.HOP_SIZE,
            matches = { EffnetDiscogsModel.isEffnetDiscogsId(it) },
        ),
    )

    /** The front end for [modelId], or null when none is implemented. */
    fun frontEndFor(modelId: String): Entry? =
        IMPLEMENTED.firstOrNull { it.matches(modelId) }

    /**
     * Whether a usable front end exists for [modelId].
     *
     * [declaredSampleRate] is checked when supplied: a developer
     * declaring 44100 Hz for a model whose front end produces 16 kHz
     * has a real disagreement, and silently ignoring it would mean the
     * decoder resamples to the wrong rate. Null means "not declared",
     * which is not a conflict.
     */
    fun hasFrontEndFor(modelId: String, declaredSampleRate: Int? = null): Boolean {
        val entry = frontEndFor(modelId) ?: return false
        if (declaredSampleRate != null && declaredSampleRate != entry.sampleRate) return false
        return true
    }

    /** Why [modelId] has no usable front end. Null when it has one. */
    fun blockedReasonFor(modelId: String, declaredSampleRate: Int? = null): String? {
        val entry = frontEndFor(modelId)
            ?: return "No mel front end is implemented for '$modelId'. A mel " +
                "front end is only valid for the model it was transcribed from: " +
                "band count, filter normalisation, spectrum convention and " +
                "compression curve all differ per model and none are recorded " +
                "in the ONNX graph. Implemented: " +
                IMPLEMENTED.joinToString { it.id } + "."

        if (declaredSampleRate != null && declaredSampleRate != entry.sampleRate) {
            return "'$modelId' uses the ${entry.id} front end, which produces " +
                "${entry.sampleRate} Hz, but ${declaredSampleRate} Hz was declared. " +
                "Resampling to the wrong rate shifts every mel band."
        }
        return null
    }
}
