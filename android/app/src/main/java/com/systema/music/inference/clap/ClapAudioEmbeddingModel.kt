package com.systema.music.inference.clap

import android.content.Context
import com.systema.music.inference.AudioEmbeddingModel
import com.systema.music.inference.EmbeddingModelLoadResult
import com.systema.music.inference.EmbeddingModelMetadata
import com.systema.music.inference.EmbeddingResult
import com.systema.music.inference.EmbeddingValidationReport
import com.systema.music.inference.InferenceErrorCode
import com.systema.music.inference.InferenceException
import com.systema.music.inference.InferenceRuntime
import com.systema.music.inference.MemorySample
import com.systema.music.inference.ModelDescriptor
import com.systema.music.inference.ModelInputPreparer
import com.systema.music.inference.ValidationCheck
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.sqrt

/**
 * LAION-CLAP audio tower adapter (§3).
 *
 * OWNS ITS OWN PREPROCESSING, ON PURPOSE
 * --------------------------------------
 * CLAP is not fed a waveform. It wants a 48 kHz log-mel spectrogram
 * built to the exact recipe in [ClapMelFrontEnd]. Reusing the YAMNet /
 * PANNs path would hand the graph a differently-scaled tensor and the
 * embeddings would be quietly wrong rather than obviously broken.
 *
 * BOUNDED WINDOWS, NOT WHOLE SONGS (§4)
 * -------------------------------------
 * A five-minute track at 48 kHz is 14.4 million floats (~58 MB) before
 * any mel expansion, and the previous experimental model froze devices
 * doing exactly this kind of thing. So audio is processed in fixed
 * 10-second windows matching the model's clip_samples, embeddings are
 * accumulated into ONE running sum, and each window's tensors are
 * dropped before the next is built. Frame-level embeddings are never
 * retained.
 *
 * This class never touches PlayerEngine, the music library, or any
 * automatic path. It only runs when something explicitly calls it.
 */
