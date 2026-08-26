package com.systema.music.library.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Persistence for DSP analysis results.
 *
 * Writes use REPLACE on the track-id primary key, which gives upsert
 * semantics: re-analysing a track overwrites its row instead of
 * creating a second one. Combined with the single-row-per-track key,
 * duplicate analyses are impossible rather than merely discouraged.
 */
@Dao
interface AudioAnalysisDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(analysis: AudioAnalysisEntity)

    @Query("SELECT * FROM song_analysis WHERE trackId = :trackId LIMIT 1")
    suspend fun getByTrackId(trackId: String): AudioAnalysisEntity?

    @Query("SELECT * FROM song_analysis WHERE trackId IN (:trackIds)")
    suspend fun getByTrackIds(trackIds: List<String>): List<AudioAnalysisEntity>

    @Query("DELETE FROM song_analysis WHERE trackId = :trackId")
    suspend fun deleteByTrackId(trackId: String)

    @Query("DELETE FROM song_analysis")
    suspend fun clear()

    // ---- Queue selection ------------------------------------------

    /**
     * Tracks with no analysis at all, or whose analysis came from an
     * older DSP version.
     *
     * This is the "what needs work" query. Failed rows are excluded:
     * a file that cannot be decoded will not decode next time either,
     * and retrying it every pass would waste the user's battery. They
     * are retried only when the analyzer version changes, which is
     * exactly when the outcome might genuinely differ.
     */
    @Query(
        "SELECT t.id FROM tracks t " +
            "LEFT JOIN song_analysis a ON a.trackId = t.id " +
            "WHERE a.trackId IS NULL " +
            "   OR (a.analyzerVersion < :currentVersion) " +
            "ORDER BY t.dateAdded DESC LIMIT :limit",
    )
    suspend fun findTracksNeedingAnalysis(currentVersion: Int, limit: Int): List<String>

    @Query(
        "SELECT COUNT(*) FROM tracks t " +
            "LEFT JOIN song_analysis a ON a.trackId = t.id " +
            "WHERE a.trackId IS NULL OR a.analyzerVersion < :currentVersion",
    )
    suspend fun countTracksNeedingAnalysis(currentVersion: Int): Int

    @Query("SELECT COUNT(*) FROM song_analysis WHERE status = :status")
    suspend fun countByStatus(status: String): Int

    @Query("SELECT COUNT(*) FROM song_analysis WHERE analyzerVersion = :version AND status = 'COMPLETED'")
    suspend fun countCompletedAtVersion(version: Int): Int

    /** Marks a failure without discarding a previous successful analysis. */
    @Query(
        "UPDATE song_analysis SET status = :status, errorCode = :errorCode, " +
            "attemptCount = attemptCount + 1, analyzedAt = :timestamp WHERE trackId = :trackId",
    )
    suspend fun markFailure(trackId: String, status: String, errorCode: String, timestamp: Long)
}
