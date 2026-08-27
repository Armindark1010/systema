package com.systema.music.inference

import android.content.Context
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Measures whether YAMNet's track embeddings are geometrically useful.
 *
 * WHY THIS IS NOT PART OF InferenceBenchmark
 * ------------------------------------------
 * The benchmark answers "what does this model cost". This answers
 * "are the vectors it produces distinguishable from one another".
 * They share the pipeline but not the question, and folding the
 * second into the first would have meant changing a class whose
 * outputs are already recorded in earlier measurements.
 *
 * What it deliberately REUSES rather than duplicates: PcmDecoder,
 * ModelInputPreparer, the InferenceRuntime registry,
 * FrameEmbeddingAggregator and OutputContract. No model-loading logic
 * is reimplemented here.
 *
 * INCREMENTAL BY CONSTRUCTION
 * ---------------------------
 * Tracks are processed strictly one at a time and each result is
 * pushed to [onEvent] the moment it exists. Nothing is batched. A
 * developer can leave a 20-track run going and see the eighteenth
 * result arrive without waiting for the twentieth - which matters,
 * because a run over real audio takes minutes and a silent UI is
 * indistinguishable from a hung one.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It will not use output_0, will not invent a similarity for the
 * first track, will not fabricate an embedding for a failed track,
 * and will not pronounce the model good or bad. It reports measured
 * geometry and stops there.
 */
