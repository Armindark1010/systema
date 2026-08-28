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
 * Phase 18 — measures whether the embedding geometry lines up with
 * HUMAN judgements, and audits the run's memory lifecycle.
 *
 * WHY A SEPARATE CLASS FROM EmbeddingQualityLab
 * ---------------------------------------------
 * Phase 17 asked "is there geometry at all" and its outputs are
 * already recorded. This asks "does that geometry agree with a
 * person", which needs ground truth Phase 17 never had. Folding this
 * in would have meant changing a class whose numbers are cited in the
 * previous report.
 *
 * What it REUSES rather than reimplements: PcmDecoder,
 * ModelInputPreparer, the InferenceRuntime registry, OutputContract,
 * FrameEmbeddingAggregator (MEAN + L2, untouched), EmbeddingSimilarity
 * (cosine, untouched), MemorySample and LabeledPairEvaluation.
 *
 * TWO INCREMENTAL STAGES
 * ----------------------
 * Stage 1 embeds each track, emitting after every track.
 * Stage 2 walks the labelled pairs, emitting after every pair.
 * Neither stage buffers. For 13 tracks that is 13 + 78 separate UI
 * updates, which is the point: a run takes minutes and a silent
 * screen is indistinguishable from a hung one.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It will not read output_0, will not change pooling, will not infer
 * a label from a cosine, will not apply a similarity threshold, and
 * will not pronounce the model good or bad.
 */
