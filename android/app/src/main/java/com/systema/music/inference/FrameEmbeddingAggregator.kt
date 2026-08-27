package com.systema.music.inference

/**
 * Collapses a per-frame embedding matrix into ONE track-level vector.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A framed audio model emits one embedding per analysis window. For a
 * three-minute track that is hundreds of vectors:
 *
 *     [N, D]  ->  aggregation  ->  [D]  ->  L2 normalise
 *
 * A similarity system needs one vector per track, so those frames
 * must be pooled. Which pooling to use is a real decision with real
 * consequences, so it is a selectable STRATEGY here rather than a
 * hardcoded mean.
 *
 * WHY THIS KNOWS NOTHING ABOUT YAMNET
 * -----------------------------------
 * It takes N and D as parameters and never looks at a model id. The
 * same code aggregates a 1024-wide YAMNet tensor, a 512-wide OpenL3
 * tensor, or anything else. Baking "1024" in here would make swapping
 * candidates a code change, which is exactly what Phase 15's
 * abstraction exists to prevent.
 *
 * WHY IT KNOWS NOTHING ABOUT ANDROID EITHER
 * -----------------------------------------
 * This file imports nothing from Capacitor, Android or ONNX. That is
 * deliberate: it makes the arithmetic runnable, and therefore
 * ASSERTABLE, on a plain JVM. Bridge concerns (serialising a result
 * to JSON, reading an OutputContract) live in
 * FrameEmbeddingBridge.kt, which is compiled only for the app.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It will not accept a matrix whose dimensions do not match its
 * element count, will not silently repair NaN or infinity, and will
 * not pretend a zero vector was normalised. Each of those is a loud
 * failure or an explicit flag, because a track embedding that is
 * quietly wrong is undetectable downstream - every later similarity
 * score would be confidently meaningless.
 *
 * NO QUALITY CLAIM IS MADE HERE. Mean pooling is the BASELINE. It has
 * not been shown to be the best choice for music similarity, and
 * nothing in this file should be read as saying it is.
 */
object FrameEmbeddingAggregator {

    /**
     * Tolerance for the "is this L2-normalised" self-check.
     *
     * A float32 dot product over 1024 terms accumulates rounding
     * error, so an exact 1.0 is not achievable. 1e-4 is far tighter
     * than any real drift while still catching a genuine bug.
     */
    const val NORM_TOLERANCE = 1e-4

