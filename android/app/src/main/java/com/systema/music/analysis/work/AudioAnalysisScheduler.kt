package com.systema.music.analysis.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Enqueues analysis work.
 *
 * Policy for this phase: NOTHING here runs automatically. There is no
 * periodic sweep and no hook that starts analysing the library after a
 * scan. Analysis is requested explicitly, which keeps Phase 13 to
 * building the foundation rather than quietly turning on background
 * processing across everyone's music.
 *
 * Battery posture matches the existing library scan work: analysis is
 * deferrable, so it waits for a battery that is not low. It does NOT
 * require charging — a handful of tracks on demand should not need the
 * user to plug in — but a full-library sweep (Phase 14+) should add
 * that constraint when it is introduced.
 */
object AudioAnalysisScheduler {

    /** Single-track/explicit-batch work. */
    const val WORK_NAME_ON_DEMAND = "systema.analysis.on-demand"

    /** Controlled background batch. */
    const val WORK_NAME_BATCH = "systema.analysis.batch"

    private val deferrableConstraints = Constraints.Builder()
        .setRequiresBatteryNotLow(true)
        .build()

    /**
     * Analyses specific tracks as soon as reasonably possible.
     *
     * Uses APPEND_OR_REPLACE so several requests queue behind each
     * other rather than cancelling one another — a user tapping two
     * tracks expects both to be analysed.
     */
    fun enqueueTracks(
        context: Context,
        trackIds: List<String>,
        force: Boolean = false,
        expedited: Boolean = false,
    ) {
        if (trackIds.isEmpty()) return

        val data = Data.Builder()
            .putStringArray(AudioAnalysisWorker.KEY_TRACK_IDS, trackIds.toTypedArray())
            .putBoolean(AudioAnalysisWorker.KEY_FORCE, force)
            .build()

        val builder = OneTimeWorkRequestBuilder<AudioAnalysisWorker>()
            .setInputData(data)
            .setConstraints(deferrableConstraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)

        if (expedited) {
            // Falls back to a normal job when the app has no quota,
            // rather than failing to enqueue.
            builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        }

        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME_ON_DEMAND,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            builder.build(),
        )
    }

    /**
     * Analyses one bounded batch drawn from the "needs analysis"
     * queue. Explicitly one batch, not a recurring sweep.
     */
    fun enqueueBatch(context: Context, batchSize: Int = AudioAnalysisWorker.DEFAULT_BATCH_SIZE) {
        val data = Data.Builder()
            .putInt(AudioAnalysisWorker.KEY_BATCH_SIZE, batchSize)
            .build()

        val request = OneTimeWorkRequestBuilder<AudioAnalysisWorker>()
            .setInputData(data)
            .setConstraints(deferrableConstraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME_BATCH,
            // KEEP: if a batch is already running, let it finish
            // instead of restarting the same work.
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun cancelAll(context: Context) {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork(WORK_NAME_ON_DEMAND)
        manager.cancelUniqueWork(WORK_NAME_BATCH)
    }

    /** True when analysis work is queued or running. */
    fun isBusy(context: Context): Boolean {
        val manager = WorkManager.getInstance(context)
        val states = listOf(WORK_NAME_ON_DEMAND, WORK_NAME_BATCH)
            .flatMap { runCatching { manager.getWorkInfosForUniqueWork(it).get() }.getOrDefault(emptyList()) }
        return states.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
    }
}
