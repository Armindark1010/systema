package com.systema.music.inference


/**
 * Human relationship label for one PAIR of tracks.
 *
 * The label describes the pair, not either track. It is supplied by a
 * person before any cosine is looked at, and nothing in this file can
 * change it. There is deliberately no `fun infer(...)`: a label that
 * the system derives from the measurement it is being used to judge
 * would make the whole evaluation circular.
 */
enum class PairLabel {
    /**
     * The same recording, including a different file, bitrate or
     * encode of it. Two rips of one song are SAME.
     */
    SAME,

    /**
     * Different recordings a person would accept as musically related
     * for search or recommendation - style, mood, instrumentation,
     * era, vocal character. Deliberately not tied to a genre taxonomy.
     */
    SIMILAR,

    /**
     * Musically far enough apart that a recommender should normally
     * rank them away from each other.
     */
    DIFFERENT,
    ;

    companion object {
        /**
         * Parses a label from the bridge. Unknown or blank input
         * returns null, meaning UNLABELED - never a default of
         * DIFFERENT, which would silently invent ground truth for
         * every pair a human had not gotten to yet.
         */
        fun parse(raw: String?): PairLabel? = when (raw?.trim()?.uppercase()) {
            "SAME" -> SAME
            "SIMILAR" -> SIMILAR
            "DIFFERENT" -> DIFFERENT
            else -> null
        }
    }
}

/**
 * A pair a human has judged, before any measurement.
 *
 * [indexA] and [indexB] refer to positions in the evaluated track
 * list. [label] is the human's; [source] records where it came from so
 * a seeded label can never be mistaken for one a person actually
 * entered.
 */
data class LabeledPair(
    val indexA: Int,
    val indexB: Int,
    val label: PairLabel,
    val source: LabelSource,
)

/** Provenance of a label. Displayed next to every result. */
enum class LabelSource {
    /** Entered by a person in the labeling UI. */
    HUMAN,

    /**
     * Pre-filled from an explicitly documented fixture. Still a human
     * judgement - just one made earlier and written down - and it is
     * editable before the run.
     */
    FIXTURE,
}

/**
 * One evaluated pair: the human label and the measured cosine, kept
 * strictly apart.
 *
 * [label] was fixed before [cosine] existed. [consistent] is NOT a
 * per-pair verdict on the model; see [PairOutcome].
 */
data class LabeledPairResult(
    val position: Int,
    val indexA: Int,
    val indexB: Int,
    val trackIdA: String,
    val trackIdB: String,
    val label: PairLabel,
    val source: LabelSource,
    val cosine: Double,
    val outcome: PairOutcome,
    /** The reference value [outcome] was decided against, or NaN. */
    val referenceValue: Double,
)

/**
 * Per-pair reading aid - NOT the phase's conclusion.
 *
 * WHY THIS IS NOT A THRESHOLD
 * ---------------------------
 * Calling a pair CORRECT requires deciding what cosine "should" have
 * been, and any fixed number for that (0.7, 0.8, anything) is invented
 * and makes the evaluation circular: you would be scoring the model
 * against a line you drew by looking at the model.
 *
 * So the reference here is not a constant. It is the MEASURED median
 * of the DIFFERENT-labelled pairs from this very run - a rank
 * comparison against the human-labelled negatives. It moves as more
 * pairs are labelled, and it does not exist at all until enough
 * DIFFERENT pairs have been measured, in which case every pair is
 * honestly NOT_SCORED.
 *
 * The actual conclusion of the phase comes from [SeparationAnalysis],
 * which is fully rank-based and uses no reference point whatsoever.
 */
enum class PairOutcome {
    /**
     * SAME/SIMILAR scoring above the measured DIFFERENT median, or
     * DIFFERENT scoring at or below it. The direction a useful
     * embedding would produce.
     */
    CONSISTENT,

    /** The opposite direction. */
    INCONSISTENT,

    /**
     * No reference distribution yet, or the pair is unlabeled. The
     * only honest answer, and the default.
     */
    NOT_SCORED,
}

/**
 * Statistics for one label class.
 *
 * [insufficient] is true when the class holds too few pairs for its
 * spread to mean anything. A "distribution" of one pair is a point,
 * and reporting a standard deviation of 0.0 for it would look like
 * consistency rather than absence of data.
 */
data class ClassStats(
    val label: PairLabel,
    val stats: SimilarityStats,
    val insufficient: Boolean,
)