class LabeledQualityLab(
    private val context: Context,
    private val registry: ModelRegistry,
    private val runtimeFor: (String) -> InferenceRuntime,
) {

    companion object {
        private const val TAG = "LabeledQualityLab"

        /** Same ceiling as Phase 17: a diagnostic, not a library scan. */
        const val MAX_TRACKS = EmbeddingQualityLab.MAX_TRACKS

        const val EVENT_STARTED = "labeledEvalStarted"
        const val EVENT_TRACK_COMPLETED = "labeledEvalTrackCompleted"
        const val EVENT_PAIR_COMPLETED = "labeledEvalPairCompleted"
        const val EVENT_MEMORY = "labeledEvalMemory"
        const val EVENT_FINISHED = "labeledEvalFinished"

        /**
         * Below this, a fixed trailing dimension is not a waveform
         * window. 8000 samples is a sixth of a second at 48 kHz.
         */
        private const val MIN_WINDOW_SAMPLES = 8_000L
    }

    private val mutex = Mutex()
    private val cancelRequested = AtomicBoolean(false)
    private val running = AtomicBoolean(false)

    fun isRunning(): Boolean = running.get()

    fun requestCancel() {
        cancelRequested.set(true)
    }

    /**
     * Embeds [tracks], then scores every labelled pair.
     *
     * [pairLabels] is keyed "indexA:indexB" with indices into
     * [tracks]. It is read, never written: nothing in this method can
     * add, remove or change a label.
     */
    suspend fun evaluate(
        runtimeId: String,
        modelId: String,
        tracks: List<TrackRef>,
        pairLabels: Map<String, PairLabel>,
        labelSources: Map<String, LabelSource>,
        strategy: AggregationStrategy = AggregationStrategy.MEAN,
        onEvent: (String, JSObject) -> Unit,
    ): LabeledEvaluationReport = mutex.withLock {
        if (tracks.isEmpty()) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "No tracks were selected. The lab never picks tracks itself.",
            )
        }
        if (tracks.size > MAX_TRACKS) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Refusing to evaluate ${tracks.size} tracks: the cap is $MAX_TRACKS.",
            )
        }

        val rt = runtimeFor(runtimeId)
        if (!rt.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${rt.label} is not available on this device.",
            )
        }

        registry.requireAudioContract(modelId)
        val descriptor = registry.resolve(modelId)

        cancelRequested.set(false)
        running.set(true)

        // Decode AT THE MODEL'S OWN RATE.
        //
        // The default here is 22050 Hz, inherited from the Phase 13
        // analyser. Feeding that to a 48 kHz model and resampling
        // afterwards would upsample: it cannot restore the 11-24 kHz
        // band the model was trained on, and it would silently make
        // every "10 second" window the wrong duration. Decoding at the
        // declared rate keeps window length and content both honest.
        val config = AudioAnalysisConfig(
            targetSampleRate = descriptor.inputSampleRate
                ?: AudioAnalysisConfig().targetSampleRate,
        )
        val decoder = PcmDecoder(context, config)
        val env = EnvironmentSnapshot.capture(context)
        val audit = MemoryLifecycleAudit(context)

        val embeddings = ArrayList<TrackEmbeddingRow>(tracks.size)
        val pairResults = ArrayList<LabeledPairResult>()
        val startNs = System.nanoTime()
        var cancelled = false

        // ---- CHECKPOINT 1: before the session exists ----
        emitMemory(onEvent, audit.record(MemoryCheckpoint.BEFORE_MODEL_LOAD, settle = true))

        try {
            val loaded = rt.loadModel(descriptor)

            // ---- CHECKPOINT 2: the model's own cost ----
            emitMemory(onEvent, audit.record(MemoryCheckpoint.AFTER_MODEL_LOAD))

            onEvent(
                EVENT_STARTED,
                JSObject().apply {
                    put("totalTracks", tracks.size)
                    put("totalLabelledPairs", pairLabels.size)
                    put("modelId", descriptor.modelId)
                    put("runtimeId", rt.runtimeId)
                    put("aggregationStrategy", strategy.name)
                    put("coldLoadMs", loaded.loadMs)
                },
            )

            // ============ STAGE 1: embed, one track at a time ============
            for ((index, track) in tracks.withIndex()) {
                if (cancelRequested.get()) {
                    cancelled = true
                    break
                }

                val row = embedOne(track, index, decoder, config, descriptor, rt, strategy)
                embeddings.add(row)

                // Emitted immediately — not buffered until stage 2.
                onEvent(
                    EVENT_TRACK_COMPLETED,
                    JSObject().apply {
                        put("index", index)
                        put("position", index + 1)
                        put("totalTracks", tracks.size)
                        put("elapsedMs", (System.nanoTime() - startNs) / 1_000_000.0)
                        put("row", row.toJs())
                        put("successCount", embeddings.count { it.ok })
                        put("failureCount", embeddings.count { !it.ok })
                    },
                )

                // ---- CHECKPOINTS 3-6: 1, 5, 10 and final track ----
                audit.checkpointForPosition(index + 1, tracks.size)?.let {
                    emitMemory(onEvent, audit.record(it))
                }
            }
        } finally {
            runCatching { rt.unloadModel() }
                .onFailure { Log.w(TAG, "unloadModel failed", it) }
        }

        // ---- CHECKPOINT 7: what the session gave back ----
        emitMemory(onEvent, audit.record(MemoryCheckpoint.AFTER_SESSION_CLEANUP, settle = true))

        // ============ STAGE 2: score pairs, one at a time ============
        //
        // Runs AFTER the model is unloaded, deliberately. Cosine over
        // stored unit vectors needs no session, and doing it here
        // means the 78 pair updates are not competing with inference
        // for memory or CPU.
        val embedStageMs = (System.nanoTime() - startNs) / 1_000_000.0
        val pairStartNs = System.nanoTime()

        if (!cancelled) {
            val ordered = orderedLabelledPairs(pairLabels, embeddings.size)

            for ((position, key) in ordered.withIndex()) {
                if (cancelRequested.get()) {
                    cancelled = true
                    break
                }

                val (i, j) = key
                val a = embeddings[i]
                val b = embeddings[j]
                val label = pairLabels.getValue(pairKey(i, j))
                val source = labelSources[pairKey(i, j)] ?: LabelSource.HUMAN

                // A pair is only scored when BOTH tracks embedded. A
                // failed track yields no vector, and inventing one
                // here would be fabricating the measurement.
                if (!a.ok || !b.ok || a.vector == null || b.vector == null) {
                    val skipped = LabeledPairResult(
                        position = position + 1,
                        indexA = i,
                        indexB = j,
                        trackIdA = a.trackId,
                        trackIdB = b.trackId,
                        label = label,
                        source = source,
                        cosine = Double.NaN,
                        outcome = PairOutcome.NOT_SCORED,
                        referenceValue = Double.NaN,
                    )
                    emitPair(onEvent, skipped, pairResults, ordered.size, pairStartNs, true)
                    continue
                }

                val cosine = EmbeddingSimilarity.cosine(a.vector, b.vector)

                // The reference is recomputed from the DIFFERENT pairs
                // measured SO FAR. It is data, not a constant, and it
                // is read only after the cosine already exists.
                val reference = LabeledPairEvaluation.referenceMedian(pairResults)

                val result = LabeledPairResult(
                    position = position + 1,
                    indexA = i,
                    indexB = j,
                    trackIdA = a.trackId,
                    trackIdB = b.trackId,
                    label = label,
                    source = source,
                    cosine = cosine,
                    outcome = LabeledPairEvaluation.outcomeFor(label, cosine, reference),
                    referenceValue = reference,
                )
                pairResults.add(result)
                emitPair(onEvent, result, pairResults, ordered.size, pairStartNs, false)
            }
        }

        val pairStageMs = (System.nanoTime() - pairStartNs) / 1_000_000.0

        // ---- CHECKPOINT 8: after a short idle ----
        try {
            Thread.sleep(MemoryLifecycleAudit.IDLE_SETTLE_MS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        emitMemory(onEvent, audit.record(MemoryCheckpoint.AFTER_IDLE, settle = true))
        running.set(false)

        val vectors = embeddings.mapNotNull { it.vector }
        val vectorIds = embeddings.filter { it.vector != null }.map { it.trackId }

        val report = LabeledEvaluationReport(
            modelId = descriptor.modelId,
            runtimeId = rt.runtimeId,
            aggregationStrategy = strategy,
            requestedTracks = tracks.size,
            rows = embeddings,
            pairResults = pairResults,
            labelledPairsRequested = pairLabels.size,
            matrixTrackIds = vectorIds,
            matrix = EmbeddingSimilarity.pairwise(vectors),
            overallStats = EmbeddingSimilarity.statistics(
                EmbeddingSimilarity.pairwise(vectors).map { it.score },
            ),
            classStats = LabeledPairEvaluation.classStatistics(pairResults),
            separation = LabeledPairEvaluation.analyse(pairResults),
            memory = audit.finish(),
            cancelled = cancelled,
            embedStageMs = embedStageMs,
            pairStageMs = pairStageMs,
            totalElapsedMs = (System.nanoTime() - startNs) / 1_000_000.0,
            environment = env,
        )

        onEvent(EVENT_FINISHED, report.toJs())
        return@withLock report
    }

    /**
     * Labelled pairs in a stable (i, j) order.
     *
     * Sorted so a re-run walks them in the same sequence — otherwise
     * the incremental reference median would depend on map iteration
     * order and two runs of identical data could disagree.
     */
    private fun orderedLabelledPairs(
        pairLabels: Map<String, PairLabel>,
        trackCount: Int,
    ): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>()
        for (i in 0 until trackCount) {
            for (j in i + 1 until trackCount) {
                if (pairLabels.containsKey(pairKey(i, j))) out.add(i to j)
            }
        }
        return out
    }

    private fun emitPair(
        onEvent: (String, JSObject) -> Unit,
        result: LabeledPairResult,
        soFar: List<LabeledPairResult>,
        total: Int,
        startNs: Long,
        skipped: Boolean,
    ) {
        // Live class statistics and a live verdict, recomputed from
        // everything scored so far. The user watches the conclusion
        // firm up rather than waiting for it.
        val liveClasses = LabeledPairEvaluation.classStatistics(soFar)
        val liveSeparation = LabeledPairEvaluation.analyse(soFar)

        onEvent(
            EVENT_PAIR_COMPLETED,
            JSObject().apply {
                put("pair", result.toJs())
                put("position", result.position)
                put("totalPairs", total)
                put("scoredCount", soFar.size)
                put("skipped", skipped)
                put("elapsedMs", (System.nanoTime() - startNs) / 1_000_000.0)
                put(
                    "classStats",
                    JSArray().apply { liveClasses.values.forEach { put(it.toJs()) } },
                )
                put("separation", liveSeparation.toJs())
            },
        )
    }

    private fun emitMemory(
        onEvent: (String, JSObject) -> Unit,
        sample: MemoryCheckpointSample,
    ) = onEvent(EVENT_MEMORY, sample.toJs())

    /**
     * Decode → prepare → infer → MEAN pool → L2 → store, for ONE track.
     *
     * Identical in structure to the Phase 17 path and calling the same
     * helpers, so the embeddings this phase judges are the embeddings
     * Phase 16A device-verified. Every large buffer is local, so it
     * becomes garbage on return; only the 1024-float vector is kept.
     */
    private suspend fun embedOne(
        track: TrackRef,
        index: Int,
        decoder: PcmDecoder,
        config: AudioAnalysisConfig,
        descriptor: ModelDescriptor,
        rt: InferenceRuntime,
        strategy: AggregationStrategy,
    ): TrackEmbeddingRow {
        val t0 = System.nanoTime()

        // ---- DECODE ----
        // Honours config.maxAnalysisDurationMs: the 5-minute analysis
        // window is a standing constraint and is not widened here.
        var collected: ArrayList<FloatArray>? = ArrayList()
        var totalSamples = 0
        val maxSamples = (
            config.targetSampleRate.toLong() *
                config.maxAnalysisDurationMs / 1000L
            ).toInt()

        try {
            decoder.decode(
                Uri.parse(track.uri),
                { samples, count ->
                    // The decoder reuses its buffer; a retained chunk
                    // must be copied.
                    if (totalSamples < maxSamples) {
                        val take = minOf(count, maxSamples - totalSamples)
                        collected?.add(samples.copyOf(take))
                        totalSamples += take
                    }
                },
                // Cancellation reaches inside the decode so a stop does
                // not have to wait out a long file.
                { cancelRequested.get() },
            )
        } catch (e: Throwable) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "DECODE_FAILED",
                e.message ?: "The track could not be decoded.",
            )
        }
        val decodeMs = (System.nanoTime() - t0) / 1_000_000.0

        if (cancelRequested.get()) {
            collected = null
            return TrackEmbeddingRow.failed(
                index, track.trackId, "CANCELLED",
                "Stopped during decode, before an embedding was produced.",
            )
        }
        if (totalSamples == 0) {
            collected = null
            return TrackEmbeddingRow.failed(
                index, track.trackId, "DECODE_FAILED", "Decoding produced no audio.",
            )
        }

        val pcm = FloatArray(totalSamples)
        var offset = 0
        for (chunk in collected!!) {
            System.arraycopy(chunk, 0, pcm, offset, chunk.size)
            offset += chunk.size
        }
        // Dropped at concatenation, not at function exit, so the peak
        // holds one copy of the audio rather than two.
        collected.clear()
        collected = null

        val durationSec = totalSamples.toDouble() / config.targetSampleRate

        // ---- FIXED-WINDOW MODELS TAKE THE WINDOWED PATH ----
        // A model whose input is a FIXED [1, N] waveform (CLAP's
        // audio.onnx is [batch, 480000]) cannot be handed a whole
        // track. Doing so previously produced a tensor declared
        // [28, 480000] against a 13,840,300-sample buffer: integer
        // division dropped the 400,300-sample remainder and ORT
        // rejected it with an arithmetic error that named neither the
        // track nor the real cause.
        //
        // Such a model is windowed here with the SAME geometry the
        // single-track test verified on this device: 10 s windows, 5 s
        // stride, one window per inference, mean-pooled then L2. The
        // frame-embedding path below is untouched and still serves
        // YAMNet, whose graph emits [frames, dim] for a whole clip.
        val windowSamples = fixedWindowSamplesFor(descriptor)
        if (windowSamples != null) {
            return embedByWindows(
                track = track,
                index = index,
                pcm = pcm,
                pcmSampleRate = config.targetSampleRate,
                windowSamples = windowSamples,
                descriptor = descriptor,
                rt = rt,
                decodeMs = decodeMs,
                durationSec = durationSec,
            )
        }

        // ---- PREPARE ----
        val prepared = try {
            ModelInputPreparer.prepare(pcm, config.targetSampleRate, descriptor)
        } catch (e: InferenceException) {
            return TrackEmbeddingRow.failed(index, track.trackId, e.code.name, e.message ?: "")
        } catch (e: Throwable) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "PREPROCESSING_UNAVAILABLE",
                e.message ?: e::class.java.simpleName,
            )
        }

        // ---- INFER (warm; loaded once before track 1) ----
        val result = try {
            rt.infer(prepared.data)
        } catch (e: InferenceException) {
            return TrackEmbeddingRow.failed(index, track.trackId, e.code.name, e.message ?: "")
        } catch (e: Throwable) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                e.message ?: "Inference failed.",
            )
        }

        // ---- THE EMBEDDING TENSOR: output_1 ONLY ----
        // From result.embeddingFrames, which the runtime populated by
        // SHAPE via OutputContract. Never result.output, which is
        // whatever index 0 happened to be - for YAMNet, the 521-wide
        // class scores.
        val frames = result.embeddingFrames
        val shape = result.embeddingShape
        if (frames == null) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "EMBEDDING_UNAVAILABLE",
                "No output of this model classified as a frame embedding. " +
                    "Not substituting another tensor: pooling class scores " +
                    "would produce a confident, well-formed, meaningless vector.",
            )
        }
        if (shape.size != 2 || shape.any { it <= 0 }) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "EMBEDDING_SHAPE_INVALID",
                "The embedding tensor has shape $shape, which is not a resolved " +
                    "[frames, dim] matrix. Refusing to guess its layout.",
            )
        }

        // ---- MEAN POOL + L2 (Phase 16A, unchanged) ----
        val aggStartNs = System.nanoTime()
        val embedding = try {
            FrameEmbeddingAggregator.aggregate(
                frames = frames,
                frameCount = shape[0].toInt(),
                dimension = shape[1].toInt(),
                strategy = strategy,
            )
        } catch (e: InferenceException) {
            return TrackEmbeddingRow.failed(index, track.trackId, e.code.name, e.message ?: "")
        }
        val aggregationMs = (System.nanoTime() - aggStartNs) / 1_000_000.0

        if (embedding.preNormL2 <= 0.0) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "DEGENERATE_EMBEDDING",
                "The pooled vector had zero magnitude; it has no direction to compare.",
            )
        }

        val norm = EmbeddingSimilarity.l2Norm(embedding.vector)
        if (kotlin.math.abs(norm - 1.0) > EmbeddingSimilarity.NORM_TOLERANCE) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "NOT_UNIT_LENGTH",
                "Normalisation produced a norm of $norm; it is never silently corrected.",
            )
        }

        // Same timing boundaries as Phase 16A/17 so the numbers stay
        // comparable. Aggregation is reported separately and is NOT
        // folded into totalMs, which would break that comparability.
        val totalMs = decodeMs + prepared.preparationMs + result.inferenceMs + result.tensorMs

        return TrackEmbeddingRow(
            index = index,
            trackId = track.trackId,
            ok = true,
            vector = embedding.vector,
            dimension = embedding.dimension,
            frameCount = shape[0].toInt(),
            frameDimension = shape[1].toInt(),
            l2Norm = norm,
            preNormL2 = embedding.preNormL2,
            decodeMs = decodeMs,
            preprocessingMs = prepared.preparationMs,
            inferenceMs = result.inferenceMs,
            tensorMs = result.tensorMs,
            aggregationMs = aggregationMs,
            totalMs = totalMs,
            audioDurationSec = durationSec,
            errorCode = null,
            errorMessage = null,
        )
    }

    /**
     * Samples per window when the model demands a FIXED-LENGTH
     * waveform, or null when it does not.
     *
     * Returns non-null only for a rank-2 waveform input whose trailing
     * dimension is fixed and long enough to be audio — the shape
     * CLAP's audio.onnx declares, [batch, 480000]. Everything else,
     * including YAMNet's frame-emitting graph, returns null and keeps
     * the original path.
     */
    private fun fixedWindowSamplesFor(descriptor: ModelDescriptor): Int? {
        if (descriptor.inputFormat != InputFormat.RAW_WAVEFORM) return null
        val shape = descriptor.inputShape
        if (shape.size != 2) return null
        val trailing = shape[1]
        // A fixed trailing dim below this is not a waveform window;
        // refusing to treat it as one avoids inventing a geometry.
        if (trailing < MIN_WINDOW_SAMPLES) return null
        return trailing.toInt()
    }

    /**
     * Embeds a track as overlapping fixed-length windows.
     *
     * WHY THIS EXISTS
     * ---------------
     * The single-tensor path assumes the graph accepts a whole clip
     * and returns [frames, dim]. A fixed-input model accepts neither:
     * it takes exactly N samples per call. Handing it a whole track
     * relied on the runtime resolving a dynamic batch axis by
     * division, which silently truncated the remainder.
     *
     * The geometry is the one already verified on-device by the
     * single-track test: window = the model's declared length, stride
     * = half of it (50% overlap), one window per inference, mean-pool
     * then L2. Memory holds ONE window and ONE running sum, never a
     * list of per-window embeddings.
     */
    private suspend fun embedByWindows(
        track: TrackRef,
        index: Int,
        pcm: FloatArray,
        pcmSampleRate: Int,
        windowSamples: Int,
        descriptor: ModelDescriptor,
        rt: InferenceRuntime,
        decodeMs: Double,
        durationSec: Double,
    ): TrackEmbeddingRow {
        val prepStart = System.nanoTime()
        val targetRate = descriptor.inputSampleRate ?: pcmSampleRate
        val audio = if (targetRate == pcmSampleRate) {
            pcm
        } else {
            ModelInputPreparer.resampleLinear(pcm, pcmSampleRate, targetRate)
        }
        var preprocessingMs = (System.nanoTime() - prepStart) / 1_000_000.0

        val stride = (windowSamples / 2).coerceAtLeast(1)
        var sum: DoubleArray? = null
        var windows = 0
        var inferenceMs = 0.0
        var tensorMs = 0.0

        var start = 0
        while (start < audio.size) {
            if (cancelRequested.get()) {
                return TrackEmbeddingRow.failed(
                    index, track.trackId, "CANCELLED",
                    "Stopped after $windows window(s), before a full embedding.",
                )
            }

            val p0 = System.nanoTime()
            val end = minOf(start + windowSamples, audio.size)
            val length = end - start
            // EXACTLY windowSamples every time. A short tail is padded
            // rather than submitted at its natural length, because the
            // declared shape is fixed and a partial buffer is what
            // caused the original mismatch.
            val window = FloatArray(windowSamples)
            System.arraycopy(audio, start, window, 0, length)
            preprocessingMs += (System.nanoTime() - p0) / 1_000_000.0

            val out = try {
                rt.infer(window)
            } catch (e: InferenceException) {
                return TrackEmbeddingRow.failed(
                    index, track.trackId, e.code.name,
                    "Window ${windows + 1} (offset $start, $windowSamples samples): " +
                        (e.message ?: ""),
                )
            } catch (e: Throwable) {
                return TrackEmbeddingRow.failed(
                    index, track.trackId,
                    InferenceErrorCode.MODEL_INFERENCE_FAILED.name,
                    e.message ?: "Inference failed.",
                )
            }
            inferenceMs += out.inferenceMs
            tensorMs += out.tensorMs

            val vec = out.output
            val acc = sum ?: DoubleArray(vec.size).also { sum = it }
            if (vec.size != acc.size) {
                return TrackEmbeddingRow.failed(
                    index, track.trackId, "EMBEDDING_SHAPE_INVALID",
                    "Window ${windows + 1} produced ${vec.size} values but the " +
                        "previous window produced ${acc.size}.",
                )
            }
            for (i in vec.indices) acc[i] += vec[i].toDouble()
            windows++

            // The final window has been emitted once the clip reaches
            // the end of the audio; advancing further would only
            // re-embed padding.
            if (end >= audio.size) break
            start += stride
        }

        val acc = sum
        if (acc == null || windows == 0) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "EMBEDDING_UNAVAILABLE",
                "No window produced an embedding.",
            )
        }

        val aggStart = System.nanoTime()
        val pooled = FloatArray(acc.size) { (acc[it] / windows).toFloat() }
        var sq = 0.0
        for (v in pooled) sq += v.toDouble() * v.toDouble()
        val preNormL2 = kotlin.math.sqrt(sq)
        if (preNormL2 <= 0.0) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "DEGENERATE_EMBEDDING",
                "The pooled vector had zero magnitude; it has no direction to compare.",
            )
        }
        val normalised = FloatArray(pooled.size) { (pooled[it] / preNormL2).toFloat() }
        val aggregationMs = (System.nanoTime() - aggStart) / 1_000_000.0

        val norm = EmbeddingSimilarity.l2Norm(normalised)
        if (kotlin.math.abs(norm - 1.0) > EmbeddingSimilarity.NORM_TOLERANCE) {
            return TrackEmbeddingRow.failed(
                index, track.trackId, "EMBEDDING_NOT_NORMALISED",
                "The pooled vector has L2 norm $norm, which is not 1.",
            )
        }

        return TrackEmbeddingRow(
            index = index,
            trackId = track.trackId,
            ok = true,
            vector = normalised,
            dimension = normalised.size,
            // One embedding per WINDOW here, rather than per model
            // frame. Reported honestly so the two paths are not
            // confused when reading a report.
            frameCount = windows,
            frameDimension = normalised.size,
            l2Norm = norm,
            preNormL2 = preNormL2,
            decodeMs = decodeMs,
            preprocessingMs = preprocessingMs,
            inferenceMs = inferenceMs,
            tensorMs = tensorMs,
            aggregationMs = aggregationMs,
            totalMs = decodeMs + preprocessingMs + inferenceMs + tensorMs,
            audioDurationSec = durationSec,
            errorCode = null,
            errorMessage = null,
        )
    }

}

