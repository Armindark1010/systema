package com.systema.music.inference

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

/**
 * A runtime that computes the test transform in pure Kotlin.
 *
 * WHAT THIS IS FOR
 * ----------------
 * It is the control in the experiment. It implements the same
 * contract as [OnnxInferenceRuntime] and computes the same function,
 * so a benchmark run against it isolates the cost of everything that
 * is NOT the ONNX engine: the Capacitor bridge, JSON marshalling,
 * decode, DSP, preprocessing. Subtract it from an ONNX run and what
 * remains is the engine's true overhead.
 *
 * WHAT THIS IS EMPHATICALLY NOT
 * -----------------------------
 * It is not a fallback. If ONNX fails, the failure propagates (§13).
 * Nothing in this codebase substitutes this runtime for a real one,
 * because a reference result that arrived when a model was expected
 * would be a fabricated measurement wearing a real one's clothes.
 *
 * It also refuses any model other than the deterministic test model.
 * Asked to "run YAMNet", it fails with MODEL_INVALID rather than
 * returning arithmetic that would look like an embedding.
 */
class ReferenceInferenceRuntime : InferenceRuntime {

    override val runtimeId: String = RuntimeIds.REFERENCE
    override val label: String = "Reference (pure Kotlin)"

    private val mutex = Mutex()
    private var loaded: ModelDescriptor? = null
    private var info: LoadedModelInfo? = null

    /** Always true: it is ordinary Kotlin with no native dependency. */
    override fun isAvailable(): Boolean = true

    override fun isLoaded(): Boolean = loaded != null

    override fun loadedModel(): LoadedModelInfo? = info

    override suspend fun loadModel(descriptor: ModelDescriptor): LoadedModelInfo = mutex.withLock {
        // Refuse real models rather than producing plausible nonsense.
        if (descriptor.modelId != TestModel.ID) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "The reference runtime only implements the deterministic test transform " +
                    "((x*2+1)^2). It cannot execute '${descriptor.modelId}'. Producing a " +
                    "number here would be a fabricated result, so it refuses. Use the ONNX " +
                    "runtime for real models.",
            )
        }

        val startNs = System.nanoTime()

        // Still check the file, so "model missing" behaves identically
        // across runtimes and the safety tests mean the same thing.
        val file = File(descriptor.filePath)
        if (!file.exists()) {
            throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "Model file not found: ${descriptor.filePath}",
            )
        }

        val loadMs = (System.nanoTime() - startNs) / 1_000_000.0
        loaded = descriptor
        info = LoadedModelInfo(
            modelId = descriptor.modelId,
            sizeBytes = file.length(),
            inputNames = listOf("input"),
            outputNames = listOf("output"),
            actualInputShape = descriptor.inputShape,
            loadMs = loadMs,
        )
        info!!
    }

    override suspend fun infer(input: FloatArray): InferenceResult = mutex.withLock {
        val descriptor = loaded ?: throw InferenceException(
            InferenceErrorCode.MODEL_UNLOADED,
            "No model is loaded. Call loadModel() before infer().",
        )

        val startNs = System.nanoTime()
        // TestModel.transform is the single definition of the
        // transform; duplicating the arithmetic here would let the
        // two drift apart silently.
        val output = FloatArray(input.size) { TestModel.transform(input[it]) }
        val inferenceMs = (System.nanoTime() - startNs) / 1_000_000.0

        InferenceResult(
            output = output,
            outputShape = listOf(input.size.toLong()),
            inferenceMs = inferenceMs,
            // No tensor marshalling happens here; reporting a fake
            // non-zero cost would distort the very comparison this
            // runtime exists to enable.
            tensorMs = 0.0,
            modelId = descriptor.modelId,
        )
    }

    override suspend fun unloadModel() = mutex.withLock {
        loaded = null
        info = null
    }
}