/**
 * Threshold-free comparison of two label classes.
 *
 * WHY AUC AND NOT A CUTOFF
 * ------------------------
 * [auc] is the Mann-Whitney U statistic normalised: the probability
 * that a randomly drawn pair from the higher class scores above a
 * randomly drawn pair from the lower one, with ties counted as half.
 *
 * That is exactly the question this phase asks - "does the geometry
 * separate the human labels" - and it answers it without any cutoff
 * at all. 0.5 means the two classes are indistinguishable by cosine.
 * 1.0 means every pair of one class outranks every pair of the other.
 * No number was invented to compute it.
 */
data class ClassSeparation(
    val higher: PairLabel,
    val lower: PairLabel,
    val countHigher: Int,
    val countLower: Int,
    /** Rank-based separation in [0,1]. 0.5 = no separation. */
    val auc: Double,
    /** meanHigher − meanLower. Sign matters; magnitude is cosine units. */
    val meanGap: Double,
    /** Width of the overlapping cosine interval; 0.0 = disjoint ranges. */
    val rangeOverlap: Double,
    /** Pairs lying inside the other class's observed range. */
    val overlappingPairs: Int,
    /** [overlappingPairs] over the total pairs in both classes. */
    val overlapFraction: Double,
    /** True when either class is too small to compare meaningfully. */
    val insufficient: Boolean,
)

/**
 * The phase's conclusion. Four states, no "good" and no "bad".
 *
 * The boundaries between CLEAR/PARTIAL/HEAVY are conventional
 * decision points on a RANK statistic, and they are declared as
 * constants in [LabeledPairEvaluation] so they can be read and argued
 * with. They are not thresholds on cosine, and they are not tuned to
 * make any particular result come out.
 */
enum class SeparationVerdict {
    CLEAR_SEPARATION,
    PARTIAL_SEPARATION,
    HEAVY_OVERLAP,
    INSUFFICIENT_DATA,
}

data class SeparationAnalysis(
    val comparisons: List<ClassSeparation>,
    val verdict: SeparationVerdict,
    /** Plain-language justification naming the numbers used. */
    val rationale: String,
)

/**
 * Statistics over human-labelled track pairs.
 *
 * Everything here is pure arithmetic over numbers that already exist.
 * It performs no inference, holds no model, and cannot change a label.
 */
object LabeledPairEvaluation {

    /**
     * Fewest pairs a class needs before its spread is reported as
     * meaningful.
     *
     * Three is already generous. It is set so that the single
     * SAME pair produced by one duplicated track - which is the
     * expected case for a 13-track set - is reported as INSUFFICIENT
     * rather than as a distribution with zero variance.
     */
    const val MIN_CLASS_PAIRS = 3

    /**
     * DIFFERENT pairs needed before the per-pair reading aid has a
     * reference. Below this, every pair is NOT_SCORED.
     */
    const val MIN_REFERENCE_PAIRS = 3

    /**
     * Conventional decision points on the rank statistic (NOT on
     * cosine). AUC 0.5 is chance; 1.0 is perfect ordering.
     *
     * 0.90 for CLEAR is strict on purpose: at 0.90 one pair in ten
     * still ranks the wrong way round, which is not something to call
     * clean separation without saying so.
     */
    const val AUC_CLEAR = 0.90
    const val AUC_PARTIAL = 0.70

    /**
     * Groups measured pair results by their human label.
     *
     * The grouping key is the label the human gave. The cosine is only
     * ever the value being grouped, never part of the key.
     */
    fun classStatistics(results: List<LabeledPairResult>): Map<PairLabel, ClassStats> {
        val out = LinkedHashMap<PairLabel, ClassStats>()
        for (label in PairLabel.entries) {
            val scores = results.filter { it.label == label }.map { it.cosine }
            val stats = EmbeddingSimilarity.statistics(scores) ?: continue
            out[label] = ClassStats(
                label = label,
                stats = stats,
                insufficient = scores.size < MIN_CLASS_PAIRS,
            )
        }
        return out
    }

