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

/**
 * Writes a Double that MAY be NaN or infinite.
 *
 * WHY THIS EXISTS - THE PHASE 18 WHITE-SCREEN BUG
 * -----------------------------------------------
 * `JSObject.put(String, double)` cannot carry NaN or Infinity, and it
 * does not tell you so. Android's org.json rejects them
 * (JSON.checkDouble throws "Forbidden numeric value"), and Capacitor's
 * override catches that JSONException and ignores it:
 *
 *     public JSObject put(String key, double value) {
 *         try { super.put(key, value); } catch (JSONException ex) {}
 *         return this;
 *     }
 *
 * So the key is not written at all. The failure is completely silent
 * on the native side: no log, no exception, no rejected call.
 *
 * On the JS side the field is then `undefined` rather than the NaN the
 * TypeScript interface promises - and NaN is a MEANINGFUL value in
 * this phase. `auc` is NaN whenever a label class is empty, and
 * `cosine` is NaN for a pair whose track failed to embed. Both are
 * normal states, not errors. The UI called `.toFixed()` on them, which
 * throws TypeError on undefined, and a TypeError thrown inside a Vue
 * render function tears down the render tree - the blank-but-scrollable
 * page reported from the device.
 *
 * Writing JSON null keeps the key present and keeps its meaning:
 * "measured, and the answer is not a number". `null` survives the
 * bridge intact, is distinguishable from a missing key, and cannot be
 * mistaken for a real measurement the way 0.0 could.
 *
 * Finite values take the normal numeric path and are unchanged, so no
 * existing number moves by even one ULP.
 */
internal fun JSObject.putNumeric(key: String, value: Double): JSObject = apply {
    if (value.isNaN() || value.isInfinite()) {
        // JSONObject.NULL, not Kotlin null: `put(key, null)` REMOVES
        // the entry, which is the very bug being fixed here.
        put(key, org.json.JSONObject.NULL)
    } else {
        put(key, value)
    }
}

/** JSON for the statistics block. */
fun SimilarityStats.toJs(): JSObject = JSObject().apply {
    put("pairCount", pairCount)
    putNumeric("mean", mean)
    putNumeric("median", median)
    putNumeric("min", min)
    putNumeric("max", max)
    putNumeric("range", range)
    putNumeric("stdDev", stdDev)
    putNumeric("p25", p25)
    putNumeric("p75", p75)
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
    putNumeric("cosine", cosine)
    put("outcome", outcome.name)
    putNumeric("referenceValue", referenceValue)
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
    putNumeric("auc", auc)
    putNumeric("meanGap", meanGap)
    putNumeric("rangeOverlap", rangeOverlap)
    put("overlappingPairs", overlappingPairs)
    putNumeric("overlapFraction", overlapFraction)
    put("insufficient", insufficient)
}

fun SeparationAnalysis.toJs(): JSObject = JSObject().apply {
    put("verdict", verdict.name)
    put("rationale", rationale)
    put("comparisons", JSArray().apply { comparisons.forEach { put(it.toJs()) } })
}
