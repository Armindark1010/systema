package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One stored DSP analysis for one track.
 *
 * Key design points
 * -----------------
 * The primary key is the track id, not a composite with the analyzer
 * version. A track has exactly ONE current analysis; re-analysing with
 * a newer pipeline replaces it rather than accumulating history. That
 * is what makes [analyzerVersion] a staleness marker instead of a
 * growing archive, and it satisfies "a song must not receive duplicate
 * analysis records for the same analyzer version" by construction —
 * there can only ever be one row per track.
 *
 * The foreign key to `tracks` with CASCADE means removing a track
 * during a library scan takes its analysis with it, so orphan rows
 * cannot accumulate as the user's library changes.
 *
 * Failure state is stored here too rather than in a separate table:
 * knowing that a file failed with UNSUPPORTED_FORMAT is exactly what
 * stops the worker retrying it forever.
 */
@Entity(
    tableName = "song_analysis",
    foreignKeys = [
        ForeignKey(
            entity = TrackEntity::class,
            parentColumns = ["id"],
            childColumns = ["trackId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        // Drives "which tracks need (re-)analysis at this version".
        Index(value = ["analyzerVersion"]),
        // Drives the pending/failed queue queries.
        Index(value = ["status"]),
        Index(value = ["bpm"]),
    ],
)
data class AudioAnalysisEntity(
    @PrimaryKey
    @ColumnInfo(name = "trackId")
    val trackId: String,

    /** DSP pipeline version that produced this row. */
    @ColumnInfo(name = "analyzerVersion")
    val analyzerVersion: Int,

    /** One of [AnalysisStatus]. */
    @ColumnInfo(name = "status")
    val status: String,

    @ColumnInfo(name = "analyzedAt")
    val analyzedAt: Long,

    // ---- Basic -------------------------------------------------
    @ColumnInfo(name = "durationMs")
    val durationMs: Long,

    @ColumnInfo(name = "sampleRate")
    val sampleRate: Int,

    @ColumnInfo(name = "channels")
    val channels: Int,

    @ColumnInfo(name = "analyzedSampleCount")
    val analyzedSampleCount: Long,

    // ---- Amplitude ---------------------------------------------
    @ColumnInfo(name = "rms")
    val rms: Float?,

    @ColumnInfo(name = "peak")
    val peak: Float?,

    @ColumnInfo(name = "dynamicRangeDb")
    val dynamicRangeDb: Float?,

    @ColumnInfo(name = "silenceRatio")
    val silenceRatio: Float?,

    // ---- Spectral ----------------------------------------------
    @ColumnInfo(name = "spectralCentroid")
    val spectralCentroid: Float?,

    @ColumnInfo(name = "spectralCentroidMin")
    val spectralCentroidMin: Float?,

    @ColumnInfo(name = "spectralCentroidMax")
    val spectralCentroidMax: Float?,

    @ColumnInfo(name = "spectralBandwidth")
    val spectralBandwidth: Float?,

    @ColumnInfo(name = "spectralRolloff")
    val spectralRolloff: Float?,

    @ColumnInfo(name = "zeroCrossingRate")
    val zeroCrossingRate: Float?,

    // ---- Tempo -------------------------------------------------
    @ColumnInfo(name = "bpm")
    val bpm: Float?,

    @ColumnInfo(name = "bpmConfidence")
    val bpmConfidence: Float?,

    // ---- Loudness ----------------------------------------------
    /** RMS-derived dBFS. Explicitly NOT LUFS — see the result model. */
    @ColumnInfo(name = "loudnessDbfs")
    val loudnessDbfs: Float?,

    // ---- Instrumentation ---------------------------------------
    @ColumnInfo(name = "decodeTimeMs")
    val decodeTimeMs: Long?,

    @ColumnInfo(name = "dspTimeMs")
    val dspTimeMs: Long?,

    @ColumnInfo(name = "totalAnalysisTimeMs")
    val totalAnalysisTimeMs: Long?,

    // ---- Failure -----------------------------------------------
    /** Structured AudioAnalysisException code, when status = FAILED. */
    @ColumnInfo(name = "errorCode")
    val errorCode: String?,

    /** How many times analysis has been attempted and failed. */
    @ColumnInfo(name = "attemptCount")
    val attemptCount: Int = 0,
)

/** Lifecycle of one track's analysis. */
object AnalysisStatus {
    const val PENDING = "PENDING"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
}
