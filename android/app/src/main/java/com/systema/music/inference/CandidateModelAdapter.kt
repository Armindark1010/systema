package com.systema.music.inference

/**
 * The contract a candidate audio model states about itself.
 *
 * WHY THIS LAYER EXISTS
 * ---------------------
 * [OnnxInferenceRuntime] must stay generic: it loads a graph, feeds a
 * tensor, reads a tensor. The moment it knows that YAMNet wants 16 kHz
 * or that OpenL3 wants 48 kHz mel128, it stops being a runtime and
 * becomes a YAMNet driver.
 *
 * So each candidate declares its contract HERE, as data, and the
 * adapter is responsible for turning decoded PCM into exactly what
 * that model was trained on.
 *
 *   InferenceBenchmark -> InferenceRuntime -> OnnxInferenceRuntime
 *                      -> CandidateModelAdapter -> Preprocessing -> ONNX
 *
 * THE CENTRAL SAFETY RULE (task 3)
 * --------------------------------
 * A model whose preprocessing cannot be reproduced EXACTLY must not
 * run. Feeding a waveform to a model trained on log-mel, or log-mel
 * built with the wrong filterbank, produces numbers that look like
 * embeddings and mean nothing. A silent wrong answer is far worse
 * than a loud failure, so [validate] refuses rather than approximates.
 *
 * Nothing here downloads, bundles or selects a model. These are
 * DECLARATIONS used to decide whether a side-loaded file can be
 * benchmarked honestly.
 */
data class CandidateModelAdapter(
    val candidateId: String,
    val displayName: String,

    // ---- Architecture / provenance -------------------------------
    val architecture: String,
    /** Embedding width, or null when the model emits something else. */
    val embeddingDimension: Int?,
    val license: String,
    /** Whether the LICENCE permits commercial use, as published. */
    val commercialUse: CommercialUse,

    // ---- Input contract ------------------------------------------
    /**
     * The tensor name, when the model's published contract fixes it.
     * Null means "read it from the session", which is what the runtime
     * already does and is safe for single-input graphs.
     */
    val inputName: String?,
    val inputSampleRate: Int,
    val inputChannels: Int,
    /** What the model actually consumes. */
    val inputRepresentation: InputFormat,
    /** Fixed window in samples, or null when the graph is dynamic. */
    val inputWindowSamples: Int?,
    /** Hop between windows in samples, when the model is framed. */
    val hopSamples: Int?,

    // ---- Mel front end, when applicable --------------------------
    val melBands: Int?,
    val fftSize: Int?,
    val melFminHz: Int?,
    val melFmaxHz: Int?,

    // ---- Status ---------------------------------------------------
    /** Whether SYSTEMA can currently run this candidate, and why not. */
    val status: CandidateStatus,
    val statusReason: String,
    /** Published size, clearly marked as documentation, not measured. */
    val approximateSizeMb: Double?,
    /** Whether an official ONNX export is known to exist. */
    val officialOnnxExport: OnnxAvailability,
) {
    /**
     * Decides whether this candidate may be benchmarked at all.
     *
     * @throws InferenceException when running it would produce a
     *   result that cannot be trusted.
     */
    fun validate() {
        when (status) {
            CandidateStatus.BLOCKED_LICENSE -> throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "$displayName is licence-blocked for SYSTEMA: $statusReason",
            )
            CandidateStatus.BLOCKED_PREPROCESSING -> throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "$displayName needs preprocessing SYSTEMA cannot yet reproduce " +
                    "exactly: $statusReason. Refusing to run it, because an embedding " +
                    "built from approximated features is plausible-looking nonsense.",
            )
            CandidateStatus.BLOCKED_NO_ONNX -> throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "$displayName has no usable ONNX export: $statusReason",
            )
            CandidateStatus.RUNNABLE -> Unit
        }

        // A declared mel front end that SYSTEMA has not implemented
        // must never silently fall through to a waveform.
        if (inputRepresentation == InputFormat.MEL_SPECTROGRAM ||
            inputRepresentation == InputFormat.LOG_MEL_SPECTROGRAM
        ) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "$displayName expects $inputRepresentation, which SYSTEMA does not " +
                    "implement. Matching a training-time filterbank exactly (bands, " +
                    "fmin/fmax, power vs magnitude, log offset) is required; " +
                    "approximating it is not acceptable.",
            )
        }
    }

    /** Builds the generic descriptor the runtime consumes. */
    fun toDescriptor(filePath: String, sizeBytes: Long): ModelDescriptor {
        validate()
        return ModelDescriptor(
            modelId = candidateId,
            modelName = displayName,
            version = "side-loaded",
            filePath = filePath,
            inputShape = inputWindowSamples?.let { listOf(1L, it.toLong()) } ?: listOf(-1L),
            inputType = TensorType.FLOAT32,
            inputSampleRate = inputSampleRate,
            inputChannels = inputChannels,
            outputShape = embeddingDimension?.let { listOf(-1L, it.toLong()) } ?: listOf(-1L),
            outputType = TensorType.FLOAT32,
            sizeBytes = sizeBytes,
            checksum = null,
            inputFormat = inputRepresentation,
        )
    }
}

