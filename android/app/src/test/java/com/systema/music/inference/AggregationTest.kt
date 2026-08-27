package com.systema.music.inference

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * ============================================================
 * SYSTEMA — Phase 16A: track-level aggregation
 * ============================================================
 *
 * REAL assertions on REAL arithmetic. Every test below computes an
 * actual FloatArray through the actual production code path; nothing
 * here inspects source text or trusts a comment.
 *
 * WHY THE HAND-CHECKED CASES MATTER
 * ---------------------------------
 * The first four cases are small enough to verify by hand:
 * [[1,2],[3,4]] must mean to [2,3], and [3,4] must normalise to
 * [0.6,0.8] because 3-4-5 is a right triangle. If those are wrong,
 * nothing built on top of them can be right, and no amount of
 * plausible-looking 1024-float output would reveal it.
 *
 * WHAT THIS DOES NOT COVER
 * ------------------------
 * It does not run ONNX, does not touch a device, and does not
 * evaluate whether mean pooling produces GOOD embeddings. It proves
 * the aggregation is correct and deterministic. Quality is a separate
 * question that has not been answered.
 * ============================================================
 */
object AggregationTest {

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

    private fun close(a: Float, b: Float, tol: Float = 1e-5f) = abs(a - b) <= tol
    private fun close(a: Double, b: Double, tol: Double = 1e-9) = abs(a - b) <= tol

    private fun arraysClose(a: FloatArray, b: FloatArray, tol: Float = 1e-5f): Boolean {
        if (a.size != b.size) return false
        return a.indices.all { close(a[it], b[it], tol) }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println()
        println("============================================================")
        println("SYSTEMA — Phase 16A aggregation suite")
        println("============================================================")

        testSimpleMean()
        testSingleFrame()
        testMultiFramePerDimension()
        testZeroVector()
        testL2NormIsUnit()
        testDeterminism()
        testDimensionPreservation()
        testFrameCountIndependence()
        testNonFiniteHandling()
        testWrongTensorRejection()
        testMeanStdWidth()
        testContractIntegration()

        println()
        println("============================================================")
        println("  $passed passed, $failed failed")
        println("============================================================")
        if (failures.isNotEmpty()) {
            println("  failing: ${failures.joinToString(", ")}")
        }
        println(
            """
            SCOPE OF THIS SUITE
            -------------------
            Executed arithmetic on the real aggregator. It does NOT run
            ONNX, does NOT touch a device, and does NOT evaluate
            embedding quality. Mean pooling is the BASELINE; whether it
            is a good choice for music similarity is unmeasured.
            """.trimIndent(),
        )

        if (failed > 0) {
            throw AssertionError("$failed aggregation assertion(s) failed")
        }
    }

    // ------------------------------------------------------------
    /** [[1,2],[3,4]] -> [2,3]. Small enough to verify by hand. */
    private fun testSimpleMean() {
        section("1. Simple mean: [[1,2],[3,4]] -> [2,3]")

        val pooled = FrameEmbeddingAggregator.meanPool(
            floatArrayOf(1f, 2f, 3f, 4f), frameCount = 2, dimension = 2,
        )
        ok("width is 2", pooled.size == 2, "got ${pooled.size}")
        ok("mean[0] == 2", close(pooled[0], 2f), "got ${pooled[0]}")
        ok("mean[1] == 3", close(pooled[1], 3f), "got ${pooled[1]}")

        // Column-wise, NOT row-wise. Averaging rows would give
        // [1.5, 3.5], which is the classic transposition bug and
        // produces an output of the right shape from the wrong axis.
        ok(
            "pooled across frames, not within a frame",
            !close(pooled[0], 1.5f) && !close(pooled[1], 3.5f),
        )

        // Same input through the public entry point, unnormalised.
        val result = FrameEmbeddingAggregator.aggregate(
            floatArrayOf(1f, 2f, 3f, 4f), 2, 2,
            AggregationStrategy.MEAN, normalise = false,
        )
        ok("aggregate() agrees with meanPool()", arraysClose(result.vector, pooled))
        ok("normalisation reported as NONE", result.normalisation == Normalisation.NONE)
        ok("strategy reported as MEAN", result.strategy == AggregationStrategy.MEAN)
        ok("input frame count recorded", result.inputFrameCount == 2)
        ok("input dimension recorded", result.inputDimension == 2)
    }

