package com.systema.music.analysis.work

import com.systema.music.analysis.AudioAnalysisException

/**
 * The batch worker's decision table, as a pure function.
 *
 * Why this is its own file
 * ------------------------
 * The rules that matter for Phase 13 verification — one bad file must
 * not abort the queue, cancellation must end the batch as a partial
 * success rather than a failure, an OOM must back off instead of
 * thrashing — are the *interesting* logic in [AudioAnalysisWorker].
 * They were previously expressed as a `when` inside `doWork()`, which
 * meant they could only be exercised with a real WorkManager, a real
 * Room database and a real device.
 *
 * Lifting them here changes no behaviour (the worker still does
 * exactly what it did) but makes the rules directly testable on a
 * desktop JVM against the real production code, rather than against a
 * reimplementation in a test that could silently drift from it.
 *
 * This file deliberately has no Android imports and no WorkManager
 * imports, which is the property that makes that possible.
 */
object AnalysisBatchPolicy {

    /**
     * What the worker should do after attempting one track.
     *
     * The distinction between [SKIP] and [FAIL] is not cosmetic:
     * SKIP means "this file will never work, stop spending battery on
     * it", FAIL means "this attempt did not work, it may later".
     */
    enum class Decision {
        /** Analysis succeeded; count it and carry on. */
        COUNT_ANALYZED,

        /** Permanent defect in this specific file. Count as skipped, continue. */
        SKIP,

        /** Transient or unexplained failure. Count as failed, continue. */
        FAIL,

        /** The whole batch was withdrawn. Stop and report what was done. */
        STOP_PARTIAL_SUCCESS,

        /** Memory pressure. Abandon the batch and let WorkManager retry later. */
        RETRY_LATER,
    }

    /**
     * Maps one failed track to a batch decision.
     *
     * Every branch continues the queue except [Decision.STOP_PARTIAL_SUCCESS]
     * (cancellation, which is not a failure) and [Decision.RETRY_LATER]
     * (memory pressure, where continuing would likely fail the same
     * way). That is the failure-isolation guarantee: a broken file
     * costs one track, never the batch.
     */
    fun decide(code: AudioAnalysisException.Code): Decision = when (code) {
        // Not a failure at all — WorkManager withdrew the job.
        AudioAnalysisException.Code.CANCELLED -> Decision.STOP_PARTIAL_SUCCESS

        // Backing off is the right move; retrying under the same
        // pressure would just fail again and burn battery.
        AudioAnalysisException.Code.OUT_OF_MEMORY -> Decision.RETRY_LATER

        // Permanent for this file: no decoder, unreadable location,
        // no audio in it, or it is not in the library any more.
        // Recorded by the repository so it is not retried forever.
        AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
        AudioAnalysisException.Code.INVALID_URI,
        AudioAnalysisException.Code.EMPTY_AUDIO,
        AudioAnalysisException.Code.NOT_FOUND,
        -> Decision.SKIP

        // Everything else may be transient (a decoder hiccup, a
        // database lock, a DSP edge case) and stays eligible for a
        // later attempt, subject to the repository's attempt budget.
        AudioAnalysisException.Code.DECODER_ERROR,
        AudioAnalysisException.Code.INVALID_PCM,
        AudioAnalysisException.Code.DSP_ERROR,
        AudioAnalysisException.Code.BPM_UNAVAILABLE,
        AudioAnalysisException.Code.DATABASE_ERROR,
        AudioAnalysisException.Code.UNKNOWN,
        -> Decision.FAIL
    }

    /**
     * Running tally of a batch. Immutable so a test (and the worker)
     * can assert on the exact counts after a known sequence of
     * outcomes.
     */
    data class Counters(
        val analyzed: Int = 0,
        val failed: Int = 0,
        val skipped: Int = 0,
    ) {
        fun apply(decision: Decision): Counters = when (decision) {
            Decision.COUNT_ANALYZED -> copy(analyzed = analyzed + 1)
            Decision.SKIP -> copy(skipped = skipped + 1)
            Decision.FAIL -> copy(failed = failed + 1)
            // Neither terminal decision advances a counter: the track
            // was not analysed, and it is not the file's fault.
            Decision.STOP_PARTIAL_SUCCESS, Decision.RETRY_LATER -> this
        }
    }

    /** True when the decision ends the batch rather than continuing it. */
    fun isTerminal(decision: Decision): Boolean =
        decision == Decision.STOP_PARTIAL_SUCCESS || decision == Decision.RETRY_LATER
}
