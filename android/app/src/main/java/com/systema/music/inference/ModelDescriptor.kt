package com.systema.music.inference

/**
 * Everything the runtime needs to load and run a model, with no
 * assumption about WHICH model it is.
 *
 * WHY THIS IS GENERIC
 * -------------------
 * Phase 15 builds the runtime, not the model choice. If CLAP's shapes,
 * sample rate or embedding size were baked in here, swapping to YAMNet
 * or PANNs later would mean touching the runtime, the plugin and the
 * web layer — which is exactly the coupling this phase exists to
 * prevent. So the descriptor carries the model's contract as DATA, and
 * the runtime reads it.
 *
 * Nothing here is CLAP-specific, and nothing here is audio-specific
 * either: the deterministic test model is described by the same type.
 */
data class ModelDescriptor(
    val modelId: String,
    val modelName: String,
    val version: String,

    /** Absolute path on the device. Weights never live in git. */
    val filePath: String,

    /**
     * Expected input shape, with -1 for a dynamic dimension.
     * e.g. [1, 480000] for ten seconds of 48 kHz mono.
     */
    val inputShape: List<Long>,
    val inputType: TensorType,
    /** Null for models that do not consume audio (e.g. the test model). */
    val inputSampleRate: Int?,
    val inputChannels: Int?,

    /** Expected output shape, with -1 for a dynamic dimension. */
    val outputShape: List<Long>,
    val outputType: TensorType,

    /** Measured at load time; -1 when not yet known. */
    val sizeBytes: Long = -1L,

    /** Optional SHA-256 of the weights, for reproducibility. */
    val checksum: String? = null,

    /**
     * How raw PCM must be shaped before it reaches this model.
     *
     * Phase 15 implements RAW_WAVEFORM only, and every other value is
     * rejected at load time rather than silently mishandled. Declaring
     * the full vocabulary now keeps the boundary explicit: a model that
     * needs log-mel input must not be fed a waveform and quietly
     * produce nonsense.
     */
    val inputFormat: InputFormat = InputFormat.RAW_WAVEFORM,
) {
    /** Total element count, or null when any dimension is dynamic. */
    fun inputElementCount(): Long? =
        if (inputShape.any { it <= 0 }) null else inputShape.fold(1L) { a, b -> a * b }

    fun outputElementCount(): Long? =
        if (outputShape.any { it <= 0 }) null else outputShape.fold(1L) { a, b -> a * b }
}

/**
 * Canonical runtime identifiers.
 *
 * THE CONTRACT
 * ------------
 * These strings cross the Capacitor bridge. They are what
 * getCapabilities() advertises, what the benchmark lab sends back in
 * `runtimeId`, and what the registry is keyed by. TypeScript mirrors
 * them in `RuntimeId` (app/services/native/inferencePlugin.ts) and a
 * test asserts the two lists match.
 *
 * WHY "onnxruntime" AND NOT "onnx"
 * --------------------------------
 * Two reasons, both pre-existing rather than invented here:
 *
 *  1. Phase 14 already established `RuntimeId = 'reference' |
 *     'onnxruntime'` in app/services/ai-lab/types.ts, and the
 *     OnnxRuntimeStub it shipped already identified itself as
 *     "onnxruntime". Phase 15's job was to make that stub real, not
 *     to rename the contract around it.
 *
 *  2. "onnx" is ALREADY TAKEN, and for a different concept:
 *     `ModelFormat = 'onnx' | 'tflite' | 'none'` describes a FILE
 *     FORMAT. A runtime and a file format are not the same thing —
 *     a future TFLite runtime could load an .onnx-converted model,
 *     and reusing one token for both would make that ambiguous.
 *
 * So "onnxruntime" names the ENGINE, "onnx" names the FORMAT.
 */
object RuntimeIds {
    /** Real ONNX Runtime, CPU execution provider. */
    const val ONNX = "onnxruntime"

    /** Pure-Kotlin control. Never a fallback for [ONNX]. */
    const val REFERENCE = "reference"

    /** Everything the app knows about, for validation and tests. */
    val ALL = listOf(ONNX, REFERENCE)
}

/**
 * Identity of the deterministic test model (§8).
 *
 * Lives here, in the Android-free file, rather than alongside the
 * storage helper: the reference runtime and the JVM test suite both
 * need it, and neither can see an Android import. Keeping the
 * constant here is what lets the whole contract be tested off-device.
 */
