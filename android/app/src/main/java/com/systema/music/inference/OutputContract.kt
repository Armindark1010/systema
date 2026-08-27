package com.systema.music.inference

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject

/**
 * Explains what a model's outputs actually are.
 *
 * WHY THIS EXISTS
 * ---------------
 * A benchmark reported "out dim 208921" for YAMNet. That number was
 * not an embedding dimension, was not an embedding at all, and could
 * not be interpreted from anything the UI displayed. It was
 * 401 frames x 521 AudioSet classes, flattened - the CLASS SCORE
 * tensor, because the runtime reads `results.get(0)` and YAMNet
 * declares class scores first.
 *
 * The failure was not the number. It was that a single unlabelled
 * integer was presented as if it described an embedding, and nothing
 * in the pipeline could contradict it. This class makes the tensor
 * contract explicit so that cannot recur silently.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It does not change which output is read, does not pool frames, and
 * does not rename an existing measurement. It describes. Every
 * classification below is derived from the SHAPE the session returned,
 * never from a model name, and anything it cannot justify is reported
 * as UNKNOWN.
 */
object OutputContract {

    /**
     * YAMNet's AudioSet ontology size.
     *
     * Used ONLY as corroboration when a trailing dimension is exactly
     * 521 - never to assert that a model is YAMNet. A 521-wide output
     * is strong evidence of AudioSet class scores because that is the
     * ontology's published size; it is not proof of the architecture.
     */
    const val AUDIOSET_CLASS_COUNT = 521L

    /** YAMNet's published embedding width. Same caveat as above. */
    const val YAMNET_EMBEDDING_DIM = 1024L

    /** YAMNet's published mel band count. Same caveat. */
    const val YAMNET_MEL_BANDS = 64L

    /**
     * Describes every output of a run.
     *
     * @param outputs resolved shapes from the session
     * @param selectedIndex which one the runtime actually read
     */
    fun describe(
        outputs: List<TensorSignature>,
        selectedIndex: Int,
        selectedElementCount: Int,
    ): OutputContractReport {
        val described = outputs.mapIndexed { i, sig ->
            DescribedOutput(
                index = i,
                name = sig.name,
                shape = sig.shape,
                type = sig.type,
                elementCount = sig.shape.takeIf { it.isNotEmpty() && it.all { d -> d > 0 } }
                    ?.fold(1L) { a, b -> a * b },
                role = classify(sig),
                meaning = meaningOf(sig),
                selected = i == selectedIndex,
            )
        }

        val embedding = described.firstOrNull { it.role == OutputRole.FRAME_EMBEDDINGS }
        val selected = described.getOrNull(selectedIndex)

        // Frame count is the LEADING dimension of a 2-D framed output.
        // Read, never assumed: it is what makes the arithmetic below
        // reproducible rather than a story.
        val frameCount = embedding?.shape?.takeIf { it.size == 2 }?.firstOrNull()
            ?: selected?.shape?.takeIf { it.size == 2 }?.firstOrNull()

        val embeddingDim = embedding?.shape?.takeIf { it.size == 2 }?.lastOrNull()

        return OutputContractReport(
            outputs = described,
            selectedIndex = selectedIndex,
            selectedName = selected?.name,
            selectedRole = selected?.role ?: OutputRole.UNKNOWN,
            embeddingOutputIndex = embedding?.index,
            embeddingOutputName = embedding?.name,
            frameCount = frameCount,
            embeddingDimension = embeddingDim,
            rawOutputElements = selectedElementCount,
            currentOutputDimension = selectedElementCount,
            isSingleEmbeddingVector = isSingleVector(selected),
            explanation = explain(selected, frameCount, selectedElementCount, embedding),
            aggregationRequired = embedding != null &&
                (frameCount == null || frameCount > 1),
        )
    }