    // ------------------------------------------------------------
    /** One frame is its own mean; [3,4] normalises to [0.6,0.8]. */
    private fun testSingleFrame() {
        section("2. Single frame: [[3,4]] -> [3,4] -> [0.6,0.8]")

        val raw = FrameEmbeddingAggregator.aggregate(
            floatArrayOf(3f, 4f), 1, 2,
            AggregationStrategy.MEAN, normalise = false,
        )
        ok("unnormalised mean is [3,4]", arraysClose(raw.vector, floatArrayOf(3f, 4f)))

        val norm = FrameEmbeddingAggregator.aggregate(
            floatArrayOf(3f, 4f), 1, 2,
            AggregationStrategy.MEAN, normalise = true,
        )
        // 3-4-5 triangle: the norm is exactly 5, so this is checkable
        // without trusting the implementation.
        ok("pre-norm L2 is 5", close(norm.preNormL2, 5.0, 1e-6), "got ${norm.preNormL2}")
        ok("normalised to [0.6,0.8]", arraysClose(norm.vector, floatArrayOf(0.6f, 0.8f)))
        ok("not flagged degenerate", !norm.degenerate)
        ok("unit length self-check passes", norm.isUnitLength())
        ok("normalisation reported as L2", norm.normalisation == Normalisation.L2)
    }

    // ------------------------------------------------------------
    /** Every dimension is averaged independently. */
    private fun testMultiFramePerDimension() {
        section("3. Multi-frame, per-dimension independence")

        // 4 frames x 3 dims. Column means: [5, 50, 500].
        val frames = floatArrayOf(
            2f, 20f, 200f,
            4f, 40f, 400f,
            6f, 60f, 600f,
            8f, 80f, 800f,
        )
        val pooled = FrameEmbeddingAggregator.meanPool(frames, 4, 3)
        ok("dim 0 mean == 5", close(pooled[0], 5f), "got ${pooled[0]}")
        ok("dim 1 mean == 50", close(pooled[1], 50f), "got ${pooled[1]}")
        ok("dim 2 mean == 500", close(pooled[2], 500f), "got ${pooled[2]}")

        // Changing one dimension must not disturb the others: a
        // stride bug shows up here and nowhere else.
        val perturbed = frames.copyOf()
        perturbed[1] = 20000f
        val after = FrameEmbeddingAggregator.meanPool(perturbed, 4, 3)
        ok("dim 0 unaffected by a change in dim 1", close(after[0], 5f))
        ok("dim 2 unaffected by a change in dim 1", close(after[2], 500f))
        ok("dim 1 did change", !close(after[1], 50f))
    }

    // ------------------------------------------------------------
    /** A zero input must yield zeros, never NaN. */
    private fun testZeroVector() {
        section("4. Zero vector: zeros out, no NaN, flagged degenerate")

        val result = FrameEmbeddingAggregator.aggregate(
            FloatArray(8 * 4), 8, 4,
            AggregationStrategy.MEAN, normalise = true,
        )
        ok("all components finite", result.vector.all { it.isFinite() })
        ok("all components exactly zero", result.vector.all { it == 0f })
        ok("no NaN anywhere", result.vector.none { it.isNaN() })
        ok("pre-norm L2 is 0", close(result.preNormL2, 0.0, 1e-12))
        ok("flagged degenerate", result.degenerate)
        // A zero vector is NOT unit length, and claiming otherwise
        // would let it slip into a similarity computation.
        ok("isUnitLength() is false for a degenerate vector", !result.isUnitLength())

        // No epsilon: normalising zeros must not manufacture a
        // near-zero vector that merely LOOKS normalised.
        val direct = FrameEmbeddingAggregator.l2Normalise(FloatArray(4))
        ok("l2Normalise(zeros) returns exact zeros", direct.all { it == 0f })
        ok("l2Normalise(zeros) preserves width", direct.size == 4)
    }

    // ------------------------------------------------------------
    /** The unit-length property, on realistic widths. */
    private fun testL2NormIsUnit() {
        section("5. L2 norm is 1 within the documented tolerance")

        val rng = java.util.Random(20260827L)
        for (dim in intArrayOf(2, 64, 512, 1024)) {
            val frames = FloatArray(7 * dim) { rng.nextGaussian().toFloat() }
            val r = FrameEmbeddingAggregator.aggregate(frames, 7, dim)
            var acc = 0.0
            for (v in r.vector) acc += v.toDouble() * v.toDouble()
            val norm = sqrt(acc)
            ok(
                "D=$dim: |norm - 1| <= ${FrameEmbeddingAggregator.NORM_TOLERANCE}",
                abs(norm - 1.0) <= FrameEmbeddingAggregator.NORM_TOLERANCE,
                "norm=$norm",
            )
            ok("D=$dim: isUnitLength() agrees", r.isUnitLength())
        }

        // The tolerance is documented; assert the documented value so
        // it cannot be loosened silently to hide a regression.
        ok(
            "documented tolerance is 1e-4",
            close(FrameEmbeddingAggregator.NORM_TOLERANCE, 1e-4, 1e-12),
        )
    }

