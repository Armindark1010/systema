package com.systema.music.inference.clap

import android.content.Context
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.analysis.AudioAnalysisException
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.inference.EmbeddingResult
import com.systema.music.inference.EmbeddingSimilarity
import com.systema.music.inference.InferenceErrorCode
import com.systema.music.inference.InferenceException
import com.systema.music.inference.InferenceRuntime
import com.systema.music.inference.InputFormat
import com.systema.music.inference.MemoryGuard
import com.systema.music.inference.MemorySample
import com.systema.music.inference.ModelRegistry
import com.systema.music.inference.TensorSignature
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedSendChannelException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The CLAP lifecycle owner (§4).
 *
 *   IMPORT -> VALIDATE -> LOAD -> SINGLE TEST -> RELEASE -> MEMORY CHECK
 *
 * ONE SESSION, EVER
 * -----------------
 * A single nullable adapter guarded by a mutex. Loading while one is
 * live is refused rather than silently replacing it, because an
 * orphaned ONNX session is native memory nobody will ever free — and
 * that is the shape of the freeze this phase exists to prevent.
 *
 * NOTHING HERE RUNS BY ITSELF
 * ---------------------------
 * Every method is reached only from an explicit @PluginMethod. There
 * is no startup hook, no observer, no scheduled work and no automatic
 * continuation from import into inference.
 *
 * SINGLE-TRACK GATE (§5)
 * ----------------------
 * [multiTrackUnlocked] starts false and is set only by a successful
 * single-track test. Multi-track work asks this first, so the
 * dangerous path cannot be reached before the safe one has passed.
 */
