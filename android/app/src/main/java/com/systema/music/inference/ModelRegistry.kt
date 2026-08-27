package com.systema.music.inference

import android.content.Context

/**
 * Turns installed .onnx files into [ModelDescriptor]s the runtime
 * can load.
 *
 * DESIGN: no model is hard-coded except the test one
 * --------------------------------------------------
 * Phase 15 must not choose a production model (§3). So the registry
 * knows exactly one model by name — the deterministic test model,
 * whose shape and expected output are fixed by definition — and
 * treats everything else as an unknown side-loaded file described by
 * whatever the developer states in the UI.
 *
 * That keeps the "which model wins" question entirely open, while
 * still letting a developer point the benchmark at a real .onnx today.
 */
class ModelRegistry(context: Context) {

    private val storage = ModelStorage(context.applicationContext)

    /**
     * What is known about imported models.
     *
     * Exposed so the plugin and the importer share ONE source of
     * truth about each model's contract. Two stores would eventually
     * disagree, and the disagreement would show up as a benchmark
     * that ran when it should have refused.
     */
    val contracts = ModelContractStore(context.applicationContext)

    /**
     * The deterministic test model (§8).
     *
     * Input [1,2,3,4] -> output [9,25,49,81] via (x*2+1)^2. Dynamic
     * length, so the same file also accepts audio-sized buffers.
     */
    fun testModelDescriptor(): ModelDescriptor? {
        val path = storage.installTestModelFromAssets()
            ?: storage.pathFor(ModelStorage.TEST_MODEL_FILE)
            ?: return null

        val size = java.io.File(path).let { if (it.exists()) it.length() else 0L }

        return ModelDescriptor(
            modelId = ModelStorage.TEST_MODEL_ID,
            modelName = "Deterministic Test Model",
            version = "1.0.0",
            filePath = path,
            // -1 marks the dynamic dimension the graph declares.
            inputShape = listOf(-1L),
            inputType = TensorType.FLOAT32,
            inputSampleRate = null,
            inputChannels = 1,
            outputShape = listOf(-1L),
            outputType = TensorType.FLOAT32,
            sizeBytes = size,
            checksum = null,
            inputFormat = InputFormat.RAW_TENSOR,
        )
    }

    /** Everything side-loaded into the models directory. */
    fun installedModels(): List<InstalledModel> = storage.listInstalled()

