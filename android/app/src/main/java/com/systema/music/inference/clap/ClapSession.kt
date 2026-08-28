package com.systema.music.inference.clap

import android.content.Context
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.inference.EmbeddingResult
import com.systema.music.inference.InferenceErrorCode
import com.systema.music.inference.InferenceException
import com.systema.music.inference.InferenceRuntime
import com.systema.music.inference.InputFormat
import com.systema.music.inference.MemoryGuard
import com.systema.music.inference.MemorySample
import com.systema.music.inference.ModelDescriptor
import com.systema.music.inference.ModelRegistry
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

    private companion object {
        /**
         * Cap on how much audio the single-track test will decode.
         * 60 s is well past the six 10 s windows the adapter will
         * actually consume, so the bound is the window cap, not this.
         */
        const val MAX_TEST_AUDIO_MS = 60_000L
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

        // THE SHAPE MATTERS, AND THE DEFAULT IS WRONG FOR CLAP
        // -----------------------------------------------------
        // The runtime builds its ONNX tensor from the DESCRIPTOR's
        // declared shape, not from the rank of the data. An imported
        // model with no stored contract defaults to [-1], which would
        // hand a 4-D log-mel to the graph as a flat vector and either
        // fail opaquely inside ORT or, far worse, succeed against a
        // fully dynamic graph while meaning something else entirely.
        //
        // So the shape is declared explicitly: [1, 1, frames, mels],
        // matching what ClapMelFrontEnd.toNchwTimeMajor() actually
        // produces. The frame count is fixed by the 10 s clip length,
        // so every dimension here is concrete and the runtime has
        // nothing left to infer.
        val frontEnd = ClapMelFrontEnd()
        val frames = frontEnd.frameCountFor(ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES)

        val descriptor = registry.descriptorForInstalled(
            fileName = if (modelId.endsWith(".onnx")) modelId else "$modelId.onnx",
            sampleRate = frontEndSampleRate,
            inputFormat = InputFormat.LOG_MEL_SPECTROGRAM,
            inputShape = listOf(1L, 1L, frames.toLong(), frontEnd.melBins.toLong()),
        )

        // Tensor cost for ONE window: [1,1,frames,mels] float32, plus
        // the window's own PCM.
        val tensorBytes = frames.toLong() * frontEnd.melBins * 4L +
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

        val model = ClapAudioEmbeddingModel(context, descriptor, runtime, frontEnd)
        val result = model.load()

        active = model
        activeModelId = modelId
        validated = false

        JSObject().apply {
            put("loadMs", result.loadMs)
            put("sizeBytes", result.sizeBytes)
            put("memoryGuard", decision.toJs())
            put("metadata", model.getMetadata().toJs())
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
        val config = AudioAnalysisConfig(
            targetSampleRate = frontEndSampleRate,
            maxAnalysisDurationMs = MAX_TEST_AUDIO_MS,
        )
        val decoder = PcmDecoder(context, config)

        // ---- DECODE, bounded ----
        val decodeStart = System.nanoTime()
        val chunks = ArrayList<FloatArray>()
        var totalSamples = 0
        // Only as much audio as the windows can consume, so a long
        // track cannot balloon the decode buffer (§4).
        val maxSamples = ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES *
            ClapAudioEmbeddingModel.DEFAULT_MAX_WINDOWS

        val info = try {
            decoder.decode(Uri.parse(uri), { samples, count ->
                // The decoder reuses its buffer; copy before retaining.
                if (totalSamples < maxSamples) {
                    val take = minOf(count, maxSamples - totalSamples)
                    if (take > 0) {
                        chunks.add(samples.copyOf(take))
                        totalSamples += take
                    }
                }
            })
        } catch (t: Throwable) {
            val after = MemorySample.capture(context)
            ClapLog.failure(
                stage = "DECODE",
                throwable = t,
                modelId = activeModelId,
                modelSizeBytes = model.getMetadata().sizeBytes,
                inputShape = null,
                inputType = "log_mel_spectrogram",
                sampleRate = frontEndSampleRate,
                audioDurationSec = null,
                memoryBeforeKb = before.totalPssKb,
                memoryAfterKb = after.totalPssKb,
            )
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Could not decode the selected track: ${t.message}",
            )
        }

        val pcm = FloatArray(totalSamples)
        var off = 0
        for (c in chunks) {
            System.arraycopy(c, 0, pcm, off, c.size)
            off += c.size
        }
        chunks.clear() // release the per-chunk copies immediately
        val decodeMs = (System.nanoTime() - decodeStart) / 1_000_000.0

        if (totalSamples == 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "The selected track decoded to zero samples.",
            )
        }

        // ---- EMBED ----
        // NOTE: the PCM handed back by the sink is at
        // config.targetSampleRate, NOT info.sourceSampleRate — the
        // decoder has already resampled. Passing the source rate here
        // would silently mis-scale every window.
        val embedding: EmbeddingResult = model.embedAudio(pcm, frontEndSampleRate)

        val finite = embedding.embedding.all { it.isFinite() }
        var norm = 0.0
        for (v in embedding.embedding) norm += v.toDouble() * v.toDouble()
        norm = Math.sqrt(norm)
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
            put("dimension", embedding.dimension)
            put("preNormL2", embedding.preNormL2)
            put("l2NormAfterNormalisation", norm)
            put("outputFinite", finite)
            put("outputNormalised", normalised)
            put("outputValid", outputValid)
            put("windowsProcessed", embedding.windowsProcessed)
            put("audioSampleRate", frontEndSampleRate)
            put("sourceSampleRate", info.sourceSampleRate)
            put("audioSamples", totalSamples)
            put("audioDurationSec", totalSamples.toDouble() / frontEndSampleRate)
            put("decodeMs", decodeMs)
            put("preprocessingMs", embedding.preprocessingMs)
            put("inferenceMs", embedding.inferenceMs)
            put("totalProcessingMs", decodeMs + embedding.totalMs)
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
