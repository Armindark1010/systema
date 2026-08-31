package com.systema.music.inference.effnet

import com.systema.music.inference.InferenceErrorCode
import com.systema.music.inference.InferenceException
import com.systema.music.inference.InputFormat
import com.systema.music.inference.LoadedModelInfo
import com.systema.music.inference.ModelDescriptor
import com.systema.music.inference.TensorType

/**
 * The Discogs-EffNet embedding model, described as data.
 *
 * WHAT THIS MODEL IS
 * ------------------
 * `discogs-effnet-bs64-1` is an EMBEDDING model. It maps mel patches to
 * a 1280-d vector. It is NOT a genre classifier, NOT a mood classifier
 * and NOT a vocal detector. Those require separate classification heads
 * that consume its output.
 *
 * It does expose a second output — 400 Discogs STYLE logits
 * (`Genre---Style` strings, e.g. `Electronic---Ambient`). Those are
 * real model output, but they are a different taxonomy from
 * MTG-Jamendo genre, and this file deliberately does not surface them
 * as "genre": presenting one label set as another is exactly the kind
 * of quiet substitution Phase 29 forbids. If they are ever used, they
 * must be labelled as Discogs styles from the 400-class list.
 *
 * WHY A DESCRIPTOR AND NOT A NEW LOADER
 * -------------------------------------
 * SYSTEMA already has a complete model pipeline: ModelStorage owns the
 * directory, ModelImporter validates by genuinely loading through ONNX
 * Runtime, ModelRegistry catalogs, OnnxInferenceRuntime executes. A
 * second loader would mean a second place for path handling, validation
 * and memory lifecycle to drift. So this file adds no loading code at
 * all — it contributes a ModelDescriptor and the shape checks specific
 * to this model, and the existing machinery does the rest.
 *
 * FORMAT
 * ------
 * ONNX only. Essentia publishes `discogs-effnet-bs64-1.onnx` directly,
 * so no conversion is needed for the embedding model. A `.pb` frozen
 * TensorFlow graph CANNOT be loaded: SYSTEMA has no TensorFlow runtime,
 * and adding one would mean a second inference architecture. See
 * [rejectionReasonFor].
 */
object EffnetDiscogsModel {

    /**
     * The canonical family prefix. NOT a full model id.
     *
     * Essentia publishes several exports of the same network that
     * differ only in the batch axis — `discogs-effnet-bs64-1` and
     * `discogs-effnet-bsdynamic-1` today. The real id is whatever the
     * imported FILE is called, because that is the only thing that
     * actually identifies which export is on the device. Hardcoding
     * one would mean the other silently loads under the wrong
     * identity, and a cache keyed on model id would then serve
     * embeddings from a different graph.
     */
    const val MODEL_FAMILY = "discogs-effnet"

    /** The default export referenced in docs and error messages. */
    const val MODEL_ID = "discogs-effnet-bs64-1"

    /** Verified dynamic-batch export that executes on real hardware. */
    const val VERIFIED_MODEL_ID = "discogs-effnet-bsdynamic-1"

    const val MODEL_NAME = "EffnetDiscogs"

    /** From the official metadata JSON: version 1, released 2022-02-17. */
    const val VERSION = "1"

    /** Documented input node name. */
    const val INPUT_NAME = "serving_default_melspectrogram"

    /** Embeddings from the ONNX graph (name resolved from graph). */
    const val OUTPUT_EMBEDDINGS = "PartitionedCall:1"

    /** 400 Discogs style logits (secondary, unexposed / not mapped). */
    const val OUTPUT_STYLES = "PartitionedCall:0"

    /**
     * Verified output mapping for `discogs-effnet-bsdynamic-1`.
     * The actual ONNX graph may name outputs differently
     * (e.g. `embeddings` / `activations`). resolveOutputNames()
     * discovers the mapping from the loaded info rather than assuming
     * the literal above.
     */

    /** The embedding width every classification head consumes. */
    const val EMBEDDING_DIM = 1280

    /** Style classes on the secondary output. */
    const val STYLE_CLASS_COUNT = 400

    /** CC BY-NC-SA 4.0 — non-commercial. Blocks commercial release. */
    const val LICENSE = "CC-BY-NC-SA-4.0"

