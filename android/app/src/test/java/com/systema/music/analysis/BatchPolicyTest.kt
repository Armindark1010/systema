package com.systema.music.analysis

import com.systema.music.analysis.work.AnalysisBatchPolicy
import com.systema.music.analysis.work.AnalysisBatchPolicy.Decision

/**
 * Worker queue semantics: failure isolation, cancellation, counters.
 *
 * What this actually tests
 * ------------------------
 * [AnalysisBatchPolicy] is the real decision table the production
 * worker uses — `AudioAnalysisWorker.doWork()` calls
 * `AnalysisBatchPolicy.decide(...)` and `Counters.apply(...)` directly.
 * So these assertions exercise shipping logic, not a copy of it. If
 * someone changes the worker's behaviour so a corrupt file aborts the
 * batch, this suite fails.
 *
 * What it does NOT test, and why
 * ------------------------------
 * WorkManager itself, Room, and the decoder need Android. This suite
 * covers the *rules*; running a real batch of real files through a
 * real WorkManager on a real phone is a separate, device-only step and
 * is reported as such rather than implied here.
 *
 * The scenario driver below replays a batch by mapping each track to a
 * scripted outcome and feeding the results through the same policy the
 * worker uses, in the same order, with the same short-circuit rules.
 */
object BatchPolicyTest {

    private var passed = 0
    private var failed = 0

    private fun ok(name: String, condition: Boolean, detail: String = "") {
        if (condition) {
            passed++
            println("  \u001B[32m✓\u001B[0m $name")
        } else {
            failed++
            println("  \u001B[31m✗\u001B[0m $name ${if (detail.isEmpty()) "" else "— $detail"}")
        }
    }

    /** One scripted track outcome: success, or a specific failure code. */
    private sealed interface Outcome {
        object Success : Outcome
        data class Fails(val code: AudioAnalysisException.Code) : Outcome
    }

    /** What a replayed batch ended up doing. */
    private data class BatchRun(
        val counters: AnalysisBatchPolicy.Counters,
        val processed: List<String>,
        val stoppedEarly: Boolean,
        val retried: Boolean,
    )

    /**
     * Replays a batch through the production policy.
     *
     * Mirrors the control flow of AudioAnalysisWorker.doWork(): decide
     * per track, apply the counters, and stop on a terminal decision.
     */
    private fun runBatch(tracks: List<Pair<String, Outcome>>): BatchRun {
        var counters = AnalysisBatchPolicy.Counters()
        val processed = mutableListOf<String>()
        var stoppedEarly = false
        var retried = false

        for ((id, outcome) in tracks) {
            processed += id
            val decision = when (outcome) {
                is Outcome.Success -> Decision.COUNT_ANALYZED
                is Outcome.Fails -> AnalysisBatchPolicy.decide(outcome.code)
            }
            counters = counters.apply(decision)

            if (AnalysisBatchPolicy.isTerminal(decision)) {
                stoppedEarly = true
                retried = decision == Decision.RETRY_LATER
                break
            }
        }
        return BatchRun(counters, processed, stoppedEarly, retried)
    }

    // ---- Failure isolation ---------------------------------------

    private fun testFailureIsolation() {
        println("\nFailure isolation: one bad file must not abort the queue")

        // The exact scenario from the spec: A completes, B fails, C
        // completes.
        val run = runBatch(
            listOf(
                "A" to Outcome.Success,
                "B" to Outcome.Fails(AudioAnalysisException.Code.DECODER_ERROR),
                "C" to Outcome.Success,
            ),
        )

        ok("all three tracks were attempted", run.processed == listOf("A", "B", "C"),
            "processed ${run.processed}")
        ok("the batch did not stop early", !run.stoppedEarly)
        ok("two tracks analysed", run.counters.analyzed == 2, "got ${run.counters.analyzed}")
        ok("one track failed", run.counters.failed == 1, "got ${run.counters.failed}")
        ok("nothing was skipped", run.counters.skipped == 0, "got ${run.counters.skipped}")

        // A corrupt file in the middle of a long queue.
        val long = runBatch(
            (1..10).map { i ->
                "t$i" to if (i == 5) {
                    Outcome.Fails(AudioAnalysisException.Code.DECODER_ERROR)
                } else {
                    Outcome.Success
                }
            },
        )
        ok("a corrupt file at position 5 of 10 does not stop the batch",
            long.processed.size == 10 && !long.stoppedEarly)
        ok("nine tracks still analysed", long.counters.analyzed == 9,
            "got ${long.counters.analyzed}")

        // Every non-terminal code must let the queue continue.
        val continuing = AudioAnalysisException.Code.entries.filter {
            !AnalysisBatchPolicy.isTerminal(AnalysisBatchPolicy.decide(it))
        }
        ok("most failure codes let the batch continue", continuing.size >= 9,
            "only ${continuing.size} continue: $continuing")

        for (code in continuing) {
            val r = runBatch(
                listOf(
                    "before" to Outcome.Success,
                    "bad" to Outcome.Fails(code),
                    "after" to Outcome.Success,
                ),
            )
            ok("$code does not abort the queue",
                r.processed.size == 3 && r.counters.analyzed == 2,
                "processed ${r.processed}, analysed ${r.counters.analyzed}")
        }
    }

