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
        inputFormat: InputFormat = InputFormat.RAW_WAVEFORM,
        inputShape: List<Long> = listOf(-1L),
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

        return ModelDescriptor(
            modelId = fileName.removeSuffix(ModelStorage.EXTENSION),
            modelName = fileName,
            version = "side-loaded",
            filePath = path,
            inputShape = inputShape,
            inputType = TensorType.FLOAT32,
            inputSampleRate = sampleRate,
            inputChannels = 1,
            outputShape = listOf(-1L),
            outputType = TensorType.FLOAT32,
            sizeBytes = file.length(),
            checksum = null,
            inputFormat = inputFormat,
        )
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
