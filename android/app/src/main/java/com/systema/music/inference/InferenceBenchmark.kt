package com.systema.music.inference

import android.content.Context
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Orchestrates a controlled, developer-initiated benchmark.
 *
 * THE LIFECYCLE THIS ENFORCES (§12)
 * ---------------------------------
 *   load once -> run N tracks -> unload
 *
 * Reloading a model per track would make every measurement a cold
 * load and hide the warm inference cost entirely — which is the number
 * that actually matters for a music app that will run a model
 * thousands of times. So the cold load is measured ONCE and reported
 * separately from the per-track warm inference.
 *
 * WHAT IT REFUSES TO DO (§13)
 * ---------------------------
 * It never discovers tracks. Track ids arrive from an explicit user
 * selection in the benchmark lab and nowhere else. There is no code
 * path here that enumerates the library, and the batch is hard-capped
 * so a mistake upstream cannot turn into a library-wide scan.
 */
class InferenceBenchmark(
    private val context: Context,
    private val registry: ModelRegistry,
) {

    companion object {
        private const val TAG = "SystemaInferenceBench"

        /**
         * Hard cap (§9). Enforced natively as well as in TypeScript:
         * the web layer is a UI, not a security boundary, and this is
         * the guarantee that a library-wide run cannot happen.
         */
        const val MAX_TRACKS = 20
    }

    private val runtimes: Map<String, InferenceRuntime> = mapOf(
        "onnx" to OnnxInferenceRuntime(),
        "reference" to ReferenceInferenceRuntime(),
    )

    /** One benchmark at a time; they compete for CPU and would skew each other. */
    private val mutex = Mutex()

    fun availableRuntimes(): List<InferenceRuntime> = runtimes.values.toList()

    fun runtime(id: String): InferenceRuntime =
        runtimes[id] ?: throw InferenceException(
            InferenceErrorCode.RUNTIME_UNAVAILABLE,
            "Unknown runtime '$id'. Available: ${runtimes.keys.joinToString()}",
        )

    /**
     * Loads a model, runs the deterministic tensor through it, unloads.
     *
     * This is the §8 proof: a real .onnx file, executed by a real
     * runtime, producing an output that is checked against a value
     * known before the run.
     */
    suspend fun runTestModel(
        runtimeId: String,
        input: FloatArray,
        iterations: Int,
    ): TestModelReport = mutex.withLock {
        val rt = runtime(runtimeId)
        if (!rt.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${rt.label} is not available on this device.",
            )
        }

        val descriptor = registry.testModelDescriptor()
            ?: throw InferenceException(
                InferenceErrorCode.MODEL_NOT_FOUND,
                "The deterministic test model is not installed on this device.",
            )

        val env = EnvironmentSnapshot.capture(context)
        val safeIterations = iterations.coerceIn(1, 100)

        try {
            val loaded = rt.loadModel(descriptor)

            // First run is separated: it includes any lazy native
            // warm-up, so folding it into the average would inflate
            // every subsequent comparison.
            val first = rt.infer(input)
            val warmTimes = ArrayList<Double>(safeIterations)
            var last = first
            repeat(safeIterations - 1) {
                last = rt.infer(input)
                warmTimes.add(last.inferenceMs)
            }

            // Determinism check: identical input must give identical
            // output. Comparing the last run to the first catches a
            // runtime carrying state between calls.
            val deterministic = first.output.contentEquals(last.output)

            TestModelReport(
                runtimeId = rt.runtimeId,
                runtimeLabel = rt.label,
                modelId = descriptor.modelId,
                modelSizeBytes = loaded.sizeBytes,
                coldLoadMs = loaded.loadMs,
                firstInferenceMs = first.inferenceMs,
                warmInferenceMs = if (warmTimes.isEmpty()) null else warmTimes.average(),
                iterations = safeIterations,
                input = input,
                output = first.output,
                outputShape = first.outputShape,
                deterministic = deterministic,
                environment = env,
            )
        } finally {
            // Always unload, including after a failure: a half-loaded
            // session holding native memory is exactly the leak §12
            // is about.
            runCatching { rt.unloadModel() }
                .onFailure { Log.w(TAG, "unloadModel failed after test run", it) }
        }
    }

    /**
     * Real audio through the full pipeline, for explicitly chosen tracks.
     *
     * Track -> MediaCodec -> PCM -> preprocessing -> model (§10).
     *
     * @param tracks explicit (id, uri) pairs from the user's selection
     */
    suspend fun runRealAudio(
        runtimeId: String,
        modelId: String,
        tracks: List<TrackRef>,
    ): RealAudioReport = mutex.withLock {
        if (tracks.isEmpty()) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "No tracks were selected. The benchmark never picks tracks itself.",
            )
        }
        if (tracks.size > MAX_TRACKS) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Refusing to benchmark ${tracks.size} tracks: the cap is $MAX_TRACKS. " +
                    "This limit exists so a benchmark can never become a library-wide scan.",
            )
        }

        val rt = runtime(runtimeId)
        if (!rt.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${rt.label} is not available on this device.",
            )
        }

        val descriptor = registry.resolve(modelId)
        val env = EnvironmentSnapshot.capture(context)
        val config = AudioAnalysisConfig()
        val decoder = PcmDecoder(context, config)

        val rows = ArrayList<TrackMeasurement>(tracks.size)

        try {
            // COLD LOAD: once, before any track (§12).
            val loaded = rt.loadModel(descriptor)

            for (track in tracks) {
                rows.add(measureOne(track, decoder, config, descriptor, rt))
            }

            return@withLock RealAudioReport(
                runtimeId = rt.runtimeId,
                runtimeLabel = rt.label,
                modelId = descriptor.modelId,
                modelVersion = descriptor.version,
                modelSizeBytes = loaded.sizeBytes,
                coldLoadMs = loaded.loadMs,
                measurements = rows,
                environment = env,
            )
        } finally {
            runCatching { rt.unloadModel() }
                .onFailure { Log.w(TAG, "unloadModel failed after real-audio run", it) }
        }
    }

    private suspend fun measureOne(
        track: TrackRef,
        decoder: PcmDecoder,
        config: AudioAnalysisConfig,
        descriptor: ModelDescriptor,
        rt: InferenceRuntime,
    ): TrackMeasurement {
        // ---- DECODE ----
        val decodeStartNs = System.nanoTime()
        val collected = ArrayList<FloatArray>()
        var totalSamples = 0
        val maxSamples = (config.targetSampleRate.toLong() *
            config.maxAnalysisDurationMs / 1000L).toInt()

        val info = try {
            decoder.decode(Uri.parse(track.uri), { samples, count ->
                // The decoder REUSES its buffer, so it must be copied
                // before it is retained. Keeping the reference would
                // leave every chunk holding the final chunk's audio.
                if (totalSamples < maxSamples) {
                    val take = minOf(count, maxSamples - totalSamples)
                    collected.add(samples.copyOf(take))
                    totalSamples += take
                }
            })
        } catch (e: Throwable) {
            return TrackMeasurement.failed(
                track.trackId,
                "DECODE_FAILED",
                e.message ?: "The track could not be decoded.",
            )
        }
        val decodeMs = (System.nanoTime() - decodeStartNs) / 1_000_000.0

        if (totalSamples == 0) {
            return TrackMeasurement.failed(
                track.trackId, "DECODE_FAILED", "Decoding produced no audio.",
            )
        }

        val pcm = FloatArray(totalSamples)
        var offset = 0
        for (chunk in collected) {
            System.arraycopy(chunk, 0, pcm, offset, chunk.size)
            offset += chunk.size
        }
        collected.clear()

        val audioDurationMs = totalSamples * 1000.0 / config.targetSampleRate

        // ---- PREPROCESSING ----
        val prepared = try {
            ModelInputPreparer.prepare(pcm, config.targetSampleRate, descriptor)
        } catch (e: InferenceException) {
            return TrackMeasurement.failed(track.trackId, e.code.name, e.message ?: "")
        }

        // ---- INFERENCE (warm: the model is already loaded) ----
        val result = try {
            rt.infer(prepared.data)
        } catch (e: InferenceException) {
            return TrackMeasurement.failed(track.trackId, e.code.name, e.message ?: "")
        } catch (e: Throwable) {
            return TrackMeasurement.failed(
                track.trackId,
                InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                e.message ?: "Inference failed.",
            )
        }

        val totalMs = decodeMs + prepared.preparationMs + result.inferenceMs + result.tensorMs

        return TrackMeasurement(
            trackId = track.trackId,
            ok = true,
            decodeMs = decodeMs,
            // Phase 13 DSP is NOT run here. This benchmark measures the
            // model path; conflating the two would make it impossible
            // to answer "what does the model itself cost".
            dspMs = null,
            preprocessingMs = prepared.preparationMs,
            inferenceMs = result.inferenceMs,
            tensorMs = result.tensorMs,
            totalMs = totalMs,
            audioDurationMs = audioDurationMs,
            rtf = if (audioDurationMs > 0) totalMs / audioDurationMs else null,
            outputDimension = result.output.size,
            outputPreview = result.output.take(8).toFloatArray(),
            sourceSampleRate = info.sourceSampleRate,
            sourceChannels = info.channels,
            errorCode = null,
            errorMessage = null,
        )
    }
}