enum class CommercialUse { PERMITTED, RESTRICTED, UNKNOWN }

enum class CandidateStatus {
    /** Contract is reproducible; may be benchmarked if side-loaded. */
    RUNNABLE,
    BLOCKED_LICENSE,
    BLOCKED_PREPROCESSING,
    BLOCKED_NO_ONNX,
}

enum class OnnxAvailability {
    /** A first-party or well-known export exists. */
    AVAILABLE,
    /** Only community exports, unverified provenance. */
    COMMUNITY_ONLY,
    /** Would require conversion work SYSTEMA has not done. */
    REQUIRES_CONVERSION,
    UNKNOWN,
}

/**
 * The evaluated candidates.
 *
 * EVERYTHING HERE IS DOCUMENTATION, NOT MEASUREMENT.
 * Sizes and dimensions come from each model's published papers and
 * repositories, cited in docs/phase-16-candidates.md. Not one figure
 * in this file was measured by SYSTEMA, and none of these models has
 * been executed on the target device. The UI must label them as such.
 */
object CandidateRegistry {

    /**
     * YAMNet — the most promising, and the most misunderstood.
     *
     * Its ONNX exports embed the mel front end INSIDE the graph and
     * accept a raw 16 kHz mono waveform. That is what makes it viable
     * here: SYSTEMA does not have to reproduce a filterbank, because
     * the model carries its own. If a given export instead expects a
     * 96x64 patch, that export is NOT runnable under this contract.
     */
    val YAMNET = CandidateModelAdapter(
        candidateId = "yamnet",
        displayName = "YAMNet (MobileNetV1)",
        architecture = "MobileNetV1 depthwise-separable CNN, ~3.7M params",
        embeddingDimension = 1024,
        license = "Apache-2.0",
        commercialUse = CommercialUse.PERMITTED,
        inputName = null,
        inputSampleRate = 16_000,
        inputChannels = 1,
        // Raw waveform ONLY because the mel front end is in the graph.
        inputRepresentation = InputFormat.RAW_WAVEFORM,
        inputWindowSamples = null,
        hopSamples = null,
        melBands = 64,
        fftSize = 512,
        melFminHz = 125,
        melFmaxHz = 7_500,
        status = CandidateStatus.RUNNABLE,
        statusReason = "Apache-2.0, and the common ONNX exports take a dynamic raw " +
            "16 kHz mono waveform with the log-mel front end inside the graph, so no " +
            "external filterbank must be matched.",
        approximateSizeMb = 15.0,
        officialOnnxExport = OnnxAvailability.COMMUNITY_ONLY,
    )

    /**
     * VGGish — blocked on preprocessing, not on licence.
     *
     * VGGish takes a 96x64 log-mel patch. SYSTEMA would have to build
     * that filterbank itself and match it to the training code
     * exactly. Until that is implemented and verified against a
     * reference, running VGGish would yield untrustworthy embeddings.
     */
    val VGGISH = CandidateModelAdapter(
        candidateId = "vggish",
        displayName = "VGGish",
        architecture = "VGG-style CNN, ~72M params",
        embeddingDimension = 128,
        license = "Apache-2.0",
        commercialUse = CommercialUse.PERMITTED,
        inputName = null,
        inputSampleRate = 16_000,
        inputChannels = 1,
        inputRepresentation = InputFormat.LOG_MEL_SPECTROGRAM,
        inputWindowSamples = 15_360,
        hopSamples = 15_360,
        melBands = 64,
        fftSize = 512,
        melFminHz = 125,
        melFmaxHz = 7_500,
        status = CandidateStatus.BLOCKED_PREPROCESSING,
        statusReason = "Requires an external 96x64 log-mel patch. SYSTEMA has no " +
            "verified mel front end, and 128 dimensions is also low for music " +
            "similarity.",
        approximateSizeMb = 280.0,
        officialOnnxExport = OnnxAvailability.REQUIRES_CONVERSION,
    )