class EmbeddingQualityLab(
    private val context: Context,
    private val registry: ModelRegistry,
    private val runtimeFor: (String) -> InferenceRuntime,
) {

    companion object {
        private const val TAG = "EmbeddingQualityLab"

        /**
         * Hard ceiling on one evaluation.
         *
         * The same reasoning as the benchmark's cap: this is a
         * developer diagnostic over EXPLICITLY CHOSEN tracks, and a
         * limit is what keeps it from drifting into a library-wide
         * scan. Twenty tracks give 190 pairs, which is plenty of
         * geometry to look at.
         */
        const val MAX_TRACKS = 20

        // Event names. Mirrored in the TypeScript layer.
        const val EVENT_STARTED = "qualityEvalStarted"
        const val EVENT_TRACK_STARTED = "qualityEvalTrackStarted"
        const val EVENT_TRACK_COMPLETED = "qualityEvalTrackCompleted"
        const val EVENT_FINISHED = "qualityEvalFinished"
    }

    /** One evaluation at a time; a second call waits rather than interleaves. */
    private val mutex = Mutex()

    /**
     * Cancellation flag.
     *
     * Atomic because it is set from the bridge thread and read from
     * the worker. Checked between tracks and, during decode, between
     * PCM chunks - so a stop lands within a chunk rather than at the
     * end of a three-minute file.
     */
    private val cancelRequested = AtomicBoolean(false)

    private val running = AtomicBoolean(false)

    fun requestCancel() {
        cancelRequested.set(true)
    }

    fun isRunning(): Boolean = running.get()

    /**
     * Runs the evaluation, emitting after every track.
     *
     * @param onEvent called with (eventName, payload) as work
     *   progresses. Invoked on the calling coroutine, in order.
     */
    suspend fun evaluate(
        runtimeId: String,
        modelId: String,
        tracks: List<TrackRef>,
        labels: Map<String, String> = emptyMap(),
        strategy: AggregationStrategy = AggregationStrategy.MEAN,
        onEvent: (String, JSObject) -> Unit,
    ): EvaluationReport = mutex.withLock {
        if (tracks.isEmpty()) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "No tracks were selected. The quality lab never picks tracks itself.",
            )
        }
        if (tracks.size > MAX_TRACKS) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Refusing to evaluate ${tracks.size} tracks: the cap is $MAX_TRACKS. " +
                    "This limit is what keeps a diagnostic from becoming a " +
                    "library-wide scan.",
            )
        }

        val rt = runtimeFor(runtimeId)
        if (!rt.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${rt.label} is not available on this device.",
            )
        }

        // Checked once, up front. Failing per-track would waste
        // minutes of decode time and bury the real reason in twenty
        // identical rows.
        registry.requireAudioContract(modelId)
        val descriptor = registry.resolve(modelId)

        cancelRequested.set(false)
        running.set(true)

        val config = AudioAnalysisConfig()
        val decoder = PcmDecoder(context, config)
        val env = EnvironmentSnapshot.capture(context)

        // The ONLY things retained across tracks: one unit vector and
        // some numbers per track. Decoded PCM, prepared input and
        // frame embeddings all go out of scope inside evaluateOne.
        val completed = ArrayList<TrackEvaluation>(tracks.size)
        val vectors = ArrayList<FloatArray>(tracks.size)
        val vectorTrackIds = ArrayList<String>(tracks.size)

        val startNs = System.nanoTime()
        var cancelled = false

        MemorySample.settle()
        val memoryBefore = MemorySample.capture(context)
        var memoryPeak = memoryBefore

        try {
            val loaded = rt.loadModel(descriptor)

            onEvent(
                EVENT_STARTED,
                JSObject().apply {
                    put("totalTracks", tracks.size)
                    put("modelId", descriptor.modelId)
                    put("runtimeId", rt.runtimeId)
                    put("aggregationStrategy", strategy.name)
                    put("coldLoadMs", loaded.loadMs)
                    put("labelled", labels.isNotEmpty())
                },
            )

            for ((index, track) in tracks.withIndex()) {
                if (cancelRequested.get()) {
                    cancelled = true
                    break
                }

                onEvent(
                    EVENT_TRACK_STARTED,
                    JSObject().apply {
                        put("index", index)
                        put("position", index + 1)
                        put("totalTracks", tracks.size)
                        put("trackId", track.trackId)
                        put("elapsedMs", (System.nanoTime() - startNs) / 1_000_000.0)
                    },
                )

                val evaluation = evaluateOne(
                    track = track,
                    index = index,
                    decoder = decoder,
                    config = config,
                    descriptor = descriptor,
                    rt = rt,
                    strategy = strategy,
                    priorVectors = vectors,
                    priorTrackIds = vectorTrackIds,
                )

                completed.add(evaluation)
                if (evaluation.ok && evaluation.embedding != null) {
                    vectors.add(evaluation.embedding)
                    vectorTrackIds.add(track.trackId)
                }

                val sample = MemorySample.capture(context)
                if (sample.totalPssKb > memoryPeak.totalPssKb) memoryPeak = sample

                // Statistics are recomputed over everything finished
                // SO FAR, so the matrix and the distribution are live
                // rather than a final-frame reveal.
                val liveStats = EmbeddingSimilarity.statistics(
                    EmbeddingSimilarity.pairwise(vectors).map { it.score },
                )

                onEvent(
                    EVENT_TRACK_COMPLETED,
                    JSObject().apply {
                        put("index", index)
                        put("position", index + 1)
                        put("totalTracks", tracks.size)
                        put("elapsedMs", (System.nanoTime() - startNs) / 1_000_000.0)
                        put("evaluation", evaluation.toJs(vectorTrackIds))
                        put("completedCount", completed.size)
                        put("successCount", completed.count { it.ok })
                        put("failureCount", completed.count { !it.ok })
                        put("matrix", matrixToJs(vectors, vectorTrackIds))
                        liveStats?.let { put("stats", it.toJs()) }
                        put("memoryPssKb", sample.totalPssKb)
                    },
                )
            }
        } finally {
            running.set(false)
            runCatching { rt.unloadModel() }
                .onFailure { Log.w(TAG, "unloadModel failed after evaluation", it) }
        }

        MemorySample.settle()
        val memoryAfter = MemorySample.capture(context)

        val pairs = EmbeddingSimilarity.pairwise(vectors)
        val stats = EmbeddingSimilarity.statistics(pairs.map { it.score })

        // Grouped statistics only when the developer supplied labels.
        // Labels are never derived from metadata here.
        val grouped = if (labels.isNotEmpty()) {
            EmbeddingSimilarity.groupedStatistics(
                vectors,
                vectorTrackIds.map { labels[it] },
            )
        } else {
            emptyMap()
        }

        val report = EvaluationReport(
            modelId = descriptor.modelId,
            runtimeId = rt.runtimeId,
            aggregationStrategy = strategy,
            requestedCount = tracks.size,
            evaluations = completed,
            trackIdsWithEmbeddings = vectorTrackIds,
            pairs = pairs,
            stats = stats,
            groupedStats = grouped,
            cancelled = cancelled,
            totalElapsedMs = (System.nanoTime() - startNs) / 1_000_000.0,
            memoryBeforeKb = memoryBefore.totalPssKb,
            memoryPeakKb = memoryPeak.totalPssKb,
            memoryAfterKb = memoryAfter.totalPssKb,
            environment = env,
        )

        onEvent(EVENT_FINISHED, report.toJs())
        return@withLock report
    }

    /**
     * Decode, prepare, infer, pool, normalise, compare - for ONE track.
     *
     * Every large buffer is local to this function, so it becomes
     * garbage the moment the function returns. Across a 20-track run
     * the retained set grows by one 4 KB vector per track, not by one
     * decoded track's worth of PCM (which for five minutes at 16 kHz
     * is ~19 MB).
     */
    private suspend fun evaluateOne(
        track: TrackRef,
        index: Int,
        decoder: PcmDecoder,
        config: AudioAnalysisConfig,
        descriptor: ModelDescriptor,
        rt: InferenceRuntime,
        strategy: AggregationStrategy,
        priorVectors: List<FloatArray>,
        priorTrackIds: List<String>,
    ): TrackEvaluation {
        // ---- DECODE ----
        val decodeStartNs = System.nanoTime()
        var collected: ArrayList<FloatArray>? = ArrayList()
        var totalSamples = 0
        val maxSamples = (
            config.targetSampleRate.toLong() *
                config.maxAnalysisDurationMs / 1000L
            ).toInt()

        val info = try {
            decoder.decode(
                Uri.parse(track.uri),
                { samples, count ->
                    // The decoder reuses its buffer, so a chunk must be
                    // copied before it is retained.
                    if (totalSamples < maxSamples) {
                        val take = minOf(count, maxSamples - totalSamples)
                        collected?.add(samples.copyOf(take))
                        totalSamples += take
                    }
                },
                // Cancellation reaches INSIDE the decode, so stopping
                // does not have to wait out a long file.
                { cancelRequested.get() },
            )
        } catch (e: Throwable) {
            return TrackEvaluation.failed(
                index, track.trackId, "DECODE_FAILED",
                e.message ?: "The track could not be decoded.",
            )
        }
        val decodeMs = (System.nanoTime() - decodeStartNs) / 1_000_000.0

        if (cancelRequested.get()) {
            collected = null
            return TrackEvaluation.failed(
                index, track.trackId, "CANCELLED",
                "Stopped during decode, before an embedding was produced.",
            )
        }
        if (totalSamples == 0) {
            collected = null
            return TrackEvaluation.failed(
                index, track.trackId, "DECODE_FAILED", "Decoding produced no audio.",
            )
        }

        val pcm = FloatArray(totalSamples)
        var offset = 0
        for (chunk in collected!!) {
            System.arraycopy(chunk, 0, pcm, offset, chunk.size)
            offset += chunk.size
        }
        // Chunks are dead the moment they are concatenated. Dropped
        // here rather than at the end of the function so the peak
        // holds one copy of the audio, not two.
        collected.clear()
        collected = null

        val audioDurationMs = totalSamples * 1000.0 / config.targetSampleRate

        // ---- PREPARE ----
        val prepared = try {
            ModelInputPreparer.prepare(pcm, config.targetSampleRate, descriptor)
        } catch (e: InferenceException) {
            return TrackEvaluation.failed(index, track.trackId, e.code.name, e.message ?: "")
        }

        // ---- INFER (warm; the model was loaded once, before track 1) ----
        val result = try {
            rt.infer(prepared.data)
        } catch (e: InferenceException) {
            return TrackEvaluation.failed(index, track.trackId, e.code.name, e.message ?: "")
        } catch (e: Throwable) {
            return TrackEvaluation.failed(
                index, track.trackId, InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                e.message ?: "Inference failed.",
            )
        }

        val totalMs = decodeMs + prepared.preparationMs + result.inferenceMs + result.tensorMs

        val contract = OutputContract.describe(
            outputs = result.outputs,
            selectedIndex = result.selectedOutputIndex,
            selectedElementCount = result.output.size,
        )

        // ---- THE EMBEDDING TENSOR ----
        // From result.embeddingFrames, which OnnxInferenceRuntime
        // populated by SHAPE via OutputContract. Never result.output:
        // that is whatever index 0 happened to be, and for YAMNet it
        // is the 521-wide class-score tensor.
        val frames = result.embeddingFrames
        val shape = result.embeddingShape
        if (frames == null) {
            return TrackEvaluation.failed(
                index, track.trackId, "EMBEDDING_UNAVAILABLE",
                "No output of this model classified as a frame embedding. Not " +
                    "substituting another tensor: pooling class scores would " +
                    "produce a confident, well-formed, meaningless vector.",
                decodeMs, prepared.preparationMs, result.inferenceMs,
                result.tensorMs, totalMs, audioDurationMs, contract,
            )
        }
        if (shape.size != 2 || shape.any { it <= 0 }) {
            return TrackEvaluation.failed(
                index, track.trackId, "EMBEDDING_SHAPE_INVALID",
                "The embedding tensor has shape $shape, which is not a resolved " +
                    "[frames, dim] matrix. Refusing to guess its layout.",
                decodeMs, prepared.preparationMs, result.inferenceMs,
                result.tensorMs, totalMs, audioDurationMs, contract,
            )
        }

        // ---- POOL + NORMALISE (Phase 16A, unchanged) ----
        val embedding = try {
            FrameEmbeddingAggregator.aggregate(
                frames = frames,
                frameCount = shape[0].toInt(),
                dimension = shape[1].toInt(),
                strategy = strategy,
                normalise = true,
            )
        } catch (e: InferenceException) {
            return TrackEvaluation.failed(
                index, track.trackId, "AGGREGATION_FAILED", e.message ?: "",
                decodeMs, prepared.preparationMs, result.inferenceMs,
                result.tensorMs, totalMs, audioDurationMs, contract,
            )
        }

        // ---- VERIFY UNIT LENGTH ----
        // A degenerate vector is excluded rather than compared. Cosine
        // against a zero vector is undefined, and letting one into the
        // matrix would corrupt every statistic derived from it.
        if (embedding.degenerate) {
            return TrackEvaluation.failed(
                index, track.trackId, "DEGENERATE_EMBEDDING",
                "The pooled vector had zero magnitude, so it was returned as zeros " +
                    "and is excluded from similarity: cosine against it is " +
                    "undefined, not zero.",
                decodeMs, prepared.preparationMs, result.inferenceMs,
                result.tensorMs, totalMs, audioDurationMs, contract,
            )
        }
        try {
            EmbeddingSimilarity.requireUnitLength(embedding.vector, track.trackId)
        } catch (e: InferenceException) {
            return TrackEvaluation.failed(
                index, track.trackId, "NOT_UNIT_LENGTH", e.message ?: "",
                decodeMs, prepared.preparationMs, result.inferenceMs,
                result.tensorMs, totalMs, audioDurationMs, contract,
            )
        }

        // ---- COMPARE AGAINST WHAT IS ALREADY DONE ----
        // Only against tracks that have already produced a valid
        // vector. For the first track this list is empty and the
        // answer is "no comparison available", not a placeholder score.
        var nearestId: String? = null
        var nearestScore: Double? = null
        var farthestId: String? = null
        var farthestScore: Double? = null

        if (priorVectors.isNotEmpty()) {
            var bestScore = Double.NEGATIVE_INFINITY
            var worstScore = Double.POSITIVE_INFINITY
            var bestIdx = -1
            var worstIdx = -1
            for (i in priorVectors.indices) {
                val s = EmbeddingSimilarity.cosine(embedding.vector, priorVectors[i])
                if (s > bestScore) { bestScore = s; bestIdx = i }
                if (s < worstScore) { worstScore = s; worstIdx = i }
            }
            if (bestIdx >= 0) {
                nearestId = priorTrackIds[bestIdx]
                nearestScore = bestScore
            }
            if (worstIdx >= 0) {
                farthestId = priorTrackIds[worstIdx]
                farthestScore = worstScore
            }
        }

        return TrackEvaluation(
            index = index,
            trackId = track.trackId,
            ok = true,
            embedding = embedding.vector,
            dimension = embedding.dimension,
            norm = EmbeddingSimilarity.l2Norm(embedding.vector),
            preNormL2 = embedding.preNormL2,
            frameCount = shape[0].toInt(),
            frameDimension = shape[1].toInt(),
            decodeMs = decodeMs,
            preprocessingMs = prepared.preparationMs,
            inferenceMs = result.inferenceMs,
            tensorMs = result.tensorMs,
            aggregationMs = embedding.aggregationMs,
            totalMs = totalMs,
            audioDurationMs = audioDurationMs,
            rtf = if (audioDurationMs > 0) totalMs / audioDurationMs else null,
            sourceSampleRate = info.sourceSampleRate,
            sourceChannels = info.channels,
            outputContract = contract,
            nearestTrackId = nearestId,
            nearestScore = nearestScore,
            farthestTrackId = farthestId,
            farthestScore = farthestScore,
            errorCode = null,
            errorMessage = null,
        )
    }

    /** Full symmetric matrix, built for display from the upper triangle. */
    private fun matrixToJs(vectors: List<FloatArray>, ids: List<String>): JSObject {
        val rows = JSArray()
        for (i in vectors.indices) {
            val row = JSArray()
            for (j in vectors.indices) {
                val v = when {
                    // The diagonal is 1 by definition, not by
                    // measurement - a vector is always identical to
                    // itself. Computed anyway would waste N dot
                    // products to rediscover a tautology.
                    i == j -> 1.0
                    else -> EmbeddingSimilarity.cosine(vectors[i], vectors[j])
                }
                row.put(v)
            }
            rows.put(row)
        }
        return JSObject().apply {
            put("trackIds", JSArray().apply { ids.forEach { put(it) } })
            put("rows", rows)
            put("size", vectors.size)
        }
    }
}