    /**
     * Classifies one output from its SHAPE alone.
     *
     * Deliberately conservative. A trailing dimension of 1024 is
     * evidence of an embedding, not proof, so the role names describe
     * what the tensor looks like rather than asserting the
     * architecture that produced it. Anything unrecognised is
     * UNKNOWN - never defaulted to "embedding", which is the mistake
     * that made 208921 look meaningful.
     */
    fun classify(sig: TensorSignature): OutputRole {
        val shape = sig.shape
        if (shape.size != 2) {
            return if (shape.size == 1 && shape.firstOrNull() == YAMNET_EMBEDDING_DIM) {
                OutputRole.SINGLE_EMBEDDING
            } else {
                OutputRole.UNKNOWN
            }
        }
        return when (shape[1]) {
            AUDIOSET_CLASS_COUNT -> OutputRole.CLASS_SCORES
            YAMNET_EMBEDDING_DIM -> OutputRole.FRAME_EMBEDDINGS
            YAMNET_MEL_BANDS -> OutputRole.LOG_MEL_SPECTROGRAM
            else -> OutputRole.UNKNOWN
        }
    }

    private fun meaningOf(sig: TensorSignature): String {
        val frames = sig.shape.takeIf { it.size == 2 }?.firstOrNull()
        val n = frames?.takeIf { it > 0 }?.toString() ?: "N"
        return when (classify(sig)) {
            OutputRole.CLASS_SCORES ->
                "Per-frame AudioSet class scores: $n frames x $AUDIOSET_CLASS_COUNT " +
                    "classes. A 521-wide output matches the published AudioSet " +
                    "ontology size. NOT an embedding."

            OutputRole.FRAME_EMBEDDINGS ->
                "Per-frame embeddings: $n frames x $YAMNET_EMBEDDING_DIM. This is the " +
                    "tensor a similarity system would use, after pooling frames into " +
                    "one track-level vector."

            OutputRole.LOG_MEL_SPECTROGRAM ->
                "Log-mel spectrogram computed INSIDE the graph: $n frames x " +
                    "$YAMNET_MEL_BANDS bands. Its presence is what confirms the mel " +
                    "front end is in-graph, so raw waveform input is correct."

            OutputRole.SINGLE_EMBEDDING ->
                "A single ${sig.shape.firstOrNull()}-dimensional embedding vector."

            OutputRole.UNKNOWN ->
                "UNKNOWN. SYSTEMA will not guess what this tensor represents from " +
                    "its shape ${sig.shape}."
        }
    }

    /** True only for a genuine 1-D vector, or [1, d]. */
    private fun isSingleVector(out: DescribedOutput?): Boolean {
        val shape = out?.shape ?: return false
        return when (shape.size) {
            1 -> shape[0] > 0
            2 -> shape[0] == 1L
            else -> false
        }
    }

    /**
     * States the arithmetic behind the reported element count.
     *
     * The output is deliberately literal - "401 x 521 = 208921" -
     * because the value of this diagnostic is that a reader can check
     * it against the shape themselves.
     */
    private fun explain(
        selected: DescribedOutput?,
        frameCount: Long?,
        elements: Int,
        embedding: DescribedOutput?,
    ): String {
        if (selected == null) {
            return "No output was described, so $elements cannot be explained. " +
                "Treat it as UNKNOWN."
        }

        val shape = selected.shape
        val product = if (shape.isNotEmpty() && shape.all { it > 0 }) {
            shape.fold(1L) { a, b -> a * b }
        } else {
            null
        }

        val arithmetic = if (shape.size == 2 && product != null) {
            "${shape[0]} x ${shape[1]} = $product"
        } else if (product != null) {
            "$shape -> $product"
        } else {
            "shape $shape contains a dimension the runtime did not resolve"
        }

        val head = "The reported figure $elements is the FLATTENED ELEMENT COUNT of " +
            "'${selected.name}' (index ${selected.index}), whose runtime shape is " +
            "$shape: $arithmetic."

        val consistency = when {
            product == null -> " The shape could not be fully resolved, so this " +
                "cannot be cross-checked."
            product == elements.toLong() -> " That matches the returned buffer exactly."
            else -> " WARNING: the shape implies $product elements but the buffer " +
                "holds $elements. Those disagree and the result should not be trusted."
        }

        val role = when (selected.role) {
            OutputRole.CLASS_SCORES ->
                " It is a CLASS SCORE tensor, not an embedding. Reading it as an " +
                    "'embedding dimension' is a category error: the number scales " +
                    "with track length and with the ontology size, so it says " +
                    "nothing about embedding width."

            OutputRole.FRAME_EMBEDDINGS ->
                " These are PER-FRAME embeddings. The flattened count is " +
                    "frames x width, not an embedding dimension - a track-level " +
                    "vector requires pooling across frames first."

            OutputRole.LOG_MEL_SPECTROGRAM ->
                " It is the log-mel spectrogram, an intermediate feature, not a " +
                    "model output anyone should benchmark as an embedding."

            OutputRole.SINGLE_EMBEDDING ->
                " This IS a single embedding vector, so the element count and the " +
                    "embedding dimension coincide here."

            OutputRole.UNKNOWN ->
                " Its role could not be determined from its shape, so the count " +
                    "carries no semantic meaning."
        }

        val alt = if (embedding != null && !selected.selectedIsEmbedding()) {
            " The embedding tensor is '${embedding.name}' (index ${embedding.index}), " +
                "shape ${embedding.shape}, which this run did NOT read."
        } else {
            ""
        }

        val pooling = if (frameCount != null && frameCount > 1 && embedding != null) {
            " A track-level embedding would require pooling $frameCount frames into " +
                "one ${embedding.shape.lastOrNull()}-dimensional vector. That " +
                "aggregation is NOT implemented."
        } else {
            ""
        }

        return head + consistency + role + alt + pooling
    }