    // ------------------------------------------------------------
    /** Same input, same bytes out. Every time. */
    private fun testDeterminism() {
        section("6. Determinism across repeated runs")

        val rng = java.util.Random(4242L)
        val frames = FloatArray(41 * 1024) { rng.nextGaussian().toFloat() }

        val first = FrameEmbeddingAggregator.aggregate(frames, 41, 1024).vector
        var identical = true
        repeat(5) {
            val again = FrameEmbeddingAggregator.aggregate(frames, 41, 1024).vector
            // Bit-exact, not approximate: floating-point summation in
            // a fixed order is fully reproducible, so anything less
            // would mean hidden state or a parallel reduction.
            if (!again.contentEquals(first)) identical = false
        }
        ok("6 runs produce bit-identical vectors", identical)

        val stdA = FrameEmbeddingAggregator.aggregate(
            frames, 41, 1024, AggregationStrategy.MEAN_STD,
        ).vector
        val stdB = FrameEmbeddingAggregator.aggregate(
            frames, 41, 1024, AggregationStrategy.MEAN_STD,
        ).vector
        ok("MEAN_STD is also bit-identical", stdA.contentEquals(stdB))

        // Order matters to the caller, not to the aggregator's
        // reproducibility: the SAME buffer must give the same answer,
        // which is what a stored embedding depends on.
        val copy = frames.copyOf()
        ok(
            "a copied buffer gives the same vector",
            FrameEmbeddingAggregator.aggregate(copy, 41, 1024).vector.contentEquals(first),
        )
        ok("input buffer was not mutated", copy.contentEquals(frames))
    }

    // ------------------------------------------------------------
    /** N x 1024 -> 1024. The width survives pooling. */
    private fun testDimensionPreservation() {
        section("7. Dimension preservation: N x 1024 -> 1024")

        val rng = java.util.Random(7L)
        val frames = FloatArray(13 * 1024) { rng.nextFloat() }
        val r = FrameEmbeddingAggregator.aggregate(frames, 13, 1024)
        ok("output width is 1024", r.dimension == 1024, "got ${r.dimension}")
        ok("vector length matches dimension", r.vector.size == r.dimension)
        // 13 x 1024 = 13312. The flattened count must never be
        // mistaken for the width - that was the 208921 bug.
        ok("output is not the flattened count", r.dimension != 13 * 1024)
        ok("input width recorded separately", r.inputDimension == 1024)
        ok(
            "strategy declares the same width",
            AggregationStrategy.MEAN.outputDimension(1024) == 1024,
        )
    }

    // ------------------------------------------------------------
    /** Frame count must not leak into the output width. */
    private fun testFrameCountIndependence() {
        section("8. Frame-count independence: 2 and 401 both -> 1024")

        val rng = java.util.Random(99L)
        val two = FrameEmbeddingAggregator.aggregate(
            FloatArray(2 * 1024) { rng.nextGaussian().toFloat() }, 2, 1024,
        )
        val many = FrameEmbeddingAggregator.aggregate(
            FloatArray(401 * 1024) { rng.nextGaussian().toFloat() }, 401, 1024,
        )
        ok("2 frames -> 1024", two.dimension == 1024, "got ${two.dimension}")
        ok("401 frames -> 1024", many.dimension == 1024, "got ${many.dimension}")
        ok("both are unit length", two.isUnitLength() && many.isUnitLength())
        ok("frame counts are recorded distinctly", two.inputFrameCount == 2 && many.inputFrameCount == 401)

        // A constant track: every frame identical. The mean must be
        // that frame, no matter how many times it repeats — this is
        // what makes two tracks of different length comparable.
        val one = floatArrayOf(1f, 2f, 3f, 4f)
        val repeatedShort = FloatArray(3 * 4) { one[it % 4] }
        val repeatedLong = FloatArray(400 * 4) { one[it % 4] }
        val a = FrameEmbeddingAggregator.aggregate(repeatedShort, 3, 4)
        val b = FrameEmbeddingAggregator.aggregate(repeatedLong, 400, 4)
        ok("identical frames pool to the same vector regardless of N", arraysClose(a.vector, b.vector, 1e-6f))
    }