data class TrackRef(val trackId: String, val uri: String)

data class TestModelReport(
    val runtimeId: String,
    val runtimeLabel: String,
    val modelId: String,
    val modelSizeBytes: Long,
    val coldLoadMs: Double,
    val firstInferenceMs: Double,
    val warmInferenceMs: Double?,
    val iterations: Int,
    val input: FloatArray,
    val output: FloatArray,
    val outputShape: List<Long>,
    val deterministic: Boolean,
    val environment: EnvironmentSnapshot,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("runtimeId", runtimeId)
        put("runtimeLabel", runtimeLabel)
        put("modelId", modelId)
        put("modelSizeBytes", modelSizeBytes)
        put("coldLoadMs", coldLoadMs)
        put("firstInferenceMs", firstInferenceMs)
        if (warmInferenceMs != null) put("warmInferenceMs", warmInferenceMs)
        put("iterations", iterations)
        put("input", JSArray().apply { input.forEach { put(it.toDouble()) } })
        put("output", JSArray().apply { output.forEach { put(it.toDouble()) } })
        put("outputShape", JSArray().apply { outputShape.forEach { put(it) } })
        put("deterministic", deterministic)
        put("environment", environment.toJs())
    }
}

data class RealAudioReport(
    val runtimeId: String,
    val runtimeLabel: String,
    val modelId: String,
    val modelVersion: String,
    val modelSizeBytes: Long,
    val coldLoadMs: Double,
    val measurements: List<TrackMeasurement>,
    val environment: EnvironmentSnapshot,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("runtimeId", runtimeId)
        put("runtimeLabel", runtimeLabel)
        put("modelId", modelId)
        put("modelVersion", modelVersion)
        put("modelSizeBytes", modelSizeBytes)
        put("coldLoadMs", coldLoadMs)
        put("environment", environment.toJs())
        put("measurements", JSArray().apply { measurements.forEach { put(it.toJs()) } })
    }
}