/**
 * One track's result.
 *
 * [embedding] is the only heavyweight field, and it is 4 KB. It is
 * kept because the matrix is recomputed live; everything else is a
 * scalar.
 */
data class TrackEvaluation(
    val index: Int,
    val trackId: String,
    val ok: Boolean,
    val embedding: FloatArray? = null,
    val dimension: Int? = null,
    val norm: Double? = null,
    val preNormL2: Double? = null,
    val frameCount: Int? = null,
    val frameDimension: Int? = null,
    val decodeMs: Double? = null,
    val preprocessingMs: Double? = null,
    val inferenceMs: Double? = null,
    val tensorMs: Double? = null,
    val aggregationMs: Double? = null,
    val totalMs: Double? = null,
    val audioDurationMs: Double? = null,
    val rtf: Double? = null,
    val sourceSampleRate: Int? = null,
    val sourceChannels: Int? = null,
    val outputContract: OutputContractReport? = null,
    val nearestTrackId: String? = null,
    val nearestScore: Double? = null,
    val farthestTrackId: String? = null,
    val farthestScore: Double? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
) {
    companion object {
        /**
         * A failure, with whatever timings were reached.
         *
         * There is deliberately no embedding parameter: a failed track
         * has no vector, and no code path in this file can give it one.
         */
        fun failed(
            index: Int,
            trackId: String,
            code: String,
            message: String,
            decodeMs: Double? = null,
            preprocessingMs: Double? = null,
            inferenceMs: Double? = null,
            tensorMs: Double? = null,
            totalMs: Double? = null,
            audioDurationMs: Double? = null,
            contract: OutputContractReport? = null,
        ) = TrackEvaluation(
            index = index,
            trackId = trackId,
            ok = false,
            decodeMs = decodeMs,
            preprocessingMs = preprocessingMs,
            inferenceMs = inferenceMs,
            tensorMs = tensorMs,
            totalMs = totalMs,
            audioDurationMs = audioDurationMs,
            outputContract = contract,
            errorCode = code,
            errorMessage = message,
        )
    }

    fun toJs(completedTrackIds: List<String> = emptyList()): JSObject = JSObject().apply {
        put("index", index)
        put("trackId", trackId)
        put("ok", ok)
        dimension?.let { put("dimension", it) }
        norm?.let { put("norm", it) }
        preNormL2?.let { put("preNormL2", it) }
        frameCount?.let { put("frameCount", it) }
        frameDimension?.let { put("frameDimension", it) }
        decodeMs?.let { put("decodeMs", it) }
        preprocessingMs?.let { put("preprocessingMs", it) }
        inferenceMs?.let { put("inferenceMs", it) }
        tensorMs?.let { put("tensorMs", it) }
        aggregationMs?.let { put("aggregationMs", it) }
        totalMs?.let { put("totalMs", it) }
        audioDurationMs?.let { put("audioDurationMs", it) }
        rtf?.let { put("rtf", it) }
        sourceSampleRate?.let { put("sourceSampleRate", it) }
        sourceChannels?.let { put("sourceChannels", it) }
        outputContract?.let { put("outputContract", it.toJs()) }
        // Absent rather than zero when there is nothing to compare
        // against. The UI shows "first embedding" for this case.
        nearestTrackId?.let { put("nearestTrackId", it) }
        nearestScore?.let { put("nearestScore", it) }
        farthestTrackId?.let { put("farthestTrackId", it) }
        farthestScore?.let { put("farthestScore", it) }
        put("hasComparison", nearestScore != null)
        put("comparedAgainst", completedTrackIds.size - (if (ok) 1 else 0))
        errorCode?.let { put("errorCode", it) }
        errorMessage?.let { put("errorMessage", it) }
        // A short preview only. The full 1024 floats stay native.
        embedding?.let { v ->
            put("preview", v.take(8).joinToString(", ") { String.format("%.5f", it) })
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TrackEvaluation) return false
        return index == other.index && trackId == other.trackId && ok == other.ok &&
            dimension == other.dimension && errorCode == other.errorCode &&
            (embedding?.contentEquals(other.embedding ?: FloatArray(0)) ?: (other.embedding == null))
    }

    override fun hashCode(): Int {
        var result = index
        result = 31 * result + trackId.hashCode()
        result = 31 * result + ok.hashCode()
        result = 31 * result + (embedding?.contentHashCode() ?: 0)
        result = 31 * result + (errorCode?.hashCode() ?: 0)
        return result
    }
}