    /**
     * Builds the descriptor for a model file at [filePath].
     *
     * The shapes here are what SYSTEMA BELIEVES, taken from the official
     * metadata. They are checked against what the FILE reports at load
     * time by [verifySignature]; a disagreement is an error, never
     * something to reconcile silently.
     */
    fun descriptorFor(
        filePath: String,
        sizeBytes: Long = -1L,
        /** The installed file name; the real identity of this export. */
        fileName: String? = null,
        /**
         * Batch size the graph declares, or null for a dynamic axis.
         * -1 is emitted in the descriptor for dynamic, exactly as ORT
         * reports it, so nothing downstream mistakes it for a real 1.
         */
        batchSize: Int? = EffnetDiscogsMelFrontEnd.DEFAULT_BATCH_SIZE,
    ): ModelDescriptor {
        val id = fileName?.removeSuffix(".onnx")?.takeIf { it.isNotEmpty() } ?: MODEL_ID
        val batchAxis = batchSize?.toLong() ?: -1L
        return ModelDescriptor(
            modelId = id,
            modelName = MODEL_NAME,
            // Parsed from the file name, never assumed. "unknown" is
            // an honest value; a fabricated "1" would key the cache
            // wrongly and hide a checkpoint change.
            version = fileName?.let(::versionFromFileName) ?: VERSION,
            filePath = filePath,
            inputShape = listOf(
                batchAxis,
                EffnetDiscogsMelFrontEnd.PATCH_SIZE.toLong(),
                EffnetDiscogsMelFrontEnd.MEL_BANDS.toLong(),
            ),
            inputType = TensorType.FLOAT32,
            inputSampleRate = EffnetDiscogsMelFrontEnd.SAMPLE_RATE,
            inputChannels = 1,
            outputShape = listOf(batchAxis, EMBEDDING_DIM.toLong()),
            outputType = TensorType.FLOAT32,
            sizeBytes = sizeBytes,
            inputFormat = InputFormat.LOG_MEL_SPECTROGRAM,
        )
    }

    /** True when [model] belongs to the Discogs-EffNet family. */
    fun isEffnetDiscogs(model: ModelDescriptor): Boolean =
        isEffnetDiscogsId(model.modelId)

    /** True when [modelId] belongs to the Discogs-EffNet family. */
    fun isEffnetDiscogsId(modelId: String): Boolean =
        modelId.startsWith(MODEL_FAMILY)

    /**
     * The batch size a given export expects, or null when dynamic.
     *
     * Read from the GRAPH's declared input shape, never from the file
     * name. A file called `bsdynamic` that actually declares a fixed
     * 64 is a mislabelled file, and trusting the name would produce a
     * shape error at session run time with a misleading message.
     */
    fun batchSizeFrom(inputShape: List<Long>): Int? {
        val batch = inputShape.firstOrNull() ?: return null
        return if (batch > 0) batch.toInt() else null
    }

    /**
     * Version parsed from the official file naming convention.
     *
     * Essentia names releases `<model>-<version>`, so the trailing
     * integer is the checkpoint version. Returns null when the name
     * does not carry one — in which case the caller must record
     * "unknown" rather than inventing "1". A wrong version string is
     * worse than an absent one: cache invalidation keys on it.
     */
    fun versionFromFileName(fileName: String): String? {
        val base = fileName.removeSuffix(".onnx")
        val trailing = base.substringAfterLast('-', "")
        return trailing.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
    }

    /**
     * Why a given file cannot be used, or null when it looks usable.
     *
     * Called BEFORE any load attempt so the developer gets an
     * actionable message instead of an ONNX Runtime parse error.
     */
    fun rejectionReasonFor(fileName: String): String? {
        val lower = fileName.lowercase()
        return when {
            lower.endsWith(".pb") ->
                "'$fileName' is a TensorFlow frozen graph. SYSTEMA runs ONNX " +
                    "Runtime only, and adding TensorFlow would mean a second " +
                    "inference architecture. Essentia publishes this model as " +
                    "ONNX directly: download '$MODEL_ID.onnx' instead. No " +
                    "conversion is required for the embedding model."

            lower.endsWith(".tflite") ->
                "'$fileName' is a TensorFlow Lite model. SYSTEMA runs ONNX " +
                    "Runtime only. Download '$MODEL_ID.onnx' instead."

            lower.endsWith(".pt") || lower.endsWith(".pth") ->
                "'$fileName' is a PyTorch checkpoint. SYSTEMA runs ONNX " +
                    "Runtime only. Download '$MODEL_ID.onnx' instead."

            !lower.endsWith(".onnx") ->
                "'$fileName' is not a .onnx file. SYSTEMA loads ONNX models " +
                    "only. Download '$MODEL_ID.onnx'."

            else -> null
        }
    }