object TestModel {
    const val ID = "systema-test-model"
    const val FILE_NAME = "systema-test-model.onnx"

    /** The transform the model encodes: (x * 2 + 1)^2. */
    const val SCALE = 2f
    const val OFFSET = 1f

    val CANONICAL_INPUT = floatArrayOf(1f, 2f, 3f, 4f)
    val CANONICAL_OUTPUT = floatArrayOf(9f, 25f, 49f, 81f)

    /** The reference implementation of the transform, stated once. */
    fun transform(x: Float): Float {
        val shifted = x * SCALE + OFFSET
        return shifted * shifted
    }
}

enum class TensorType { FLOAT32, INT64 }

/**
 * The preprocessing boundary (§10).
 *
 * Phase 13's DSP features (BPM, centroid, loudness) are NOT a valid
 * input for an arbitrary neural model, and pretending otherwise would
 * be a category error. Each model states what it actually consumes.
 */
enum class InputFormat {
    /** Float PCM, normalised, at the model's declared sample rate. */
    RAW_WAVEFORM,

    /** Mel spectrogram. Not implemented in Phase 15. */
    MEL_SPECTROGRAM,

    /** Log-mel spectrogram. Not implemented in Phase 15. */
    LOG_MEL_SPECTROGRAM,

    /** Arbitrary pre-shaped tensor, used by the deterministic test model. */
    RAW_TENSOR,
}

/**
 * Structured failure codes (§7).
 *
 * Deliberately distinct: "the file is not there" and "the file is
 * there but ONNX rejected it" lead to completely different fixes, and
 * collapsing them into one error would waste a developer's time.
 */
enum class InferenceErrorCode {
    /** No file at the descriptor's path. */
    MODEL_NOT_FOUND,

    /** The file exists but the runtime could not open it as a session. */
    MODEL_LOAD_FAILED,

    /** Loaded, but its actual signature contradicts the descriptor. */
    MODEL_INVALID,

    /** The session ran and threw. */
    MODEL_INFERENCE_FAILED,

    /** infer() was called with no model loaded. */
    MODEL_UNLOADED,

    /** Input length or shape does not match what the model declares. */
    INPUT_SHAPE_MISMATCH,

    /** The runtime itself is unavailable in this build. */
    RUNTIME_UNAVAILABLE,
}

/**
 * The only failure type this layer throws.
 *
 * There is no success-with-empty-result path anywhere in the runtime:
 * a failure is always an exception carrying a code, so no caller can
 * mistake "it failed" for "it returned zeros" (§7).
 */
class InferenceException(
    val code: InferenceErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * One inference result.
 *
 * Timings are separated (§11) so "how much does the model itself
 * cost?" is answerable. `inferenceMs` covers the session run alone —
 * not tensor allocation, not decode, not preprocessing.
 */
data class InferenceResult(
    val output: FloatArray,
    val outputShape: List<Long>,
    /** Session.run() only. */
    val inferenceMs: Double,
    /** Building the input tensor and reading the output back. */
    val tensorMs: Double,
    /**
     * Which model produced this. Carried on the result itself so a
     * stored measurement can never be attributed to the wrong model
     * after the fact.
     */
    val modelId: String = "",
) {
    // Data classes with an array member need these by hand; the
    // generated versions compare references, which would make two
    // equal results test unequal.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is InferenceResult) return false
        return output.contentEquals(other.output) &&
            outputShape == other.outputShape &&
            inferenceMs == other.inferenceMs &&
            tensorMs == other.tensorMs &&
            modelId == other.modelId
    }

    override fun hashCode(): Int {
        var result = output.contentHashCode()
        result = 31 * result + outputShape.hashCode()
        result = 31 * result + inferenceMs.hashCode()
        result = 31 * result + tensorMs.hashCode()
        result = 31 * result + modelId.hashCode()
        return result
    }
}

/** What a loaded model reports about itself, read from the session. */
data class LoadedModelInfo(
    val modelId: String,
    val sizeBytes: Long,
    /** Input names as the model actually declares them. */
    val inputNames: List<String>,
    val outputNames: List<String>,
    /** Actual input shape from the session, which may be dynamic. */
    val actualInputShape: List<Long>,
    /** Cold load cost: reading the file and building the session. */
    val loadMs: Double,
)
