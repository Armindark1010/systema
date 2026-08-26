package com.systema.music.inference

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.util.Log
import java.io.File
import java.nio.FloatBuffer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Real ONNX Runtime execution. THE ONLY FILE THAT IMPORTS ONNX.
 *
 * Everything ONNX-specific — sessions, tensors, OrtEnvironment,
 * OrtException — is contained here and converted at the boundary into
 * the plain Kotlin types in ModelDescriptor.kt. Grep for
 * `ai.onnxruntime` across the project: this file should be the only
 * hit outside tests. That containment is the deliverable of Phase 15
 * as much as the inference itself is.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It never fabricates output. If the model is missing, the file is
 * corrupt, or the session throws, the call fails with a specific code.
 * There is deliberately no fallback to the reference runtime, because
 * a silent downgrade would make a benchmark report ONNX numbers that
 * ONNX never produced (§13).
 *
 * THREADING
 * ---------
 * OrtSession is not documented as thread-safe for concurrent run()
 * calls, and the load/unload pair mutates shared state. A Mutex
 * serialises everything; benchmark runs are sequential by design, so
 * there is no throughput cost.
 *
 * EXECUTION PROVIDER
 * ------------------
 * CPU only, deliberately. NNAPI is deprecated as of Android 15 — the
 * target device's OS — and the device is MediaTek, so Qualcomm's QNN
 * provider does not apply. Adding an unvalidated provider would
 * produce numbers nobody could trust. CPU is the honest baseline.
 */
class OnnxInferenceRuntime : InferenceRuntime {

    private companion object {
        const val TAG = "SystemaOnnx"
    }

    override val runtimeId = RuntimeIds.ONNX
    override val label = "ONNX Runtime (CPU)"

    private val mutex = Mutex()

    private var environment: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var descriptor: ModelDescriptor? = null
    private var info: LoadedModelInfo? = null

    override fun isAvailable(): Boolean = try {
        // Touching the class is enough to prove the AAR linked and the
        // native library loaded. A ClassNotFoundError or
        // UnsatisfiedLinkError here means the dependency is broken,
        // which must be reported rather than crashing the app.
        OrtEnvironment.getEnvironment()
        true
    } catch (t: Throwable) {
        Log.e(TAG, "ONNX Runtime unavailable", t)
        false
    }

    override fun isLoaded(): Boolean = session != null

    override fun loadedModel(): LoadedModelInfo? = info

    override suspend fun loadModel(model: ModelDescriptor): LoadedModelInfo =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                // One model resident at a time (§12): loading a second
                // without this would leak the first's native memory,
                // and these files can be hundreds of megabytes.
                releaseLocked()

                val file = File(model.filePath)
                if (!file.exists() || !file.isFile) {
                    throw InferenceException(
                        InferenceErrorCode.MODEL_NOT_FOUND,
                        "No model file at ${model.filePath}. Model weights are never " +
                            "committed to git; side-load the .onnx file to the device first.",
                    )
                }
                if (file.length() <= 0L) {
                    throw InferenceException(
                        InferenceErrorCode.MODEL_INVALID,
                        "Model file at ${model.filePath} is empty (0 bytes).",
                    )
                }

                val startNs = System.nanoTime()

                val env = try {
                    OrtEnvironment.getEnvironment()
                } catch (t: Throwable) {
                    throw InferenceException(
                        InferenceErrorCode.RUNTIME_UNAVAILABLE,
                        "Could not initialise ONNX Runtime: ${t.message}",
                        t,
                    )
                }

                val options = try {
                    OrtSession.SessionOptions().apply {
                        // Single thread: a benchmark measuring "what does
                        // this model cost" is easier to interpret without
                        // the scheduler distributing work unpredictably
                        // across big and little cores.
                        setIntraOpNumThreads(1)
                        setInterOpNumThreads(1)
                        setOptimizationLevel(
                            OrtSession.SessionOptions.OptLevel.ALL_OPT,
                        )
                    }
                } catch (t: Throwable) {
                    throw InferenceException(
                        InferenceErrorCode.MODEL_LOAD_FAILED,
                        "Could not build ONNX session options: ${t.message}",
                        t,
                    )
                }

