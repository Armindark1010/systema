package com.systema.music.inference

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * ============================================================
 * SYSTEMA — Phase 17: cosine similarity and evaluation statistics
 * ============================================================
 *
 * REAL assertions on REAL arithmetic, executed on a plain JVM. Every
 * case below computes an actual number through the actual production
 * code path.
 *
 * WHY THE HAND-CHECKABLE CASES COME FIRST
 * ---------------------------------------
 * Identical vectors must give exactly 1, orthogonal exactly 0, and
 * opposite exactly -1. Those three are verifiable without trusting
 * any implementation, and everything else - matrices, distributions,
 * neighbour rankings - is built on top of them. If cosine is wrong,
 * a similarity matrix full of plausible numbers would hide it
 * completely.
 *
 * WHAT THIS DOES NOT COVER
 * ------------------------
 * It does not run ONNX, does not decode audio, does not touch a
 * device, and does not judge whether the embeddings are any good. It
 * proves the measurement machinery is correct. Whether YAMNet's
 * vectors are useful is a question only a real device run can answer.
 * ============================================================
 */
object SimilarityTest {

    private var passed = 0
    private var failed = 0
    private val failures = mutableListOf<String>()

    private fun ok(name: String, condition: Boolean, detail: String = "") {
        if (condition) {
            passed++
            println("  PASS  $name")
        } else {
            failed++
            failures.add(name)
            println("  FAIL  $name${if (detail.isNotEmpty()) " — $detail" else ""}")
        }
    }

    private fun section(title: String) {
        println()
        println(title)
        println("-".repeat(title.length))
    }

    private fun close(a: Double, b: Double, tol: Double = 1e-9) = abs(a - b) <= tol

    /** A random unit vector, so tests use legal input by construction. */
    private fun unitVector(dim: Int, rng: java.util.Random): FloatArray {
        val v = FloatArray(dim) { rng.nextGaussian().toFloat() }
        var acc = 0.0
        for (x in v) acc += x.toDouble() * x.toDouble()
        val n = sqrt(acc)
        for (i in v.indices) v[i] = (v[i] / n).toFloat()
        return v
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println()
        println("============================================================")
        println("SYSTEMA — Phase 17 similarity suite")
        println("============================================================")

        testIdenticalVectors()
        testOrthogonalVectors()
        testOppositeVectors()
        testNormalizedValidation()
        testDimensionMismatch()
        testNonFiniteRejection()
        testFirstTrackBehaviour()
        testNeighbours()
        testPairwiseAndMatrix()
        testStatistics()
        testHistogram()
        testGroupedStatistics()
        testStatisticsUseValidEmbeddingsOnly()
        testRealisticGeometry()

        println()
        println("============================================================")
        println("  $passed passed, $failed failed")
        println("============================================================")
        if (failures.isNotEmpty()) println("  failing: ${failures.joinToString(", ")}")
        println(
            """
            SCOPE OF THIS SUITE
            -------------------
            Executed arithmetic on the real similarity code. It does NOT
            run ONNX, decode audio, or touch a device, and it does NOT
            evaluate whether YAMNet's embeddings are good. That requires
            a real device run, which this does not perform.
            """.trimIndent(),
        )

        if (failed > 0) throw AssertionError("$failed similarity assertion(s) failed")
    }

    // ------------------------------------------------------------
    /** cos(a,a) = 1, exactly. */
    private fun testIdenticalVectors() {
        section("1. Identical vectors -> 1")

        val a = floatArrayOf(0.6f, 0.8f)
        ok("[0.6,0.8] with itself is 1", close(EmbeddingSimilarity.cosine(a, a), 1.0, 1e-6))

        val rng = java.util.Random(17L)
        for (dim in intArrayOf(2, 64, 1024)) {
            val v = unitVector(dim, rng)
            val s = EmbeddingSimilarity.cosine(v, v)
            ok("D=$dim: self-similarity is 1", close(s, 1.0, 1e-6), "got $s")
            // Clamping must hold the contract exactly: a value of
            // 1.0000000002 would make "score <= 1" false downstream.
            ok("D=$dim: never exceeds 1", s <= 1.0, "got $s")
        }

        // A copy is not the same object but is the same vector.
        val v = unitVector(1024, rng)
        ok("a copy is also 1", close(EmbeddingSimilarity.cosine(v, v.copyOf()), 1.0, 1e-6))
    }