    /**
     * Checks a loaded session against the official signature.
     *
     * WHY THIS IS NOT OPTIONAL
     * ------------------------
     * If a differently-shaped model is loaded under this id, the mel
     * tensor still feeds in and numbers still come out. The embeddings
     * would be wrong in a way nothing downstream can detect. So the
     * width is verified against [EMBEDDING_DIM] and a mismatch is a
     * hard failure.
     *
     * The batch/patch axes are checked leniently because an exporter
     * may legitimately mark them dynamic (-1); the FEATURE axis is
     * checked strictly because it is the model's identity.
     */
    fun verifySignature(info: LoadedModelInfo) {
        // RESOLVE OUTPUT NAMES FROM THE ACTUAL GRAPH, NOT FROM ASSUMED LITERALS.
        val embeddingCandidate = info.outputs.filter {
            it.name == OUTPUT_EMBEDDINGS || it.name.equals("embeddings", ignoreCase = true)
        }.firstOrNull()
            ?: info.outputs.firstOrNull { it.shape.lastOrNull()?.toInt() == EMBEDDING_DIM }

        val secondaryCandidate = info.outputs.filter {
            it.name == OUTPUT_STYLES || it.name.equals("activations", ignoreCase = true)
                || it.name.equals("styles", ignoreCase = true)
        }.firstOrNull()
            ?: info.outputs.firstOrNull { it.shape.lastOrNull()?.toInt() == STYLE_CLASS_COUNT }

        val resolvedEmbeddingName = embeddingCandidate?.name ?: "<not found>"
        val resolvedSecondaryName = secondaryCandidate?.name ?: "<not found>"

        if (embeddingCandidate == null) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "No ${EMBEDDING_DIM}-d embedding output found in ${info.modelId}. Outputs: ${info.outputs.joinToString { "${it.name}${it.shape}" }}. Expected width $EMBEDDING_DIM (embeddings/PartitionedCall:1). Not $VERIFIED_MODEL_ID.",
            )
        }

        val width = embeddingCandidate.shape.lastOrNull()?.toInt()
        if (width != EMBEDDING_DIM) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "Embedding '$resolvedEmbeddingName' is $width-d, expected $EMBEDDING_DIM. Mapped secondary: $resolvedSecondaryName.",
            )
        }

        // Secondary output = 400-d (unexposed / not mapped). Must never become genre.
        if (secondaryCandidate != null) {
            val secWidth = secondaryCandidate.shape.lastOrNull()?.toInt()
            if (secWidth != STYLE_CLASS_COUNT) {
                throw InferenceException(
                    InferenceErrorCode.MODEL_INVALID,
                    "Secondary '$resolvedSecondaryName' width $secWidth != $STYLE_CLASS_COUNT.",
                )
            }
        }

        val melBands = info.inputs.firstOrNull()?.shape?.lastOrNull()?.toInt()
        if (melBands != null && melBands > 0 && melBands != EffnetDiscogsMelFrontEnd.MEL_BANDS) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Model expects $melBands mel bands but front end produces ${EffnetDiscogsMelFrontEnd.MEL_BANDS}.",
            )
        }

        val shape = info.inputs.firstOrNull()?.shape
        if (shape != null && shape.size >= 3) {
            val frames = shape[shape.size - 2].toInt()
            if (frames > 0 && frames != EffnetDiscogsMelFrontEnd.PATCH_SIZE) {
                throw InferenceException(
                    InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                    "Model expects $frames frames per patch but front end produces ${EffnetDiscogsMelFrontEnd.PATCH_SIZE}.",
                )
            }
        }
    }

    /**
     * How this export handles batching, read from the loaded graph.
     *
     * Reported so the caller can choose between one session run for
     * the whole track (dynamic) and fixed-size padded batches (bs64).
     */
    fun batchModeOf(info: LoadedModelInfo): BatchMode {
        val batch = info.inputs.firstOrNull()?.shape?.firstOrNull()
        return when {
            batch == null -> BatchMode.Unknown
            batch <= 0L -> BatchMode.Dynamic
            else -> BatchMode.Fixed(batch.toInt())
        }
    }

    /** Batch behaviour of a loaded graph. */
    sealed interface BatchMode {
        /** Any batch size accepted — `bsdynamic`. One run per track. */
        data object Dynamic : BatchMode

        /** Exactly [size] patches per run — `bs64`. Pad the last batch. */
        data class Fixed(val size: Int) : BatchMode

        /** The graph did not report a shape. Treat as fixed-default. */
        data object Unknown : BatchMode
    }

    /**
     * PCM -> the flat mel tensor for batch 0.
     *
     * Called from ModelInputPreparer, which owns format dispatch. This
     * returns only the FIRST batch: a full multi-batch walk belongs to
     * the analysis service, which knows how many patches it wants to
     * average and can release memory between batches.
     *
     * @throws InferenceException when the audio is too short for one
     *   patch. Zero-padding to make a batch would mean running the
     *   model on silence and reporting the result as a property of the
     *   track.
     */
    fun prepareMel(
        pcm: FloatArray,
        pcmSampleRate: Int,
        model: ModelDescriptor,
    ): PatchBatch {
        val expected = model.inputSampleRate ?: EffnetDiscogsMelFrontEnd.SAMPLE_RATE
        if (pcmSampleRate != expected) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Discogs-EffNet requires $expected Hz mono PCM but received " +
                    "$pcmSampleRate Hz. The decoder must resample before this " +
                    "point; resampling here would hide a configuration error.",
            )
        }

        val frontEnd = EffnetDiscogsMelFrontEnd()
        val minimum = frontEnd.minimumSamplesForOnePatch()
        if (pcm.size < minimum) {
            val seconds = minimum.toDouble() / expected
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Need at least $minimum samples (${"%.2f".format(seconds)} s) for one " +
                    "patch; got ${pcm.size}. Padding with silence would make the " +
                    "model describe silence, not this track.",
            )
        }

        val frames = frontEnd.melFrames(pcm)
        val declared = batchSizeFrom(model.inputShape)
        val batch = (
            if (declared == null) frontEnd.toSingleBatch(frames)
            else frontEnd.toBatch(frames, batchIndex = 0, batchSize = declared)
            )
            ?: throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Could not build a complete patch from ${frames.size} frames.",
            )

        return batch
    }
}