    // ------------------------------------------------------------
    /** NaN and infinity are rejected, never averaged away. */
    private fun testNonFiniteHandling() {
        section("9. NaN / Inf rejection")

        for ((label, bad) in listOf(
            "NaN" to Float.NaN,
            "+Inf" to Float.POSITIVE_INFINITY,
            "-Inf" to Float.NEGATIVE_INFINITY,
        )) {
            val frames = FloatArray(5 * 8) { 1f }
            frames[17] = bad
            var threw = false
            var msg = ""
            try {
                FrameEmbeddingAggregator.aggregate(frames, 5, 8)
            } catch (e: InferenceException) {
                threw = true
                msg = e.message ?: ""
            }
            ok("$label is rejected", threw)
            ok("$label error names the count", msg.contains("1 non-finite"), msg)
        }

        // Clean input must NOT be rejected. A check that fires on
        // everything is worthless.
        var cleanThrew = false
        try {
            FrameEmbeddingAggregator.aggregate(FloatArray(5 * 8) { 1f }, 5, 8)
        } catch (e: InferenceException) {
            cleanThrew = true
        }
        ok("finite input is accepted", !cleanThrew)

        // The result is never NaN: rejection happens BEFORE pooling,
        // so a poisoned column can never reach the output.
        val huge = FloatArray(4 * 4) { 3.0e38f }
        val r = runCatching { FrameEmbeddingAggregator.aggregate(huge, 4, 4) }
        ok(
            "very large finite input still yields finite output",
            r.isSuccess && r.getOrThrow().vector.all { it.isFinite() },
        )
    }

    // ------------------------------------------------------------
    /**
     * The one that would have caught the original bug: a class-score
     * tensor offered as an embedding must be REJECTED, not reshaped.
     */
    private fun testWrongTensorRejection() {
        section("10. Wrong-tensor rejection: [N,521] is not an embedding")

        // The exact shape from the device run: 401 x 521 = 208921
        // AudioSet class scores.
        val classScores = FloatArray(401 * 521) { 0.5f }

        // Claiming [401, 1024] over a 521-wide buffer must fail. If it
        // did not, the aggregator would return a confident,
        // well-formed, entirely meaningless 1024-d vector.
        var threw = false
        var msg = ""
        try {
            FrameEmbeddingAggregator.aggregate(classScores, 401, 1024)
        } catch (e: InferenceException) {
            threw = true
            msg = e.message ?: ""
        }
        ok("[401,521] buffer claimed as [401,1024] is rejected", threw)
        ok("the error refuses to reshape", msg.contains("Refusing to reshape"), msg)
        ok("the error states both counts", msg.contains("208921") && msg.contains("410624"), msg)

        // 208921 is prime-factored 401 x 521 and nothing else, so no
        // other framing of this buffer is even arithmetically
        // available. Assert that, since it is why the rejection is
        // safe rather than merely conservative.
        ok("208921 == 401 * 521", 401 * 521 == 208921)
        ok("208921 is not divisible by 1024", 208921 % 1024 != 0)
        ok("208921 is not divisible by 64", 208921 % 64 != 0)

        // Shapes that are internally consistent but wrong-rolled must
        // also fail: 208921 elements cannot be [521, 401] AND
        // [401, 521] at once for a caller who knows D.
        var strayThrew = false
        try {
            FrameEmbeddingAggregator.aggregate(classScores, 400, 521)
        } catch (e: InferenceException) {
            strayThrew = true
        }
        ok("an off-by-one frame count is rejected", strayThrew)

        // Degenerate shapes.
        for ((label, n, d) in listOf(
            Triple("zero frames", 0, 1024),
            Triple("negative frames", -1, 1024),
            Triple("zero dimension", 4, 0),
        )) {
            var t = false
            try {
                FrameEmbeddingAggregator.aggregate(FloatArray(16), n, d)
            } catch (e: InferenceException) {
                t = true
            }
            ok("$label is rejected", t)
        }

        // And the positive control: the CORRECT shape is accepted.
        val real = FloatArray(401 * 1024) { 0.01f }
        val okResult = runCatching { FrameEmbeddingAggregator.aggregate(real, 401, 1024) }
        ok("the genuine [401,1024] tensor is accepted", okResult.isSuccess)
        ok("and yields 1024 dimensions", okResult.getOrNull()?.dimension == 1024)
    }