    /**
     * Builds a descriptor for a side-loaded file.
     *
     * The shape is supplied by the caller because SYSTEMA cannot know
     * it: reading it from the file would require parsing protobuf here,
     * and guessing it would be worse. When it is unknown the descriptor
     * declares a fully dynamic shape and the runtime reads the truth
     * from the session at load time.
     */
    fun descriptorForInstalled(
        fileName: String,
        sampleRate: Int? = null,
        inputFormat: InputFormat? = null,
        inputShape: List<Long>? = null,
    ): ModelDescriptor {
        val path = storage.pathFor(fileName)
            ?: throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "External storage is unavailable, so $fileName cannot be located.",
            )
        val file = java.io.File(path)
        if (!file.exists()) {
            throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "No model named $fileName is installed. Side-load it first: " +
                    storage.sideloadInstructions(),
            )
        }

        val modelId = fileName.removeSuffix(ModelStorage.EXTENSION)

        // A stored contract, when one exists, is authoritative over
        // any default. This is what makes an imported model carry its
        // OWN sample rate rather than inheriting Phase 13's 22050 Hz
        // — feeding YAMNet 22.05 kHz because that is what the decoder
        // happens to emit would be exactly the silent-wrong-answer
        // failure this phase exists to prevent.
        val contract = contracts.find(modelId)

        return ModelDescriptor(
            modelId = modelId,
            modelName = fileName,
            version = if (contract != null) "imported" else "side-loaded",
            filePath = path,
            inputShape = inputShape ?: contract?.inputShape?.takeIf { it.isNotEmpty() }
                ?: listOf(-1L),
            inputType = TensorType.FLOAT32,
            inputSampleRate = sampleRate ?: contract?.sampleRate,
            inputChannels = 1,
            outputShape = contract?.outputShape?.takeIf { it.isNotEmpty() } ?: listOf(-1L),
            outputType = TensorType.FLOAT32,
            sizeBytes = file.length(),
            checksum = null,
            // No default. An undeclared model gets RAW_TENSOR, which
            // the benchmark path refuses for audio, rather than
            // RAW_WAVEFORM, which it would happily run.
            inputFormat = inputFormat ?: contract?.inputFormat ?: InputFormat.RAW_TENSOR,
        )
    }

    /**
     * Verifies a model may be benchmarked against real audio.
     *
     * THE GATE (§ preprocessing safety)
     * ---------------------------------
     * Loading proves a graph is executable. It says nothing about
     * whether the tensor SYSTEMA would build is the tensor the model
     * was trained on. Only a declared contract establishes that, so a
     * model without one fails here — loudly, with
     * PREPROCESSING_UNAVAILABLE — instead of producing plausible
     * numbers from arbitrary PCM.
     *
     * The bundled test model is exempt: it is pure arithmetic with no
     * audio semantics at all, and its expected output is known in
     * advance.
     */
    fun requireAudioContract(modelId: String) {
        if (modelId == ModelStorage.TEST_MODEL_ID) return

        val contract = contracts.find(modelId)
            ?: throw InferenceException(
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE,
                "No preprocessing contract is declared for '$modelId'. An ONNX graph " +
                    "records shapes but not sample rate or feature extraction, so " +
                    "SYSTEMA cannot know what this model expects. Declare the contract " +
                    "in the Candidate Lab first. Refusing to run: a benchmark on the " +
                    "wrong input produces believable timings and meaningless embeddings.",
            )

        when (contract.preprocessingStatus) {
            PreprocessingStatus.VERIFIED -> Unit

            PreprocessingStatus.BLOCKED -> throw InferenceException(
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE,
                "'$modelId' needs a ${contract.inputFormat?.name ?: "spectrogram"} front " +
                    "end that SYSTEMA does not implement. Matching a training-time " +
                    "filterbank exactly is required; approximating it is not acceptable.",
            )

            PreprocessingStatus.UNKNOWN -> throw InferenceException(
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE,
                "The preprocessing contract for '$modelId' is UNKNOWN. Declare its " +
                    "sample rate and input format in the Candidate Lab before " +
                    "benchmarking it against real audio.",
            )
        }

        if (contract.sampleRate == null || contract.sampleRate <= 0) {
            throw InferenceException(
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE,
                "'$modelId' is marked VERIFIED but declares no sample rate. That is " +
                    "contradictory, so it is treated as unverified.",
            )
        }
        if (contract.inputFormat == null) {
            throw InferenceException(
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE,
                "'$modelId' is marked VERIFIED but declares no input format.",
            )
        }
    }

    /** The contract for a model, or null when nothing is known. */
    fun contractFor(modelId: String): ModelContract? = contracts.find(modelId)

    /**
     * Records a developer-declared contract.
     *
     * Graph-derived fields are preserved from the existing record; the
     * developer only supplies what the graph cannot express. The
     * source is stamped DEVELOPER_DECLARED so a later report can never
     * present an assertion as something SYSTEMA verified.
     */
    fun declareContract(
        modelId: String,
        sampleRate: Int?,
        inputFormat: InputFormat,
    ): ModelContract {
        val existing = contracts.find(modelId)

        // Only formats with an implemented preparation path can be
        // VERIFIED. Declaring "log-mel" does not make a mel front end
        // exist, so those record as BLOCKED however confident the
        // developer is.
        val status = when (inputFormat) {
            InputFormat.MEL_SPECTROGRAM,
            InputFormat.LOG_MEL_SPECTROGRAM,
            -> PreprocessingStatus.BLOCKED

            InputFormat.RAW_WAVEFORM ->
                if (sampleRate != null && sampleRate > 0) PreprocessingStatus.VERIFIED
                else PreprocessingStatus.UNKNOWN

            InputFormat.RAW_TENSOR -> PreprocessingStatus.UNKNOWN
        }

        val updated = ModelContract(
            modelId = modelId,
            inputName = existing?.inputName,
            inputShape = existing?.inputShape ?: emptyList(),
            inputType = existing?.inputType ?: "UNKNOWN",
            outputName = existing?.outputName,
            outputShape = existing?.outputShape ?: emptyList(),
            embeddingDimension = existing?.embeddingDimension,
            sampleRate = sampleRate,
            inputFormat = inputFormat,
            preprocessingStatus = status,
            declaredBy = ContractSource.DEVELOPER_DECLARED,
        )
        contracts.save(updated)
        return updated
    }

    /** Forgets an imported model's file and its contract together. */
    fun deleteImported(modelId: String): Boolean {
        val fileName = if (modelId.endsWith(ModelStorage.EXTENSION)) modelId
        else modelId + ModelStorage.EXTENSION
        val deleted = storage.deleteInstalled(fileName)
        if (deleted) contracts.remove(modelId)
        return deleted
    }

    /** Resolves a model id from the UI to a descriptor. */
    fun resolve(modelId: String, sampleRate: Int? = null): ModelDescriptor {
        if (modelId == ModelStorage.TEST_MODEL_ID) {
            return testModelDescriptor() ?: throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "The bundled test model could not be installed to device storage.",
            )
        }
        val fileName = if (modelId.endsWith(ModelStorage.EXTENSION)) {
            modelId
        } else {
            modelId + ModelStorage.EXTENSION
        }
        return descriptorForInstalled(fileName, sampleRate = sampleRate)
    }

    fun sideloadInstructions(): String = storage.sideloadInstructions()

    fun checksum(fileName: String): String? = storage.checksum(fileName)
}
