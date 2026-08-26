package com.systema.music.library.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update

/**
 * Data access for the local track index.
 *
 * All queries are suspend functions so Room enforces off-main-thread
 * execution. Sorting is expressed as separate statements rather than a
 * string-concatenated ORDER BY, which keeps every statement compiled,
 * indexed and immune to SQL injection through the bridge.
 */
@Dao
abstract class TrackDao {

    // ---- writes -------------------------------------------------

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertAll(tracks: List<TrackEntity>)

    @Update
    abstract suspend fun updateAll(tracks: List<TrackEntity>)

    /**
     * Marks surviving rows as seen by the current scan without
     * rewriting their metadata. Chunked by the repository.
     */
    @Query("UPDATE tracks SET lastSeenScan = :scanToken WHERE id IN (:ids)")
    abstract suspend fun touch(ids: List<String>, scanToken: Long)

    /** Removes everything the latest completed scan did not observe. */
    @Query("DELETE FROM tracks WHERE lastSeenScan < :scanToken")
    abstract suspend fun deleteStale(scanToken: Long): Int

    @Query("DELETE FROM tracks")
    abstract suspend fun clear()

    // ---- sync ---------------------------------------------------

    /**
     * Full key set for diffing against MediaStore. Three columns only —
     * this is the single query that must stay cheap at 10k+ tracks.
     */
    @Query("SELECT id, dateModified, fileSize FROM tracks")
    abstract suspend fun loadSyncKeys(): List<TrackSyncKey>

    // ---- reads --------------------------------------------------

    @Query("SELECT COUNT(*) FROM tracks")
    abstract suspend fun count(): Int

    @Query("SELECT * FROM tracks WHERE id = :id LIMIT 1")
    abstract suspend fun findById(id: String): TrackEntity?

    @Query("SELECT * FROM tracks ORDER BY title COLLATE NOCASE ASC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByTitleAsc(limit: Int, offset: Int): List<TrackEntity>

    @Query("SELECT * FROM tracks ORDER BY title COLLATE NOCASE DESC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByTitleDesc(limit: Int, offset: Int): List<TrackEntity>

    @Query(
        "SELECT * FROM tracks ORDER BY artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, " +
            "discNumber ASC, trackNumber ASC LIMIT :limit OFFSET :offset",
    )
    abstract suspend fun pageByArtistAsc(limit: Int, offset: Int): List<TrackEntity>

    @Query(
        "SELECT * FROM tracks ORDER BY artist COLLATE NOCASE DESC, album COLLATE NOCASE DESC, " +
            "discNumber ASC, trackNumber ASC LIMIT :limit OFFSET :offset",
    )
    abstract suspend fun pageByArtistDesc(limit: Int, offset: Int): List<TrackEntity>

    @Query(
        "SELECT * FROM tracks ORDER BY album COLLATE NOCASE ASC, discNumber ASC, " +
            "trackNumber ASC LIMIT :limit OFFSET :offset",
    )
    abstract suspend fun pageByAlbumAsc(limit: Int, offset: Int): List<TrackEntity>

    @Query(
        "SELECT * FROM tracks ORDER BY album COLLATE NOCASE DESC, discNumber ASC, " +
            "trackNumber ASC LIMIT :limit OFFSET :offset",
    )
    abstract suspend fun pageByAlbumDesc(limit: Int, offset: Int): List<TrackEntity>

    @Query("SELECT * FROM tracks ORDER BY dateAdded ASC, id ASC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByDateAddedAsc(limit: Int, offset: Int): List<TrackEntity>

    @Query("SELECT * FROM tracks ORDER BY dateAdded DESC, id ASC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByDateAddedDesc(limit: Int, offset: Int): List<TrackEntity>

    @Query("SELECT * FROM tracks ORDER BY duration ASC, id ASC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByDurationAsc(limit: Int, offset: Int): List<TrackEntity>

    @Query("SELECT * FROM tracks ORDER BY duration DESC, id ASC LIMIT :limit OFFSET :offset")
    abstract suspend fun pageByDurationDesc(limit: Int, offset: Int): List<TrackEntity>

    // ---- search-ready surface -----------------------------------
    // Phase 6 (semantic search) will add its own index; these plain
    // LIKE queries exist so the architecture is not a dead end.

    // ESCAPE '\' matches the escaping the repository applies to user
    // input, so a literal % or _ in a search term stays literal.
    @Query(
        "SELECT COUNT(*) FROM tracks WHERE title LIKE :pattern ESCAPE '\\' " +
            "OR artist LIKE :pattern ESCAPE '\\' OR album LIKE :pattern ESCAPE '\\'",
    )
    abstract suspend fun searchCount(pattern: String): Int

    @Query(
        "SELECT * FROM tracks WHERE title LIKE :pattern ESCAPE '\\' " +
            "OR artist LIKE :pattern ESCAPE '\\' OR album LIKE :pattern ESCAPE '\\' " +
            "ORDER BY title COLLATE NOCASE ASC LIMIT :limit OFFSET :offset",
    )
    abstract suspend fun search(pattern: String, limit: Int, offset: Int): List<TrackEntity>

    /** One transaction per batch: short, cancellable, and atomic. */
    @Transaction
    open suspend fun applyBatch(inserts: List<TrackEntity>, updates: List<TrackEntity>) {
        if (inserts.isNotEmpty()) insertAll(inserts)
        if (updates.isNotEmpty()) updateAll(updates)
    }
}