    // ------------------------------------------------------------
    /** cos(a,b) = 0 for perpendicular vectors. */
    private fun testOrthogonalVectors() {
        section("2. Orthogonal vectors -> 0")

        val x = floatArrayOf(1f, 0f)
        val y = floatArrayOf(0f, 1f)
        ok("[1,0] vs [0,1] is 0", close(EmbeddingSimilarity.cosine(x, y), 0.0, 1e-6))

        // Basis vectors in 1024-d: the realistic width.
        val e1 = FloatArray(1024).also { it[0] = 1f }
        val e2 = FloatArray(1024).also { it[500] = 1f }
        ok("two 1024-d basis vectors are 0", close(EmbeddingSimilarity.cosine(e1, e2), 0.0, 1e-6))

        // A hand-built orthogonal pair that is not axis-aligned.
        val h = 1f / sqrt(2.0).toFloat()
        val p = floatArrayOf(h, h)
        val q = floatArrayOf(h, -h)
        ok("[.707,.707] vs [.707,-.707] is 0", close(EmbeddingSimilarity.cosine(p, q), 0.0, 1e-6))
        ok("symmetric: cos(q,p) == cos(p,q)",
            close(EmbeddingSimilarity.cosine(q, p), EmbeddingSimilarity.cosine(p, q), 1e-12))
    }

    // ------------------------------------------------------------
    /** cos(a,-a) = -1. */
    private fun testOppositeVectors() {
        section("3. Opposite vectors -> -1")

        val a = floatArrayOf(0.6f, 0.8f)
        val b = floatArrayOf(-0.6f, -0.8f)
        ok("[0.6,0.8] vs [-0.6,-0.8] is -1", close(EmbeddingSimilarity.cosine(a, b), -1.0, 1e-6))

        val rng = java.util.Random(23L)
        val v = unitVector(1024, rng)
        val neg = FloatArray(v.size) { -v[it] }
        val s = EmbeddingSimilarity.cosine(v, neg)
        ok("1024-d negation is -1", close(s, -1.0, 1e-6), "got $s")
        ok("never below -1", s >= -1.0, "got $s")

        // Negating a unit vector keeps it unit length, so this is a
        // legal input rather than an edge case that only happens to work.
        ok("the negated vector is still unit length",
            abs(EmbeddingSimilarity.l2Norm(neg) - 1.0) <= EmbeddingSimilarity.NORM_TOLERANCE)
    }

    // ------------------------------------------------------------
    /** Unnormalised input is refused, not silently renormalised. */
    private fun testNormalizedValidation() {
        section("4. Normalised-vector validation")

        // [3,4] has norm 5. Cosine's dot-product shortcut is only
        // valid for unit vectors, so this must be rejected rather
        // than quietly divided.
        var threw = false
        var msg = ""
        try {
            EmbeddingSimilarity.cosine(floatArrayOf(3f, 4f), floatArrayOf(0.6f, 0.8f))
        } catch (e: InferenceException) {
            threw = true
            msg = e.message ?: ""
        }
        ok("a norm-5 vector is rejected", threw)
        ok("the error states the measured norm", msg.contains("5.0"), msg)
        ok("the error explains why it is not renormalised",
            msg.contains("hide whatever went wrong upstream"), msg)

        // A zero vector has norm 0 and must also be refused: cosine
        // against it is undefined, not zero.
        var zeroThrew = false
        try {
            EmbeddingSimilarity.cosine(FloatArray(8), unitVector(8, java.util.Random(1L)))
        } catch (e: InferenceException) {
            zeroThrew = true
        }
        ok("a zero vector is rejected", zeroThrew)

        // Just inside and just outside tolerance.
        val almost = floatArrayOf(1f + 5e-5f, 0f)
        ok("a norm within 1e-4 is accepted",
            runCatching { EmbeddingSimilarity.requireUnitLength(almost) }.isSuccess)
        val tooFar = floatArrayOf(1.01f, 0f)
        ok("a norm 1% off is rejected",
            runCatching { EmbeddingSimilarity.requireUnitLength(tooFar) }.isFailure)

        ok("the tolerance matches the aggregator's",
            EmbeddingSimilarity.NORM_TOLERANCE == FrameEmbeddingAggregator.NORM_TOLERANCE)

        // A vector produced by the real aggregator must pass.
        val pooled = FrameEmbeddingAggregator.aggregate(
            FloatArray(7 * 1024) { java.util.Random(5L).nextGaussian().toFloat() }, 7, 1024,
        )
        ok("an aggregator-produced vector validates",
            runCatching { EmbeddingSimilarity.requireUnitLength(pooled.vector) }.isSuccess)
    }

