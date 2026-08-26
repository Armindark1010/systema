package com.systema.music.inference

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The ONLY way the web layer reaches inference.
 *
 * ARCHITECTURAL BOUNDARY (§2, §4)
 * -------------------------------
 *   Nuxt -> InferencePlugin -> InferenceBenchmark -> InferenceRuntime
 *        -> ONNX Runtime -> .onnx
 *
 * Note what does NOT cross this line: no OrtSession, no OnnxTensor, no
 * execution-provider name, no ai.onnxruntime type of any kind. The
 * WebView receives numbers, ids and error codes. Swapping ONNX Runtime
 * for something else later touches one Kotlin file and zero
 * TypeScript files — which is the entire point of the abstraction.
 *
 * The surface is intentionally small: describe what is available, run
 * the deterministic test, run a chosen set of tracks. There is no
 * "analyze library" method, because no such capability should be
 * reachable from JavaScript (§13).
 */
@CapacitorPlugin(name = "Inference")
class InferencePlugin : Plugin() {

    private val registry: ModelRegistry by lazy { ModelRegistry(context) }
    private val benchmark: InferenceBenchmark by lazy { InferenceBenchmark(context, registry) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /**
     * What this device can actually do, measured rather than assumed.
     *
     * The web layer uses this to decide what to offer. It is told
     * whether a runtime is available, never why or how.
     */
    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        scope.launch {
            try {
                val runtimes = JSArray()
                benchmark.availableRuntimes().forEach { rt ->
                    runtimes.put(
                        JSObject().apply {
                            put("id", rt.runtimeId)
                            put("label", rt.label)
                            put("available", rt.isAvailable())
                        },
                    )
                }

                val models = JSArray()
                registry.testModelDescriptor()?.let { test ->
                    models.put(
                        JSObject().apply {
                            put("id", test.modelId)
                            put("name", test.modelName)
                            put("version", test.version)
                            put("sizeBytes", test.sizeBytes)
                            put("kind", "test")
                            put("installed", true)
                            put("inputFormat", test.inputFormat.name)
                        },
                    )
                }
                registry.installedModels()
                    .filter { it.fileName != ModelStorage.TEST_MODEL_FILE }
                    .forEach { m ->
                        models.put(
                            JSObject().apply {
                                put("id", m.fileName.removeSuffix(ModelStorage.EXTENSION))
                                put("name", m.fileName)
                                put("version", "side-loaded")
                                put("sizeBytes", m.sizeBytes)
                                put("kind", "sideloaded")
                                put("installed", true)
                                put("inputFormat", InputFormat.RAW_WAVEFORM.name)
                            },
                        )
                    }

                call.resolve(
                    JSObject().apply {
                        put("runtimes", runtimes)
                        put("models", models)
                        put("maxTracks", InferenceBenchmark.MAX_TRACKS)
                        put("sideloadPath", registry.sideloadInstructions())
                        put("environment", EnvironmentSnapshot.capture(context).toJs())
                    },
                )
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "Capabilities could not be read.",
                    InferenceErrorCode.RUNTIME_UNAVAILABLE.name,
                )
            }
        }
    }

    /**
     * The §8 proof: real .onnx, real runtime, checkable output.
     *
     * The caller supplies the input and knows the expected answer, so
     * a wrong result is unambiguous. Nothing here can succeed unless
     * ONNX Runtime genuinely executed the file.
     */
    @PluginMethod
    fun runTestModel(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val iterations = call.getInt("iterations") ?: 1
        val inputArray = call.getArray("input", null)

        val input: FloatArray = try {
            if (inputArray == null) {
                floatArrayOf(1f, 2f, 3f, 4f)
            } else {
                val list = inputArray.toList<Any>()
                FloatArray(list.size) { i -> (list[i] as Number).toFloat() }
            }
        } catch (e: Throwable) {
            call.reject(
                "The input array must contain only numbers.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        scope.launch {
            try {
                call.resolve(benchmark.runTestModel(runtimeId, input, iterations).toJs())
            } catch (e: InferenceException) {
                call.reject(e.message ?: "Inference failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "Inference failed.",
                    InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                )
            }
        }
    }

    /**
     * Benchmarks explicitly selected tracks.
     *
     * The track list is REQUIRED and comes from the user's selection.
     * There is deliberately no "all tracks" option and no default: if
     * the caller sends nothing, this fails rather than helpfully
     * choosing something (§13).
     */
    @PluginMethod
    fun runRealAudio(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject(
                "A modelId is required. The benchmark never picks a model for you.",
                InferenceErrorCode.MODEL_NOT_FOUND.name,
            )
            return
        }

        val rawTracks = call.getArray("tracks", null)
        if (rawTracks == null || rawTracks.length() == 0) {
            call.reject(
                "A non-empty tracks array is required. Tracks are never auto-selected.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        val tracks = ArrayList<TrackRef>(rawTracks.length())
        try {
            for (i in 0 until rawTracks.length()) {
                val obj = rawTracks.getJSONObject(i)
                val id = obj.optString("trackId")
                val uri = obj.optString("uri")
                if (id.isNullOrBlank() || uri.isNullOrBlank()) {
                    call.reject(
                        "Each track needs both trackId and uri.",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
                tracks.add(TrackRef(id, uri))
            }
        } catch (e: Throwable) {
            call.reject(
                "The tracks array could not be read.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        // Checked here as well as in the benchmark: two independent
        // gates, so neither one being wrong lets a big run through.
        if (tracks.size > InferenceBenchmark.MAX_TRACKS) {
            call.reject(
                "At most ${InferenceBenchmark.MAX_TRACKS} tracks may be benchmarked at once.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        scope.launch {
            try {
                call.resolve(benchmark.runRealAudio(runtimeId, modelId, tracks).toJs())
            } catch (e: InferenceException) {
                call.reject(e.message ?: "The benchmark failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "The benchmark failed.",
                    InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                )
            }
        }
    }

    /** Current device conditions, for labelling a measurement (§1). */
    @PluginMethod
    fun getEnvironment(call: PluginCall) {
        call.resolve(EnvironmentSnapshot.capture(context).toJs())
    }
}
