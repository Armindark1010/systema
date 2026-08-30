package com.systema.music.inference.effnet

import android.content.Context
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.inference.InferenceErrorCode
import com.systema.music.inference.InferenceException
import com.systema.music.inference.InferenceRuntime
import com.systema.music.inference.InputFormat
import com.systema.music.inference.LoadedModelInfo
import com.systema.music.inference.MelFrontEnds
import com.systema.music.inference.ModelRegistry
import com.systema.music.inference.ModelStorage
import com.systema.music.inference.RuntimeIds
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Runs Discogs-EffNet over one track and returns a REAL embedding.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * This produces an EMBEDDING — a 1280-d vector. It produces no genre,
 * no mood, no tags and no vocal/instrumental label, because none of
 * those classifier heads exist in the project. Any of those appearing
 * in the UI while this is the only installed model would be fabricated.
 *
 * WHY IT MIRRORS ClapSession RATHER THAN REPLACING IT
 * ---------------------------------------------------
 * CLAP stays exactly as it is. This is a second, independent
 * experimental model with a different front end, a different rate and
 * a different output width. Sharing a session object would mean one
 * mutex, one resident model and two sets of assumptions about which
 * was loaded — and the failure mode would be an embedding attributed
 * to the wrong model. They are kept apart deliberately.
 *
 * It reuses everything that is genuinely shared: PcmDecoder for audio,
 * ModelStorage/ModelRegistry for locating and describing the file, and
 * the existing InferenceRuntime for execution. No second loader, no
 * hardcoded path, nothing bundled in the APK.
 *
 * ONE MODEL RESIDENT AT A TIME
 * ----------------------------
 * The runtime enforces this itself: loadModel releases whatever was
 * loaded before. So loading EffNet evicts CLAP and vice versa, which
 * is correct on a phone — these graphs are tens to hundreds of MB.
 */