    // ------------------------------------------------------------
    /** Different widths cannot be compared. */
    private fun testDimensionMismatch() {
        section("5. Dimension mismatch rejection")

        var threw = false
        var msg = ""
        try {
            EmbeddingSimilarity.cosine(FloatArray(1024) { 0f }.also { it[0] = 1f },
                FloatArray(512) { 0f }.also { it[0] = 1f })
        } catch (e: InferenceException) {
            threw = true
            msg = e.message ?: ""
        }
        ok("1024 vs 512 is rejected", threw)
        ok("the error names both widths", msg.contains("1024") && msg.contains("512"), msg)
        ok("it refuses to pad or truncate", msg.contains("Refusing to pad"), msg)

        // The MEAN vs MEAN_STD trap: 1024 and 2048 come from the same
        // model and the same track, and are still not comparable.
        val mean = FrameEmbeddingAggregator.aggregate(FloatArray(4 * 1024) { 0.01f }, 4, 1024)
        val meanStd = FrameEmbeddingAggregator.aggregate(
            FloatArray(4 * 1024) { 0.01f }, 4, 1024, AggregationStrategy.MEAN_STD,
        )
        ok("MEAN(1024) vs MEAN_STD(2048) is rejected",
            runCatching { EmbeddingSimilarity.cosine(mean.vector, meanStd.vector) }.isFailure)

        // Empty vectors.
        ok("empty vectors are rejected",
            runCatching { EmbeddingSimilarity.cosine(FloatArray(0), FloatArray(0)) }.isFailure)
    }

    // ------------------------------------------------------------
    /** NaN and Inf never reach a score. */
    private fun testNonFiniteRejection() {
        section("6. NaN / Inf rejection")

        val good = floatArrayOf(1f, 0f, 0f, 0f)
        for ((label, bad) in listOf(
            "NaN" to Float.NaN,
            "+Inf" to Float.POSITIVE_INFINITY,
            "-Inf" to Float.NEGATIVE_INFINITY,
        )) {
            val poisoned = floatArrayOf(1f, 0f, 0f, 0f)
            poisoned[2] = bad
            var threw = false
            var msg = ""
            try {
                EmbeddingSimilarity.cosine(poisoned, good)
            } catch (e: InferenceException) {
                threw = true
                msg = e.message ?: ""
            }
            ok("$label in the first vector is rejected", threw)
            ok("$label error names the count", msg.contains("1 non-finite"), msg)

            var threwB = false
            try {
                EmbeddingSimilarity.cosine(good, poisoned)
            } catch (e: InferenceException) {
                threwB = true
            }
            ok("$label in the second vector is rejected", threwB)
        }

        // Clean input must NOT be rejected: a check that fires on
        // everything is worthless.
        ok("clean input is accepted",
            runCatching { EmbeddingSimilarity.cosine(good, good) }.isSuccess)

        // No path returns NaN. Rejection happens before the dot
        // product, so a poisoned component can never reach a score.
        val rng = java.util.Random(31L)
        val scores = (1..20).map {
            EmbeddingSimilarity.cosine(unitVector(64, rng), unitVector(64, rng))
        }
        ok("no computed score is NaN", scores.none { it.isNaN() })
        ok("every score is within [-1,1]", scores.all { it in -1.0..1.0 })
    }