    // ------------------------------------------------------------
    /** MEAN_STD is 2x wide and must never be presented otherwise. */
    private fun testMeanStdWidth() {
        section("11. MEAN_STD is 2D wide, not D")

        // [[1,2],[3,4]]: means [2,3], population sd [1,1].
        val r = FrameEmbeddingAggregator.aggregate(
            floatArrayOf(1f, 2f, 3f, 4f), 2, 2,
            AggregationStrategy.MEAN_STD, normalise = false,
        )
        ok("width is 4, not 2", r.dimension == 4, "got ${r.dimension}")
        ok("first half is the mean", arraysClose(r.vector.copyOfRange(0, 2), floatArrayOf(2f, 3f)))
        ok("second half is the population sd", arraysClose(r.vector.copyOfRange(2, 4), floatArrayOf(1f, 1f)))
        ok("input width still reported as 2", r.inputDimension == 2)
        ok("strategy declares 2x width", AggregationStrategy.MEAN_STD.outputDimension(1024) == 2048)

        // A single frame has zero spread. Population (N), not sample
        // (N-1), so this is 0 rather than a divide-by-zero NaN.
        val single = FrameEmbeddingAggregator.aggregate(
            floatArrayOf(3f, 4f), 1, 2,
            AggregationStrategy.MEAN_STD, normalise = false,
        )
        ok("single frame sd is exactly 0", single.vector[2] == 0f && single.vector[3] == 0f)
        ok("single frame sd is not NaN", single.vector.all { it.isFinite() })

        // 1024 in -> 2048 out. The number a caller must never confuse
        // with the MEAN baseline.
        val wide = FrameEmbeddingAggregator.aggregate(
            FloatArray(5 * 1024) { 0.1f }, 5, 1024, AggregationStrategy.MEAN_STD,
        )
        ok("1024-wide input gives 2048-wide output", wide.dimension == 2048)
        ok("MEAN and MEAN_STD widths differ", wide.dimension != 1024)
    }

    // ------------------------------------------------------------
    /**
     * Integration: the three tensors of the verified device contract
     * are three DIFFERENT things, and only one is aggregatable.
     */
    private fun testContractIntegration() {
        section("12. Integration: CLASS_SCORES vs FRAME_EMBEDDINGS vs TRACK_EMBEDDING")

        val frames = 401
        val rng = java.util.Random(16L)

        // output_0: [401, 521] AudioSet class scores. NOT an embedding.
        val classScores = FloatArray(frames * 521) { rng.nextFloat() }
        // output_1: [401, 1024] per-frame embeddings. The right one.
        val frameEmbeddings = FloatArray(frames * 1024) { rng.nextGaussian().toFloat() }
        // output_2: [~401, 64] in-graph log-mel. Also not an embedding.
        val logMel = FloatArray(frames * 64) { rng.nextFloat() }

        ok("class scores flatten to 208921", classScores.size == 208921)
        ok("frame embeddings flatten to 410624", frameEmbeddings.size == 410624)
        ok("log-mel flattens to 25664", logMel.size == 25664)
        ok("all three flattened counts differ", setOf(classScores.size, frameEmbeddings.size, logMel.size).size == 3)

        // Only output_1 aggregates.
        val track = FrameEmbeddingAggregator.aggregate(frameEmbeddings, frames, 1024)
        ok("TRACK EMBEDDING is 1024-d", track.dimension == 1024)
        ok("TRACK EMBEDDING is unit length", track.isUnitLength())
        ok("TRACK EMBEDDING is finite", track.vector.all { it.isFinite() })
        ok("TRACK EMBEDDING is not 208921-d", track.dimension != 208921)
        ok("TRACK EMBEDDING is not 410624-d", track.dimension != 410624)
        ok("TRACK EMBEDDING is narrower than one frame row is long", track.dimension * frames == frameEmbeddings.size)

        // The other two are refused when presented as [N,1024].
        for ((label, buf) in listOf("class scores" to classScores, "log-mel" to logMel)) {
            var threw = false
            try {
                FrameEmbeddingAggregator.aggregate(buf, frames, 1024)
            } catch (e: InferenceException) {
                threw = true
            }
            ok("$label rejected when claimed as [401,1024]", threw)
        }

        // The distinction the UI must preserve: 208921 is a FLATTENED
        // COUNT of a class-score tensor, and 1024 is an embedding
        // WIDTH. They are not the same kind of number.
        ok("flattened count != embedding width", classScores.size != track.dimension)
        ok(
            "one frame row of embeddings is itself 1024 wide",
            frameEmbeddings.size / frames == 1024,
        )

        // Aggregation timing is measured and non-negative, and is a
        // separate figure from anything inferenceMs contains.
        ok("aggregationMs is recorded", track.aggregationMs >= 0.0)
        ok("aggregationMs is finite", track.aggregationMs.isFinite())
    }
}