    private fun DescribedOutput.selectedIsEmbedding(): Boolean =
        role == OutputRole.FRAME_EMBEDDINGS || role == OutputRole.SINGLE_EMBEDDING
}

/**
 * What a tensor appears to be, judged from its shape.
 *
 * These name what the tensor LOOKS like. None of them asserts an
 * architecture, and UNKNOWN is a first-class outcome rather than a
 * failure to be papered over.
 */
enum class OutputRole {
    /** Trailing dim matches the AudioSet ontology size. */
    CLASS_SCORES,

    /** [frames, 1024]: per-frame embeddings, needing pooling. */
    FRAME_EMBEDDINGS,

    /** A genuine single embedding vector. */
    SINGLE_EMBEDDING,

    /** [frames, 64]: an in-graph log-mel front end. */
    LOG_MEL_SPECTROGRAM,

    /** Not classifiable from its shape. Never guessed. */
    UNKNOWN,
}

data class DescribedOutput(
    val index: Int,
    val name: String,
    val shape: List<Long>,
    val type: String,
    val elementCount: Long?,
    val role: OutputRole,
    val meaning: String,
    val selected: Boolean,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("index", index)
        put("name", name)
        put("shape", JSArray(shape.toTypedArray()))
        put("type", type)
        put("elementCount", elementCount)
        put("role", role.name)
        put("meaning", meaning)
        put("selected", selected)
    }
}

data class OutputContractReport(
    val outputs: List<DescribedOutput>,
    val selectedIndex: Int,
    val selectedName: String?,
    val selectedRole: OutputRole,
    /** Index of the embedding tensor, when one is recognisable. */
    val embeddingOutputIndex: Int?,
    val embeddingOutputName: String?,
    /** Resolved leading dimension. Null when it could not be read. */
    val frameCount: Long?,
    /** Width of ONE frame's embedding. Not the flattened count. */
    val embeddingDimension: Long?,
    val rawOutputElements: Int,
    val currentOutputDimension: Int,
    /** True only when the selected output really is one vector. */
    val isSingleEmbeddingVector: Boolean,
    val explanation: String,
    /** True when frames would have to be pooled for a track vector. */
    val aggregationRequired: Boolean,
) {
    fun toJs(): JSObject = JSObject().apply {
        val arr = JSArray()
        outputs.forEach { arr.put(it.toJs()) }
        put("outputs", arr)
        put("selectedIndex", selectedIndex)
        put("selectedName", selectedName)
        put("selectedRole", selectedRole.name)
        put("embeddingOutputIndex", embeddingOutputIndex)
        put("embeddingOutputName", embeddingOutputName)
        put("frameCount", frameCount)
        put("embeddingDimension", embeddingDimension)
        put("rawOutputElements", rawOutputElements)
        put("currentOutputDimension", currentOutputDimension)
        put("isSingleEmbeddingVector", isSingleEmbeddingVector)
        put("explanation", explanation)
        put("aggregationRequired", aggregationRequired)
    }
}