/** The whole run. */
data class EvaluationReport(
    val modelId: String,
    val runtimeId: String,
    val aggregationStrategy: AggregationStrategy,
    val requestedCount: Int,
    val evaluations: List<TrackEvaluation>,
    val trackIdsWithEmbeddings: List<String>,
    val pairs: List<PairSimilarity>,
    val stats: SimilarityStats?,
    val groupedStats: Map<String, SimilarityStats>,
    val cancelled: Boolean,
    val totalElapsedMs: Double,
    val memoryBeforeKb: Int,
    val memoryPeakKb: Int,
    val memoryAfterKb: Int,
    val environment: EnvironmentSnapshot,
) {
    val successCount: Int get() = evaluations.count { it.ok }
    val failureCount: Int get() = evaluations.count { !it.ok }

    /** Median of a timing across SUCCESSFUL tracks only. */
    private fun median(selector: (TrackEvaluation) -> Double?): Double? {
        val v = evaluations.filter { it.ok }.mapNotNull(selector).sorted()
        if (v.isEmpty()) return null
        return if (v.size % 2 == 1) v[v.size / 2] else (v[v.size / 2 - 1] + v[v.size / 2]) / 2.0
    }

    fun toJs(): JSObject = JSObject().apply {
        put("modelId", modelId)
        put("runtimeId", runtimeId)
        put("aggregationStrategy", aggregationStrategy.name)
        put("requestedCount", requestedCount)
        put("completedCount", evaluations.size)
        put("successCount", successCount)
        put("failureCount", failureCount)
        put("remainingCount", requestedCount - evaluations.size)
        put("cancelled", cancelled)
        put("totalElapsedMs", totalElapsedMs)

        put("evaluations", JSArray().apply {
            evaluations.forEach { put(it.toJs(trackIdsWithEmbeddings)) }
        })
        put("trackIdsWithEmbeddings", JSArray().apply {
            trackIdsWithEmbeddings.forEach { put(it) }
        })

        stats?.let { put("stats", it.toJs()) }

        if (groupedStats.isNotEmpty()) {
            put("groupedStats", JSObject().apply {
                groupedStats.forEach { (k, v) -> put(k, v.toJs()) }
            })
        }
        // Stated as a fact about THIS run, so the UI never has to
        // guess whether the numbers describe labelled comparisons.
        put("labelled", groupedStats.isNotEmpty())

        put("medianDecodeMs", median { it.decodeMs })
        put("medianInferenceMs", median { it.inferenceMs })
        put("medianAggregationMs", median { it.aggregationMs })
        put("medianTotalMs", median { it.totalMs })
        put("medianRtf", median { it.rtf })

        put("memoryBeforeKb", memoryBeforeKb)
        put("memoryPeakKb", memoryPeakKb)
        put("memoryAfterKb", memoryAfterKb)
        put("memoryDeltaKb", memoryAfterKb - memoryBeforeKb)

        // ENERGY. Android exposes no per-process energy accounting
        // that is trustworthy over a two-minute foreground run:
        // BatteryManager counters are coarse, device-dependent and
        // dominated by the screen. Rather than derive a number from
        // them and call it measured, this says plainly that it was not
        // measured. See docs/phase-17-embedding-quality.md.
        put("energyMeasured", false)
        put("energyNote", "Not directly measured")

        put("environment", environment.toJs())

        // The verdict field. It is a constant, and deliberately so:
        // no threshold on cosine statistics is defensible without
        // labelled ground truth, and this phase does not have any.
        put("qualityConclusion", "INSUFFICIENT EVIDENCE")
        put(
            "qualityNote",
            if (groupedStats.isNotEmpty()) {
                "Group statistics describe the labels supplied for this run only. " +
                    "They are evidence, not a verdict, and the sample is small."
            } else {
                "UNLABELED EVALUATION. Similarity statistics describe embedding " +
                    "geometry only. They do not prove semantic music similarity " +
                    "quality."
            },
        )
    }
}
