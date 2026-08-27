package com.systema.music.inference

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Cosine similarity and descriptive statistics over track embeddings.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Phase 16A produces one 1024-d L2-normalised vector per track. This
 * file answers the only question that matters next: do those vectors
 * arrange themselves in a way that could support music similarity?
 *
 * It computes GEOMETRY. It does not compute quality. A tight cluster
 * of similarities proves the vectors are close together, not that the
 * tracks sound alike, and nothing in this file will ever claim
 * otherwise.
 *
 * WHY IT KNOWS NOTHING ABOUT ANDROID
 * ----------------------------------
 * No Capacitor, no Android, no ONNX imports - the same discipline as
 * FrameEmbeddingAggregator, and for the same reason: it makes the
 * arithmetic executable, and therefore assertable, on a plain JVM.
 * Every statistic below is verified by running it, not by reading it.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It rejects vectors of differing length, rejects non-finite values,
 * and rejects vectors that are not unit length. Each refusal is loud.
 * A similarity score computed from a malformed vector is still a
 * number between -1 and 1, which is exactly what makes it dangerous:
 * nothing downstream could tell it apart from a real one.
 */
object EmbeddingSimilarity {

    /**
     * How far a norm may drift from 1.0 before a vector is rejected.
     *
     * Shared with the aggregator on purpose. If the two disagreed, a
     * vector could be normalised by one standard and refused by the
     * other, which would be a confusing bug to chase.
     */
    const val NORM_TOLERANCE = FrameEmbeddingAggregator.NORM_TOLERANCE

