package com.systema.music.inference

import com.getcapacitor.JSObject

/**
 * The Android-facing edge of [FrameEmbeddingAggregator].
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * The aggregator itself is pure arithmetic over FloatArrays. Keeping
 * Capacitor and OutputContract out of it means the pooling, the L2
 * normalisation and the failure rules can be COMPILED AND EXECUTED on
 * a plain JVM, with real assertions on real numbers, instead of only
 * being read in a diff.
 *
 * Everything here is glue: turn a result into JSON, ask the output
 * contract which tensor is the embedding. None of it does maths.
 */
object FrameEmbeddingBridge {

    /**
     * Selects the embedding tensor from a described output set.
     *
     * WHY IT IS SHAPE-BASED
     * ---------------------
     * The model name is not evidence. A file called yamnet.onnx may be
     * any graph, and identifying tensors by filename is how the
     * previous bug - reading class scores as embeddings - became
     * possible. [OutputContract] classifies by shape, and this simply
     * asks it which output is the embedding.
     *
     * Returns null when no output is confidently an embedding. The
     * caller must FAIL on null - never fall back to output index 0,
     * which for YAMNet is the 521-wide class-score tensor.
     */
    fun findEmbeddingOutput(contract: OutputContractReport?): DescribedOutput? {
        if (contract == null) return null
        return contract.outputs.firstOrNull {
            it.role == OutputRole.FRAME_EMBEDDINGS || it.role == OutputRole.SINGLE_EMBEDDING
        }
    }

    /** Serialises a track embedding for the diagnostic UI. */
    fun toJs(embedding: TrackEmbedding): JSObject = JSObject().apply {
        put("dimension", embedding.dimension)
        put("inputFrameCount", embedding.inputFrameCount)
        put("inputDimension", embedding.inputDimension)
        put("strategy", embedding.strategy.name)
        put("normalisation", embedding.normalisation.name)
        put("preNormL2", embedding.preNormL2)
        put("degenerate", embedding.degenerate)
        put("aggregationMs", embedding.aggregationMs)
        put("unitLength", embedding.isUnitLength())
        put("preview", embedding.preview())
    }
}