class EffnetDiscogsSession(
    private val context: Context,
    private val registry: ModelRegistry,
    /**
     * Resolves the runtime by id, exactly as the quality labs do, so
     * this session reaches the SAME ONNX abstraction the benchmark
     * uses instead of constructing a second one.
     */
    private val runtimeProvider: (String) -> InferenceRuntime,
) {

    private val storage = ModelStorage(context.applicationContext)
    private val runtime: InferenceRuntime get() = runtimeProvider(RUNTIME_ID)

    private companion object {
        const val TAG = "SystemaEffnet"

        /**
         * The ONNX runtime id, taken from RuntimeIds rather than
         * spelled out. The literal is "onnxruntime", and a hand-typed
         * "onnx" resolves to nothing — a failure that would only show
         * up on a device, as RUNTIME_UNAVAILABLE.
         *
         * The reference runtime is deliberately NOT a fallback: it
         * cannot execute this graph, and pretending otherwise would
         * mean a fabricated embedding.
         */
        val RUNTIME_ID = RuntimeIds.ONNX

        /**
         * Seconds of audio to analyse by default.
         *
         * Not the whole track: at ~1 patch/second a five-minute song is
         * ~300 patches, and the embedding is mean-pooled anyway. 120 s
         * from the start captures the material while keeping peak
         * memory and battery cost bounded. 0 or negative means the
         * whole track, chosen explicitly by the caller.
         */
        const val DEFAULT_DURATION_SEC = 120
    }

    private val mutex = Mutex()
    private var loaded: LoadedModelInfo? = null
    private var loadedModelId: String? = null

    /**
     * Which EffNet export is installed, if any.
     *
     * Discovered by scanning the models directory for the family
     * prefix — NOT by looking for one hardcoded file name. Both
     * `bs64` and `bsdynamic` are valid and either may be present.
     */
    fun installedModel(): String? =
        storage.listInstalled()
            .map { it.fileName }
            .firstOrNull { EffnetDiscogsModel.isEffnetDiscogsId(it.removeSuffix(ModelStorage.EXTENSION)) }

    /** Status for the UI. Truthful about what is and is not present. */
    fun status(): JSObject {
        val file = installedModel()
        val modelId = file?.removeSuffix(ModelStorage.EXTENSION)
        return JSObject().apply {
            put("available", runtime.isAvailable())
            put("runtime", runtime.label)
            put("installed", file != null)
            put("modelId", modelId)
            put("modelFile", file)
            put("modelVersion", file?.let { EffnetDiscogsModel.versionFromFileName(it) })
            put("loaded", loaded != null)
            put("embeddingDimension", EffnetDiscogsModel.EMBEDDING_DIM)
            put("sampleRate", EffnetDiscogsMelFrontEnd.SAMPLE_RATE)
            put("melBands", EffnetDiscogsMelFrontEnd.MEL_BANDS)
            put("experimental", true)
            // What this model can and cannot produce. The UI reads
            // this rather than assuming.
            put("producesEmbedding", true)
            put("producesLabels", false)
            put(
                "notice",
                "Discogs-EffNet produces a ${EffnetDiscogsModel.EMBEDDING_DIM}-d embedding " +
                    "only. Genre, mood, tags and vocal/instrumental require separate " +
                    "classifier heads that are not installed.",
            )
            if (file == null) {
                put("errorCode", "MODEL_NOT_INSTALLED")
                put(
                    "detail",
                    "No Discogs-EffNet model is installed. Import " +
                        "'discogs-effnet-bsdynamic-1.onnx' (or the bs64 export) " +
                        "through Model Import. " + storage.sideloadInstructions(),
                )
            }
        }
    }

    /**
     * Loads the installed export through the existing runtime.
     *
     * The descriptor is built from the REAL file name and the REAL
     * graph shape, so `bs64` and `bsdynamic` are distinguishable and
     * the batch axis is whatever the model actually declares.
     */
    suspend fun load(): JSObject = mutex.withLock { loadLocked() }

    private suspend fun loadLocked(): JSObject {
        if (!runtime.isAvailable()) {
            throw InferenceException(
                InferenceErrorCode.RUNTIME_UNAVAILABLE,
                "${runtime.label} is not available on this device.",
            )
        }

        val fileName = installedModel() ?: throw InferenceException(
            InferenceErrorCode.MODEL_NOT_FOUND,
            "No Discogs-EffNet model is installed. Import it through Model " +
                "Import first. " + storage.sideloadInstructions(),
        )
        val modelId = fileName.removeSuffix(ModelStorage.EXTENSION)


        // THE DESCRIPTOR COMES FROM THE REGISTRY, NOT FROM HERE.
        //
        // registry.resolve() reads the contract that the importer
        // stored for this exact file, so an operator who declared
        // something about this model is obeyed. Building a descriptor
        // locally would be a second model-definition system, and the
        // two would eventually disagree about the input shape.
        //
        // The EffNet-specific knowledge added on top is only what the
        // contract cannot know and the graph does not record: the mel
        // front end and its 16 kHz rate. Everything else — shape,
        // path, size — stays the registry's answer.
        val resolved = registry.resolve(
            modelId = modelId,
            sampleRate = EffnetDiscogsMelFrontEnd.SAMPLE_RATE,
        )
        val descriptor = resolved.copy(
            modelName = EffnetDiscogsModel.MODEL_NAME,
            inputFormat = InputFormat.LOG_MEL_SPECTROGRAM,
            inputChannels = 1,
        )

        val info = runtime.loadModel(descriptor)

        // MODEL_INCOMPATIBLE: the graph is not what we expect.
        EffnetDiscogsModel.verifySignature(info)

        loaded = info
        loadedModelId = modelId

        Log.i(
            TAG,
            "loaded modelId=$modelId batch=${EffnetDiscogsModel.batchModeOf(info)} " +
                "inputs=${info.inputs.joinToString { "${it.name}${it.shape}" }} " +
                "outputs=${info.outputs.joinToString { "${it.name}${it.shape}" }}",
        )

        return JSObject().apply {
            put("modelId", modelId)
            put("modelVersion", descriptor.version)
            put("loadMs", info.loadMs)
            put("sizeBytes", info.sizeBytes)
            put("inputNames", info.inputNames.joinToString())
            put("outputNames", info.outputNames.joinToString())
            put("batchMode", EffnetDiscogsModel.batchModeOf(info).toString())
            put("experimental", true)
        }
    }

    /**
     * Decodes one track, builds mel patches, and runs real inference.
     *
     * Every failure below is a DISTINCT code, because the fixes are
     * completely different: a missing model needs an import, an
     * incompatible one needs a different file, a preprocessing failure
     * means the audio was unusable, and an inference failure is a
     * runtime problem. Collapsing them into "analysis failed" would
     * waste the developer's time.
     *
     * There is no fallback. Not to CLAP, not to a zero vector, not to a
     * cached result from another model.
     */
    suspend fun embedTrack(
        trackId: String,
        uri: String,
        durationSec: Int = DEFAULT_DURATION_SEC,
        includeVector: Boolean = true,
    ): JSObject = mutex.withLock {
        if (loaded == null) loadLocked()
        val info = loaded ?: throw InferenceException(
            InferenceErrorCode.MODEL_LOAD_FAILED,
            "No Discogs-EffNet session is loaded.",
        )

        val startNs = System.nanoTime()

        // ---- DECODE, at the model's own rate ----
        //
        // 16 kHz, mono. The Phase 13 analyser targets 22050 Hz; feeding
        // that to a 16 kHz model and resampling afterwards would put
        // every mel band at the wrong frequency.
        val frontEnd = EffnetDiscogsMelFrontEnd()
        val fullTrack = durationSec <= 0
        val config = AudioAnalysisConfig(
            targetSampleRate = EffnetDiscogsMelFrontEnd.SAMPLE_RATE,
            maxAnalysisDurationMs = if (fullTrack) Long.MAX_VALUE
            else durationSec.toLong() * 1000L,
        )

        val decodeStartNs = System.nanoTime()
        val pcmChunks = ArrayList<FloatArray>()
        var totalSamples = 0
        val source = try {
            PcmDecoder(context, config).decode(Uri.parse(uri)) { samples, count ->
                pcmChunks.add(samples.copyOf(count))
                totalSamples += count
            }
        } catch (e: Throwable) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "PREPROCESSING_FAILED: could not decode the track: ${e.message}",
                e,
            )
        }
        val decodeMs = (System.nanoTime() - decodeStartNs) / 1_000_000.0

        if (totalSamples == 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "PREPROCESSING_FAILED: the track decoded to zero samples.",
            )
        }

        val pcm = FloatArray(totalSamples)
        var offset = 0
        for (chunk in pcmChunks) {
            System.arraycopy(chunk, 0, pcm, offset, chunk.size)
            offset += chunk.size
        }
        pcmChunks.clear()

        // ---- PREPROCESS ----
        val prepStartNs = System.nanoTime()
        val minimum = frontEnd.minimumSamplesForOnePatch()
        if (pcm.size < minimum) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "PREPROCESSING_FAILED: the track is too short. Need at least " +
                    "${"%.2f".format(minimum.toDouble() / EffnetDiscogsMelFrontEnd.SAMPLE_RATE)} s " +
                    "for one patch. Padding with silence would make the model " +
                    "describe silence rather than this track.",
            )
        }

        val frames = frontEnd.melFrames(pcm)
        val batchMode = EffnetDiscogsModel.batchModeOf(info)
        val batch = when (batchMode) {
            is EffnetDiscogsModel.BatchMode.Dynamic -> frontEnd.toSingleBatch(frames)
            is EffnetDiscogsModel.BatchMode.Fixed ->
                frontEnd.toBatch(frames, 0, batchMode.size)
            EffnetDiscogsModel.BatchMode.Unknown ->
                frontEnd.toBatch(frames, 0, EffnetDiscogsMelFrontEnd.DEFAULT_BATCH_SIZE)
        } ?: throw InferenceException(
            InferenceErrorCode.INPUT_SHAPE_MISMATCH,
            "PREPROCESSING_FAILED: could not build a complete patch from " +
                "${frames.size} frames.",
        )
        val preprocessMs = (System.nanoTime() - prepStartNs) / 1_000_000.0

        // ---- INFER ----
        val result = try {
            runtime.infer(batch.data)
        } catch (e: InferenceException) {
            throw e
        } catch (e: Throwable) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INFERENCE_FAILED,
                "INFERENCE_FAILED: ${e.message}",
                e,
            )
        }

        // ---- POOL ----
        //
        // Mean over the REAL patches only. Averaging the zero-padded
        // tail of a fixed-batch run would drag every embedding toward
        // the origin by an amount that varies with track length.
        val embedding = meanPool(
            output = result.output,
            patches = batch.realPatchCount,
            dim = EffnetDiscogsModel.EMBEDDING_DIM,
        )

        val totalMs = (System.nanoTime() - startNs) / 1_000_000.0

        Log.i(
            TAG,
            "embedded trackId=$trackId modelId=$loadedModelId dim=${embedding.size} " +
                "patches=${batch.realPatchCount}/${batch.totalPatchCount} " +
                "decodeMs=${"%.1f".format(decodeMs)} prepMs=${"%.1f".format(preprocessMs)} " +
                "inferMs=${"%.1f".format(result.inferenceMs)}",
        )

        return JSObject().apply {
            put("trackId", trackId)
            put("modelId", loadedModelId)
            put(
                "modelVersion",
                installedModel()?.let { EffnetDiscogsModel.versionFromFileName(it) },
            )
            put("embeddingDimension", embedding.size)
            put("patchesProcessed", batch.realPatchCount)
            put("patchesAvailable", batch.totalPatchCount)
            put("sampleRate", EffnetDiscogsMelFrontEnd.SAMPLE_RATE)
            put("sourceDurationSec", source.durationUs / 1_000_000.0)
            put("processedDurationSec", pcm.size.toDouble() / EffnetDiscogsMelFrontEnd.SAMPLE_RATE)
            put("decodeMs", decodeMs)
            put("preprocessMs", preprocessMs)
            put("inferenceMs", result.inferenceMs)
            put("totalMs", totalMs)
            put("experimental", true)
            // No labels. This model does not produce any.
            put("producesLabels", false)
            put("frontEnd", MelFrontEnds.frontEndFor(loadedModelId ?: "")?.id)
            if (includeVector) {
                put(
                    "embedding",
                    JSArray().apply { embedding.forEach { put(it.toDouble()) } },
                )
            }
        }
    }

    /**
     * Mean-pools [patches] consecutive [dim]-wide rows.
     *
     * Throws rather than truncating when the output does not divide
     * evenly: a shape surprise means the graph is not what we think it
     * is, and quietly reshaping would produce a plausible vector from
     * misaligned memory.
     */
    private fun meanPool(output: FloatArray, patches: Int, dim: Int): FloatArray {
        if (patches <= 0) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INFERENCE_FAILED,
                "INFERENCE_FAILED: no real patches to pool.",
            )
        }
        if (output.size < patches * dim) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "MODEL_INCOMPATIBLE: output has ${output.size} values but " +
                    "$patches patches x $dim dimensions needs ${patches * dim}.",
            )
        }
        val out = FloatArray(dim)
        for (p in 0 until patches) {
            val base = p * dim
            for (d in 0 until dim) out[d] += output[base + d]
        }
        for (d in 0 until dim) out[d] /= patches
        return out
    }

    /** Releases the session. Safe when nothing is loaded. */
    suspend fun release(): JSObject = mutex.withLock {
        runtime.unloadModel()
        loaded = null
        loadedModelId = null
        JSObject().apply { put("released", true) }
    }
}
