package com.systema.music.inference

import kotlin.math.abs

/**
 * Executed arithmetic for the Phase 18 labelled evaluation.
 *
 * Every number below was worked out by hand and is checked against
 * what the code actually computes. These functions decide whether the
 * phase reports separation or overlap, so reviewing them is not
 * enough - they are run.
 *
 * Run via scripts/run-inference-tests.sh.
 */
object LabeledPairTest {

    private var passed = 0
    private var failed = 0
    private val failures = ArrayList<String>()

    private const val EPS = 1e-9

    private fun ok(name: String, condition: Boolean, detail: String = "") {
        if (condition) {
            passed++
        } else {
            failed++
            failures.add(name)
            println("  FAIL  $name${if (detail.isEmpty()) "" else " — $detail"}")
        }
    }

    private fun near(name: String, actual: Double, expected: Double, eps: Double = 1e-6) {
        ok(name, abs(actual - expected) <= eps, "expected $expected, got $actual")
    }

    private fun section(t: String) = println("\n$t")

    @JvmStatic
    fun main(args: Array<String>) {
        println("Phase 18 — labelled pair evaluation")

        // ----------------------------------------------------------
        section("1. Label parsing never invents ground truth")
        // ----------------------------------------------------------
        ok("SAME parses", PairLabel.parse("SAME") == PairLabel.SAME)
        ok("SIMILAR parses", PairLabel.parse("SIMILAR") == PairLabel.SIMILAR)
        ok("DIFFERENT parses", PairLabel.parse("DIFFERENT") == PairLabel.DIFFERENT)
        ok("lowercase parses", PairLabel.parse("similar") == PairLabel.SIMILAR)
        ok("whitespace tolerated", PairLabel.parse("  same  ") == PairLabel.SAME)

        // The critical one: an unknown label must NOT silently become
        // DIFFERENT. That would manufacture negatives for every pair
        // nobody had labelled, and negatives are what the separation
        // statistic is measured against.
        ok("unknown -> null, NOT DIFFERENT", PairLabel.parse("kinda") == null)
        ok("null -> null", PairLabel.parse(null) == null)
        ok("blank -> null", PairLabel.parse("   ") == null)
        ok("empty -> null", PairLabel.parse("") == null)
        ok("there are exactly three labels", PairLabel.entries.size == 3)

        // ----------------------------------------------------------
        section("2. AUC — the threshold-free separation statistic")
        // ----------------------------------------------------------

        // Perfectly separated: every higher value beats every lower.
        near(
            "disjoint sets give AUC 1.0",
            LabeledPairEvaluation.auc(listOf(0.9, 0.8, 0.7), listOf(0.3, 0.2, 0.1)),
            1.0,
        )
        // Reversed: the hypothesis is wrong and the statistic says so.
        near(
            "reversed sets give AUC 0.0",
            LabeledPairEvaluation.auc(listOf(0.1, 0.2), listOf(0.8, 0.9)),
            0.0,
        )
        // Identical sets: pure chance. Every comparison is a tie, and
        // ties count as half, so 0.5 exactly.
        near(
            "identical sets give AUC 0.5",
            LabeledPairEvaluation.auc(listOf(0.5, 0.5), listOf(0.5, 0.5)),
            0.5,
        )
        // Hand-computed: higher={0.6,0.4}, lower={0.5,0.3}.
        // 0.6>0.5 ✓, 0.6>0.3 ✓, 0.4<0.5 ✗, 0.4>0.3 ✓  => 3/4
        near(
            "interleaved sets give the hand-computed 0.75",
            LabeledPairEvaluation.auc(listOf(0.6, 0.4), listOf(0.5, 0.3)),
            0.75,
        )
        // One tie: higher={0.5}, lower={0.5,0.1}. Tie=0.5, win=1 => 1.5/2
        near(
            "a single tie contributes exactly one half",
            LabeledPairEvaluation.auc(listOf(0.5), listOf(0.5, 0.1)),
            0.75,
        )
        // Empty input is unmeasured, not chance.
        ok(
            "empty higher gives NaN, not 0.5",
            LabeledPairEvaluation.auc(emptyList(), listOf(0.1)).isNaN(),
        )
        ok(
            "empty lower gives NaN, not 0.5",
            LabeledPairEvaluation.auc(listOf(0.1), emptyList()).isNaN(),
        )

        // AUC must depend only on ORDER, not on the values' scale.
        // This is what makes it threshold-free.
        val a1 = LabeledPairEvaluation.auc(listOf(0.9, 0.8), listOf(0.7, 0.6))
        val a2 = LabeledPairEvaluation.auc(listOf(0.99, 0.98), listOf(0.97, 0.96))
        near("AUC is scale-invariant (rank-only)", a1, a2)

        // ----------------------------------------------------------
        section("3. Class statistics are grouped by LABEL, never by score")
        // ----------------------------------------------------------
        val results = listOf(
            res(1, PairLabel.SAME, 1.0),
            res(2, PairLabel.SIMILAR, 0.9),
            res(3, PairLabel.SIMILAR, 0.8),
            res(4, PairLabel.SIMILAR, 0.7),
            res(5, PairLabel.DIFFERENT, 0.6),
            res(6, PairLabel.DIFFERENT, 0.5),
            res(7, PairLabel.DIFFERENT, 0.4),
        )
        val cls = LabeledPairEvaluation.classStatistics(results)
        ok("three classes present", cls.size == 3)
        ok("SAME has 1 pair", cls[PairLabel.SAME]!!.stats.pairCount == 1)
        ok("SIMILAR has 3 pairs", cls[PairLabel.SIMILAR]!!.stats.pairCount == 3)
        ok("DIFFERENT has 3 pairs", cls[PairLabel.DIFFERENT]!!.stats.pairCount == 3)
        near("SIMILAR mean is 0.8", cls[PairLabel.SIMILAR]!!.stats.mean, 0.8)
        near("DIFFERENT mean is 0.5", cls[PairLabel.DIFFERENT]!!.stats.mean, 0.5)
        near("SIMILAR median is 0.8", cls[PairLabel.SIMILAR]!!.stats.median, 0.8)

        // A single-pair class is a point, not a distribution.
        ok("a 1-pair class is flagged insufficient", cls[PairLabel.SAME]!!.insufficient)
        ok("a 3-pair class is not flagged", !cls[PairLabel.SIMILAR]!!.insufficient)

        // A high-cosine DIFFERENT pair must stay in DIFFERENT. If
        // grouping ever keyed off the score, this pair would migrate.
        val adversarial = listOf(
            res(1, PairLabel.DIFFERENT, 0.99),
            res(2, PairLabel.DIFFERENT, 0.98),
            res(3, PairLabel.DIFFERENT, 0.97),
            res(4, PairLabel.SIMILAR, 0.10),
        )
        val advCls = LabeledPairEvaluation.classStatistics(adversarial)
        ok(
            "a 0.99 pair labelled DIFFERENT stays in DIFFERENT",
            advCls[PairLabel.DIFFERENT]!!.stats.pairCount == 3,
        )
        near(
            "and its mean reflects those high scores",
            advCls[PairLabel.DIFFERENT]!!.stats.mean,
            0.98,
        )
        ok(
            "a 0.10 pair labelled SIMILAR stays in SIMILAR",
            advCls[PairLabel.SIMILAR]!!.stats.pairCount == 1,
        )

        // ----------------------------------------------------------
        section("4. Overlap measurement")
        // ----------------------------------------------------------
        val disjoint = LabeledPairEvaluation.compare(
            PairLabel.SIMILAR, listOf(0.9, 0.85, 0.8),
            PairLabel.DIFFERENT, listOf(0.3, 0.25, 0.2),
        )
        near("disjoint ranges: AUC 1.0", disjoint.auc, 1.0)
        near("disjoint ranges: overlap 0", disjoint.rangeOverlap, 0.0)
        ok("disjoint ranges: no crossing pairs", disjoint.overlappingPairs == 0)
        near("disjoint ranges: meanGap 0.6", disjoint.meanGap, 0.85 - 0.25)

        val overlapping = LabeledPairEvaluation.compare(
            PairLabel.SIMILAR, listOf(0.9, 0.7, 0.5),
            PairLabel.DIFFERENT, listOf(0.8, 0.6, 0.4),
        )
        // Shared interval is [0.5, 0.8] => width 0.3
        near("overlapping ranges measured", overlapping.rangeOverlap, 0.3, 1e-9)
        ok("overlapping ranges: crossing pairs counted", overlapping.overlappingPairs > 0)
        ok(
            "overlap fraction is a proportion of all pairs",
            overlapping.overlapFraction > 0.0 && overlapping.overlapFraction <= 1.0,
        )

        // ----------------------------------------------------------
        section("5. Verdicts follow the evidence")
        // ----------------------------------------------------------

        // Not enough labelled pairs -> INSUFFICIENT_DATA, never a verdict.
        val tiny = listOf(res(1, PairLabel.SAME, 1.0), res(2, PairLabel.DIFFERENT, 0.5))
        ok(
            "two pairs give INSUFFICIENT_DATA",
            LabeledPairEvaluation.analyse(tiny).verdict == SeparationVerdict.INSUFFICIENT_DATA,
        )

        // SAME present but SIMILAR absent is still insufficient: the
        // headline comparison is SIMILAR vs DIFFERENT.
        val noSimilar = listOf(
            res(1, PairLabel.SAME, 1.0), res(2, PairLabel.SAME, 0.99), res(3, PairLabel.SAME, 0.98),
            res(4, PairLabel.DIFFERENT, 0.3), res(5, PairLabel.DIFFERENT, 0.2),
            res(6, PairLabel.DIFFERENT, 0.1),
        )
        ok(
            "SAME vs DIFFERENT alone is INSUFFICIENT_DATA",
            LabeledPairEvaluation.analyse(noSimilar).verdict ==
                SeparationVerdict.INSUFFICIENT_DATA,
        )

        // Perfect ordering with no overlap -> CLEAR.
        val clean = listOf(
            res(1, PairLabel.SIMILAR, 0.95), res(2, PairLabel.SIMILAR, 0.92),
            res(3, PairLabel.SIMILAR, 0.90), res(4, PairLabel.SIMILAR, 0.88),
            res(5, PairLabel.DIFFERENT, 0.30), res(6, PairLabel.DIFFERENT, 0.25),
            res(7, PairLabel.DIFFERENT, 0.20), res(8, PairLabel.DIFFERENT, 0.15),
        )
        val cleanA = LabeledPairEvaluation.analyse(clean)
        ok("cleanly separated -> CLEAR_SEPARATION",
            cleanA.verdict == SeparationVerdict.CLEAR_SEPARATION, cleanA.rationale)

        // Indistinguishable -> HEAVY_OVERLAP.
        val mush = listOf(
            res(1, PairLabel.SIMILAR, 0.75), res(2, PairLabel.SIMILAR, 0.73),
            res(3, PairLabel.SIMILAR, 0.71), res(4, PairLabel.SIMILAR, 0.69),
            res(5, PairLabel.DIFFERENT, 0.74), res(6, PairLabel.DIFFERENT, 0.72),
            res(7, PairLabel.DIFFERENT, 0.70), res(8, PairLabel.DIFFERENT, 0.68),
        )
        val mushA = LabeledPairEvaluation.analyse(mush)
        ok("interleaved -> HEAVY_OVERLAP",
            mushA.verdict == SeparationVerdict.HEAVY_OVERLAP, mushA.rationale)

        // Ordered but overlapping -> PARTIAL, not CLEAR.
        val partial = listOf(
            res(1, PairLabel.SIMILAR, 0.95), res(2, PairLabel.SIMILAR, 0.90),
            res(3, PairLabel.SIMILAR, 0.85), res(4, PairLabel.SIMILAR, 0.60),
            res(5, PairLabel.DIFFERENT, 0.70), res(6, PairLabel.DIFFERENT, 0.50),
            res(7, PairLabel.DIFFERENT, 0.40), res(8, PairLabel.DIFFERENT, 0.30),
        )
        val partialA = LabeledPairEvaluation.analyse(partial)
        ok("ordered-but-overlapping -> PARTIAL_SEPARATION",
            partialA.verdict == SeparationVerdict.PARTIAL_SEPARATION, partialA.rationale)

        // Backwards geometry must never read as separation.
        val backwards = listOf(
            res(1, PairLabel.SIMILAR, 0.20), res(2, PairLabel.SIMILAR, 0.25),
            res(3, PairLabel.SIMILAR, 0.30), res(4, PairLabel.SIMILAR, 0.35),
            res(5, PairLabel.DIFFERENT, 0.90), res(6, PairLabel.DIFFERENT, 0.92),
            res(7, PairLabel.DIFFERENT, 0.94), res(8, PairLabel.DIFFERENT, 0.96),
        )
        val backA = LabeledPairEvaluation.analyse(backwards)
        ok("inverted ordering -> HEAVY_OVERLAP, never CLEAR",
            backA.verdict == SeparationVerdict.HEAVY_OVERLAP, backA.rationale)
        val backHeadline = backA.comparisons.first {
            it.higher == PairLabel.SIMILAR && it.lower == PairLabel.DIFFERENT
        }
        near("inverted ordering drives AUC to 0.0", backHeadline.auc, 0.0)

        ok("analyse always reports all three comparisons",
            cleanA.comparisons.size == 3)
        ok("a rationale is always supplied", cleanA.rationale.isNotBlank() &&
            mushA.rationale.isNotBlank() && backA.rationale.isNotBlank())

        // ----------------------------------------------------------
        section("6. The per-pair reading aid is not a fixed threshold")
        // ----------------------------------------------------------

        // Below the minimum, there is no reference at all.
        ok("no reference from 0 DIFFERENT pairs",
            LabeledPairEvaluation.referenceMedian(emptyList()).isNaN())
        ok("no reference from 2 DIFFERENT pairs",
            LabeledPairEvaluation.referenceMedian(
                listOf(res(1, PairLabel.DIFFERENT, 0.5), res(2, PairLabel.DIFFERENT, 0.6)),
            ).isNaN())

        val refSet = listOf(
            res(1, PairLabel.DIFFERENT, 0.4),
            res(2, PairLabel.DIFFERENT, 0.5),
            res(3, PairLabel.DIFFERENT, 0.6),
        )
        near("reference is the measured DIFFERENT median",
            LabeledPairEvaluation.referenceMedian(refSet), 0.5)

        // The reference MOVES with the data — proving it is not a constant.
        val refSet2 = refSet + listOf(
            res(4, PairLabel.DIFFERENT, 0.9),
            res(5, PairLabel.DIFFERENT, 0.95),
        )
        val movedRef = LabeledPairEvaluation.referenceMedian(refSet2)
        near("the reference moves as data arrives", movedRef, 0.6)
        ok("so it is data-derived, not hardcoded", abs(movedRef - 0.5) > EPS)

        ok("unscored without a reference",
            LabeledPairEvaluation.outcomeFor(PairLabel.SIMILAR, 0.9, Double.NaN) ==
                PairOutcome.NOT_SCORED)
        ok("SIMILAR above reference is CONSISTENT",
            LabeledPairEvaluation.outcomeFor(PairLabel.SIMILAR, 0.9, 0.5) ==
                PairOutcome.CONSISTENT)
        ok("SIMILAR below reference is INCONSISTENT",
            LabeledPairEvaluation.outcomeFor(PairLabel.SIMILAR, 0.3, 0.5) ==
                PairOutcome.INCONSISTENT)
        ok("SAME above reference is CONSISTENT",
            LabeledPairEvaluation.outcomeFor(PairLabel.SAME, 1.0, 0.5) ==
                PairOutcome.CONSISTENT)
        ok("DIFFERENT at or below reference is CONSISTENT",
            LabeledPairEvaluation.outcomeFor(PairLabel.DIFFERENT, 0.5, 0.5) ==
                PairOutcome.CONSISTENT)
        ok("DIFFERENT above reference is INCONSISTENT",
            LabeledPairEvaluation.outcomeFor(PairLabel.DIFFERENT, 0.9, 0.5) ==
                PairOutcome.INCONSISTENT)
        ok("a NaN cosine is never scored",
            LabeledPairEvaluation.outcomeFor(PairLabel.SAME, Double.NaN, 0.5) ==
                PairOutcome.NOT_SCORED)

        // ----------------------------------------------------------
        section("7. Diagonal exclusion and pair enumeration")
        // ----------------------------------------------------------
        val unit = FloatArray(1024) { if (it == 0) 1f else 0f }
        val vectors = List(13) { k ->
            FloatArray(1024) { i -> if (i == k % 1024) 1f else 0f }
        }
        val pairs = EmbeddingSimilarity.pairwise(vectors)
        ok("13 tracks give exactly 78 pairs", pairs.size == 78, "${pairs.size}")
        ok("no pair is a track with itself", pairs.none { it.i == it.j })
        ok("every pair is upper-triangular", pairs.all { it.i < it.j })
        ok("pairs are unique", pairs.map { it.i to it.j }.toSet().size == 78)
        near("a vector with itself is 1.0", EmbeddingSimilarity.cosine(unit, unit), 1.0)

        // 78 = 13*12/2 — the diagonal's 13 entries are excluded, and so
        // is the lower triangle.
        ok("78 == n(n-1)/2 for n=13", 13 * 12 / 2 == 78)

        // ----------------------------------------------------------
        section("8. Cosine stability — repeatability (Part 8)")
        // ----------------------------------------------------------
        val v1 = FloatArray(1024) { kotlin.math.sin(it * 0.01).toFloat() }
        val v2 = FloatArray(1024) { kotlin.math.cos(it * 0.017).toFloat() }
        val n1 = normalise(v1)
        val n2 = normalise(v2)
        val first = EmbeddingSimilarity.cosine(n1, n2)
        var stable = true
        repeat(50) { if (EmbeddingSimilarity.cosine(n1, n2) != first) stable = false }
        ok("cosine is bit-identical across 50 calls", stable)

        // Recomputed from a fresh copy: same inputs, same answer.
        val copy1 = n1.copyOf()
        val copy2 = n2.copyOf()
        near("cosine of copied inputs is identical",
            EmbeddingSimilarity.cosine(copy1, copy2), first, 0.0)
        // Symmetry: cos(a,b) == cos(b,a). A matrix built either way agrees.
        near("cosine is symmetric",
            EmbeddingSimilarity.cosine(n2, n1), first, 1e-12)

        // ----------------------------------------------------------
        section("9. Statistics never include the diagonal")
        // ----------------------------------------------------------
        // Off-diagonal only: mean of {0.4,0.5,0.6} is 0.5. Adding three
        // 1.0 diagonal entries would pull it to 0.75 — that is what
        // this guards.
        val offDiag = listOf(0.4, 0.5, 0.6)
        val st = EmbeddingSimilarity.statistics(offDiag)!!
        near("mean over off-diagonal pairs only", st.mean, 0.5)
        val withDiag = EmbeddingSimilarity.statistics(offDiag + listOf(1.0, 1.0, 1.0))!!
        ok("including the diagonal would change the mean",
            abs(withDiag.mean - st.mean) > 0.2)

        // ----------------------------------------------------------
        section("10. Class stats reproduce the Phase 17 numbers")
        // ----------------------------------------------------------
        // Guards the shared statistics path against drift: Phase 17
        // reported mean 0.7439 / median 0.7444 / min 0.4977 / max 1.0
        // over 78 pairs. A synthetic set with those properties must
        // still summarise to them.
        val synth = ArrayList<Double>()
        synth.add(1.0)
        synth.add(0.4977)
        repeat(38) { synth.add(0.7444) }
        repeat(38) { synth.add(0.7444) }
        val s17 = EmbeddingSimilarity.statistics(synth)!!
        ok("78 pairs in, 78 counted", s17.pairCount == 78, "${s17.pairCount}")
        near("median matches the reported 0.7444", s17.median, 0.7444, 1e-9)
        near("min matches the reported 0.4977", s17.min, 0.4977, 1e-9)
        near("max matches the reported 1.0000", s17.max, 1.0, 1e-9)
        ok("min is strictly below max", s17.min < s17.max)
        ok("p25 <= median <= p75", s17.p25 <= s17.median && s17.median <= s17.p75)

        // ----------------------------------------------------------
        section("11. Empty and degenerate input")
        // ----------------------------------------------------------
        ok("no results -> no classes", LabeledPairEvaluation.classStatistics(emptyList()).isEmpty())
        val emptyA = LabeledPairEvaluation.analyse(emptyList())
        ok("no results -> INSUFFICIENT_DATA",
            emptyA.verdict == SeparationVerdict.INSUFFICIENT_DATA)
        ok("no results still explains itself", emptyA.rationale.isNotBlank())
        val onlySame = List(5) { res(it, PairLabel.SAME, 0.99) }
        ok("one populated class -> INSUFFICIENT_DATA",
            LabeledPairEvaluation.analyse(onlySame).verdict ==
                SeparationVerdict.INSUFFICIENT_DATA)

        val cmpEmpty = LabeledPairEvaluation.compare(
            PairLabel.SIMILAR, emptyList(), PairLabel.DIFFERENT, listOf(0.5),
        )
        ok("comparing against an empty class is insufficient", cmpEmpty.insufficient)
        ok("and yields NaN rather than a number", cmpEmpty.auc.isNaN())

        // ----------------------------------------------------------
        section("12. Phase 16A aggregation is untouched")
        // ----------------------------------------------------------
        // MEAN pooling + L2 must still behave exactly as Phase 16A
        // device-verified it. Two frames, 4 dims.
        val frames = floatArrayOf(
            1f, 0f, 0f, 0f,
            0f, 1f, 0f, 0f,
        )
        val pooled = FrameEmbeddingAggregator.aggregate(
            frames = frames,
            frameCount = 2,
            dimension = 4,
            strategy = AggregationStrategy.MEAN,
        )
        ok("MEAN pooling yields one vector of the frame width", pooled.dimension == 4)
        ok("the input frame count is recorded", pooled.inputFrameCount == 2)
        ok("the strategy is recorded as MEAN", pooled.strategy == AggregationStrategy.MEAN)
        // mean = (0.5, 0.5, 0, 0); L2 norm = 0.7071; normalised = 0.7071 each
        near("dim 0 is L2-normalised mean", pooled.vector[0].toDouble(), 0.70710678, 1e-6)
        near("dim 1 is L2-normalised mean", pooled.vector[1].toDouble(), 0.70710678, 1e-6)
        near("unused dims stay zero", pooled.vector[2].toDouble(), 0.0, 1e-9)
        near("the pre-normalisation L2 is the raw mean's norm",
            pooled.preNormL2, 0.70710678, 1e-6)
        near("the result is unit length",
            EmbeddingSimilarity.l2Norm(pooled.vector), 1.0, 1e-6)

        // ----------------------------------------------------------
        println("\n============================================================")
        println("  $passed passed, $failed failed")
        println("============================================================")
        if (failures.isNotEmpty()) println("  failing: ${failures.joinToString(", ")}")
        if (failed > 0) throw AssertionError("$failed labelled-pair assertion(s) failed")
    }

    private fun res(pos: Int, label: PairLabel, cosine: Double) = LabeledPairResult(
        position = pos,
        indexA = pos,
        indexB = pos + 1,
        trackIdA = "a$pos",
        trackIdB = "b$pos",
        label = label,
        source = LabelSource.HUMAN,
        cosine = cosine,
        outcome = PairOutcome.NOT_SCORED,
        referenceValue = Double.NaN,
    )

    private fun normalise(v: FloatArray): FloatArray {
        var acc = 0.0
        for (x in v) acc += x.toDouble() * x
        val n = kotlin.math.sqrt(acc)
        return FloatArray(v.size) { (v[it] / n).toFloat() }
    }
}