    /**
     * Normalised Mann-Whitney U (AUC) for two score sets.
     *
     * Returns NaN when either side is empty - not 0.5, which would
     * read as "measured, and found to be chance".
     *
     * Ties take the average rank, so identical cosines contribute
     * exactly 0.5 rather than being silently ordered by list position.
     */
    fun auc(higher: List<Double>, lower: List<Double>): Double {
        if (higher.isEmpty() || lower.isEmpty()) return Double.NaN

        // Rank the combined sample, averaging ranks within tie groups.
        val combined = ArrayList<Pair<Double, Int>>(higher.size + lower.size)
        higher.forEach { combined.add(it to 0) }
        lower.forEach { combined.add(it to 1) }
        combined.sortBy { it.first }

        val ranks = DoubleArray(combined.size)
        var i = 0
        while (i < combined.size) {
            var j = i
            while (j + 1 < combined.size && combined[j + 1].first == combined[i].first) j++
            // Ranks are 1-based; the tie group shares their mean.
            val avg = (i + j + 2) / 2.0
            for (k in i..j) ranks[k] = avg
            i = j + 1
        }

        var rankSumHigher = 0.0
        for (k in combined.indices) if (combined[k].second == 0) rankSumHigher += ranks[k]

        val nH = higher.size.toDouble()
        val nL = lower.size.toDouble()
        val u = rankSumHigher - nH * (nH + 1) / 2.0
        return u / (nH * nL)
    }

    /**
     * Overlap between two score sets.
     *
     * Reported two ways because they answer different questions:
     * [ClassSeparation.rangeOverlap] is how much of the cosine axis
     * the classes share at all, and [ClassSeparation.overlappingPairs]
     * is how many actual measurements sit inside the other class's
     * span. Two classes can share a wide interval while few pairs
     * actually fall in it.
     */
    fun compare(
        higherLabel: PairLabel,
        higherScores: List<Double>,
        lowerLabel: PairLabel,
        lowerScores: List<Double>,
    ): ClassSeparation {
        val insufficient = higherScores.size < MIN_CLASS_PAIRS ||
            lowerScores.size < MIN_CLASS_PAIRS

        if (higherScores.isEmpty() || lowerScores.isEmpty()) {
            return ClassSeparation(
                higher = higherLabel,
                lower = lowerLabel,
                countHigher = higherScores.size,
                countLower = lowerScores.size,
                auc = Double.NaN,
                meanGap = Double.NaN,
                rangeOverlap = Double.NaN,
                overlappingPairs = 0,
                overlapFraction = Double.NaN,
                insufficient = true,
            )
        }

        val hMin = higherScores.min()
        val hMax = higherScores.max()
        val lMin = lowerScores.min()
        val lMax = lowerScores.max()

        val overlapLo = maxOf(hMin, lMin)
        val overlapHi = minOf(hMax, lMax)
        val rangeOverlap = (overlapHi - overlapLo).coerceAtLeast(0.0)

        val crossing = higherScores.count { it in lMin..lMax } +
            lowerScores.count { it in hMin..hMax }

        return ClassSeparation(
            higher = higherLabel,
            lower = lowerLabel,
            countHigher = higherScores.size,
            countLower = lowerScores.size,
            auc = auc(higherScores, lowerScores),
            meanGap = higherScores.average() - lowerScores.average(),
            rangeOverlap = rangeOverlap,
            overlappingPairs = crossing,
            overlapFraction = crossing.toDouble() / (higherScores.size + lowerScores.size),
            insufficient = insufficient,
        )
    }

