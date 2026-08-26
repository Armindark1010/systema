package com.systema.music.analysis.work

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.WorkerParameters
import com.systema.music.analysis.AudioAnalysisException
import com.systema.music.analysis.AudioAnalysisRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/**
 * Analyses a bounded batch of tracks in the background.
 *
 * Scope for Phase 13 is deliberately modest: the infrastructure exists
 * and is correct, but nothing schedules a whole-library sweep. Work is
 * enqueued explicitly — for specific track ids, or for a small batch —
 * so this phase cannot quietly start grinding through 10,000 files on
 * someone's phone.
 *
 * Contract
 * --------
 *  - runs on Dispatchers.Default via CoroutineWorker (never the main
 *    thread; the analysis itself confines to IO internally)
 *  - cancellation is honoured between decoder buffers, not merely
 *    between tracks, so stopping is prompt even mid-file
 *  - a decoder failure fails ONE track, is recorded, and the batch
 *    continues
 *  - never throws out of doWork(): a crash here would take the app
 *    down, and analysis is strictly secondary to playback
 */
class AudioAnalysisWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "SystemaAnalysisWorker"

        /** Explicit ids to analyse. Omit to pull a batch from the queue. */
        const val KEY_TRACK_IDS = "trackIds"

        /** How many tracks to take when no explicit ids were supplied. */
        const val KEY_BATCH_SIZE = "batchSize"

        /** Re-analyse even if a current-version result already exists. */
        const val KEY_FORCE = "force"

        const val KEY_ANALYZED = "analyzed"
        const val KEY_FAILED = "failed"
        const val KEY_SKIPPED = "skipped"

        /**
         * Small on purpose. A batch is a unit of *interruptible* work;
         * WorkManager can stop us between tracks, and a short batch
         * means less repeated effort when that happens.
         */
        const val DEFAULT_BATCH_SIZE = 10
        const val MAX_BATCH_SIZE = 50
    }

    override suspend fun doWork(): Result {
        val repository = AudioAnalysisRepository.get(applicationContext)

        val explicitIds = inputData.getStringArray(KEY_TRACK_IDS)?.toList()
        val force = inputData.getBoolean(KEY_FORCE, false)
        val batchSize = inputData
            .getInt(KEY_BATCH_SIZE, DEFAULT_BATCH_SIZE)
            .coerceIn(1, MAX_BATCH_SIZE)

        val trackIds = try {
            explicitIds ?: repository.findTracksNeedingAnalysis(batchSize)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Could not build the analysis queue", e)
            return Result.retry()
        }

        if (trackIds.isEmpty()) {
            return Result.success(
                Data.Builder()
                    .putInt(KEY_ANALYZED, 0)
                    .putInt(KEY_FAILED, 0)
                    .putInt(KEY_SKIPPED, 0)
                    .build(),
            )
        }

        // The per-track decision table lives in AnalysisBatchPolicy so
        // it can be unit tested on a desktop JVM. This loop owns the
        // I/O and the coroutine plumbing; the policy owns the rules.
        var counters = AnalysisBatchPolicy.Counters()

        for (trackId in trackIds) {
            // Stop promptly when WorkManager withdraws the job.
            if (isStopped) break
            try {
                coroutineContext.ensureActive()
            } catch (e: CancellationException) {
                break
            }

            val decision = try {
                repository.analyzeTrack(
                    trackId = trackId,
                    force = force,
                    // Polled inside the decode loop, so a long track
                    // does not delay cancellation.
                    shouldCancel = { isStopped },
                )
                AnalysisBatchPolicy.Decision.COUNT_ANALYZED
            } catch (e: AudioAnalysisException) {
                AnalysisBatchPolicy.decide(e.code).also {
                    if (it == AnalysisBatchPolicy.Decision.RETRY_LATER) {
                        Log.w(TAG, "Out of memory analysing $trackId; backing off")
                    } else if (it == AnalysisBatchPolicy.Decision.FAIL) {
                        Log.w(TAG, "Analysis failed for $trackId: ${e.codeName}")
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Anything unanticipated fails one track, not the app.
                Log.e(TAG, "Unexpected error analysing $trackId", e)
                AnalysisBatchPolicy.Decision.FAIL
            }

            counters = counters.apply(decision)

            if (AnalysisBatchPolicy.isTerminal(decision)) {
                return when (decision) {
                    // Memory pressure: let WorkManager bring us back
                    // later rather than grinding through the rest now.
                    AnalysisBatchPolicy.Decision.RETRY_LATER -> Result.retry()
                    // Cancelled: report what actually got done.
                    else -> partialSuccess(counters)
                }
            }
        }

        return partialSuccess(counters)
    }

    private fun partialSuccess(counters: AnalysisBatchPolicy.Counters): Result =
        partialSuccess(counters.analyzed, counters.failed, counters.skipped)

    private fun partialSuccess(analyzed: Int, failed: Int, skipped: Int): Result =
        Result.success(
            Data.Builder()
                .putInt(KEY_ANALYZED, analyzed)
                .putInt(KEY_FAILED, failed)
                .putInt(KEY_SKIPPED, skipped)
                .build(),
        )
}