data class TrackMeasurement(
    val trackId: String,
    val ok: Boolean,
    val decodeMs: Double?,
    val dspMs: Double?,
    val preprocessingMs: Double?,
    val inferenceMs: Double?,
    val tensorMs: Double?,
    val totalMs: Double?,
    val audioDurationMs: Double?,
    val rtf: Double?,
    val outputDimension: Int?,
    val outputPreview: FloatArray?,
    val sourceSampleRate: Int?,
    val sourceChannels: Int?,
    val errorCode: String?,
    val errorMessage: String?,
) {
    companion object {
        fun failed(trackId: String, code: String, message: String) = TrackMeasurement(
            trackId = trackId, ok = false,
            decodeMs = null, dspMs = null, preprocessingMs = null,
            inferenceMs = null, tensorMs = null, totalMs = null,
            audioDurationMs = null, rtf = null,
            outputDimension = null, outputPreview = null,
            sourceSampleRate = null, sourceChannels = null,
            errorCode = code, errorMessage = message,
        )
    }

    fun toJs(): JSObject = JSObject().apply {
        put("trackId", trackId)
        put("ok", ok)
        decodeMs?.let { put("decodeMs", it) }
        dspMs?.let { put("dspMs", it) }
        preprocessingMs?.let { put("preprocessingMs", it) }
        inferenceMs?.let { put("inferenceMs", it) }
        tensorMs?.let { put("tensorMs", it) }
        totalMs?.let { put("totalMs", it) }
        audioDurationMs?.let { put("audioDurationMs", it) }
        rtf?.let { put("rtf", it) }
        outputDimension?.let { put("outputDimension", it) }
        outputPreview?.let { p ->
            put("outputPreview", JSArray().apply { p.forEach { put(it.toDouble()) } })
        }
        sourceSampleRate?.let { put("sourceSampleRate", it) }
        sourceChannels?.let { put("sourceChannels", it) }
        errorCode?.let { put("errorCode", it) }
        errorMessage?.let { put("errorMessage", it) }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TrackMeasurement) return false
        return trackId == other.trackId && ok == other.ok &&
            decodeMs == other.decodeMs && dspMs == other.dspMs &&
            preprocessingMs == other.preprocessingMs &&
            inferenceMs == other.inferenceMs && tensorMs == other.tensorMs &&
            totalMs == other.totalMs && audioDurationMs == other.audioDurationMs &&
            rtf == other.rtf && outputDimension == other.outputDimension &&
            (outputPreview?.contentEquals(other.outputPreview ?: FloatArray(0)) ?: (other.outputPreview == null)) &&
            sourceSampleRate == other.sourceSampleRate &&
            sourceChannels == other.sourceChannels &&
            errorCode == other.errorCode && errorMessage == other.errorMessage
    }

    override fun hashCode(): Int {
        var result = trackId.hashCode()
        result = 31 * result + ok.hashCode()
        result = 31 * result + (outputPreview?.contentHashCode() ?: 0)
        result = 31 * result + (errorCode?.hashCode() ?: 0)
        return result
    }
}
