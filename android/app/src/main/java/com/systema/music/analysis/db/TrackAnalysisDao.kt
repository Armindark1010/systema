package com.systema.music.analysis.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Data Access Object for track analysis records.
 * 
 * This DAO provides methods for:
 * - Inserting new analysis results
 * - Querying analysis by track ID
 * - Finding tracks that need re-analysis
 * - Deleting old analysis records
 */
@Dao
interface TrackAnalysisDao {

    /**
     * Insert or replace an analysis record.
     * Uses REPLACE strategy to handle updates.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrReplace(entity: TrackAnalysisEntity): Long

    /**
     * Insert multiple analysis records.
     * Uses REPLACE strategy for conflicts.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrReplaceAll(entities: List<TrackAnalysisEntity>): List<Long>

    /**
     * Get analysis for a specific track and version.
     */
    @Query("""
        SELECT * FROM track_analysis 
        WHERE songId = :songId AND analyzerVersion = :version
        LIMIT 1
    """)
    suspend fun getBySongAndVersion(songId: String, version: Int): TrackAnalysisEntity?

    /**
     * Get the latest analysis for a specific track (highest version).
     */
    @Query("""
        SELECT * FROM track_analysis 
        WHERE songId = :songId
        ORDER BY analyzerVersion DESC
        LIMIT 1
    """)
    suspend fun getLatestBySong(songId: String): TrackAnalysisEntity?

    /**
     * Get all analysis records for a specific track.
     */
    @Query("""
        SELECT * FROM track_analysis 
        WHERE songId = :songId
        ORDER BY analyzerVersion DESC
    """)
    suspend fun getAllBySong(songId: String): List<TrackAnalysisEntity>

    /**
     * Get analysis records for multiple tracks.
     */
    @Query("""
        SELECT * FROM track_analysis 
        WHERE songId IN (:songIds) AND analyzerVersion = :version
    """)
    suspend fun getBySongIdsAndVersion(songIds: List<String>, version: Int): List<TrackAnalysisEntity>

    /**
     * Get all tracks that need re-analysis.
     * A track needs re-analysis if:
     * - It has no analysis record for the current version
     * - Its latest analysis is for an older version
     */
    @Query("""
        SELECT t.id as songId, :currentVersion as analyzerVersion, 0 as analyzedAt
        FROM tracks t
        LEFT JOIN track_analysis a ON t.id = a.songId AND a.analyzerVersion = :currentVersion
        WHERE a.id IS NULL
    """)
    suspend fun getTracksNeedingAnalysis(currentVersion: Int): List<TrackAnalysisKey>

    /**
     * Get tracks that have analysis for a specific version.
     */
    @Query("""
        SELECT songId, analyzerVersion, analyzedAt FROM track_analysis
        WHERE analyzerVersion = :version
        ORDER BY analyzedAt DESC
    """)
    suspend fun getByVersion(version: Int): List<TrackAnalysisKey>

    /**
     * Get the latest analysis version for a track.
     */
    @Query("""
        SELECT analyzerVersion FROM track_analysis
        WHERE songId = :songId
        ORDER BY analyzerVersion DESC
        LIMIT 1
    """)
    suspend fun getLatestVersionForSong(songId: String): Int?

    /**
     * Delete analysis records for a specific version.
     */
    @Query("""
        DELETE FROM track_analysis WHERE analyzerVersion = :version
    """)
    suspend fun deleteByVersion(version: Int): Int

    /**
     * Delete analysis records for specific tracks.
     */
    @Query("""
        DELETE FROM track_analysis WHERE songId IN (:songIds)
    """)
    suspend fun deleteBySongIds(songIds: List<String>): Int

    /**
     * Delete all analysis records.
     */
    @Query("DELETE FROM track_analysis")
    suspend fun deleteAll(): Int

    /**
     * Count analysis records.
     */
    @Query("SELECT COUNT(*) FROM track_analysis")
    suspend fun count(): Int

    /**
     * Count analysis records for a specific version.
     */
    @Query("SELECT COUNT(*) FROM track_analysis WHERE analyzerVersion = :version")
    suspend fun countByVersion(version: Int): Int

    /**
     * Get analysis records with errors.
     */
    @Query("""
        SELECT * FROM track_analysis
        WHERE errorCode IS NOT NULL
        ORDER BY analyzedAt DESC
    """)
    suspend fun getFailedAnalyses(): List<TrackAnalysisEntity>

    /**
     * Get recent analysis records.
     */
    @Query("""
        SELECT * FROM track_analysis
        ORDER BY analyzedAt DESC
        LIMIT :limit
    """)
    suspend fun getRecent(limit: Int): List<TrackAnalysisEntity>
}
