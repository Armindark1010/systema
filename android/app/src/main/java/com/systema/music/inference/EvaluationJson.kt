package com.systema.music.inference

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject

/**
 * Capacitor serialisation for the embedding-evaluation value types.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * EmbeddingSimilarity.kt and LabeledPairEvaluation.kt are pure
 * arithmetic: no Android, no Capacitor, no coroutines. That is not an
 * accident of style, it is what lets scripts/run-inference-tests.sh
 * compile and RUN them on a plain JVM, so the cosine maths and the
 * separation statistics are verified by execution instead of by
 * reading a diff.
 *
 * A single `import com.getcapacitor.JSObject` in either of those files
 * ends that - the suite stops compiling outside an Android build, and
 * the numbers that decide this phase's conclusion become unverifiable
 * here. So every JS-facing conversion lives out here instead, as
 * extension functions in the same package. The bridge keeps its
 * convenient `stats.toJs()` call sites and the maths keeps its
 * testability.
 *
 * Nothing in this file computes anything. It only copies already
 * computed fields onto a JSObject.
 */

/** JSON for the statistics block. */
fun SimilarityStats.toJs(): JSObject = JSObject().apply {
    put("pairCount", pairCount)
    put("mean", mean)
    put("median", median)
    put("min", min)
    put("max", max)
    put("range", range)
    put("stdDev", stdDev)
    put("p25", p25)
    put("p75", p75)
    put("histogram", JSArray().apply { histogram.forEach { put(it) } })
    put("histogramBuckets", EmbeddingSimilarity.HISTOGRAM_BUCKETS)
}

fun LabeledPairResult.toJs(): JSObject = JSObject().apply {
    put("position", position)
    put("indexA", indexA)
    put("indexB", indexB)
    put("trackIdA", trackIdA)
    put("trackIdB", trackIdB)
    put("label", label.name)
    put("source", source.name)
    put("cosine", cosine)
    put("outcome", outcome.name)
    if (!referenceValue.isNaN()) put("referenceValue", referenceValue)
}

fun ClassStats.toJs(): JSObject = JSObject().apply {
    put("label", label.name)
    put("insufficient", insufficient)
    put("stats", stats.toJs())
}

fun ClassSeparation.toJs(): JSObject = JSObject().apply {
    put("higher", higher.name)
    put("lower", lower.name)
    put("countHigher", countHigher)
    put("countLower", countLower)
    put("auc", auc)
    put("meanGap", meanGap)
    put("rangeOverlap", rangeOverlap)
    put("overlappingPairs", overlappingPairs)
    put("overlapFraction", overlapFraction)
    put("insufficient", insufficient)
}

fun SeparationAnalysis.toJs(): JSObject = JSObject().apply {
    put("verdict", verdict.name)
    put("rationale", rationale)
    put("comparisons", JSArray().apply { comparisons.forEach { put(it.toJs()) } })
}