    /**
     * The three comparisons this phase reports, plus a verdict.
     *
     * SAME/SIMILAR are expected above DIFFERENT and SAME above
     * SIMILAR. That ordering is the hypothesis being TESTED, not an
     * assumption baked into the maths: if the embedding orders them
     * the other way the AUC drops below 0.5 and the verdict says so.
     */
    fun analyse(results: List<LabeledPairResult>): SeparationAnalysis {
        val byLabel = PairLabel.entries.associateWith { lbl ->
            results.filter { it.label == lbl }.map { it.cosine }
        }
        val same = byLabel.getValue(PairLabel.SAME)
        val similar = byLabel.getValue(PairLabel.SIMILAR)
        val different = byLabel.getValue(PairLabel.DIFFERENT)

        val comparisons = listOf(
            compare(PairLabel.SAME, same, PairLabel.DIFFERENT, different),
            compare(PairLabel.SIMILAR, similar, PairLabel.DIFFERENT, different),
            compare(PairLabel.SAME, same, PairLabel.SIMILAR, similar),
        )

        // The headline comparison is SIMILAR vs DIFFERENT: it is the
        // one that actually decides whether the embedding is useful
        // for recommendation. SAME vs DIFFERENT is a much easier test
        // - near-duplicate detection - and passing only that would not
        // show musical similarity at all.
        val headline = comparisons.first {
            it.higher == PairLabel.SIMILAR && it.lower == PairLabel.DIFFERENT
        }

        val usable = comparisons.filter { !it.insufficient && !it.auc.isNaN() }

        val verdict: SeparationVerdict
        val rationale: String

        if (headline.insufficient || headline.auc.isNaN()) {
            verdict = SeparationVerdict.INSUFFICIENT_DATA
            rationale = buildString {
                append("SIMILAR vs DIFFERENT is the comparison that decides ")
                append("whether the embedding is useful for recommendation, and it ")
                append("does not have enough labelled pairs. SIMILAR=")
                append(similar.size)
                append(", DIFFERENT=")
                append(different.size)
                append("; each needs at least ")
                append(MIN_CLASS_PAIRS)
                append(". No verdict is possible from ")
                append(usable.size)
                append(" usable comparison(s).")
            }
        } else if (headline.auc >= AUC_CLEAR && headline.rangeOverlap <= 0.0) {
            verdict = SeparationVerdict.CLEAR_SEPARATION
            rationale = buildString {
                append("SIMILAR ranks above DIFFERENT with AUC ")
                append(fmt(headline.auc))
                append(" and the two ranges do not overlap at all.")
            }
        } else if (headline.auc >= AUC_CLEAR) {
            verdict = SeparationVerdict.PARTIAL_SEPARATION
            rationale = buildString {
                append("SIMILAR ranks above DIFFERENT with AUC ")
                append(fmt(headline.auc))
                append(", but the ranges still overlap over ")
                append(fmt(headline.rangeOverlap))
                append(" of cosine, with ")
                append(headline.overlappingPairs)
                append(" pair(s) inside the other class's span.")
            }
        } else if (headline.auc >= AUC_PARTIAL) {
            verdict = SeparationVerdict.PARTIAL_SEPARATION
            rationale = buildString {
                append("SIMILAR ranks above DIFFERENT with AUC ")
                append(fmt(headline.auc))
                append(", above chance but below ")
                append(fmt(AUC_CLEAR))
                append(". The classes are distinguishable on average and ")
                append("not reliably per pair.")
            }
        } else {
            verdict = SeparationVerdict.HEAVY_OVERLAP
            rationale = buildString {
                append("SIMILAR vs DIFFERENT AUC is ")
                append(fmt(headline.auc))
                append(" (0.5 would be chance), with ")
                append(fmt(headline.overlapFraction * 100))
                append("% of pairs inside the other class's range. ")
                append("Cosine does not order these human labels.")
            }
        }

        return SeparationAnalysis(comparisons, verdict, rationale)
    }

    /**
     * The live reference for the per-pair reading aid: the median of
     * the DIFFERENT pairs measured so far.
     *
     * Returns NaN until [MIN_REFERENCE_PAIRS] exist, which keeps early
     * pairs honestly NOT_SCORED instead of judged against one or two
     * measurements.
     */
    fun referenceMedian(results: List<LabeledPairResult>): Double {
        val diff = results.filter { it.label == PairLabel.DIFFERENT }.map { it.cosine }
        if (diff.size < MIN_REFERENCE_PAIRS) return Double.NaN
        return EmbeddingSimilarity.statistics(diff)?.median ?: Double.NaN
    }

    /**
     * Classifies one pair against the live reference.
     *
     * Note the asymmetry: SAME and SIMILAR are expected ABOVE the
     * DIFFERENT median and DIFFERENT at or below it. A DIFFERENT pair
     * exactly at its own class median is CONSISTENT - it is, by
     * construction, typical of its class.
     */
    fun outcomeFor(label: PairLabel, cosine: Double, reference: Double): PairOutcome {
        if (reference.isNaN() || cosine.isNaN()) return PairOutcome.NOT_SCORED
        return when (label) {
            PairLabel.SAME, PairLabel.SIMILAR ->
                if (cosine > reference) PairOutcome.CONSISTENT else PairOutcome.INCONSISTENT
            PairLabel.DIFFERENT ->
                if (cosine <= reference) PairOutcome.CONSISTENT else PairOutcome.INCONSISTENT
        }
    }

    private fun fmt(v: Double): String =
        if (v.isNaN()) "n/a" else String.format("%.4f", v)
}