    // ---- Permanent vs transient ----------------------------------

    private fun testPermanentVersusTransient() {
        println("\nPermanent defects are skipped, transient ones are failures")

        val permanent = listOf(
            AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
            AudioAnalysisException.Code.INVALID_URI,
            AudioAnalysisException.Code.EMPTY_AUDIO,
            AudioAnalysisException.Code.NOT_FOUND,
        )
        for (code in permanent) {
            ok("$code counts as skipped, not failed",
                AnalysisBatchPolicy.decide(code) == Decision.SKIP)
        }

        val transient = listOf(
            AudioAnalysisException.Code.DECODER_ERROR,
            AudioAnalysisException.Code.INVALID_PCM,
            AudioAnalysisException.Code.DSP_ERROR,
            AudioAnalysisException.Code.DATABASE_ERROR,
            AudioAnalysisException.Code.UNKNOWN,
        )
        for (code in transient) {
            ok("$code counts as failed, not skipped",
                AnalysisBatchPolicy.decide(code) == Decision.FAIL)
        }

        // A mixed batch: the counters must separate the two kinds.
        val run = runBatch(
            listOf(
                "good1" to Outcome.Success,
                "notmusic" to Outcome.Fails(AudioAnalysisException.Code.UNSUPPORTED_FORMAT),
                "good2" to Outcome.Success,
                "glitch" to Outcome.Fails(AudioAnalysisException.Code.DECODER_ERROR),
                "gone" to Outcome.Fails(AudioAnalysisException.Code.NOT_FOUND),
                "good3" to Outcome.Success,
            ),
        )
        ok("mixed batch: 3 analysed", run.counters.analyzed == 3, "got ${run.counters.analyzed}")
        ok("mixed batch: 2 skipped", run.counters.skipped == 2, "got ${run.counters.skipped}")
        ok("mixed batch: 1 failed", run.counters.failed == 1, "got ${run.counters.failed}")
        ok("mixed batch: every track was attempted", run.processed.size == 6)
        ok("mixed batch: counters account for every track",
            run.counters.analyzed + run.counters.skipped + run.counters.failed == 6)
    }

    // ---- Cancellation --------------------------------------------

    private fun testCancellation() {
        println("\nCancellation ends the batch as a partial success")

        ok("CANCELLED is terminal",
            AnalysisBatchPolicy.isTerminal(Decision.STOP_PARTIAL_SUCCESS))
        ok("CANCELLED maps to a partial success, not a failure",
            AnalysisBatchPolicy.decide(AudioAnalysisException.Code.CANCELLED)
                == Decision.STOP_PARTIAL_SUCCESS)

        val run = runBatch(
            listOf(
                "done1" to Outcome.Success,
                "done2" to Outcome.Success,
                "cancelled" to Outcome.Fails(AudioAnalysisException.Code.CANCELLED),
                "never" to Outcome.Success,
                "alsonever" to Outcome.Success,
            ),
        )

        ok("the batch stopped at the cancellation", run.stoppedEarly)
        ok("tracks after the cancellation were not attempted",
            run.processed == listOf("done1", "done2", "cancelled"),
            "processed ${run.processed}")
        ok("work completed before cancelling is retained",
            run.counters.analyzed == 2, "got ${run.counters.analyzed}")

        // The critical honesty property: a cancelled track is NOT
        // recorded as failed, and NOT recorded as analysed.
        ok("a cancelled track is not counted as failed",
            run.counters.failed == 0, "got ${run.counters.failed}")
        ok("a cancelled track is not counted as skipped",
            run.counters.skipped == 0, "got ${run.counters.skipped}")
        ok("a cancelled track is not counted as analysed",
            run.counters.analyzed == 2,
            "the two successes only, got ${run.counters.analyzed}")
        ok("cancellation does not request a retry", !run.retried)

        // Cancelling before anything ran reports zero, not an error.
        val immediate = runBatch(
            listOf("first" to Outcome.Fails(AudioAnalysisException.Code.CANCELLED)),
        )
        ok("cancelling immediately reports zero analysed",
            immediate.counters == AnalysisBatchPolicy.Counters(0, 0, 0),
            "got ${immediate.counters}")
    }

    // ---- Memory pressure -----------------------------------------