    /**
     * Cosine similarity between two L2-normalised vectors.
     *
     * WHY THIS IS JUST A DOT PRODUCT
     * ------------------------------
     * cos(a,b) = dot(a,b) / (|a| * |b|). When both vectors are unit
     * length the denominator is 1, so the division is skipped.
     *
     * That shortcut is only valid if the inputs really are normalised,
     * so [requireUnitLength] verifies it rather than assuming it. The
     * alternative - dividing by the measured norms - would silently
     * "work" on unnormalised input and hide a broken pipeline
     * upstream. The whole point of Phase 17 is to detect that class of
     * problem, not to paper over it.
     *
     * @throws InferenceException on mismatched length, non-finite
     *   values, or a norm outside [NORM_TOLERANCE] of 1.0
     */
    fun cosine(a: FloatArray, b: FloatArray): Double {
        if (a.size != b.size) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Cannot compare a ${a.size}-d embedding with a ${b.size}-d one. " +
                    "Refusing to pad, truncate or reshape: vectors of different " +
                    "width come from different models or different pooling " +
                    "strategies, and a similarity between them is meaningless.",
            )
        }
        if (a.isEmpty()) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Cannot compute similarity between empty vectors.",
            )
        }

        requireUnitLength(a, "first")
        requireUnitLength(b, "second")

        // Double accumulator: 1024 float32 products summed in float32
        // lose low-order bits, and this number is compared against
        // others at four decimal places.
        var dot = 0.0
        for (i in a.indices) {
            dot += a[i].toDouble() * b[i].toDouble()
        }

        // Rounding can push a genuinely identical pair a hair past
        // 1.0. Clamping keeps the contract "cosine is in [-1, 1]"
        // exactly true, which downstream statistics rely on.
        return dot.coerceIn(-1.0, 1.0)
    }

    /** Euclidean norm, accumulated in Double. */
    fun l2Norm(vector: FloatArray): Double {
        var acc = 0.0
        for (v in vector) acc += v.toDouble() * v.toDouble()
        return sqrt(acc)
    }

    /**
     * Verifies a vector is finite and unit length.
     *
     * Both checks live together because both have the same
     * consequence: the dot-product shortcut stops being cosine
     * similarity. A NaN propagates into every statistic computed from
     * it; a norm of 0.5 halves every score involving that track.
     */
    fun requireUnitLength(vector: FloatArray, label: String = "embedding") {
        var nonFinite = 0
        for (v in vector) if (!v.isFinite()) nonFinite++
        if (nonFinite > 0) {
            throw InferenceException(
                InferenceErrorCode.MODEL_INFERENCE_FAILED,
                "The $label embedding contains $nonFinite non-finite value(s) " +
                    "out of ${vector.size}. Refusing to compute a similarity: the " +
                    "result would be NaN, and a NaN spreads into every statistic " +
                    "derived from it.",
            )
        }
        val norm = l2Norm(vector)
        if (abs(norm - 1.0) > NORM_TOLERANCE) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "The $label embedding has L2 norm $norm, which is not 1.0 within " +
                    "$NORM_TOLERANCE. Cosine similarity is only a plain dot " +
                    "product for unit vectors, so this vector cannot be compared " +
                    "without renormalising it - and silently renormalising here " +
                    "would hide whatever went wrong upstream.",
            )
        }
    }

    /**
     * Every pairwise similarity among [embeddings], upper triangle only.
     *
     * The matrix is symmetric and its diagonal is 1 by definition, so
     * computing the full N^2 would triple the work and add N
     * self-comparisons that carry no information. Statistics must be
     * computed from the N(N-1)/2 distinct pairs; including the
     * diagonal would drag every mean towards 1.0 and make an
     * indifferent embedding space look excellent.
     */
    fun pairwise(embeddings: List<FloatArray>): List<PairSimilarity> {
        val out = ArrayList<PairSimilarity>(embeddings.size * (embeddings.size - 1) / 2)
        for (i in embeddings.indices) {
            for (j in i + 1 until embeddings.size) {
                out.add(PairSimilarity(i, j, cosine(embeddings[i], embeddings[j])))
            }
        }
        return out
    }

    /**
     * Nearest and farthest already-completed neighbours of [index].
     *
     * Returns null when [index] is the only entry. THAT IS THE FIRST
     * TRACK'S CORRECT ANSWER: with nothing to compare against there is
     * no nearest neighbour, and inventing one - 1.0 against itself, or
     * 0.0 as a placeholder - would put a fabricated number into the
     * evidence this phase exists to collect.
     */
    fun neighbours(
        embeddings: List<FloatArray>,
        index: Int,
    ): NeighbourPair? {
        if (index !in embeddings.indices) return null
        if (embeddings.size < 2) return null

        var nearest = -1
        var nearestScore = Double.NEGATIVE_INFINITY
        var farthest = -1
        var farthestScore = Double.POSITIVE_INFINITY

        for (other in embeddings.indices) {
            if (other == index) continue
            val s = cosine(embeddings[index], embeddings[other])
            if (s > nearestScore) {
                nearestScore = s
                nearest = other
            }
            if (s < farthestScore) {
                farthestScore = s
                farthest = other
            }
        }
        if (nearest < 0 || farthest < 0) return null
        return NeighbourPair(nearest, nearestScore, farthest, farthestScore)
    }

    /**
     * Descriptive statistics over a set of pairwise scores.
     *
     * Returns null for fewer than one pair. A single track produces no
     * pairs, and a "mean of nothing" is not zero - it does not exist.
     */
    fun statistics(scores: List<Double>): SimilarityStats? {
        if (scores.isEmpty()) return null

        val sorted = scores.sorted()
        val n = sorted.size
        val mean = sorted.sum() / n
        val median = if (n % 2 == 1) {
            sorted[n / 2]
        } else {
            (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
        }

        // Population standard deviation: this describes the pairs that
        // were actually measured, not an estimate of some larger set
        // of pairs that was never computed.
        var acc = 0.0
        for (s in sorted) acc += (s - mean) * (s - mean)
        val stdDev = sqrt(acc / n)

        return SimilarityStats(
            pairCount = n,
            mean = mean,
            median = median,
            min = sorted.first(),
            max = sorted.last(),
            stdDev = stdDev,
            p25 = percentile(sorted, 0.25),
            p75 = percentile(sorted, 0.75),
            histogram = histogram(sorted),
        )
    }

    /** Nearest-rank percentile on an already-sorted list. */
    private fun percentile(sorted: List<Double>, q: Double): Double {
        if (sorted.isEmpty()) return Double.NaN
        val idx = ((sorted.size - 1) * q).toInt().coerceIn(0, sorted.size - 1)
        return sorted[idx]
    }

    /**
     * Fixed 10-bucket histogram spanning the full cosine range.
     *
     * Bucket edges are fixed at [-1, 1] rather than fitted to the data
     * on purpose: an auto-scaled histogram makes every distribution
     * look equally spread out, which would disguise the single most
     * important thing this lab can reveal - embeddings crammed into a
     * narrow band, where nothing is distinguishable from anything.
     */
    fun histogram(scores: List<Double>, buckets: Int = HISTOGRAM_BUCKETS): IntArray {
        val counts = IntArray(buckets)
        if (scores.isEmpty()) return counts
        val width = 2.0 / buckets
        for (s in scores) {
            val raw = ((s + 1.0) / width).toInt()
            counts[raw.coerceIn(0, buckets - 1)]++
        }
        return counts
    }

    const val HISTOGRAM_BUCKETS = 10

    /** Lower edge of histogram bucket [i]. */
    fun bucketLowerBound(i: Int, buckets: Int = HISTOGRAM_BUCKETS): Double =
        -1.0 + i * (2.0 / buckets)

    /**
     * Statistics grouped by a user-supplied relationship label.
     *
     * LABELS ARE NEVER INFERRED. They arrive from the developer
     * running the lab, and a pair is only grouped when BOTH of its
     * tracks carry a label. Deriving "same artist" from metadata would
     * turn a tag-quality measurement into an embedding-quality claim,
     * and the two are not the same thing at all.
     */
    fun groupedStatistics(
        embeddings: List<FloatArray>,
        labels: List<String?>,
    ): Map<String, SimilarityStats> {
        if (embeddings.size != labels.size) {
            throw InferenceException(
                InferenceErrorCode.INPUT_SHAPE_MISMATCH,
                "Got ${embeddings.size} embeddings but ${labels.size} labels.",
            )
        }
        val byGroup = HashMap<String, MutableList<Double>>()
        for (i in embeddings.indices) {
            for (j in i + 1 until embeddings.size) {
                val a = labels[i]
                val b = labels[j]
                if (a.isNullOrBlank() || b.isNullOrBlank()) continue
                // A pair belongs to a group only when both ends agree.
                // Cross-group pairs are recorded separately rather
                // than being dropped or assigned to one side.
                val key = if (a == b) a else listOf(a, b).sorted().joinToString(" vs ")
                byGroup.getOrPut(key) { ArrayList() }.add(cosine(embeddings[i], embeddings[j]))
            }
        }
        val out = LinkedHashMap<String, SimilarityStats>()
        for ((k, v) in byGroup.entries.sortedBy { it.key }) {
            statistics(v)?.let { out[k] = it }
        }
        return out
    }
}