class ClapAudioEmbeddingModel(
    private val context: Context,
    private val descriptor: ModelDescriptor,
    private val runtime: InferenceRuntime,
    private val frontEnd: ClapMelFrontEnd = ClapMelFrontEnd(),
    /** Cap on windows per track, so a long file cannot run unbounded. */
    private val maxWindows: Int = DEFAULT_MAX_WINDOWS,
) : AudioEmbeddingModel {

    companion object {
        const val FAMILY = "CLAP"

        /**
         * 6 windows x 10 s = 60 s of audio per track.
         *
         * Bounded deliberately: the goal is a representative embedding,
         * not exhaustive coverage, and an unbounded loop over a long
         * track is how memory pressure becomes a freeze.
         */
        const val DEFAULT_MAX_WINDOWS = 6

        /** 50% overlap between windows, as CLAP segmenting commonly uses. */
        const val WINDOW_STRIDE_DIVISOR = 2
    }

    private val mutex = Mutex()

    @Volatile private var loaded = false
    @Volatile private var loadedInputNames: List<String> = emptyList()
    @Volatile private var loadedOutputNames: List<String> = emptyList()
    @Volatile private var provenDimension: Int? = null
    @Volatile private var status: String = "IMPORTED"

    /**
     * What the loaded graph actually wants (§2). Null until load()
     * has read the real signatures; nothing may infer before then.
     */
    @Volatile private var graphContract: ClapGraphContract? = null

    /** The derived contract, or null when nothing is loaded. */
    fun contract(): ClapGraphContract? = graphContract

    override val modelId: String get() = descriptor.modelId
    override val family: String get() = FAMILY

    override fun isLoaded(): Boolean = loaded

    /**
     * Text support is answered from the LOADED GRAPH, never the family.
     *
     * A CLAP audio-tower export has no text encoder. Reporting "CLAP
     * therefore supports text" would advertise a capability the file
     * does not contain (§7).
     */
    override fun supportsText(): Boolean =
        loadedInputNames.any { it.contains("input_ids", ignoreCase = true) ||
            it.contains("token", ignoreCase = true) }

    override fun getMetadata(): EmbeddingModelMetadata = EmbeddingModelMetadata(
        modelId = descriptor.modelId,
        name = descriptor.modelName,
        family = FAMILY,
        architecture = "LAION-CLAP audio tower (HTSAT / PANN variants)",
        format = "onnx",
        sampleRate = descriptor.inputSampleRate ?: frontEnd.sampleRate,
        // Reported from the derived contract, not from a constant: a
        // waveform export and a log-mel export are both "CLAP".
        inputType = when (graphContract?.inputKind) {
            ClapGraphContract.InputKind.WAVEFORM -> "waveform"
            ClapGraphContract.InputKind.LOG_MEL -> "log_mel_spectrogram"
            else -> "unknown"
        },
        // Null until a real forward pass proves it. Never assumed.
        embeddingDimension = provenDimension,
        sizeBytes = descriptor.sizeBytes,
        sha256 = descriptor.checksum,
        status = status,
        runtimeId = runtime.runtimeId,
        inputNames = loadedInputNames,
        outputNames = loadedOutputNames,
        supportsText = supportsText(),
        notes = when (graphContract?.inputKind) {
            ClapGraphContract.InputKind.WAVEFORM ->
                "Preprocessing: decode to mono, resample to " +
                    "${descriptor.inputSampleRate ?: frontEnd.sampleRate} Hz, " +
                    "${graphContract?.waveformSamples ?: 0} samples per window. " +
                    "The GRAPH computes its own spectrogram, so SYSTEMA applies " +
                    "no mel transform. Short audio is repeat-padded, matching " +
                    "LAION-CLAP's data_filling=repeatpad."
            ClapGraphContract.InputKind.LOG_MEL ->
                "Preprocessing: ${frontEnd.sampleRate} Hz mono, n_fft ${frontEnd.nFft}, " +
                    "hop ${frontEnd.hopSize}, ${frontEnd.melBins} mels, " +
                    "fmin ${frontEnd.fMin.toInt()}, fmax ${frontEnd.fMax.toInt()}, " +
                    "10*log10 power, Slaney mel. Verified against librosa to 3e-5 dB."
            else ->
                "Preprocessing undetermined: the model has not been loaded, or " +
                    "its input format could not be read from the graph."
        },
        architectureNote = graphContract?.rationale,
    )

    override suspend fun load(): EmbeddingModelLoadResult = mutex.withLock {
        // Never load a second copy over a live one (§4).
        if (loaded) {
            throw InferenceException(
                InferenceErrorCode.MODEL_LOAD_FAILED,
                "A CLAP session is already loaded for ${descriptor.modelId}. " +
                    "Unload it before loading again; two sessions must never be " +
                    "resident at once.",
            )
        }
        if (runtime.isLoaded()) {
            throw InferenceException(
                InferenceErrorCode.MODEL_LOAD_FAILED,
                "The runtime already holds a session. Release it first.",
            )
        }

        val before = MemorySample.capture(context)
        ClapLog.event(ClapLog.MEMORY_BEFORE, "stage" to "load", "pssKb" to before.totalPssKb)
        ClapLog.event(
            ClapLog.LOAD_START,
            "modelId" to descriptor.modelId,
            "sizeBytes" to descriptor.sizeBytes,
        )

        val info = try {
            runtime.loadModel(descriptor)
        } catch (t: Throwable) {
            val after = MemorySample.capture(context)
            ClapLog.failure(
                stage = ClapLog.LOAD_START,
                throwable = t,
                modelId = descriptor.modelId,
                modelSizeBytes = descriptor.sizeBytes,
                inputShape = descriptor.inputShape,
                inputType = descriptor.inputFormat.name,
                sampleRate = descriptor.inputSampleRate,
                audioDurationSec = null,
                memoryBeforeKb = before.totalPssKb,
                memoryAfterKb = after.totalPssKb,
            )
            throw t
        }

        loaded = true
        loadedInputNames = info.inputNames
        loadedOutputNames = info.outputNames

        // DERIVE THE PREPROCESSING FROM THE GRAPH, NEVER FROM THE NAME
        // ------------------------------------------------------------
        // Some CLAP exports take a raw 48 kHz waveform and compute the
        // mel internally; others take an externally computed log-mel.
        // Both are "CLAP". Only the graph knows which this is, and
        // getting it wrong yields a finite, normalised, meaningless
        // vector rather than an error — so it is read, not assumed.
        val derived = ClapGraphContract.derive(info.inputs, info.outputs)
        graphContract = derived
        ClapLog.event(
            ClapLog.CONTRACT_DERIVED,
            "modelId" to descriptor.modelId,
            "inputKind" to derived.inputKind.name,
            "inputName" to derived.inputName,
            "inputShape" to derived.inputShape.joinToString("x"),
            "outputShape" to derived.outputShape.joinToString("x"),
        )

        val after = MemorySample.capture(context)
        ClapLog.event(
            ClapLog.LOAD_SUCCESS,
            "modelId" to descriptor.modelId,
            "loadMs" to info.loadMs,
            "inputs" to info.inputNames.joinToString(","),
            "outputs" to info.outputNames.joinToString(","),
        )
        ClapLog.event(ClapLog.MEMORY_AFTER, "stage" to "load", "pssKb" to after.totalPssKb)

        EmbeddingModelLoadResult(
            loadMs = info.loadMs,
            inputNames = info.inputNames,
            outputNames = info.outputNames,
            declaredInputShape = descriptor.inputShape,
            sizeBytes = descriptor.sizeBytes,
        )
    }

    /**
     * Dry validation (§2), run on synthetic silence-free noise rather
     * than a user's track: the point is to prove the graph accepts our
     * tensor and returns a finite, normalisable vector, and that must
     * be established before any real audio is touched.
     */
    override suspend fun validate(): EmbeddingValidationReport = mutex.withLock {
        val checks = mutableListOf<ValidationCheck>()

        if (!loaded) {
            return EmbeddingValidationReport(
                ok = false,
                checks = listOf(
                    ValidationCheck("session loaded", false, "No session is loaded."),
                ),
                embeddingDimension = null,
                failureCode = InferenceErrorCode.MODEL_LOAD_FAILED,
                failureMessage = "validate() called before load().",
            )
        }
        checks += ValidationCheck("session loaded", true, "Runtime session is live.")

        checks += ValidationCheck(
            "graph has inputs and outputs",
            loadedInputNames.isNotEmpty() && loadedOutputNames.isNotEmpty(),
            "inputs=${loadedInputNames} outputs=${loadedOutputNames}",
        )

        val rate = descriptor.inputSampleRate
        checks += ValidationCheck(
            "required sample rate is known",
            rate != null && rate > 0,
            if (rate != null && rate > 0) "$rate Hz" else "Model declares no sample rate.",
        )

        // ---- THE GRAPH CONTRACT (§2) ----
        // Each of these is read off the real graph. A model whose
        // input format cannot be determined is refused here, before
        // any audio is touched, rather than producing a meaningless
        // vector later.
        val contract = graphContract
        if (contract == null || contract.inputKind == ClapGraphContract.InputKind.UNKNOWN) {
            checks += ValidationCheck(
                "input format determined from graph",
                false,
                contract?.rationale ?: "No contract was derived at load time.",
            )
            return EmbeddingValidationReport(
                ok = false,
                checks = checks,
                embeddingDimension = null,
                failureCode = InferenceErrorCode.MODEL_INVALID,
                failureMessage = contract?.rationale
                    ?: "The model's input format could not be determined.",
            )
        }

        checks += ValidationCheck(
            "input name", contract.inputName.isNotBlank(), "'${contract.inputName}'",
        )
        checks += ValidationCheck(
            "input dtype is float32",
            contract.inputType.contains("FLOAT", ignoreCase = true),
            contract.inputType,
        )
        checks += ValidationCheck(
            "input rank",
            contract.inputShape.isNotEmpty(),
            "rank ${contract.inputShape.size} ${contract.inputShape}",
        )
        checks += ValidationCheck(
            "input dimensions resolved",
            contract.concreteInputShape() != null,
            contract.concreteInputShape()?.toString()
                ?: "Could not resolve every input dimension.",
        )
        checks += ValidationCheck(
            "input format determined from graph",
            true,
            contract.rationale,
        )
        checks += ValidationCheck(
            "output name", contract.outputName.isNotBlank(), "'${contract.outputName}'",
        )
        checks += ValidationCheck(
            "output dimension",
            contract.outputShape.isNotEmpty(),
            contract.embeddingDimension?.let { "$it (declared by the graph)" }
                ?: "dynamic ${contract.outputShape}; measured by the probe below",
        )

        ClapLog.event(ClapLog.VALIDATE, "modelId" to descriptor.modelId)

        // A deterministic, non-degenerate probe. Silence could produce
        // a legitimately zero embedding and mask a real fault, so this
        // is a 440 Hz tone. One second of it; embedWindowsInternal
        // fits it to whatever window length the contract requires.
        val probeRate = descriptor.inputSampleRate ?: frontEnd.sampleRate
        val probeSamples = FloatArray(probeRate) { i ->
            (sqrt(2.0) * kotlin.math.sin(2.0 * Math.PI * 440.0 * i / probeRate) * 0.1).toFloat()
        }

        val result = try {
            embedWindowsInternal(probeSamples, probeRate, maxWindowsOverride = 1)
        } catch (t: Throwable) {
            checks += ValidationCheck("forward pass", false, "${t.javaClass.simpleName}: ${t.message}")
            return EmbeddingValidationReport(
                ok = false,
                checks = checks,
                embeddingDimension = null,
                failureCode = (t as? InferenceException)?.code
                    ?: InferenceErrorCode.MODEL_INVALID,
                failureMessage = t.message,
            )
        }

        checks += ValidationCheck(
            "forward pass",
            true,
            "Produced ${result.dimension} values in ${"%.1f".format(result.inferenceMs)} ms.",
        )

        val allFinite = result.embedding.all { it.isFinite() }
        checks += ValidationCheck(
            "output is finite",
            allFinite,
            if (allFinite) "No NaN or Inf." else "Output contains NaN or Inf.",
        )

        val normalisable = result.preNormL2 > 1e-8
        checks += ValidationCheck(
            "embedding can be normalised",
            normalisable,
            "pre-normalisation L2 = ${"%.6f".format(result.preNormL2)}" +
                if (normalisable) "" else " (degenerate: a zero vector cannot be normalised)",
        )

        val dimSane = result.dimension > 0
        checks += ValidationCheck(
            "embedding dimension is usable",
            dimSane,
            "dimension = ${result.dimension}",
        )

        val ok = checks.all { it.passed }
        if (ok) {
            provenDimension = result.dimension
            status = "VALIDATED"
        }

        EmbeddingValidationReport(
            ok = ok,
            checks = checks,
            embeddingDimension = if (ok) result.dimension else null,
            failureCode = if (ok) null else InferenceErrorCode.MODEL_INVALID,
            failureMessage = if (ok) null else
                checks.firstOrNull { !it.passed }?.let { "${it.name}: ${it.detail}" },
        )
    }

    override suspend fun embedAudio(pcm: FloatArray, pcmSampleRate: Int): EmbeddingResult =
        mutex.withLock {
            if (!loaded) {
                throw InferenceException(
                    InferenceErrorCode.MODEL_LOAD_FAILED,
                    "embedAudio() called with no session loaded.",
                )
            }
            embedWindowsInternal(pcm, pcmSampleRate)
        }

    /**
     * The bounded-window embedding loop (§4).
     *
     * Holds exactly one window's tensors at a time and accumulates
     * into a single running sum, so peak memory is independent of
     * track length.
     */
    private suspend fun embedWindowsInternal(
        pcm: FloatArray,
        pcmSampleRate: Int,
        maxWindowsOverride: Int? = null,
    ): EmbeddingResult {
        val totalStart = System.nanoTime()
        val before = MemorySample.capture(context)
        val durationSec = if (pcmSampleRate > 0) pcm.size.toDouble() / pcmSampleRate else 0.0

        ClapLog.event(
            ClapLog.INFERENCE_START,
            "modelId" to descriptor.modelId,
            "samples" to pcm.size,
            "pcmSampleRate" to pcmSampleRate,
            "durationSec" to "%.2f".format(durationSec),
            "pssKb" to before.totalPssKb,
        )

        var preprocessingMs = 0.0
        var inferenceMs = 0.0

        // ---- resample to the model's rate, once ----
        val preStart = System.nanoTime()
        val target = descriptor.inputSampleRate ?: frontEnd.sampleRate
        val resampled = if (pcmSampleRate == target) {
            pcm
        } else {
            ModelInputPreparer.resampleLinear(pcm, pcmSampleRate, target)
        }
        preprocessingMs += (System.nanoTime() - preStart) / 1_000_000.0

        // The window length is whatever the GRAPH asks for. For a
        // waveform model that is its fixed sample count; for a log-mel
        // model it is the clip that produces the expected frame count.
        val contract = graphContract ?: throw InferenceException(
            InferenceErrorCode.MODEL_INVALID,
            "The graph contract has not been derived. load() must run first.",
        )
        if (contract.inputKind == ClapGraphContract.InputKind.UNKNOWN) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "Refusing to run inference: the model's input format could not " +
                    "be determined. ${contract.rationale}",
            )
        }

        val clip = when (contract.inputKind) {
            ClapGraphContract.InputKind.WAVEFORM ->
                contract.waveformSamples ?: ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES
            // A log-mel graph fixes the FRAME count, so the clip is the
            // audio length that yields it: frames = samples/hop + 1.
            ClapGraphContract.InputKind.LOG_MEL ->
                contract.melFrames?.let { (it - 1) * frontEnd.hopSize }
                    ?: ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES
            ClapGraphContract.InputKind.UNKNOWN -> ClapMelFrontEnd.DEFAULT_CLIP_SAMPLES
        }
        val stride = clip / WINDOW_STRIDE_DIVISOR
        val cap = maxWindowsOverride ?: maxWindows

        val windowStarts = ArrayList<Int>(cap)
        var s = 0
        while (windowStarts.size < cap && s < resampled.size) {
            windowStarts.add(s)
            s += stride
        }
        if (windowStarts.isEmpty()) windowStarts.add(0)

        var sum: DoubleArray? = null
        var windowsProcessed = 0

        for (start in windowStarts) {
            // One window's worth of samples. Scoped so each iteration's
            // buffers become garbage immediately.
            val windowPcm = run {
                val end = minOf(start + clip, resampled.size)
                if (end <= start) return@run FloatArray(0)
                frontEnd.fitToClip(resampled.copyOfRange(start, end), clip)
            }
            if (windowPcm.isEmpty()) continue

            val p0 = System.nanoTime()
            // THE BRANCH THIS PHASE EXISTS FOR.
            // A waveform graph gets the samples themselves; only a
            // log-mel graph gets a spectrogram computed out here.
            val tensor = when (contract.inputKind) {
                ClapGraphContract.InputKind.WAVEFORM -> windowPcm
                else -> frontEnd.toNchwTimeMajor(frontEnd.logMel(windowPcm))
            }
            preprocessingMs += (System.nanoTime() - p0) / 1_000_000.0

            val out = try {
                runtime.infer(tensor)
            } catch (t: Throwable) {
                val after = MemorySample.capture(context)
                ClapLog.failure(
                    stage = ClapLog.INFERENCE_START,
                    throwable = t,
                    modelId = descriptor.modelId,
                    modelSizeBytes = descriptor.sizeBytes,
                    inputShape = contract.concreteInputShape() ?: listOf(tensor.size.toLong()),
                    inputType = contract.inputKind.name,
                    sampleRate = target,
                    audioDurationSec = durationSec,
                    memoryBeforeKb = before.totalPssKb,
                    memoryAfterKb = after.totalPssKb,
                )
                throw t
            }
            inferenceMs += out.inferenceMs

            val vec = out.output
            // Bound to a local val: relying on a smart cast of a
            // nullable var across loop iterations is needlessly
            // fragile, and this is the accumulator everything else
            // depends on.
            val acc = sum ?: DoubleArray(vec.size).also { sum = it }
            if (vec.size != acc.size) {
                throw InferenceException(
                    InferenceErrorCode.MODEL_INVALID,
                    "Window $windowsProcessed produced ${vec.size} values but the " +
                        "previous window produced ${acc.size}. A model whose output " +
                        "dimension varies per window cannot be mean-pooled.",
                )
            }
            for (i in vec.indices) acc[i] += vec[i].toDouble()
            windowsProcessed++
            // `mel`, `tensor`, `windowPcm` and `out` all drop out of
            // scope here; nothing frame-level is retained (§4).
        }

        val acc = sum ?: throw InferenceException(
            InferenceErrorCode.MODEL_INVALID,
            "No window produced an embedding.",
        )

        // Mean-pool, then L2 normalise.
        val pooled = FloatArray(acc.size) { (acc[it] / windowsProcessed).toFloat() }
        var sq = 0.0
        for (v in pooled) sq += v.toDouble() * v.toDouble()
        val preNormL2 = sqrt(sq)

        val normalised = if (preNormL2 > 1e-12) {
            FloatArray(pooled.size) { (pooled[it] / preNormL2).toFloat() }
        } else {
            // Do not fabricate a unit vector from nothing.
            pooled
        }

        val after = MemorySample.capture(context)
        val totalMs = (System.nanoTime() - totalStart) / 1_000_000.0

        ClapLog.event(
            ClapLog.INFERENCE_END,
            "modelId" to descriptor.modelId,
            "windows" to windowsProcessed,
            "dimension" to normalised.size,
            "inferenceMs" to "%.1f".format(inferenceMs),
            "totalMs" to "%.1f".format(totalMs),
        )
        ClapLog.event(
            ClapLog.EMBEDDING_VALID,
            "finite" to normalised.all { it.isFinite() },
            "preNormL2" to "%.6f".format(preNormL2),
            "dimension" to normalised.size,
        )
        ClapLog.event(ClapLog.MEMORY_AFTER, "stage" to "inference", "pssKb" to after.totalPssKb)

        return EmbeddingResult(
            embedding = normalised,
            dimension = normalised.size,
            preNormL2 = preNormL2,
            windowsProcessed = windowsProcessed,
            decodeMs = 0.0,
            preprocessingMs = preprocessingMs,
            inferenceMs = inferenceMs,
            totalMs = totalMs,
        )
    }

    /** Never throws: cleanup after a failure is what matters most. */
    override suspend fun unload() {
        mutex.withLock {
            ClapLog.event(ClapLog.UNLOAD_START, "modelId" to descriptor.modelId)
            try {
                runtime.unloadModel()
            } catch (t: Throwable) {
                ClapLog.warn(
                    ClapLog.UNLOAD_START,
                    "modelId" to descriptor.modelId,
                    "error" to t.message,
                )
            }
            loaded = false
            loadedInputNames = emptyList()
            loadedOutputNames = emptyList()
            // The contract describes a LOADED graph. Keeping it after
            // unload would let a stale format outlive the session.
            graphContract = null
            val after = MemorySample.capture(context)
            ClapLog.event(ClapLog.UNLOAD_SUCCESS, "modelId" to descriptor.modelId)
            ClapLog.event(ClapLog.MEMORY_AFTER, "stage" to "unload", "pssKb" to after.totalPssKb)
        }
    }

    /** Marks a successful single-track device test (§10). Never PRODUCTION. */
    fun markDeviceTested() {
        status = "DEVICE_TESTED"
    }
}