    /**
     * Aggregates [frames] (row-major [N, D]) into one vector.
     *
     * @param frames flattened frame matrix, length must equal N * D
     * @param frameCount N, the number of frames
     * @param dimension D, the width of one frame's embedding
     * @param strategy how to pool across frames
     * @param normalise whether to L2-normalise the pooled vector
     *
     * @throws InferenceException on any shape or numeric violation
     */
    fun aggregate(
        frames: FloatArray,
        frameCount: Int,
        dimension: Int,
        strategy: AggregationStrategy = AggregationStrategy.MEAN,
        normalise: Boolean = true,
    ): TrackEmbedding {
        val startNs = System.nanoTime()

        // ---- SHAPE VALIDATION ----
        if (frameCount <= 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Cannot aggregate $frameCount frames. A track embedding needs at " +
                    "least one frame.",
            )
        }
        if (dimension <= 0) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Embedding dimension must be positive, got $dimension.",
            )
        }
        val expected = frameCount.toLong() * dimension.toLong()
        if (frames.size.toLong() != expected) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Frame buffer holds ${frames.size} floats but shape " +
                    "[$frameCount, $dimension] requires $expected. Refusing to " +
                    "reshape: a mismatched buffer means the wrong tensor was " +
                    "passed, and reinterpreting it would produce a plausible " +
                    "embedding from the wrong data.",
            )
        }

        // ---- NUMERIC VALIDATION ----
        // Checked BEFORE pooling. One NaN anywhere makes the mean of
        // its entire column NaN, and that single poisoned dimension
        // propagates into every cosine similarity the vector ever
        // takes part in. Far better to fail here, where the cause is
        // still visible.
        var nonFinite = 0
        for (v in frames) {
            if (!v.isFinite()) nonFinite++
        }
        if (nonFinite > 0) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INFERENCE_FAILED,
                "The frame embeddings contain $nonFinite non-finite value(s) " +
                    "(NaN or infinity) out of ${frames.size}. Refusing to aggregate: " +
                    "a single NaN would poison the whole track embedding and every " +
                    "similarity computed from it.",
            )
        }

        val pooled = when (strategy) {
            AggregationStrategy.MEAN -> meanPool(frames, frameCount, dimension)
            AggregationStrategy.MEAN_STD -> meanStdPool(frames, frameCount, dimension)
        }

        val rawNorm = l2Norm(pooled)
        val degenerate = rawNorm <= 0.0

        val finalVector = if (normalise) {
            l2Normalise(pooled, rawNorm)
        } else {
            pooled
        }

        val aggregationMs = (System.nanoTime() - startNs) / 1_000_000.0

        return TrackEmbedding(
            vector = finalVector,
            dimension = finalVector.size,
            inputFrameCount = frameCount,
            inputDimension = dimension,
            strategy = strategy,
            normalisation = if (normalise) Normalisation.L2 else Normalisation.NONE,
            preNormL2 = rawNorm,
            degenerate = degenerate,
            aggregationMs = aggregationMs,
        )
    }

    /**
     * Column-wise arithmetic mean. THE BASELINE, not a recommendation.
     *
     * Accumulates in Double. Summing hundreds of float32 values in
     * float32 loses low-order bits progressively; the Double
     * accumulator costs one temporary array of D and removes the
     * question entirely.
     *
     * Allocates exactly ONE array of size D and walks the input once,
     * so a [401, 1024] tensor is never duplicated (see the memory
     * discipline note in the phase brief).
     */
    fun meanPool(frames: FloatArray, frameCount: Int, dimension: Int): FloatArray {
        val sums = DoubleArray(dimension)
        var offset = 0
        repeat(frameCount) {
            for (d in 0 until dimension) {
                sums[d] += frames[offset + d]
            }
            offset += dimension
        }
        val out = FloatArray(dimension)
        for (d in 0 until dimension) {
            out[d] = (sums[d] / frameCount).toFloat()
        }
        return out
    }

    /**
     * Mean concatenated with population standard deviation.
     *
     * OUTPUT IS 2D WIDE, NOT D. That is stated everywhere this
     * strategy appears and is never presented as interchangeable with
     * the mean baseline: a 2048-dimensional vector cannot be compared
     * against a 1024-dimensional one, and quietly changing the width
     * would break any store built on the earlier contract.
     *
     * Uses the two-pass form. The one-pass "sum of squares minus
     * square of sum" shortcut is faster but catastrophically
     * cancellation-prone when the mean is large relative to the
     * spread, which is a real risk for embedding activations.
     *
     * Population (N), not sample (N-1): this describes the frames of
     * THIS track, not an estimate of some wider population. With a
     * single frame the deviation is exactly zero, which is correct and
     * avoids a divide-by-zero.
     */
    fun meanStdPool(frames: FloatArray, frameCount: Int, dimension: Int): FloatArray {
        val mean = meanPool(frames, frameCount, dimension)

        val varianceAcc = DoubleArray(dimension)
        var offset = 0
        repeat(frameCount) {
            for (d in 0 until dimension) {
                val delta = frames[offset + d] - mean[d].toDouble()
                varianceAcc[d] += delta * delta
            }
            offset += dimension
        }

        val out = FloatArray(dimension * 2)
        mean.copyInto(out, 0)
        for (d in 0 until dimension) {
            // Guard the sqrt: accumulated rounding can leave a tiny
            // negative where the true variance is zero.
            val variance = (varianceAcc[d] / frameCount).coerceAtLeast(0.0)
            out[dimension + d] = kotlin.math.sqrt(variance).toFloat()
        }
        return out
    }

    /** Euclidean norm, accumulated in Double for the same reason. */
    fun l2Norm(vector: FloatArray): Double {
        var acc = 0.0
        for (v in vector) acc += v.toDouble() * v.toDouble()
        return kotlin.math.sqrt(acc)
    }

    /**
     * Scales a vector to unit length.
     *
     * ZERO-VECTOR BEHAVIOUR, STATED EXPLICITLY
     * ----------------------------------------
     * A zero vector has no direction, so it has no unit form. There
     * are three options and only one is honest:
     *
     *   - divide anyway  -> NaN, which silently corrupts everything
     *   - add an epsilon -> returns a near-zero vector that LOOKS
     *                       normalised but is not, hiding the problem
     *   - return zeros   -> stays zero, and the caller is told
     *
     * This returns the zero vector unchanged and the result carries
     * `degenerate = true`. No epsilon is added anywhere. A zero
     * embedding means something upstream produced silence or failed,
     * and that must stay visible rather than being smoothed over.
     */
    fun l2Normalise(vector: FloatArray, precomputedNorm: Double? = null): FloatArray {
        val norm = precomputedNorm ?: l2Norm(vector)
        if (norm <= 0.0 || !norm.isFinite()) {
            // Deterministic: a zero vector in gives a zero vector out.
            return FloatArray(vector.size)
        }
        val scale = 1.0 / norm
        val out = FloatArray(vector.size)
        for (i in vector.indices) {
            out[i] = (vector[i] * scale).toFloat()
        }
        return out
    }

}