    // ------------------------------------------------------------
    /** The first track has no neighbour, and none is invented. */
    private fun testFirstTrackBehaviour() {
        section("7. First-track behaviour")

        val rng = java.util.Random(41L)
        val one = listOf(unitVector(1024, rng))

        ok("a single embedding has no neighbours",
            EmbeddingSimilarity.neighbours(one, 0) == null)
        ok("a single embedding yields zero pairs",
            EmbeddingSimilarity.pairwise(one).isEmpty())
        // "No pairs" is not "mean of zero". A statistic over nothing
        // does not exist, and returning 0.0 would put a fabricated
        // number into the evidence.
        ok("statistics over zero pairs is null, not zero",
            EmbeddingSimilarity.statistics(emptyList()) == null)
        ok("an empty list has no neighbours",
            EmbeddingSimilarity.neighbours(emptyList(), 0) == null)

        // With a second embedding a neighbour appears immediately.
        val two = listOf(one[0], unitVector(1024, rng))
        val n = EmbeddingSimilarity.neighbours(two, 0)
        ok("two embeddings produce a neighbour", n != null)
        ok("with only one other, nearest == farthest",
            n != null && n.nearestIndex == 1 && n.farthestIndex == 1)
        ok("and one pair exists", EmbeddingSimilarity.pairwise(two).size == 1)
    }

    // ------------------------------------------------------------
    /** Nearest and farthest are actually the extremes. */
    private fun testNeighbours() {
        section("8. Nearest / farthest neighbour selection")

        // Constructed so the answer is known by hand: index 0 is
        // closest to 1, farthest from 3.
        val e0 = floatArrayOf(1f, 0f, 0f)
        val e1 = floatArrayOf(0.99f, 0.141067f, 0f)   // very close to e0
        val e2 = floatArrayOf(0f, 1f, 0f)             // orthogonal
        val e3 = floatArrayOf(-1f, 0f, 0f)            // opposite
        val all = listOf(e0, e1, e2, e3)

        val n = EmbeddingSimilarity.neighbours(all, 0)!!
        ok("nearest to e0 is e1", n.nearestIndex == 1, "got ${n.nearestIndex}")
        ok("farthest from e0 is e3", n.farthestIndex == 3, "got ${n.farthestIndex}")
        ok("nearest score is high", n.nearestScore > 0.98, "got ${n.nearestScore}")
        ok("farthest score is -1", close(n.farthestScore, -1.0, 1e-6), "got ${n.farthestScore}")

        // A track is never its own neighbour: self-similarity is 1 by
        // definition and would win every time.
        ok("self is excluded from nearest", n.nearestIndex != 0)
        ok("self is excluded from farthest", n.farthestIndex != 0)

        val n2 = EmbeddingSimilarity.neighbours(all, 3)!!
        ok("nearest to e3 is e2 (orthogonal beats opposite)", n2.nearestIndex == 2)
        ok("farthest from e3 is e0", n2.farthestIndex == 0)

        ok("an out-of-range index yields null",
            EmbeddingSimilarity.neighbours(all, 99) == null)
    }