/** One entry of the upper-triangular similarity matrix. */
data class PairSimilarity(val i: Int, val j: Int, val score: Double)

/** The closest and farthest neighbours of one track. */
data class NeighbourPair(
    val nearestIndex: Int,
    val nearestScore: Double,
    val farthestIndex: Int,
    val farthestScore: Double,
)

/**
 * Descriptive statistics over pairwise similarities.
 *
 * Every field is measured. There is deliberately no "quality" or
 * "score" field: no threshold on these numbers is defensible without
 * labelled data, and providing one would invite exactly the
 * unjustified GOOD/BAD verdict this phase exists to avoid.
 */
data class SimilarityStats(
    val pairCount: Int,
    val mean: Double,
    val median: Double,
    val min: Double,
    val max: Double,
    val stdDev: Double,
    val p25: Double,
    val p75: Double,
    val histogram: IntArray,
) {
    /** Width of the observed range. A narrow spread is worth seeing. */
    val range: Double get() = max - min

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SimilarityStats) return false
        return pairCount == other.pairCount && mean == other.mean &&
            median == other.median && min == other.min && max == other.max &&
            stdDev == other.stdDev && p25 == other.p25 && p75 == other.p75 &&
            histogram.contentEquals(other.histogram)
    }

    override fun hashCode(): Int {
        var result = pairCount
        result = 31 * result + mean.hashCode()
        result = 31 * result + median.hashCode()
        result = 31 * result + min.hashCode()
        result = 31 * result + max.hashCode()
        result = 31 * result + stdDev.hashCode()
        result = 31 * result + histogram.contentHashCode()
        return result
    }
}
