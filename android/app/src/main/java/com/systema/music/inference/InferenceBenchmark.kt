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

    /**
     * The runtime registry, keyed by each runtime's OWN [InferenceRuntime.runtimeId].
     *
     * WHY associateBy AND NOT A HAND-WRITTEN mapOf
     * --------------------------------------------
     * This used to be `mapOf("onnx" to OnnxInferenceRuntime(), ...)`,
     * which created two competing sources of truth for one identifier:
     * the literal map key, and the runtime's own `runtimeId` property
     * (which is "onnxruntime"). getCapabilities() advertised the
     * PROPERTY while runtime(id) looked up the KEY, so the web layer
     * was told to ask for "onnxruntime" and Kotlin only answered to
     * "onnx". Every ONNX run on device died with:
     *
     *   RUNTIME_UNAVAILABLE
     *   Unknown runtime 'onnxruntime'. Available: onnx, reference
     *
     * Deriving the key from the property makes that class of bug
     * unrepresentable: whatever a runtime calls itself is exactly what
     * it is registered and looked up under. Renaming a runtime is now
     * a one-line change that cannot desynchronise.
     */
    private val runtimes: Map<String, InferenceRuntime> = listOf(
        OnnxInferenceRuntime(),
        ReferenceInferenceRuntime(),
    ).associateBy { it.runtimeId }

    /** One benchmark at a time; they compete for CPU and would skew each other. */
    private val mutex = Mutex()

    fun availableRuntimes(): List<InferenceRuntime> = runtimes.values.toList()

    fun runtime(id: String): InferenceRuntime =
        runtimes[id] ?: throw InferenceException(
            InferenceErrorCode.RUNTIME_UNAVAILABLE,
            "Unknown runtime '$id'. Available: ${runtimes.keys.joinToString()}",
        )

    /**
     * Native memory across repeated load → infer → unload cycles.
     *
     * WHY REPEATED CYCLES AND NOT ONE
     * -------------------------------
     * A single cycle cannot distinguish a leak from PSS noise: the OS
     * samples proportional set size coarsely, pages are reclaimed
     * lazily, and a few MB of drift is normal. Only a TREND across
     * cycles carries information. So this runs N full cycles and
     * reports whether post-unload memory returns to baseline each
     * time or climbs monotonically.
     *
     * It still cannot prove the absence of a leak — no test can — so
     * the strongest verdict it emits is STABLE, never "no leak".
     *
     * The model is genuinely re-loaded and re-unloaded every cycle.
     * That is the opposite of the benchmark path (which loads once on
     * purpose), because here the load/unload boundary IS the subject.
     */
    suspend fun runMemoryLifecycle(
        runtimeId: String,
        modelId: String,
        iterations: Int,
        inferencesPerCycle: Int,
    ): MemoryLifecycleReport = mutex.withLock {
        val rt = runtime(runtimeId)
        if (!rt.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${rt.label} is not available on this device.",
            )
        }

        val descriptor = registry.resolve(modelId)
        val env = EnvironmentSnapshot.capture(context)
        val cycles = iterations.coerceIn(1, 50)
        val perCycle = inferencesPerCycle.coerceIn(1, 100)

        // The test input must not itself dominate memory, or the
        // measurement would be about the buffer rather than the model.
        val probeInput = FloatArray(16_000) { (it % 100) / 100f }

        MemorySample.settle()
        val baseline = MemorySample.capture(context)

        val rows = ArrayList<MemoryCycle>(cycles)
        var peakKb = baseline.totalPssKb

        try {
            repeat(cycles) { i ->
                val loaded = rt.loadModel(descriptor)
                val afterLoad = MemorySample.capture(context)

                var lastInferenceMs = 0.0
                repeat(perCycle) {
                    lastInferenceMs = rt.infer(probeInput).inferenceMs
                }
                val afterInference = MemorySample.capture(context)

                rt.unloadModel()
                MemorySample.settle()
                val afterUnload = MemorySample.capture(context)

                peakKb = maxOf(peakKb, afterLoad.totalPssKb, afterInference.totalPssKb)

                rows.add(
                    MemoryCycle(
                        iteration = i + 1,
                        afterLoadKb = afterLoad.totalPssKb,
                        afterInferenceKb = afterInference.totalPssKb,
                        afterUnloadKb = afterUnload.totalPssKb,
                        loadMs = loaded.loadMs,
                        inferenceMs = lastInferenceMs,
                    ),
                )
            }
        } finally {
            // Even a mid-run failure must not leave a session resident.
            runCatching { rt.unloadModel() }
        }

        MemorySample.settle()
        val finalSample = MemorySample.capture(context)

        val trend = classifyTrend(baseline, rows)

        MemoryLifecycleReport(
            runtimeId = rt.runtimeId,
            modelId = descriptor.modelId,
            modelSizeBytes = descriptor.sizeBytes,
            iterations = cycles,
            baseline = baseline,
            cycles = rows,
            finalSample = finalSample,
            peakDeltaKb = peakKb - baseline.totalPssKb,
            netDeltaKb = finalSample.totalPssKb - baseline.totalPssKb,
            trend = trend,
            environment = env,
            caveat = "PSS is an OS estimate that includes shared and lazily reclaimed " +
                "pages, so a few MB of drift is normal. STABLE means post-unload memory " +
                "did not trend upward across $cycles cycles - it is evidence, not proof " +
                "that no leak exists.",
        )
    }

    /**
     * Classifies the post-unload series.
     *
     * Deliberately conservative. It only reports GROWING when memory
     * rises in the clear majority of steps AND the total climb exceeds
     * a noise floor, because calling normal PSS jitter a leak would
     * send someone hunting a bug that is not there.
     */
    private fun classifyTrend(baseline: MemorySample, cycles: List<MemoryCycle>): MemoryTrend {
        if (cycles.size < 3) return MemoryTrend.INCONCLUSIVE
        if (baseline.totalPssKb <= 0) return MemoryTrend.INCONCLUSIVE
        if (cycles.any { it.afterUnloadKb <= 0 }) return MemoryTrend.INCONCLUSIVE

        val series = cycles.map { it.afterUnloadKb }
        val rises = series.zipWithNext().count { (a, b) -> b > a }
        val climbKb = series.last() - series.first()

        // 8 MB across the whole run, and rising in most steps.
        val NOISE_FLOOR_KB = 8 * 1024
        return if (rises >= (series.size - 1) * 2 / 3 && climbKb > NOISE_FLOOR_KB) {
            MemoryTrend.GROWING
        } else {
            MemoryTrend.STABLE
        }
    }

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
                warmStats = LatencyStats.of(warmTimes),
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
        /**
         * Pooling used to build a track-level vector (Phase 16A).
         *
         * Selectable rather than hardcoded so strategies can be
         * compared later without touching the runtime. MEAN is the
         * default BASELINE - not a claim that it is the best choice.
         */
        aggregationStrategy: AggregationStrategy = AggregationStrategy.MEAN,
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

        // THE PREPROCESSING GATE.
        // Checked before decoding a single track, because the failure
        // is about the model, not the audio. Running first and failing
        // per-track would waste minutes of decode time and bury the
        // real reason in twenty identical rows.
        registry.requireAudioContract(modelId)

        val descriptor = registry.resolve(modelId)
        val env = EnvironmentSnapshot.capture(context)
        val config = AudioAnalysisConfig()
        val decoder = PcmDecoder(context, config)

        val rows = ArrayList<TrackMeasurement>(tracks.size)

        try {
            // COLD LOAD: once, before any track (§12).
            val loaded = rt.loadModel(descriptor)

            for (track in tracks) {
                rows.add(
                    measureOne(track, decoder, config, descriptor, rt, aggregationStrategy),
                )
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
                aggregationStrategy = aggregationStrategy,
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
        aggregationStrategy: AggregationStrategy,
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

        // ---- TRACK-LEVEL AGGREGATION (Phase 16A) ----
        // Runs AFTER inference, outside every existing timing
        // boundary. inferenceMs stays session.run() alone and totalMs
        // keeps its original formula, so numbers from earlier runs
        // remain directly comparable to these.
        //
        // A failure here does NOT fail the track: the timings are
        // still valid measurements of the model. The reason is
        // recorded instead, so an absent embedding is visible rather
        // than silently missing.
        var trackEmbedding: TrackEmbedding? = null
        var aggregationError: String? = null

        val embFrames = result.embeddingFrames
        val embShape = result.embeddingShape
        if (embFrames == null) {
            aggregationError = "No output of this model classified as a frame " +
                "embedding, so no track embedding was produced. Not substituting " +
                "another tensor: for YAMNet, output_0 is 521-wide AudioSet class " +
                "scores, and pooling those would yield a confident nonsense vector."
        } else if (embShape.size != 2 || embShape.any { it <= 0 }) {
            aggregationError = "The embedding tensor has shape $embShape, which is " +
                "not a resolved [frames, dim] matrix. Refusing to guess its layout."
        } else {
            try {
                trackEmbedding = FrameEmbeddingAggregator.aggregate(
                    frames = embFrames,
                    frameCount = embShape[0].toInt(),
                    dimension = embShape[1].toInt(),
                    strategy = aggregationStrategy,
                    normalise = true,
                )
            } catch (e: InferenceException) {
                aggregationError = e.message
            } catch (e: Throwable) {
                aggregationError = e.message ?: "Aggregation failed."
            }
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
            // NOT an embedding dimension. This is the flattened
            // element count of whichever output the runtime read, and
            // for a framed model it scales with track length. The
            // audit that renamed the UI label found it reporting
            // 401 frames x 521 AudioSet classes = 208921 for YAMNet.
            outputDimension = result.output.size,
            outputContract = OutputContract.describe(
                outputs = result.outputs,
                selectedIndex = result.selectedOutputIndex,
                selectedElementCount = result.output.size,
            ),
            outputPreview = result.output.take(8).toFloatArray(),
            // Reported alongside, never folded into totalMs - see the
            // comment above the aggregation block.
            aggregationMs = trackEmbedding?.aggregationMs,
            trackEmbedding = trackEmbedding,
            aggregationError = aggregationError,
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
    /** Distribution of the warm runs. A mean alone hides the tail. */
    val warmStats: LatencyStats?,
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
        warmStats?.let { put("warmStats", it.toJs()) }
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
    /** Which pooling produced the track embeddings in this run. */
    val aggregationStrategy: AggregationStrategy = AggregationStrategy.MEAN,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("runtimeId", runtimeId)
        put("aggregationStrategy", aggregationStrategy.name)
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
    /**
     * Flattened element count of the output that was read.
     *
     * Named `outputDimension` for wire compatibility, but it is NOT an
     * embedding dimension and the UI must not label it as one. See
     * [outputContract] for what the number actually means.
     */
    val outputDimension: Int?,
    /** Full description of every output, or null when unavailable. */
    val outputContract: OutputContractReport? = null,
    /**
     * Pooling + normalisation cost. NOT part of [totalMs].
     *
     * Kept outside the total on purpose: totalMs must keep meaning
     * what it meant in earlier runs, or the two cannot be compared.
     */
    val aggregationMs: Double? = null,
    val trackEmbedding: TrackEmbedding? = null,
    /** Why no track embedding exists, when one could not be built. */
    val aggregationError: String? = null,
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
            outputDimension = null, outputContract = null, outputPreview = null,
            aggregationMs = null, trackEmbedding = null, aggregationError = null,
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
        outputContract?.let { put("outputContract", it.toJs()) }
        aggregationMs?.let { put("aggregationMs", it) }
        trackEmbedding?.let { put("trackEmbedding", FrameEmbeddingBridge.toJs(it)) }
        aggregationError?.let { put("aggregationError", it) }
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

/**
 * Distribution of a set of latency samples.
 *
 * WHY NOT JUST A MEAN (task 6)
 * ----------------------------
 * A mean hides exactly what matters on a phone. One thermal stall or
 * one scheduler preemption inflates the average while leaving the
 * typical case untouched; conversely a lucky single run understates
 * the cost a user will actually feel. The median says what usually
 * happens, p95 says what the bad case looks like, and min/max bound
 * the run.
 *
 * p95 uses nearest-rank on the sorted samples. With few samples that
 * is coarse - with 10 runs p95 IS the maximum - so [count] is
 * reported alongside and the UI must not present a p95 from a handful
 * of runs as a stable figure.
 */
data class LatencyStats(
    val count: Int,
    val minMs: Double,
    val medianMs: Double,
    val p95Ms: Double,
    val maxMs: Double,
    val meanMs: Double,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("count", count)
        put("minMs", minMs)
        put("medianMs", medianMs)
        put("p95Ms", p95Ms)
        put("maxMs", maxMs)
        put("meanMs", meanMs)
    }

    companion object {
        fun of(samples: List<Double>): LatencyStats? {
            if (samples.isEmpty()) return null
            val s = samples.sorted()
            val mid = s.size / 2
            val median = if (s.size % 2 == 1) s[mid] else (s[mid - 1] + s[mid]) / 2.0
            // Nearest-rank: the smallest value at or above the 95th
            // percentile position, clamped into range.
            val rank = kotlin.math.ceil(0.95 * s.size).toInt().coerceIn(1, s.size)
            return LatencyStats(
                count = s.size,
                minMs = s.first(),
                medianMs = median,
                p95Ms = s[rank - 1],
                maxMs = s.last(),
                meanMs = s.average(),
            )
        }
    }
}