                val created = try {
                    env.createSession(model.filePath, options)
                } catch (e: OrtException) {
                    options.close()
                    throw InferenceException(
                        InferenceErrorCode.MODEL_LOAD_FAILED,
                        "ONNX Runtime rejected ${file.name}: ${e.message}",
                        e,
                    )
                } catch (t: Throwable) {
                    options.close()
                    throw InferenceException(
                        InferenceErrorCode.MODEL_LOAD_FAILED,
                        "Unexpected failure loading ${file.name}: ${t.message}",
                        t,
                    )
                }

                val loadMs = (System.nanoTime() - startNs) / 1_000_000.0

                val inputNames = created.inputNames.toList()
                val outputNames = created.outputNames.toList()

                // A session with no inputs cannot be driven, and a
                // descriptor that disagrees with the file means the
                // caller is about to measure the wrong thing.
                if (inputNames.isEmpty() || outputNames.isEmpty()) {
                    created.close()
                    options.close()
                    throw InferenceException(
                        InferenceErrorCode.MODEL_INVALID,
                        "Model ${file.name} declares ${inputNames.size} inputs and " +
                            "${outputNames.size} outputs; both must be non-empty.",
                    )
                }

                val actualShape = readInputShape(created, inputNames.first())

                environment = env
                session = created
                descriptor = model

                val loaded = LoadedModelInfo(
                    modelId = model.modelId,
                    sizeBytes = file.length(),
                    inputNames = inputNames,
                    outputNames = outputNames,
                    actualInputShape = actualShape,
                    loadMs = loadMs,
                )
                info = loaded