    /**
     * OpenL3 — highest published timbral accuracy, heaviest front end.
     *
     * MIT code, but the WEIGHTS are CC BY 4.0, which is permissive yet
     * carries an attribution obligation SYSTEMA would have to honour
     * in-app. Blocked here on preprocessing regardless.
     */
    val OPENL3 = CandidateModelAdapter(
        candidateId = "openl3",
        displayName = "OpenL3 (music, mel128)",
        architecture = "L3-Net audiovisual self-supervised 2D CNN, ~4.7M params",
        embeddingDimension = 512,
        license = "MIT (code) / CC BY 4.0 (weights)",
        commercialUse = CommercialUse.PERMITTED,
        inputName = null,
        inputSampleRate = 48_000,
        inputChannels = 1,
        inputRepresentation = InputFormat.MEL_SPECTROGRAM,
        inputWindowSamples = 48_000,
        hopSamples = 48_000,
        melBands = 128,
        fftSize = 2_048,
        melFminHz = 0,
        melFmaxHz = 24_000,
        status = CandidateStatus.BLOCKED_PREPROCESSING,
        statusReason = "Needs an external mel128 front end at 48 kHz matched to " +
            "training. CC BY 4.0 weights also require visible attribution.",
        approximateSizeMb = 45.0,
        officialOnnxExport = OnnxAvailability.REQUIRES_CONVERSION,
    )

    /**
     * PANNs CNN14 — strong embeddings, wrong shape for a phone.
     *
     * A Raspberry Pi study measured CNN14 hitting ~85 C thermal
     * limits. 2048-dim output and ~300 MB make it a poor fit for
     * per-track work on a handset.
     */
    val PANNS_CNN14 = CandidateModelAdapter(
        candidateId = "panns-cnn14",
        displayName = "PANNs CNN14",
        architecture = "14-layer CNN, ~80M params",
        embeddingDimension = 2048,
        license = "Apache-2.0",
        commercialUse = CommercialUse.PERMITTED,
        inputName = null,
        inputSampleRate = 32_000,
        inputChannels = 1,
        inputRepresentation = InputFormat.LOG_MEL_SPECTROGRAM,
        inputWindowSamples = 320_000,
        hopSamples = 320_000,
        melBands = 64,
        fftSize = 1_024,
        melFminHz = 50,
        melFmaxHz = 14_000,
        status = CandidateStatus.BLOCKED_PREPROCESSING,
        statusReason = "External log-mel required, ~300 MB, and published Raspberry Pi " +
            "measurements show CNN14 reaching thermal limits. Poor fit for a phone.",
        approximateSizeMb = 300.0,
        officialOnnxExport = OnnxAvailability.REQUIRES_CONVERSION,
    )

    /**
     * LAION-CLAP — the model everyone assumes, and the worst fit.
     *
     * ~155M params across an HTSAT-tiny audio tower and a RoBERTa
     * text tower, ~111 GFLOPs per sample. Attractive because it
     * enables text-to-audio search, but far too heavy to run per
     * track on a handset, and its ONNX export is non-trivial.
     */
    val CLAP = CandidateModelAdapter(
        candidateId = "laion-clap",
        displayName = "LAION-CLAP (HTSAT-tiny + RoBERTa)",
        architecture = "HTSAT-tiny audio (~30M) + RoBERTa-base text (~125M)",
        embeddingDimension = 512,
        license = "Apache-2.0 (code); per-checkpoint terms vary",
        commercialUse = CommercialUse.UNKNOWN,
        inputName = null,
        inputSampleRate = 48_000,
        inputChannels = 1,
        inputRepresentation = InputFormat.LOG_MEL_SPECTROGRAM,
        inputWindowSamples = 480_000,
        hopSamples = 480_000,
        melBands = 64,
        fftSize = 1_024,
        melFminHz = 50,
        melFmaxHz = 14_000,
        status = CandidateStatus.BLOCKED_PREPROCESSING,
        statusReason = "~155M params and ~111 GFLOPs/sample, external log-mel required, " +
            "checkpoint licensing varies. Too heavy for per-track on-device work in " +
            "this phase.",
        approximateSizeMb = 620.0,
        officialOnnxExport = OnnxAvailability.REQUIRES_CONVERSION,
    )

    val ALL = listOf(YAMNET, VGGISH, OPENL3, PANNS_CNN14, CLAP)

    fun byId(id: String): CandidateModelAdapter? = ALL.firstOrNull { it.candidateId == id }

    /** Only those SYSTEMA could honestly benchmark today. */
    fun runnable(): List<CandidateModelAdapter> =
        ALL.filter { it.status == CandidateStatus.RUNNABLE }
}