class ClapSession(
    private val context: Context,
    private val registry: ModelRegistry,
) {

    private val mutex = Mutex()

    companion object {
        /**
         * Default seconds of audio for a single-track test.
         *
         * Kept at 60 s so a mis-tap cannot start a huge run. Full-track
         * mode must be chosen deliberately.
         */
        const val DEFAULT_DURATION_SEC = 60

        /** Offered in the UI. 0 means the whole track. */
        val DURATION_CHOICES = listOf(10, 30, 60, 0)
    }

    /** The rate CLAP expects, and therefore the rate we decode to. */
    private val frontEndSampleRate = ClapMelFrontEnd.DEFAULT_SAMPLE_RATE

    @Volatile private var active: ClapAudioEmbeddingModel? = null
    @Volatile private var activeModelId: String? = null
    @Volatile private var validated = false
    @Volatile private var multiTrackUnlocked = false
    @Volatile private var lastSingleTrackId: String? = null

    /** True once a single-track test has fully succeeded (§5). */
    fun isMultiTrackUnlocked(): Boolean = multiTrackUnlocked

    fun status(): JSObject = JSObject().apply {
        val model = active
        // Lifecycle tracing (Phase 23.1). `sessionId` is this object's
        // identity hash: if the lab and a later analysis print the same
        // value, they are talking to the SAME ClapSession, which
        // distinguishes a lost-plugin problem from a released-session
        // one. No audio or embedding data is ever logged.
        ClapLog.event(
            ClapLog.SESSION_STATE,
            "sessionId" to Integer.toHexString(System.identityHashCode(this@ClapSession)),
            "loaded" to (model != null),
            "validated" to validated,
            "modelId" to (activeModelId ?: ""),
        )
        put("loaded", model != null)
        put("modelId", activeModelId ?: "")
        put("validated", validated)
        put("multiTrackUnlocked", multiTrackUnlocked)
        put("lastSingleTrackId", lastSingleTrackId ?: "")
        put(
            "status",
            when {
                multiTrackUnlocked -> "DEVICE_TESTED"
                validated -> "VALIDATED"
                model != null -> "LOADED"
                else -> "IDLE"
            },
        )
        // Never PRODUCTION (§10).
        put("productionSelected", false)
        put(
            "productionNote",
            "Production selection is a separate, explicit human decision. This " +
                "subsystem never makes it.",
        )
        model?.let { put("metadata", it.getMetadata().toJs()) }
    }

    /**
     * LOAD. Runs the memory guard first and refuses if there is not
     * room (§4).
     */
    suspend fun load(modelId: String, runtime: InferenceRuntime): JSObject = mutex.withLock {
        ClapLog.event(
            ClapLog.SESSION_IDENTITY,
            "stage" to "loadRequested",
            "sessionId" to Integer.toHexString(System.identityHashCode(this@ClapSession)),
            "modelId" to modelId,
        )
        if (active != null) {
            throw InferenceException(
                InferenceErrorCode.MODEL_LOAD_FAILED,
                "A CLAP session is already loaded (${activeModelId}). Release it " +
                    "first: only one model session may be active.",
            )
        }
        if (!runtime.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${runtime.label} is not available on this device.",
            )
        }

        // THE SHAPE MUST COME FROM THE GRAPH, NOT FROM AN ASSUMPTION
        // -----------------------------------------------------------
        // The runtime builds its ONNX tensor from the DESCRIPTOR's
        // declared shape, and it must be fully concrete: a dynamic
        // axis gets resolved by dividing the element count, which
        // silently yields the wrong rank rather than an error.
        //
        // Which shape is correct depends entirely on the model. A raw
        // HTSAT audio tower wants [1,1,frames,64] log-mel. A
        // pre-converted export such as clap-htsat-base-onnx/audio.onnx
        // wants [1,480000] waveform and computes the mel internally.
        // Both are "CLAP", so the answer is read from the signatures
        // the importer recorded off the real graph.
        val frontEnd = ClapMelFrontEnd()
        val fileName = if (modelId.endsWith(".onnx")) modelId else "$modelId.onnx"

        val stored = registry.contractFor(modelId)
        val predicted = ClapGraphContract.derive(
            inputs = listOfNotNull(
                stored?.let {
                    TensorSignature(
                        name = it.inputName ?: "",
                        shape = it.inputShape,
                        type = it.inputType,
                    )
                },
            ),
            outputs = listOfNotNull(
                stored?.let {
                    TensorSignature(
                        name = it.outputName ?: "",
                        shape = it.outputShape,
                        type = "FLOAT",
                    )
                },
            ),
        )

        // When the stored signatures are missing or inconclusive, fall
        // back to a fully dynamic descriptor and let the adapter derive
        // the contract from the live graph after load. It refuses to
        // infer on an UNKNOWN contract, so a wrong guess cannot reach
        // the model.
        val declaredShape = predicted.concreteInputShape()
        val declaredFormat = when (predicted.inputKind) {
            ClapGraphContract.InputKind.WAVEFORM -> InputFormat.RAW_WAVEFORM
            ClapGraphContract.InputKind.LOG_MEL -> InputFormat.LOG_MEL_SPECTROGRAM
            ClapGraphContract.InputKind.UNKNOWN -> InputFormat.RAW_TENSOR
        }

        val descriptor = registry.descriptorForInstalled(
            fileName = fileName,
            sampleRate = frontEndSampleRate,
            inputFormat = declaredFormat,
            inputShape = declaredShape,
        )

        // Tensor cost for ONE window, plus the window's own PCM. Uses
        // the derived element count when known, and the log-mel size
        // otherwise, which is the larger of the two.
        val elements = predicted.elementsPerWindow()
            ?: (frontEnd.frameCountFor(ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES) *
                frontEnd.melBins)
        val tensorBytes = elements.toLong() * 4L +
            ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES * 4L

        val decision = MemoryGuard.evaluate(context, descriptor.sizeBytes, tensorBytes)
        if (!decision.allowed) {
            ClapLog.warn(
                ClapLog.GUARD_REFUSED,
                "modelId" to modelId,
                "reason" to decision.reasonCode,
                "availableMb" to decision.availableMb,
                "estimatedMb" to decision.estimatedRequiredMb,
            )
            throw InferenceException(
                InferenceErrorCode.MODEL_LOAD_FAILED,
                "Refusing to load: ${decision.explanation}",
            )
        }

        var model = ClapAudioEmbeddingModel(context, descriptor, runtime, frontEnd)
        var result = model.load()

        // ---- SECOND PASS, only when the first was a guess ----
        // If the stored signatures were absent or inconclusive, the
        // descriptor above declared a dynamic shape. The live graph has
        // now told us exactly what it wants, so if that turns out to be
        // concrete and different, the session is rebuilt with the real
        // shape. Without this the runtime would keep resolving a
        // dynamic axis by division and hand the model the wrong rank.
        val live = model.contract()
        val liveShape = live?.concreteInputShape()
        if (liveShape != null && liveShape != descriptor.inputShape) {
            ClapLog.event(
                ClapLog.CONTRACT_DERIVED,
                "modelId" to modelId,
                "action" to "RELOAD_WITH_GRAPH_SHAPE",
                "predicted" to descriptor.inputShape.joinToString("x"),
                "actual" to liveShape.joinToString("x"),
            )
            // Release the first session before opening another: two
            // must never be resident at once (§4).
            runCatching { model.unload() }

            val corrected = registry.descriptorForInstalled(
                fileName = fileName,
                sampleRate = frontEndSampleRate,
                inputFormat = when (live.inputKind) {
                    ClapGraphContract.InputKind.WAVEFORM -> InputFormat.RAW_WAVEFORM
                    ClapGraphContract.InputKind.LOG_MEL -> InputFormat.LOG_MEL_SPECTROGRAM
                    ClapGraphContract.InputKind.UNKNOWN -> InputFormat.RAW_TENSOR
                },
                inputShape = liveShape,
            )
            model = ClapAudioEmbeddingModel(context, corrected, runtime, frontEnd)
            result = model.load()
        }

        active = model
        activeModelId = modelId
        validated = false

        JSObject().apply {
            put("loadMs", result.loadMs)
            put("sizeBytes", result.sizeBytes)
            put("memoryGuard", decision.toJs())
            put("metadata", model.getMetadata().toJs())
            model.contract()?.let { put("graphContract", it.toJs()) }
            put(
                "inputNames",
                JSArray().apply { result.inputNames.forEach { put(it) } },
            )
            put(
                "outputNames",
                JSArray().apply { result.outputNames.forEach { put(it) } },
            )
        }
    }

    /** VALIDATE (§2). Must pass before any real audio is accepted. */
    suspend fun validate(): JSObject {
        val model = active ?: throw InferenceException(
            InferenceErrorCode.MODEL_LOAD_FAILED,
            "No CLAP session is loaded. Load a model before validating.",
        )
        val report = model.validate()
        validated = report.ok
        return report.toJs()
    }

    /**
     * SINGLE TEST (§5): exactly ONE manually chosen file.
     *
     * The full arc runs here — memory before, decode, embed, validate
     * the vector, unload, cleanup, memory after — so the caller cannot
     * forget to release and leave a session resident.
     */
    suspend fun testOneTrack(
        trackId: String,
        uri: String,
        releaseAfter: Boolean = true,
        /** Seconds of audio to embed, or null / <= 0 for the whole track. */
        durationSec: Int? = DEFAULT_DURATION_SEC,
        /**
         * Include the embedding itself in the payload (Phase 22).
         *
         * Off by default so the existing single-track test payload is
         * unchanged. The vector is only needed by the similarity
         * pipeline, which compares two tracks; sending 512 floats to a
         * UI that just wants timings would be waste.
         */
        includeVector: Boolean = false,
    ): JSObject = mutex.withLock {
        val model = active ?: throw InferenceException(
            InferenceErrorCode.MODEL_LOAD_FAILED,
            "No CLAP session is loaded.",
        )
        if (!validated) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "This model has not passed validation. Run VALIDATE before " +
                    "processing audio: an unvalidated graph must never see a track.",
            )
        }

        val before = MemorySample.capture(context)
        ClapLog.event(
            ClapLog.MEMORY_BEFORE,
            "stage" to "singleTrack",
            "pssKb" to before.totalPssKb,
            "nativeKb" to before.nativeHeapKb,
        )

        // Decode straight to CLAP's own rate. The default analysis
        // config targets 22050 Hz for the Phase 13 DSP; feeding that
        // to a 48 kHz model and resampling back up would throw away
        // everything above 11 kHz and then fabricate it again. The
        // model's mel filter bank runs to 14 kHz, so that band is
        // real content, not headroom.
        val fullTrack = durationSec == null || durationSec <= 0

        // WINDOW BUDGET
        // -------------
        // Windows are `clip` long and advance by `clip/2` (50% overlap),
        // so N windows cover clip + (N-1)*stride seconds, NOT N*clip.
        // Deriving the count from the requested duration is what makes
        // "60 seconds" mean sixty seconds of audio.
        val contract = model.contract() ?: throw InferenceException(
            InferenceErrorCode.MODEL_INVALID,
            "The graph contract has not been derived. Load and validate first.",
        )
        val clipSamples = model.windowLengthFor(contract)
        val strideSamples = clipSamples / ClapAudioEmbeddingModel.WINDOW_STRIDE_DIVISOR
        val clipSec = clipSamples.toDouble() / frontEndSampleRate

        val windowBudget: Int? = if (fullTrack) {
            null
        } else {
            val requested = durationSec!!.toLong() * frontEndSampleRate
            if (requested <= clipSamples) {
                1
            } else {
                (((requested - clipSamples) / strideSamples) + 1).toInt()
            }
        }

        // Decoding is capped to the audio the windows can actually
        // consume. Previously the cap was 6 windows' worth of SAMPLES
        // (60 s) while 6 overlapping windows only reach 35 s, so 25 s
        // was decoded, held in memory and thrown away.
        val decodeCapMs: Long = if (fullTrack) {
            0L // 0 disables the decoder's own limit: stream everything.
        } else {
            val covered = clipSamples.toLong() +
                (windowBudget!! - 1).toLong() * strideSamples
            // A small tail margin so the last window is never starved
            // by rounding.
            (covered * 1000L / frontEndSampleRate) + 1000L
        }

        val config = AudioAnalysisConfig(
            targetSampleRate = frontEndSampleRate,
            maxAnalysisDurationMs = decodeCapMs,
        )
        val decoder = PcmDecoder(context, config)

        // Captured from the producer coroutine; the decoder reports
        // the source's true rate and duration only when it returns.
        var sourceInfo: PcmDecoder.SourceInfo? = null

        // ---- DECODE AND EMBED, STREAMED ----
        // The whole track is never resident. The decoder hands over
        // small chunks, the embedder keeps exactly ONE window buffer,
        // and each window is inferred and discarded as soon as it
        // fills. Peak memory is a function of the window size, not the
        // track length (§4).
        // One id per analyse request, so the whole chain can be read as
        // a sequence in logcat. Derived from the clock and this
        // session's identity: no track data, no URI.
        val requestId = java.lang.Long.toHexString(System.nanoTime())
        ClapLog.event(
            ClapLog.ANALYZE_START,
            "requestId" to requestId,
            "sessionId" to Integer.toHexString(System.identityHashCode(this@ClapSession)),
            "modelId" to (activeModelId ?: ""),
            "windowBudget" to (windowBudget?.toString() ?: "unbounded"),
        )

        val stream = model.openStream(windowBudget)
        val decodeStart = System.nanoTime()
        var decodeMs: Double

        val info = try {
            // BRIDGING A BLOCKING DECODER TO A SUSPENDING MODEL
            // -------------------------------------------------
            // PcmDecoder.decode() is synchronous and pushes chunks
            // through a callback; runtime.infer() is a suspend
            // function. Calling runBlocking from inside the callback
            // would block a dispatcher thread that the inference call
            // itself needs, which risks deadlock under load.
            //
            // Instead the decode runs on an IO thread and hands chunks
            // to this coroutine through a RENDEZVOUS channel. Capacity
            // zero matters: the decoder cannot run ahead and queue
            // audio, so back-pressure keeps exactly one chunk in
            // flight and memory stays bounded no matter how long the
            // track is.
            withContext(Dispatchers.IO) {
                val channel = Channel<FloatArray>(Channel.RENDEZVOUS)

                val producer = launch {
                    try {
                        val result = decoder.decode(
                            Uri.parse(uri),
                            { samples, count ->
                                // The decoder REUSES its buffer, so the
                                // chunk is copied before it crosses the
                                // channel. This copy is one chunk (a few
                                // KB), never the track.
                                val copy = samples.copyOf(count)
                                // trySendBlocking applies back-pressure
                                // without needing a coroutine here.
                                channel.trySendBlocking(copy).getOrThrow()
                            },
                            shouldCancel = { stream.isSaturated() },
                        )
                        sourceInfo = result
                    } catch (e: AudioAnalysisException) {
                        // STOPPING EARLY IS SUCCESS, NOT FAILURE.
                        // PcmDecoder signals cancellation by THROWING
                        // CANCELLED, and a capped run cancels on
                        // purpose the moment its window budget is
                        // filled. Treating that as an error would make
                        // every 10/30/60 s test fail.
                        if (e.code != AudioAnalysisException.Code.CANCELLED) throw e
                    } catch (e: ClosedSendChannelException) {
                        // The consumer stopped first; also expected.
                    } catch (e: CancellationException) {
                        // THE CONSUMER FINISHED FIRST — THIS IS SUCCESS.
                        //
                        // When the window budget fills, the consumer
                        // breaks and calls channel.cancel(). If the
                        // producer is parked on the rendezvous send at
                        // that moment, its trySendBlocking().getOrThrow()
                        // throws CancellationException. That is the
                        // normal end of a capped run, not a failure.
                        //
                        // Only swallowed when THIS coroutine was not
                        // itself cancelled: if the caller cancelled the
                        // whole request, the exception must propagate so
                        // structured concurrency stays correct.
                        if (isActive) {
                            ClapLog.event(
                                ClapLog.DECODE_STOPPED,
                                "requestId" to requestId,
                                "reason" to "consumerSaturated",
                            )
                        } else {
                            throw e
                        }
                    } finally {
                        channel.close()
                    }
                }

                for (chunk in channel) {
                    stream.accept(chunk, chunk.size)
                    if (stream.isSaturated()) break
                }
                // The consumer has everything it needs. The producer
                // may still be parked on a rendezvous send, so the
                // channel is cancelled to release it; that surfaces in
                // the producer as a CancellationException, which it
                // recognises as this expected stop.
                //
                // shouldCancel = { stream.isSaturated() } is only polled
                // at the top of the decode loop, so it cannot release a
                // producer that is ALREADY parked mid-callback. The
                // channel cancel is what actually unblocks it.
                ClapLog.event(
                    ClapLog.DECODE_STOPPED,
                    "requestId" to requestId,
                    "stage" to "consumerDone",
                    "saturated" to stream.isSaturated(),
                    "windows" to stream.windowsProcessed,
                )
                channel.cancel()
                producer.join()

                // A cancelled decode never returns SourceInfo, so the
                // metadata is read separately. This is cheap: it opens
                // the container, reads the format, and closes it.
                sourceInfo ?: PcmDecoder(context, config).probe(Uri.parse(uri))
            }
        } catch (t: Throwable) {
            val after = MemorySample.capture(context)
            ClapLog.failure(
                stage = "DECODE",
                throwable = t,
                modelId = activeModelId,
                modelSizeBytes = model.getMetadata().sizeBytes,
                inputShape = contract.concreteInputShape(),
                inputType = contract.inputKind.name,
                sampleRate = frontEndSampleRate,
                audioDurationSec = null,
                memoryBeforeKb = before.totalPssKb,
                memoryAfterKb = after.totalPssKb,
            )
            runCatching { stream.finish() }
            // Include the underlying cause. The wrapper's own message
            // ("The decoder failed while reading this file") cannot
            // distinguish a permission problem from an unexpected PCM
            // encoding, which is exactly the ambiguity that made this
            // failure undiagnosable from the device report.
            val cause = generateSequence(t) { it.cause }
                .drop(1)
                .firstOrNull()
            val detail = if (cause != null) {
                "${t.message} (cause: ${cause.javaClass.simpleName}: ${cause.message})"
            } else {
                t.message
            }
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Could not decode the selected track: $detail",
            )
        }

        val sum = stream.finish()
        decodeMs = (System.nanoTime() - decodeStart) / 1_000_000.0
        ClapLog.event(
            ClapLog.ANALYZE_SUCCESS,
            "requestId" to requestId,
            "windows" to stream.windowsProcessed,
            "decodeMs" to decodeMs.toLong(),
        )

        if (sum == null || stream.windowsProcessed == 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "The selected track produced no embeddable audio.",
            )
        }

        val (vector, preNormL2) = model.poolAndNormalise(sum, stream.windowsProcessed)
        val norm = EmbeddingSimilarity.l2Norm(vector)
        val finite = vector.all { it.isFinite() }
        val normalised = abs(norm - 1.0) <= EmbeddingSimilarity.NORM_TOLERANCE
        val outputValid = finite && normalised && preNormL2 > 1e-8

        // Audio actually EMBEDDED, which is what the windows covered —
        // not what happened to be decoded.
        val processedSamples = minOf(
            stream.samplesSeen,
            clipSamples.toLong() +
                (stream.windowsProcessed - 1).toLong() * strideSamples,
        )
        val processedSec = processedSamples.toDouble() / frontEndSampleRate
        val sourceSec = if (info.durationUs > 0) info.durationUs / 1_000_000.0 else null

        val embedding = EmbeddingResult(
            embedding = vector,
            dimension = vector.size,
            preNormL2 = preNormL2,
            windowsProcessed = stream.windowsProcessed,
            decodeMs = decodeMs,
            preprocessingMs = stream.preprocessingMs,
            inferenceMs = stream.inferenceMs,
            totalMs = decodeMs,
        )

        val finite = embedding.embedding.all { it.isFinite() }
        var norm = 0.0
        for (v in embedding.embedding) norm += v.toDouble() * v.toDouble()
        norm = kotlin.math.sqrt(norm)
        // A correctly L2-normalised vector has norm 1.
        val normalised = kotlin.math.abs(norm - 1.0) < 1e-3
        val outputValid = finite && normalised && embedding.dimension > 0

        val peak = MemorySample.capture(context)

        // ---- RELEASE ----
        var released = false
        var releaseError: String? = null
        if (releaseAfter) {
            try {
                model.unload()
                active = null
                activeModelId = null
                validated = false
                released = !model.isLoaded()
            } catch (t: Throwable) {
                releaseError = t.message
            }
            // Cleanup, then let the allocator settle before sampling.
            MemorySettle.settleForMeasurement()
        }

        val after = MemorySample.capture(context)
        ClapLog.event(
            ClapLog.MEMORY_AFTER,
            "stage" to "singleTrack",
            "pssKb" to after.totalPssKb,
            "nativeKb" to after.nativeHeapKb,
        )

        if (outputValid) {
            lastSingleTrackId = trackId
            // Only a genuinely valid single-track run unlocks the
            // multi-track path (§5).
            multiTrackUnlocked = true
            model.markDeviceTested()
        }

        JSObject().apply {
            put("trackId", trackId)
            // Phase 22: the raw embedding, for the similarity pipeline.
            // Only when explicitly requested, and only when the output
            // passed its validity checks — an invalid vector must not
            // leave this class and become a silent 0.0 cosine.
            if (includeVector && outputValid) {
                put("vector", JSArray().apply { embedding.embedding.forEach { put(it.toDouble()) } })
            }
            put("dimension", embedding.dimension)
            put("preNormL2", embedding.preNormL2)
            put("l2NormAfterNormalisation", norm)
            put("outputFinite", finite)
            put("outputNormalised", normalised)
            put("outputValid", outputValid)
            put("windowsProcessed", embedding.windowsProcessed)
            put("audioSampleRate", frontEndSampleRate)
            put("sourceSampleRate", info.sourceSampleRate)
            put("audioSamples", processedSamples)
            // AUDIO ACTUALLY EMBEDDED, not audio decoded. The previous
            // build reported decoded samples, which overstated coverage
            // by the difference between N*clip and the overlapped span.
            put("audioDurationSec", processedSec)
            put("processedDurationSec", processedSec)
            put("sourceDurationSec", sourceSec ?: -1.0)
            put("fullTrack", fullTrack)
            put("requestedDurationSec", if (fullTrack) -1 else (durationSec ?: -1))
            put("windowLengthSec", clipSec)
            put("windowStrideSec", strideSamples.toDouble() / frontEndSampleRate)
            put(
                "coverageNote",
                if (fullTrack) {
                    "FULL TRACK: every window was streamed; the track was never " +
                        "held in memory in full."
                } else {
                    "Windows overlap 50%%, so %d windows cover %.1f s, not %d x %.1f s."
                        .format(
                            stream.windowsProcessed,
                            processedSec,
                            stream.windowsProcessed,
                            clipSec,
                        )
                },
            )
            put("decodeMs", decodeMs)
            put("preprocessingMs", embedding.preprocessingMs)
            put("inferenceMs", embedding.inferenceMs)
            // Decode and inference are interleaved in the streamed
            // pipeline, so decodeMs already spans the whole run;
            // adding them would double-count.
            put("totalProcessingMs", decodeMs)
            put("memoryBeforeKb", before.totalPssKb)
            put("memoryPeakKb", peak.totalPssKb)
            put("memoryAfterKb", after.totalPssKb)
            put("retainedKb", after.totalPssKb - before.totalPssKb)
            put("nativeBeforeKb", before.nativeHeapKb)
            put("nativeAfterKb", after.nativeHeapKb)
            put("sessionReleased", released)
            put("releaseError", releaseError ?: "")
            put("multiTrackUnlocked", multiTrackUnlocked)
            put(
                "retentionCaveat",
                "Retained PSS alone cannot separate allocator retention from a " +
                    "leak. Compare nativeAfterKb with nativeBeforeKb before " +
                    "concluding anything.",
            )
        }
    }

    /** RELEASE. Safe to call when nothing is loaded. */
    suspend fun release(): JSObject = mutex.withLock {
        val before = MemorySample.capture(context)
        val model = active
        var released = true
        var error: String? = null
        if (model != null) {
            try {
                model.unload()
            } catch (t: Throwable) {
                released = false
                error = t.message
            }
        }
        active = null
        activeModelId = null
        validated = false
        MemorySettle.settleForMeasurement()
        val after = MemorySample.capture(context)

        JSObject().apply {
            put("released", released)
            put("error", error ?: "")
            put("memoryBeforeKb", before.totalPssKb)
            put("memoryAfterKb", after.totalPssKb)
            put("retainedKb", after.totalPssKb - before.totalPssKb)
            put("nativeBeforeKb", before.nativeHeapKb)
            put("nativeAfterKb", after.nativeHeapKb)
        }
    }

    /** MEMORY CHECK, callable at any point in the lifecycle. */
    fun memoryCheck(modelId: String?): JSObject {
        val sample = MemorySample.capture(context)
        val size = modelId?.let {
            runCatching { registry.resolve(it).sizeBytes }.getOrNull()
        } ?: 0L
        val decision = MemoryGuard.evaluate(context, size, 0L)
        return JSObject().apply {
            put("sample", sample.toJs())
            put("guard", decision.toJs())
            put("sessionLoaded", active != null)
        }
    }

    /** Small helper so the settle policy lives in exactly one place. */
    private object MemorySettle {
        fun settleForMeasurement() {
            // Suggest collection, then pause: a PSS read taken
            // immediately after unload measures the allocator's
            // laziness, not the app's retention.
            System.gc()
            try {
                Thread.sleep(250)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            System.gc()
        }
    }
}