/**
 * One track's embedding plus its timings.
 *
 * [vector] is null for a failure, structurally — a failed track cannot
 * carry an embedding even by mistake.
 */
data class TrackEmbeddingRow(
    val index: Int,
    val trackId: String,
    val ok: Boolean,
    val vector: FloatArray?,
    val dimension: Int,
    val frameCount: Int,
    val frameDimension: Int,
    val l2Norm: Double,
    val preNormL2: Double,
    val decodeMs: Double,
    val preprocessingMs: Double,
    val inferenceMs: Double,
    val tensorMs: Double,
    val aggregationMs: Double,
    val totalMs: Double,
    val audioDurationSec: Double,
    val errorCode: String?,
    val errorMessage: String?,
) {
    companion object {
        fun failed(index: Int, trackId: String, code: String, message: String) =
            TrackEmbeddingRow(
                index = index, trackId = trackId, ok = false, vector = null,
                dimension = 0, frameCount = 0, frameDimension = 0,
                l2Norm = Double.NaN, preNormL2 = Double.NaN,
                decodeMs = 0.0, preprocessingMs = 0.0, inferenceMs = 0.0,
                tensorMs = 0.0, aggregationMs = 0.0, totalMs = 0.0,
                audioDurationSec = 0.0, errorCode = code, errorMessage = message,
            )
    }

    /** Real-time factor: processing time over audio duration. */
    val rtf: Double get() =
        if (audioDurationSec > 0.0) (totalMs / 1000.0) / audioDurationSec else Double.NaN

    /**
     * JSON WITHOUT the vector.
     *
     * 1024 floats per track across the bridge would be ~13k JSON
     * numbers for 13 tracks, for a UI that only ever displays the
     * norm and the dimension.
     */
    fun toJs(): JSObject = JSObject().apply {
        put("index", index)
        put("trackId", trackId)
        put("ok", ok)
        put("dimension", dimension)
        put("frameCount", frameCount)
        put("frameDimension", frameDimension)
        putNumeric("l2Norm", l2Norm)
        putNumeric("preNormL2", preNormL2)
        putNumeric("decodeMs", decodeMs)
        putNumeric("preprocessingMs", preprocessingMs)
        putNumeric("inferenceMs", inferenceMs)
        putNumeric("tensorMs", tensorMs)
        putNumeric("aggregationMs", aggregationMs)
        putNumeric("totalMs", totalMs)
        putNumeric("audioDurationSec", audioDurationSec)
        putNumeric("rtf", rtf)
        errorCode?.let { put("errorCode", it) }
        errorMessage?.let { put("errorMessage", it) }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TrackEmbeddingRow) return false
        return index == other.index && trackId == other.trackId && ok == other.ok
    }

    override fun hashCode(): Int = 31 * index + trackId.hashCode()
}

