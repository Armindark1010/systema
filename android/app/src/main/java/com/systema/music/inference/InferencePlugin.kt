package com.systema.music.inference

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.inference.clap.ClapSession
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

    private companion object {
        /**
         * Logcat tag for the labelled evaluation.
         *
         * Kept distinct so a long run can be watched without the rest
         * of the app's noise:  adb logcat -s LabeledEval
         */
        const val LABELED_TAG = "LabeledEval"
    }

    private val registry: ModelRegistry by lazy { ModelRegistry(context) }
    private val benchmark: InferenceBenchmark by lazy { InferenceBenchmark(context, registry) }
    private val importer: ModelImporter by lazy {
        ModelImporter(context, ModelStorage(context), registry.contracts)
    }

    /**
     * Phase 17. Shares the benchmark's runtime registry rather than
     * building its own, so both reach the SAME loaded ONNX session
     * abstraction and no model-loading logic is duplicated.
     */
    private val qualityLab: EmbeddingQualityLab by lazy {
        EmbeddingQualityLab(context, registry) { benchmark.runtime(it) }
    }

    /**
     * Phase 18. Resolves runtimes through the same benchmark registry,
     * for the same reason: one source of truth for the loaded session.
     */
    private val labeledLab: LabeledQualityLab by lazy {
        LabeledQualityLab(context, registry) { benchmark.runtime(it) }
    }
    /**
     * Phase 21 CLAP lifecycle owner. Lazy: constructing it must not
     * touch a model, and nothing is loaded until asked.
     */
    private val clap: ClapSession by lazy { ClapSession(context, registry) }

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
                            // Pure arithmetic with a known answer, so
                            // there is no audio contract to establish.
                            put("preprocessingStatus", PreprocessingStatus.VERIFIED.name)
                            put("sampleRate", null)
                            put("embeddingDimension", null)
                        },
                    )
                }
                registry.installedModels()
                    .filter { it.fileName != ModelStorage.TEST_MODEL_FILE }
                    .forEach { m ->
                        val id = m.fileName.removeSuffix(ModelStorage.EXTENSION)
                        val contract = registry.contractFor(id)
                        models.put(
                            JSObject().apply {
                                put("id", id)
                                put("name", m.fileName)
                                put("version", if (contract != null) "imported" else "side-loaded")
                                put("sizeBytes", m.sizeBytes)
                                put("kind", if (contract != null) "imported" else "sideloaded")
                                put("installed", true)
                                // The REAL format when one is declared,
                                // and RAW_TENSOR (which the audio path
                                // refuses) when it is not. This used to
                                // claim RAW_WAVEFORM for every
                                // side-loaded file, which was an
                                // assertion SYSTEMA had no basis for.
                                put(
                                    "inputFormat",
                                    contract?.inputFormat?.name ?: InputFormat.RAW_TENSOR.name,
                                )
                                put(
                                    "preprocessingStatus",
                                    contract?.preprocessingStatus?.name
                                        ?: PreprocessingStatus.UNKNOWN.name,
                                )
                                put("sampleRate", contract?.sampleRate)
                                put("embeddingDimension", contract?.embeddingDimension)
                                put("contract", contract?.toJs())
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

        // Optional. Defaults to the MEAN baseline; an unrecognised
        // value is rejected rather than quietly falling back, so a
        // typo can never produce a run labelled with the wrong
        // strategy.
        val strategyName = call.getString("aggregationStrategy")
        val strategy = if (strategyName.isNullOrBlank()) {
            AggregationStrategy.MEAN
        } else {
            runCatching { AggregationStrategy.valueOf(strategyName) }.getOrNull()
                ?: run {
                    call.reject(
                        "Unknown aggregation strategy '$strategyName'. Expected one " +
                            "of: ${AggregationStrategy.entries.joinToString { it.name }}",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
        }

        scope.launch {
            try {
                call.resolve(
                    benchmark.runRealAudio(runtimeId, modelId, tracks, strategy).toJs(),
                )
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

    /**
     * Native memory across repeated load/unload cycles.
     *
     * The outstanding Phase 15 verification item: ONNX Runtime keeps
     * its session and weights in NATIVE memory, so "unload releases
     * resources" was previously only code-verified. This makes it
     * measurable on the physical device.
     */
    @PluginMethod
    fun runMemoryLifecycle(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject(
                "A modelId is required.",
                InferenceErrorCode.MODEL_NOT_FOUND.name,
            )
            return
        }
        val iterations = call.getInt("iterations") ?: 5
        val inferencesPerCycle = call.getInt("inferencesPerCycle") ?: 3

        scope.launch {
            try {
                call.resolve(
                    benchmark.runMemoryLifecycle(
                        runtimeId, modelId, iterations, inferencesPerCycle,
                    ).toJs(),
                )
            } catch (e: InferenceException) {
                call.reject(e.message ?: "The memory test failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "The memory test failed.",
                    InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                )
            }
        }
    }

    // ---------------------------------------------------------------
    // CLAP subsystem (Phase 21)
    //
    // Deliberately isolated. Every method below is reachable ONLY from
    // an explicit user action in the benchmark UI. Nothing here runs at
    // startup, on import, on navigation, or in the background, and
    // nothing here is reachable from PlayerEngine (§8).
    // ---------------------------------------------------------------

    /** Current lifecycle state. Pure read; never starts anything. */
    @PluginMethod
    fun getClapStatus(call: PluginCall) {
        call.resolve(clap.status())
    }

    /**
     * Memory check (§4). Callable at any point, including before load,
     * so the UI can show whether starting would even be permitted.
     */
    @PluginMethod
    fun clapMemoryCheck(call: PluginCall) {
        call.resolve(clap.memoryCheck(call.getString("modelId")))
    }

    /** LOAD. Runs the memory guard first and refuses if there is no room. */
    @PluginMethod
    fun clapLoadModel(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject(
                "A modelId is required. No model is ever chosen for you.",
                InferenceErrorCode.MODEL_NOT_FOUND.name,
            )
            return
        }
        scope.launch {
            try {
                call.resolve(clap.load(modelId, benchmark.runtime(runtimeId)))
            } catch (e: InferenceException) {
                call.reject(e.message ?: "CLAP load failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "CLAP load failed.",
                    InferenceErrorCode.MODEL_LOAD_FAILED.name,
                )
            }
        }
    }

    /** VALIDATE (§2). Dry run on a synthetic probe, before any track. */
    @PluginMethod
    fun clapValidateModel(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(clap.validate())
            } catch (e: InferenceException) {
                call.reject(e.message ?: "CLAP validation failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "CLAP validation failed.",
                    InferenceErrorCode.MODEL_INVALID.name,
                )
            }
        }
    }

    /**
     * SINGLE TEST (§5): exactly ONE manually chosen track.
     *
     * Takes one trackId and one uri. There is no array parameter, so
     * this method cannot be handed twenty tracks even by mistake.
     */
    @PluginMethod
    fun clapTestOneTrack(call: PluginCall) {
        val trackId = call.getString("trackId")
        val uri = call.getString("uri")
        if (trackId.isNullOrBlank() || uri.isNullOrBlank()) {
            call.reject(
                "Both trackId and uri are required. The track is never auto-selected.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }
        val releaseAfter = call.getBoolean("releaseAfter") ?: true
        // Seconds of audio to embed. 0 (or a negative value) means the
        // WHOLE track, streamed one window at a time. Absent means the
        // conservative default, so an old caller cannot accidentally
        // start a full-track run.
        val durationSec = call.getInt("durationSec") ?: ClapSession.DEFAULT_DURATION_SEC

        scope.launch {
            try {
                call.resolve(clap.testOneTrack(trackId, uri, releaseAfter, durationSec))
            } catch (e: InferenceException) {
                call.reject(e.message ?: "The single-track test failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "The single-track test failed.",
                    InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                )
            }
        }
    }

    /** RELEASE + MEMORY CHECK. Safe when nothing is loaded. */
    @PluginMethod
    fun clapRelease(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(clap.release())
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "CLAP release failed.",
                    InferenceErrorCode.MODEL_LOAD_FAILED.name,
                )
            }
        }
    }

    // ---------------------------------------------------------------
    // In-app model import (Phase 16.1)
    // ---------------------------------------------------------------

    /**
     * Opens the Android system file picker for ONE .onnx file.
     *
     * ACTION_OPEN_DOCUMENT, not ACTION_GET_CONTENT: it returns a
     * durable document URI and, critically, grants access to exactly
     * the single file the user tapped. There is no directory
     * permission, no scanning, and no way for this to see anything
     * else on the device.
     *
     * MIME TYPE
     * ---------
     * There is no registered MIME type for ONNX, and providers report
     * inconsistent values for unknown extensions — application/octet-
     * stream, application/x-onnx, or nothing at all. Filtering
     * strictly would hide the file the developer is trying to select,
     * which is the worst possible failure for this feature. So the
     * picker accepts everything and the FILE ITSELF is validated
     * afterwards by actually loading it. Extension is a hint; the
     * session build is the proof.
     */
    @PluginMethod
    fun pickAndImportModel(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/octet-stream", "application/x-onnx", "*/*"),
            )
            // Single selection only. Bulk import is deliberately not
            // offered: every model must be an explicit choice.
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        startActivityForResult(call, intent, "handleModelPicked")
    }

    /**
     * Receives the picked document and runs the import.
     *
     * A cancelled picker is a normal outcome, not an error: it
     * resolves with imported=false and no message, so the UI can stay
     * quiet rather than showing a failure the user caused on purpose.
     */
    @ActivityCallback
    private fun handleModelPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return

        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(
                JSObject().apply {
                    put("imported", false)
                    put("cancelled", true)
                },
            )
            return
        }

        val uri: Uri? = result.data?.data
        if (uri == null) {
            call.reject(
                "The file picker returned no file.",
                InferenceErrorCode.MODEL_NOT_FOUND.name,
            )
            return
        }

        scope.launch {
            try {
                // Validated against the SAME runtime that will execute
                // the benchmark. Validating with anything else would
                // prove the wrong thing.
                val runtime = benchmark.runtime(RuntimeIds.ONNX)
                val report = importer.import(uri, runtime)
                call.resolve(
                    report.toJs().apply {
                        put("imported", report.ok)
                        put("cancelled", false)
                    },
                )
            } catch (e: InferenceException) {
                call.reject(e.message ?: "Import failed.", e.code.name)
            } catch (e: Throwable) {
                call.reject(
                    e.message ?: "Import failed.",
                    InferenceErrorCode.MODEL_LOAD_FAILED.name,
                )
            }
        }
    }

    /**
     * Records what an imported model consumes.
     *
     * The developer supplies only what the ONNX graph cannot express —
     * sample rate and input representation. It is stamped
     * DEVELOPER_DECLARED, so no later report can present it as
     * something SYSTEMA verified.
     */
    @PluginMethod
    fun declareModelContract(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject("A modelId is required.", InferenceErrorCode.MODEL_NOT_FOUND.name)
            return
        }
        val formatName = call.getString("inputFormat")
        val format = runCatching { InputFormat.valueOf(formatName ?: "") }.getOrNull()
        if (format == null) {
            call.reject(
                "Unknown input format '$formatName'. Expected one of: " +
                    InputFormat.entries.joinToString { it.name },
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE.name,
            )
            return
        }
        val sampleRate = call.getInt("sampleRate")

        try {
            val contract = registry.declareContract(modelId, sampleRate, format)
            call.resolve(contract.toJs())
        } catch (e: Throwable) {
            call.reject(
                e.message ?: "Could not record the contract.",
                InferenceErrorCode.PREPROCESSING_UNAVAILABLE.name,
            )
        }
    }

    /** Removes an imported model and its contract. Never the test model. */
    @PluginMethod
    fun deleteImportedModel(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject("A modelId is required.", InferenceErrorCode.MODEL_NOT_FOUND.name)
            return
        }
        if (modelId == ModelStorage.TEST_MODEL_ID) {
            call.reject(
                "The bundled test model cannot be deleted: the Phase 15 integration " +
                    "proof depends on it.",
                InferenceErrorCode.MODEL_INVALID.name,
            )
            return
        }
        val deleted = registry.deleteImported(modelId)
        call.resolve(JSObject().apply { put("deleted", deleted) })
    }

    /**
     * The researched candidate matrix.
     *
     * Documentation, not measurement. Every figure here is quoted from
     * the models' published papers and repositories; none was measured
     * by SYSTEMA and none of these models has run on this device. The
     * UI states that alongside the table.
     */
    @PluginMethod
    fun getCandidates(call: PluginCall) {
        val list = JSArray()
        CandidateRegistry.ALL.forEach { c ->
            list.put(
                JSObject().apply {
                    put("candidateId", c.candidateId)
                    put("displayName", c.displayName)
                    put("architecture", c.architecture)
                    put("embeddingDimension", c.embeddingDimension)
                    put("license", c.license)
                    put("commercialUse", c.commercialUse.name)
                    put("inputSampleRate", c.inputSampleRate)
                    put("inputChannels", c.inputChannels)
                    put("inputRepresentation", c.inputRepresentation.name)
                    put("melBands", c.melBands)
                    put("status", c.status.name)
                    put("statusReason", c.statusReason)
                    put("approximateSizeMb", c.approximateSizeMb)
                    put("officialOnnxExport", c.officialOnnxExport.name)
                    // Nothing below has ever been measured.
                    put("coldLoadMs", null)
                    put("warmInferenceMs", null)
                    put("peakMemoryKb", null)
                    put("deviceVerified", false)
                },
            )
        }
        call.resolve(
            JSObject().apply {
                put("candidates", list)
                put("measured", false)
                put(
                    "note",
                    "Published specifications only. No candidate model has been " +
                        "downloaded, executed or verified on this device.",
                )
            },
        )
    }

    /** Current device conditions, for labelling a measurement (§1). */
    @PluginMethod
    fun getEnvironment(call: PluginCall) {
        call.resolve(EnvironmentSnapshot.capture(context).toJs())
    }

    // ---------------------------------------------------------------
    // Phase 17 — Embedding Quality Lab
    // ---------------------------------------------------------------

    /**
     * Evaluates real track embeddings, emitting a result per track.
     *
     * WHY THIS RESOLVES IMMEDIATELY
     * -----------------------------
     * The call resolves as soon as the run is ACCEPTED, and every
     * actual result arrives as an event. A twenty-track evaluation
     * takes minutes; holding a bridge promise open for that long
     * would give the UI nothing to show until the very end, which is
     * exactly the batch-then-dump behaviour this phase forbids.
     *
     * This mirrors how MusicLibraryPlugin.scan already works, so the
     * pattern is one the web layer already knows.
     */
    @PluginMethod
    fun runQualityEvaluation(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject(
                "A modelId is required. The quality lab never picks a model for you.",
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
        if (rawTracks.length() > EmbeddingQualityLab.MAX_TRACKS) {
            call.reject(
                "At most ${EmbeddingQualityLab.MAX_TRACKS} tracks may be evaluated " +
                    "at once.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        val tracks = ArrayList<TrackRef>(rawTracks.length())
        // Labels are read from the request and NEVER derived from
        // artist or genre metadata. A label here is a claim the
        // developer is making about the pair, and manufacturing one
        // would turn a tag-quality measurement into an
        // embedding-quality claim.
        val labels = HashMap<String, String>()
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
                val label = obj.optString("label")
                if (!label.isNullOrBlank()) labels[id] = label
            }
        } catch (e: Throwable) {
            call.reject(
                "The tracks array could not be read.",
                InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
            )
            return
        }

        val strategyName = call.getString("aggregationStrategy")
        val strategy = if (strategyName.isNullOrBlank()) {
            AggregationStrategy.MEAN
        } else {
            runCatching { AggregationStrategy.valueOf(strategyName) }.getOrNull()
                ?: run {
                    call.reject(
                        "Unknown aggregation strategy '$strategyName'.",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
        }

        if (qualityLab.isRunning()) {
            call.reject(
                "An evaluation is already running. Stop it before starting another.",
                InferenceErrorCode.RUNTIME_UNAVAILABLE.name,
            )
            return
        }

        scope.launch {
            try {
                qualityLab.evaluate(
                    runtimeId = runtimeId,
                    modelId = modelId,
                    tracks = tracks,
                    labels = labels,
                    strategy = strategy,
                ) { event, payload -> notifyListeners(event, payload) }
            } catch (e: InferenceException) {
                notifyListeners(
                    EmbeddingQualityLab.EVENT_FINISHED,
                    JSObject().apply {
                        put("failed", true)
                        put("errorCode", e.code.name)
                        put("errorMessage", e.message)
                    },
                )
            } catch (e: Throwable) {
                notifyListeners(
                    EmbeddingQualityLab.EVENT_FINISHED,
                    JSObject().apply {
                        put("failed", true)
                        put("errorCode", InferenceErrorCode.MODEL_INFERENCE_FAILED.name)
                        put("errorMessage", e.message ?: "The evaluation failed.")
                    },
                )
            }
        }

        call.resolve(
            JSObject().apply {
                put("started", true)
                put("totalTracks", tracks.size)
                put("labelled", labels.isNotEmpty())
            },
        )
    }

    /**
     * Requests a stop.
     *
     * Already-completed results are kept: they are real measurements
     * that cost real time, and discarding them because the developer
     * chose not to wait for the rest would be gratuitous.
     */
    @PluginMethod
    fun stopQualityEvaluation(call: PluginCall) {
        qualityLab.requestCancel()
        call.resolve(
            JSObject().apply {
                put("stopping", true)
                put("running", qualityLab.isRunning())
            },
        )
    }

    /** Whether an evaluation is in flight, for restoring UI state. */
    @PluginMethod
    fun getQualityEvaluationStatus(call: PluginCall) {
        call.resolve(
            JSObject().apply {
                put("running", qualityLab.isRunning())
                put("maxTracks", EmbeddingQualityLab.MAX_TRACKS)
            },
        )
    }

    // ================= PHASE 18: LABELLED EVALUATION =================

    /**
     * Starts a labelled evaluation.
     *
     * Resolves as soon as the run is ACCEPTED, not when it finishes.
     * A 13-track run takes minutes; holding the bridge promise open
     * for that is exactly what produces a blank screen. Results arrive
     * as events, one per track and then one per pair.
     *
     * Pair labels arrive as {"i:j": "SAME|SIMILAR|DIFFERENT"}. They are
     * read, never written. Nothing here derives a label from metadata
     * or from a measurement.
     */
    @PluginMethod
    fun runLabeledEvaluation(call: PluginCall) {
        val runtimeId = call.getString("runtimeId") ?: RuntimeIds.ONNX
        val modelId = call.getString("modelId")
        if (modelId.isNullOrBlank()) {
            call.reject(
                "A modelId is required. The lab never picks a model for you.",
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
        if (rawTracks.length() > LabeledQualityLab.MAX_TRACKS) {
            call.reject(
                "At most ${LabeledQualityLab.MAX_TRACKS} tracks may be evaluated at once.",
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

        // ---- PAIR LABELS: read verbatim, never inferred ----
        val pairLabels = HashMap<String, PairLabel>()
        val labelSources = HashMap<String, LabelSource>()
        val rawLabels = call.getObject("pairLabels")
        if (rawLabels != null) {
            val keys = rawLabels.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val entry = rawLabels.optJSONObject(key)
                val labelText = entry?.optString("label") ?: rawLabels.optString(key)
                val parsed = PairLabel.parse(labelText)
                if (parsed == null) {
                    // An unreadable label is rejected outright rather
                    // than defaulted. Defaulting to DIFFERENT would
                    // invent negatives, and negatives are what the
                    // separation statistic is measured against.
                    call.reject(
                        "Pair '$key' has an unrecognised label '$labelText'. " +
                            "Expected SAME, SIMILAR or DIFFERENT.",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
                if (!isValidPairKey(key, tracks.size)) {
                    call.reject(
                        "Pair key '$key' does not address two distinct tracks " +
                            "in range 0..${tracks.size - 1}.",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
                pairLabels[key] = parsed
                labelSources[key] = when (entry?.optString("source")?.uppercase()) {
                    "FIXTURE" -> LabelSource.FIXTURE
                    else -> LabelSource.HUMAN
                }
            }
        }

        val strategyName = call.getString("aggregationStrategy")
        val strategy = if (strategyName.isNullOrBlank()) {
            AggregationStrategy.MEAN
        } else {
            runCatching { AggregationStrategy.valueOf(strategyName) }.getOrNull()
                ?: run {
                    call.reject(
                        "Unknown aggregation strategy '$strategyName'.",
                        InferenceErrorCode.INPUT_SHAPE_MISMATCH.name,
                    )
                    return
                }
        }

        if (labeledLab.isRunning()) {
            call.reject(
                "An evaluation is already running. Stop it before starting another.",
                InferenceErrorCode.RUNTIME_UNAVAILABLE.name,
            )
            return
        }

        scope.launch {
            try {
                labeledLab.evaluate(
                    runtimeId = runtimeId,
                    modelId = modelId,
                    tracks = tracks,
                    pairLabels = pairLabels,
                    labelSources = labelSources,
                    strategy = strategy,
                ) { event, payload ->
                    // Device diagnostics for the Phase 18 white-screen
                    // investigation. The terminal events are the ones
                    // that historically preceded the blank page, so
                    // their payload is logged in full and can be read
                    // with:  adb logcat -s LabeledEval
                    //
                    // Logging never blocks the emit: a diagnostic must
                    // not be able to break the thing it is diagnosing.
                    runCatching {
                        if (event == LabeledQualityLab.EVENT_FINISHED) {
                            Log.i(LABELED_TAG, "$event -> $payload")
                        } else {
                            Log.d(LABELED_TAG, "$event")
                        }
                    }
                    notifyListeners(event, payload)
                }
            } catch (e: InferenceException) {
                notifyListeners(
                    LabeledQualityLab.EVENT_FINISHED,
                    JSObject().apply {
                        put("failed", true)
                        put("errorCode", e.code.name)
                        put("errorMessage", e.message)
                    },
                )
            } catch (e: Throwable) {
                notifyListeners(
                    LabeledQualityLab.EVENT_FINISHED,
                    JSObject().apply {
                        put("failed", true)
                        put("errorCode", InferenceErrorCode.MODEL_INFERENCE_FAILED.name)
                        put("errorMessage", e.message ?: "The evaluation failed.")
                    },
                )
            }
        }

        call.resolve(
            JSObject().apply {
                put("started", true)
                put("totalTracks", tracks.size)
                put("labelledPairs", pairLabels.size)
            },
        )
    }

    /** "i:j" with i < j and both inside the track list. */
    private fun isValidPairKey(key: String, trackCount: Int): Boolean {
        val parts = key.split(":")
        if (parts.size != 2) return false
        val a = parts[0].toIntOrNull() ?: return false
        val b = parts[1].toIntOrNull() ?: return false
        return a in 0 until trackCount && b in 0 until trackCount && a < b
    }

    /** Stops between items. Completed results are kept. */
    @PluginMethod
    fun stopLabeledEvaluation(call: PluginCall) {
        labeledLab.requestCancel()
        call.resolve(
            JSObject().apply {
                put("stopping", true)
                put("running", labeledLab.isRunning())
            },
        )
    }

    @PluginMethod
    fun getLabeledEvaluationStatus(call: PluginCall) {
        call.resolve(
            JSObject().apply {
                put("running", labeledLab.isRunning())
                put("maxTracks", LabeledQualityLab.MAX_TRACKS)
            },
        )
    }
}