                Log.i(
                    TAG,
                    "[AI-BENCHMARK] model_loaded id=${model.modelId} " +
                        "bytes=${file.length()} loadMs=${"%.2f".format(loadMs)} " +
                        "inputs=$inputNames shape=$actualShape",
                )
                loaded
            }
        }

    override suspend fun infer(input: FloatArray): InferenceResult =
        withContext(Dispatchers.Default) {
            mutex.withLock {
                val active = session ?: throw InferenceException(
                    InferenceErrorCode.MODEL_UNLOADED,
                    "infer() called with no model loaded. Call loadModel() first.",
                )
                val model = descriptor ?: throw InferenceException(
                    InferenceErrorCode.MODEL_UNLOADED,
                    "No descriptor for the loaded session.",
                )
                val env = environment ?: throw InferenceException(
                    InferenceErrorCode.RUNTIME_UNAVAILABLE,
                    "ONNX environment disappeared.",
                )

                // Validate BEFORE touching native memory: a shape
                // mismatch caught here is a clear error, whereas the
                // same mistake inside ORT is an opaque native message.
                val expected = model.inputElementCount()
                if (expected != null && input.size.toLong() != expected) {
                    throw InferenceException(
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                        "Model ${model.modelId} expects $expected float(s) " +
                            "(shape ${model.inputShape}) but received ${input.size}.",
                    )
                }
                if (input.isEmpty()) {
                    throw InferenceException(
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                        "Refusing to run inference on an empty input buffer.",
                    )
                }

                val inputName = active.inputNames.first()
                // A dynamic batch/length dimension is resolved from the
                // actual input so a model declaring [1, -1] still runs.
                val shape = resolveShape(model.inputShape, input.size)

                val tensorStartNs = System.nanoTime()
                var tensor: OnnxTensor? = null
                var results: OrtSession.Result? = null
                try {
                    tensor = OnnxTensor.createTensor(
                        env,
                        FloatBuffer.wrap(input),
                        shape,
                    )
                    val tensorMs = (System.nanoTime() - tensorStartNs) / 1_000_000.0

                    // Timed as tightly as possible around run() alone:
                    // this is the number that answers "what does the
                    // model itself cost" (§11).
                    val runStartNs = System.nanoTime()
                    results = active.run(mapOf(inputName to tensor))
                    val inferenceMs = (System.nanoTime() - runStartNs) / 1_000_000.0

                    val readStartNs = System.nanoTime()
                    val first = results.get(0)
                    val flat = flattenFloats(first.value)
                        ?: throw InferenceException(
                            InferenceErrorCode.MODEL_INFERENCE_FAILED,
                            "Model ${model.modelId} returned an output this runtime " +
                                "cannot read as float32 (${first.value?.javaClass?.name}).",
                        )
                    val outShape = (first.info as? TensorInfo)?.shape?.toList() ?: emptyList()
                    val readMs = (System.nanoTime() - readStartNs) / 1_000_000.0

                    InferenceResult(
                        output = flat,
                        outputShape = outShape,
                        inferenceMs = inferenceMs,
                        tensorMs = tensorMs + readMs,
                        modelId = model.modelId,
                    )
                } catch (e: InferenceException) {
                    throw e
                } catch (e: OrtException) {
                    throw InferenceException(
                        InferenceErrorCode.MODEL_INFERENCE_FAILED,
                        "ONNX inference failed for ${model.modelId}: ${e.message}",
                        e,
                    )
                } catch (t: Throwable) {
                    throw InferenceException(
                        InferenceErrorCode.MODEL_INFERENCE_FAILED,
                        "Unexpected inference failure for ${model.modelId}: ${t.message}",
                        t,
                    )
                } finally {
                    // Native buffers must be released on every path,
                    // including failure, or a benchmark loop leaks
                    // until the process dies.
                    try { results?.close() } catch (_: Throwable) {}
                    try { tensor?.close() } catch (_: Throwable) {}
                }
            }
        }

    override suspend fun unloadModel() = withContext(Dispatchers.IO) {
        mutex.withLock { releaseLocked() }
    }

    /** Caller must hold the mutex. */
    private fun releaseLocked() {
        val existing = session ?: return
        try {
            existing.close()
            Log.i(TAG, "[AI-BENCHMARK] model_unloaded id=${descriptor?.modelId}")
        } catch (t: Throwable) {
            Log.w(TAG, "Error closing ONNX session", t)
        } finally {
            session = null
            descriptor = null
            info = null
            // OrtEnvironment is a process-wide singleton owned by the
            // library; closing it would break every later load, so it
            // is deliberately left alone.
        }
    }

    private fun readInputShape(session: OrtSession, name: String): List<Long> = try {
        val nodeInfo = session.inputInfo[name]
        (nodeInfo?.info as? TensorInfo)?.shape?.toList() ?: emptyList()
    } catch (t: Throwable) {
        Log.w(TAG, "Could not read input shape for $name", t)
        emptyList()
    }

    /** Substitutes the real length into a single dynamic dimension. */
    private fun resolveShape(declared: List<Long>, actualElements: Int): LongArray {
        if (declared.isEmpty()) return longArrayOf(actualElements.toLong())
        val dynamicCount = declared.count { it <= 0 }
        if (dynamicCount == 0) return declared.toLongArray()
        if (dynamicCount > 1) {
            // Ambiguous: several unknowns cannot be inferred from one
            // total. Fall back to a flat vector rather than guessing.
            return longArrayOf(actualElements.toLong())
        }
        val known = declared.filter { it > 0 }.fold(1L) { a, b -> a * b }
        val inferred = if (known > 0) actualElements / known else actualElements.toLong()
        return declared.map { if (it <= 0) inferred else it }.toLongArray()
    }

    /**
     * Flattens ORT's nested array output into a FloatArray.
     *
     * ORT returns Java arrays whose nesting matches the tensor rank,
     * so a [1, 512] output arrives as Array<FloatArray>. Recursion
     * handles any rank without special cases per shape.
     */
    private fun flattenFloats(value: Any?): FloatArray? = when (value) {
        null -> null
        is FloatArray -> value
        is Array<*> -> {
            val parts = value.map { flattenFloats(it) ?: return null }
            val total = parts.sumOf { it.size }
            val out = FloatArray(total)
            var offset = 0
            for (part in parts) {
                part.copyInto(out, offset)
                offset += part.size
            }
            out
        }
        is Float -> floatArrayOf(value)
        else -> null
    }
}