    private fun testOutOfMemoryBacksOff() {
        println("\nMemory pressure backs off instead of thrashing")

        ok("OUT_OF_MEMORY requests a retry",
            AnalysisBatchPolicy.decide(AudioAnalysisException.Code.OUT_OF_MEMORY)
                == Decision.RETRY_LATER)
        ok("RETRY_LATER is terminal", AnalysisBatchPolicy.isTerminal(Decision.RETRY_LATER))

        val run = runBatch(
            listOf(
                "ok1" to Outcome.Success,
                "huge" to Outcome.Fails(AudioAnalysisException.Code.OUT_OF_MEMORY),
                "ok2" to Outcome.Success,
            ),
        )
        ok("the batch stops on OOM", run.stoppedEarly)
        ok("the batch asks WorkManager to retry", run.retried)
        ok("an OOM track is not recorded as a permanent failure",
            run.counters.failed == 0 && run.counters.skipped == 0,
            "failed=${run.counters.failed} skipped=${run.counters.skipped}")
    }

    // ---- Counter arithmetic --------------------------------------

    private fun testCounters() {
        println("\nCounter arithmetic")

        val zero = AnalysisBatchPolicy.Counters()
        ok("counters start at zero", zero.analyzed == 0 && zero.failed == 0 && zero.skipped == 0)

        ok("COUNT_ANALYZED increments only analyzed",
            zero.apply(Decision.COUNT_ANALYZED) == AnalysisBatchPolicy.Counters(1, 0, 0))
        ok("FAIL increments only failed",
            zero.apply(Decision.FAIL) == AnalysisBatchPolicy.Counters(0, 1, 0))
        ok("SKIP increments only skipped",
            zero.apply(Decision.SKIP) == AnalysisBatchPolicy.Counters(0, 0, 1))
        ok("a terminal cancellation advances no counter",
            zero.apply(Decision.STOP_PARTIAL_SUCCESS) == zero)
        ok("a terminal retry advances no counter",
            zero.apply(Decision.RETRY_LATER) == zero)

        // Counters are immutable — applying returns a new value and
        // leaves the original alone.
        val once = zero.apply(Decision.COUNT_ANALYZED)
        ok("counters are immutable", zero.analyzed == 0 && once.analyzed == 1)

        // An all-success batch.
        val allGood = runBatch((1..7).map { "t$it" to Outcome.Success })
        ok("an all-success batch counts every track",
            allGood.counters.analyzed == 7 && allGood.counters.failed == 0,
            "got ${allGood.counters}")

        // An all-failure batch still completes rather than aborting.
        val allBad = runBatch(
            (1..5).map { "t$it" to Outcome.Fails(AudioAnalysisException.Code.DECODER_ERROR) },
        )
        ok("an all-failure batch still attempts every track",
            allBad.processed.size == 5 && !allBad.stoppedEarly)
        ok("an all-failure batch reports five failures",
            allBad.counters.failed == 5, "got ${allBad.counters.failed}")

        // An empty batch.
        val empty = runBatch(emptyList())
        ok("an empty batch reports zeroes and does not stop early",
            empty.counters == AnalysisBatchPolicy.Counters() && !empty.stoppedEarly)
    }

    // ---- Exhaustiveness ------------------------------------------

    private fun testEveryCodeIsHandled() {
        println("\nEvery failure code has an explicit decision")

        // `decide` is an exhaustive `when` over the enum, so this can
        // only fail if a code is added without a decision — which is
        // the regression worth catching.
        for (code in AudioAnalysisException.Code.entries) {
            val decision = AnalysisBatchPolicy.decide(code)
            ok("$code -> $decision", true)
        }

        ok("exactly one code stops the batch as a partial success",
            AudioAnalysisException.Code.entries.count {
                AnalysisBatchPolicy.decide(it) == Decision.STOP_PARTIAL_SUCCESS
            } == 1)
        ok("exactly one code triggers a retry",
            AudioAnalysisException.Code.entries.count {
                AnalysisBatchPolicy.decide(it) == Decision.RETRY_LATER
            } == 1)
        ok("no failure code is ever counted as analysed",
            AudioAnalysisException.Code.entries.none {
                AnalysisBatchPolicy.decide(it) == Decision.COUNT_ANALYZED
            })
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n\u001B[1mSYSTEMA — Phase 13 worker batch policy\u001B[0m")

        testFailureIsolation()
        testPermanentVersusTransient()
        testCancellation()
        testOutOfMemoryBacksOff()
        testCounters()
        testEveryCodeIsHandled()

        println(
            "\n${if (failed == 0) "\u001B[32m" else "\u001B[31m"}" +
                "$passed passed, $failed failed\u001B[0m\n",
        )
        if (failed > 0) throw AssertionError("$failed batch policy checks failed")
    }
}
