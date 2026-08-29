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

    /** Model id, matching the official file name without extension. */
    const val MODEL_ID = "discogs-effnet-bs64-1"

    const val MODEL_NAME = "EffnetDiscogs"

    /** From the official metadata JSON: version 1, released 2022-02-17. */
    const val VERSION = "1"

    /** Documented input node name. */
    const val INPUT_NAME = "serving_default_melspectrogram"

    /** Embeddings. NOT PartitionedCall:0, which is 400 style logits. */
    const val OUTPUT_EMBEDDINGS = "PartitionedCall:1"

    /** 400 Discogs style logits. Real, but a different taxonomy. */
    const val OUTPUT_STYLES = "PartitionedCall:0"

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
    fun descriptorFor(filePath: String, sizeBytes: Long = -1L): ModelDescriptor =
        ModelDescriptor(
            modelId = MODEL_ID,
            modelName = MODEL_NAME,
            version = VERSION,
            filePath = filePath,
            inputShape = listOf(
                EffnetDiscogsMelFrontEnd.BATCH_SIZE.toLong(),
                EffnetDiscogsMelFrontEnd.PATCH_SIZE.toLong(),
                EffnetDiscogsMelFrontEnd.MEL_BANDS.toLong(),
            ),
            inputType = TensorType.FLOAT32,
            inputSampleRate = EffnetDiscogsMelFrontEnd.SAMPLE_RATE,
            inputChannels = 1,
            outputShape = listOf(
                EffnetDiscogsMelFrontEnd.BATCH_SIZE.toLong(),
                EMBEDDING_DIM.toLong(),
            ),
            outputType = TensorType.FLOAT32,
            sizeBytes = sizeBytes,
            inputFormat = InputFormat.LOG_MEL_SPECTROGRAM,
        )

    /** True when [model] is this model, by id. */
    fun isEffnetDiscogs(model: ModelDescriptor): Boolean =
        model.modelId == MODEL_ID || model.modelId.startsWith("discogs-effnet")

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
        val embedding = info.outputs.firstOrNull { it.name == OUTPUT_EMBEDDINGS }
            ?: info.outputs.firstOrNull { it.shape.lastOrNull()?.toInt() == EMBEDDING_DIM }

        if (embedding == null) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "No ${EMBEDDING_DIM}-d embedding output found in ${info.modelId}. " +
                    "Outputs present: ${info.outputs.joinToString { "${it.name}${it.shape}" }}. " +
                    "Expected '$OUTPUT_EMBEDDINGS' with shape [batch, $EMBEDDING_DIM]. " +
                    "This is probably not $MODEL_ID.",
            )
        }

        val width = embedding.shape.lastOrNull()?.toInt()
        if (width != EMBEDDING_DIM) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INVALID,
                "Embedding output '${embedding.name}' is $width-d, expected " +
                    "$EMBEDDING_DIM. The classification heads consume a " +
                    "${EMBEDDING_DIM}-d vector; a different width means this is a " +
                    "different model, not a compatible one.",
            )
        }

        val melBands = info.inputs.firstOrNull()?.shape?.lastOrNull()?.toInt()
        if (melBands != null && melBands > 0 &&
            melBands != EffnetDiscogsMelFrontEnd.MEL_BANDS
        ) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Model expects $melBands mel bands but the front end produces " +
                    "${EffnetDiscogsMelFrontEnd.MEL_BANDS}. Feeding a mismatched " +
                    "filterbank would produce meaningless embeddings.",
            )
        }
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
    ): FloatArray {
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
        val batch = frontEnd.toBatch(frames, batchIndex = 0)
            ?: throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Could not build a complete patch from ${frames.size} frames.",
            )

        return batch.data
    }
}