    // ------------------------------------------------------------
    /** The matrix grows incrementally and stays symmetric. */
    private fun testPairwiseAndMatrix() {
        section("9. Pairwise set and incremental growth")

        val rng = java.util.Random(53L)
        val vectors = ArrayList<FloatArray>()

        // Simulates the lab's loop: one track at a time.
        val expectedPairs = intArrayOf(0, 0, 1, 3, 6, 10, 15, 21)
        for (n in 1..7) {
            vectors.add(unitVector(1024, rng))
            val pairs = EmbeddingSimilarity.pairwise(vectors)
            ok("after $n tracks there are ${expectedPairs[n]} pairs",
                pairs.size == expectedPairs[n], "got ${pairs.size}")
            // N(N-1)/2, the upper triangle only. Including the
            // diagonal would add N ones and inflate every mean.
            ok("after $n tracks that is N(N-1)/2",
                pairs.size == n * (n - 1) / 2)
        }

        val pairs = EmbeddingSimilarity.pairwise(vectors)
        ok("every pair has i < j", pairs.all { it.i < it.j })
        ok("no pair is a self-comparison", pairs.none { it.i == it.j })
        ok("all scores are in range", pairs.all { it.score in -1.0..1.0 })

        // Symmetry: computing the other direction gives the same
        // number, which is why only the triangle is stored.
        for (p in pairs.take(10)) {
            val reverse = EmbeddingSimilarity.cosine(vectors[p.j], vectors[p.i])
            ok("pair (${p.i},${p.j}) is symmetric", close(p.score, reverse, 1e-12))
        }

        // Adding a track must not change any EXISTING pair's score.
        // That is what makes the live matrix trustworthy rather than a
        // moving target.
        //
        // Note the pairs are compared BY INDEX PAIR, not by position:
        // pairwise() emits row-major upper-triangle order, so a new
        // track inserts (0,new), (1,new)... between the old entries
        // rather than appending them. Comparing positionally would be
        // asserting an ordering the function never promised.
        val before = EmbeddingSimilarity.pairwise(vectors)
            .associate { (it.i to it.j) to it.score }
        vectors.add(unitVector(1024, rng))
        val after = EmbeddingSimilarity.pairwise(vectors)
            .associate { (it.i to it.j) to it.score }

        ok("every previously-seen pair keeps its exact score",
            before.all { (key, score) -> close(after[key] ?: Double.NaN, score, 1e-12) })
        ok("and the new track added exactly 7 pairs", after.size - before.size == 7)
        ok("the new pairs all involve the new index",
            (after.keys - before.keys).all { it.second == vectors.size - 1 })
    }

    // ------------------------------------------------------------
    /** Statistics are correct on hand-checkable input. */
    private fun testStatistics() {
        section("10. Descriptive statistics")

        // Mean 0.3, median 0.3, min 0.1, max 0.5.
        val s = EmbeddingSimilarity.statistics(listOf(0.1, 0.2, 0.3, 0.4, 0.5))!!
        ok("pairCount is 5", s.pairCount == 5)
        ok("mean is 0.3", close(s.mean, 0.3, 1e-12), "got ${s.mean}")
        ok("median is 0.3 (odd count)", close(s.median, 0.3, 1e-12), "got ${s.median}")
        ok("min is 0.1", close(s.min, 0.1, 1e-12))
        ok("max is 0.5", close(s.max, 0.5, 1e-12))
        ok("range is 0.4", close(s.range, 0.4, 1e-12))

        // Even count: the median is the average of the middle two.
        val even = EmbeddingSimilarity.statistics(listOf(0.2, 0.4, 0.6, 0.8))!!
        ok("median of 4 values averages the middle two",
            close(even.median, 0.5, 1e-12), "got ${even.median}")

        // Order must not matter.
        val shuffled = EmbeddingSimilarity.statistics(listOf(0.5, 0.1, 0.4, 0.2, 0.3))!!
        ok("input order does not change the mean", close(shuffled.mean, s.mean, 1e-12))
        ok("input order does not change the median", close(shuffled.median, s.median, 1e-12))

        // Standard deviation of a constant set is exactly 0.
        val flat = EmbeddingSimilarity.statistics(listOf(0.7, 0.7, 0.7))!!
        ok("stdDev of identical values is 0", close(flat.stdDev, 0.0, 1e-12))
        ok("range of identical values is 0", close(flat.range, 0.0, 1e-12))

        // A single pair is a valid statistic.
        val one = EmbeddingSimilarity.statistics(listOf(0.42))!!
        ok("one pair gives mean == median == that value",
            close(one.mean, 0.42, 1e-12) && close(one.median, 0.42, 1e-12))
        ok("one pair has stdDev 0", close(one.stdDev, 0.0, 1e-12))

        ok("no pairs gives null", EmbeddingSimilarity.statistics(emptyList()) == null)
        ok("p25 <= median <= p75", s.p25 <= s.median && s.median <= s.p75)
    }