/** Key for a pair, always low index first so (i,j) and (j,i) agree. */
fun pairKey(a: Int, b: Int): String =
    if (a <= b) "$a:$b" else "$b:$a"

/**
 * The full Phase 18 report.
 *
 * There is no "quality" field and no model recommendation. The
 * strongest statement it makes is [SeparationAnalysis.verdict], which
 * is derived from rank statistics over human labels.
 */
data class LabeledEvaluationReport(
    val modelId: String,
    val runtimeId: String,
    val aggregationStrategy: AggregationStrategy,
    val requestedTracks: Int,
    val rows: List<TrackEmbeddingRow>,
    val pairResults: List<LabeledPairResult>,
    val labelledPairsRequested: Int,
    val matrixTrackIds: List<String>,
    val matrix: List<PairSimilarity>,
    val overallStats: SimilarityStats?,
    val classStats: Map<PairLabel, ClassStats>,
    val separation: SeparationAnalysis,
    val memory: MemoryLifecycleAuditReport,
    val cancelled: Boolean,
    val embedStageMs: Double,
    val pairStageMs: Double,
    val totalElapsedMs: Double,
    val environment: EnvironmentSnapshot,
) {
    val successCount: Int get() = rows.count { it.ok }
    val failureCount: Int get() = rows.count { !it.ok }

    private fun median(values: List<Double>): Double {
        if (values.isEmpty()) return Double.NaN
        val s = values.sorted()
        val n = s.size
        return if (n % 2 == 1) s[n / 2] else (s[n / 2 - 1] + s[n / 2]) / 2.0
    }

    fun toJs(): JSObject = JSObject().apply {
        put("modelId", modelId)
        put("runtimeId", runtimeId)
        put("aggregationStrategy", aggregationStrategy.name)
        put("requestedTracks", requestedTracks)
        put("successCount", successCount)
        put("failureCount", failureCount)
        put("labelledPairsRequested", labelledPairsRequested)
        put("scoredPairCount", pairResults.count { !it.cosine.isNaN() })
        put("cancelled", cancelled)

        // Timings kept in the SAME boundaries as Phase 16A/17 so the
        // numbers stay comparable with the earlier runs. The two new
        // stage timers are reported separately and are not folded into
        // any per-track total.
        putNumeric("embedStageMs", embedStageMs)
        putNumeric("pairStageMs", pairStageMs)
        putNumeric("totalElapsedMs", totalElapsedMs)

        val okRows = rows.filter { it.ok }
        putNumeric("medianDecodeMs", median(okRows.map { it.decodeMs }))
        putNumeric("medianPreprocessingMs", median(okRows.map { it.preprocessingMs }))
        putNumeric("medianInferenceMs", median(okRows.map { it.inferenceMs }))
        putNumeric("medianTensorMs", median(okRows.map { it.tensorMs }))
        putNumeric("medianAggregationMs", median(okRows.map { it.aggregationMs }))
        putNumeric("medianTotalMs", median(okRows.map { it.totalMs }))
        putNumeric("medianRtf", median(okRows.map { it.rtf }.filter { !it.isNaN() }))

        put("rows", JSArray().apply { rows.forEach { put(it.toJs()) } })
        put("pairResults", JSArray().apply { pairResults.forEach { put(it.toJs()) } })
        put("classStats", JSArray().apply { classStats.values.forEach { put(it.toJs()) } })
        put("separation", separation.toJs())
        put("memory", memory.toJs())
        put("environment", environment.toJs())
        overallStats?.let { put("overallStats", it.toJs()) }

        put(
            "matrix",
            JSObject().apply {
                put("trackIds", JSArray().apply { matrixTrackIds.forEach { put(it) } })
                put(
                    "pairs",
                    JSArray().apply {
                        matrix.forEach { p ->
                            put(
                                JSObject().apply {
                                    put("i", p.i)
                                    put("j", p.j)
                                    put("score", p.score)
                                },
                            )
                        }
                    },
                )
            },
        )

        // Energy is not measured. Stated, not estimated.
        put("energyMeasured", false)
        put(
            "energyNote",
            "Not directly measured. Android exposes no per-process energy " +
                "accounting trustworthy over a short foreground run.",
        )
    }
}