/**
 * How frames are collapsed into one vector.
 *
 * MEAN is the default and the baseline. That is a starting point,
 * not a finding: no evaluation has compared these on real music.
 */
enum class AggregationStrategy {
    /** Column-wise mean. Output width = D. */
    MEAN,

    /** Mean concatenated with population std. Output width = 2 * D. */
    MEAN_STD,
    ;

    /** Output width for an input of width [dimension]. */
    fun outputDimension(dimension: Int): Int = when (this) {
        MEAN -> dimension
        MEAN_STD -> dimension * 2
    }
}

enum class Normalisation { L2, NONE }

/**
 * One track-level embedding, with everything needed to interpret it.
 *
 * The provenance fields are not decoration. A bare 1024-float array
 * cannot be compared safely against another unless you know it came
 * from the same strategy and the same normalisation - and
 * [degenerate] marks the vectors that must not be compared at all.
 */
data class TrackEmbedding(
    val vector: FloatArray,
    /** Width of [vector]. For MEAN_STD this is 2x the input width. */
    val dimension: Int,
    val inputFrameCount: Int,
    val inputDimension: Int,
    val strategy: AggregationStrategy,
    val normalisation: Normalisation,
    /** L2 norm BEFORE normalising. Zero means a degenerate input. */
    val preNormL2: Double,
    /**
     * True when the pooled vector had zero magnitude.
     *
     * Such a vector is returned as all zeros rather than NaN, and it
     * must not be used for similarity: every cosine against it is
     * undefined, not "zero similarity".
     */
    val degenerate: Boolean,
    val aggregationMs: Double,
) {
    /**
     * First [count] components, for eyeballing in a diagnostic view.
     *
     * A preview only. The full vector is deliberately never sent
     * across the bridge: 1024 floats per track through JSON, for a
     * figure nobody reads digit by digit, is pure overhead.
     */
    fun preview(count: Int = 8): String =
        vector.take(count).joinToString(", ") { String.format("%.5f", it) }

    /** Verifies the unit-length property actually holds. */
    fun isUnitLength(tolerance: Double = FrameEmbeddingAggregator.NORM_TOLERANCE): Boolean {
        if (degenerate) return false
        val n = FrameEmbeddingAggregator.l2Norm(vector)
        return kotlin.math.abs(n - 1.0) <= tolerance
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TrackEmbedding) return false
        return vector.contentEquals(other.vector) &&
            dimension == other.dimension &&
            inputFrameCount == other.inputFrameCount &&
            inputDimension == other.inputDimension &&
            strategy == other.strategy &&
            normalisation == other.normalisation &&
            degenerate == other.degenerate
    }

    override fun hashCode(): Int {
        var result = vector.contentHashCode()
        result = 31 * result + dimension
        result = 31 * result + inputFrameCount
        result = 31 * result + inputDimension
        result = 31 * result + strategy.hashCode()
        result = 31 * result + normalisation.hashCode()
        result = 31 * result + degenerate.hashCode()
        return result
    }
}