    // ------------------------------------------------------------
    /** Fixed buckets, so a narrow cluster looks narrow. */
    private fun testHistogram() {
        section("11. Histogram uses fixed buckets")

        val h = EmbeddingSimilarity.histogram(listOf(-1.0, -0.5, 0.0, 0.5, 0.99))
        ok("there are 10 buckets", h.size == 10)
        ok("all values are counted", h.sum() == 5)
        ok("-1.0 lands in the first bucket", h[0] >= 1)
        ok("0.99 lands in the last bucket", h[9] >= 1)

        // The important case: everything crammed into a narrow band
        // must occupy ONE bucket, not spread across all ten. An
        // auto-scaled histogram would hide exactly this.
        val narrow = EmbeddingSimilarity.histogram(List(50) { 0.82 + (it % 5) * 0.001 })
        val occupied = narrow.count { it > 0 }
        ok("50 values in a 0.005 band occupy one bucket", occupied == 1, "occupied $occupied")
        ok("that bucket holds all 50", narrow.max() == 50)

        // Exact boundary handling: +1.0 must not overflow the array.
        val edge = EmbeddingSimilarity.histogram(listOf(1.0, -1.0))
        ok("+1.0 does not overflow", edge.sum() == 2)
        ok("bucket bounds start at -1", close(EmbeddingSimilarity.bucketLowerBound(0), -1.0, 1e-12))
        ok("bucket 5 starts at 0", close(EmbeddingSimilarity.bucketLowerBound(5), 0.0, 1e-12))

        ok("an empty input gives all-zero counts",
            EmbeddingSimilarity.histogram(emptyList()).all { it == 0 })
    }

    // ------------------------------------------------------------
    /** Labels group pairs; unlabelled pairs are skipped, not guessed. */
    private fun testGroupedStatistics() {
        section("12. Grouped statistics from explicit labels")

        val rng = java.util.Random(67L)
        val v = List(4) { unitVector(64, rng) }

        val grouped = EmbeddingSimilarity.groupedStatistics(
            v, listOf("same artist", "same artist", "different artist", "different artist"),
        )
        ok("two same-artist tracks give one same-artist pair",
            grouped["same artist"]?.pairCount == 1)
        ok("two different-artist tracks give one such pair",
            grouped["different artist"]?.pairCount == 1)
        // Cross-group pairs are recorded under a combined key rather
        // than dropped or arbitrarily assigned to one side.
        ok("the 4 cross pairs get their own key",
            grouped["different artist vs same artist"]?.pairCount == 4)
        ok("all 6 pairs are accounted for",
            grouped.values.sumOf { it.pairCount } == 6)

        // An unlabelled track contributes no pairs at all.
        val partial = EmbeddingSimilarity.groupedStatistics(
            v, listOf("same artist", "same artist", null, null),
        )
        ok("unlabelled tracks contribute no pairs",
            partial.values.sumOf { it.pairCount } == 1)
        ok("only the labelled group exists", partial.keys == setOf("same artist"))

        // No labels at all: no groups. Nothing is manufactured from
        // metadata, because there is no metadata here to manufacture from.
        val none = EmbeddingSimilarity.groupedStatistics(v, listOf(null, null, null, null))
        ok("no labels means no groups", none.isEmpty())

        ok("a label/embedding count mismatch is rejected",
            runCatching {
                EmbeddingSimilarity.groupedStatistics(v, listOf("a", "b"))
            }.isFailure)
    }

