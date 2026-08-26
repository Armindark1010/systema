package com.systema.music.inference

/**
 * The contract between SYSTEMA and whatever executes a model.
 *
 * WHY THIS INTERFACE EXISTS
 * -------------------------
 * The architecture Phase 15 must preserve is:
 *
 *     Nuxt → Capacitor Plugin → Kotlin → InferenceRuntime → ONNX → model
 *
 * Everything above this interface is forbidden from knowing that ONNX
 * Runtime exists. No `ai.onnxruntime.*` type appears in the plugin, in
 * the TypeScript services, in the UI, or in the music-library domain.
 * That is what makes a future runtime swap a one-class change instead
 * of a refactor across three layers.
 *
 * LIFECYCLE (§12)
 * ---------------
 *     load → (infer × N) → unload
 *
 * Models are large. Exactly one is resident at a time; loading a
 * second implicitly releases the first. This is enforced by the
 * implementation, not left to callers to remember.
 *
 * FAILURE (§7)
 * ------------
 * Every failure throws [InferenceException] with a specific code.
 * There is no path that returns an empty or synthesised result — a
 * missing model FAILS, it does not produce a fake embedding.
 */
interface InferenceRuntime {

    /** Stable identifier, surfaced to the benchmark UI. */
    val runtimeId: String

    /** Human-readable name for the UI. */
    val label: String

    /**
     * True when this runtime can execute at all in this build.
     *
     * False here must lead to a visible, explained failure rather than
     * a silent fallback to another runtime (§13).
     */
    fun isAvailable(): Boolean

    /**
     * Loads a model, replacing any currently-loaded one.
     *
     * This is the COLD path and is timed separately from inference so
     * the two can never be conflated in a benchmark.
     *
     * @throws InferenceException MODEL_NOT_FOUND, MODEL_LOAD_FAILED,
     *   MODEL_INVALID, RUNTIME_UNAVAILABLE
     */
    suspend fun loadModel(model: ModelDescriptor): LoadedModelInfo

    /**
     * Runs one inference. WARM path.
     *
     * @throws InferenceException MODEL_UNLOADED, INPUT_SHAPE_MISMATCH,
     *   MODEL_INFERENCE_FAILED
     */
    suspend fun infer(input: FloatArray): InferenceResult

    /** Releases the session and its native memory. Idempotent. */
    suspend fun unloadModel()

    fun isLoaded(): Boolean

    /** Metadata for the loaded model, or null when none is loaded. */
    fun loadedModel(): LoadedModelInfo?
}