    // ------------------------------------------------------------
    /**
     * Statistics come only from valid embeddings.
     *
     * The lab appends to its vector list ONLY on success, so a failed
     * track cannot enter the geometry. This asserts the consequence.
     */
    private fun testStatisticsUseValidEmbeddingsOnly() {
        section("13. Only valid embeddings reach the statistics")

        val rng = java.util.Random(71L)
        // Five tracks attempted, two failed: only three vectors exist.
        val succeeded = List(3) { unitVector(1024, rng) }

        val pairs = EmbeddingSimilarity.pairwise(succeeded)
        ok("3 successes give 3 pairs, not 10", pairs.size == 3)
        ok("statistics see exactly those 3",
            EmbeddingSimilarity.statistics(pairs.map { it.score })!!.pairCount == 3)

        // A degenerate (all-zero) vector must never be admitted. The
        // lab rejects it before this point; here we prove that had it
        // slipped through, the maths would have refused it too.
        val zero = FloatArray(1024)
        ok("a zero vector cannot be compared",
            runCatching { EmbeddingSimilarity.cosine(succeeded[0], zero) }.isFailure)
        ok("pairwise over a list containing zeros throws",
            runCatching { EmbeddingSimilarity.pairwise(succeeded + listOf(zero)) }.isFailure)

        // No hardcoded quality number exists anywhere in the result.
        val stats = EmbeddingSimilarity.statistics(pairs.map { it.score })!!
        ok("stats carry no score/grade field",
            SimilarityStats::class.java.declaredFields.none {
                it.name.lowercase().contains("quality") || it.name.lowercase().contains("grade")
            })
        ok("every statistic is derived from the data",
            stats.min <= stats.mean && stats.mean <= stats.max)
    }

    // ------------------------------------------------------------
    /** End-to-end on aggregator output at the real contract shape. */
    private fun testRealisticGeometry() {
        section("14. Integration: [401,1024] frames -> comparable track vectors")

        val rng = java.util.Random(83L)

        // Two tracks built from genuinely different frame data, plus
        // one built from the SAME frames as track A. The third must
        // come back essentially identical to A - a strong check that
        // pooling is deterministic and comparison is meaningful.
        val framesA = FloatArray(401 * 1024) { rng.nextGaussian().toFloat() }
        val framesB = FloatArray(401 * 1024) { rng.nextGaussian().toFloat() }

        val a = FrameEmbeddingAggregator.aggregate(framesA, 401, 1024)
        val b = FrameEmbeddingAggregator.aggregate(framesB, 401, 1024)
        val aAgain = FrameEmbeddingAggregator.aggregate(framesA.copyOf(), 401, 1024)

        ok("all three are 1024-d", a.dimension == 1024 && b.dimension == 1024)
        ok("all three are unit length",
            a.isUnitLength() && b.isUnitLength() && aAgain.isUnitLength())

        val selfScore = EmbeddingSimilarity.cosine(a.vector, aAgain.vector)
        ok("the same frames give similarity 1", close(selfScore, 1.0, 1e-6), "got $selfScore")

        val crossScore = EmbeddingSimilarity.cosine(a.vector, b.vector)
        ok("different frames give a score in range", crossScore in -1.0..1.0)
        ok("different frames are not identical", crossScore < 0.9999, "got $crossScore")

        // A 521-wide class-score tensor must never be comparable with
        // a 1024-d embedding. This is the Phase 16.2 defect, now
        // guarded at the similarity layer too.
        val classScoreShaped = FloatArray(521).also { it[0] = 1f }
        ok("a 521-wide vector cannot be compared with a 1024-d one",
            runCatching {
                EmbeddingSimilarity.cosine(a.vector, classScoreShaped)
            }.isFailure)

        // The full pipeline on a small set, exactly as the lab runs it.
        val vectors = listOf(a.vector, b.vector, aAgain.vector)
        val pairs = EmbeddingSimilarity.pairwise(vectors)
        ok("3 vectors give 3 pairs", pairs.size == 3)
        val stats = EmbeddingSimilarity.statistics(pairs.map { it.score })!!
        ok("max is the A/A-again pair", close(stats.max, 1.0, 1e-6), "got ${stats.max}")
        ok("statistics are finite", stats.mean.isFinite() && stats.stdDev.isFinite())

        val n = EmbeddingSimilarity.neighbours(vectors, 0)!!
        ok("A's nearest neighbour is its own duplicate", n.nearestIndex == 2)
        ok("A's farthest is the genuinely different track", n.farthestIndex == 1)
    }
}
