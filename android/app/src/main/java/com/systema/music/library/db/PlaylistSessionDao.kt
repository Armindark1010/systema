package com.systema.music.library.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * DAO for Playlist Listening Sessions.
 *
 * Maintains one persistent record per playlist.
 */
@Dao
interface PlaylistSessionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(session: PlaylistSessionEntity)

    @Query("SELECT * FROM playlist_sessions WHERE playlistId = :playlistId")
    suspend fun getById(playlistId: String): PlaylistSessionEntity?

    @Query("SELECT * FROM playlist_sessions ORDER BY lastPlayedAt DESC")
    suspend fun getAll(): List<PlaylistSessionEntity>

    @Query("SELECT * FROM playlist_sessions WHERE completed = 0 ORDER BY lastPlayedAt DESC")
    suspend fun getAllIncomplete(): List<PlaylistSessionEntity>

    @Query("DELETE FROM playlist_sessions WHERE playlistId = :playlistId")
    suspend fun deleteById(playlistId: String): Int

    @Query(
        """
        UPDATE playlist_sessions
        SET completed = 1, lastPlayedAt = :now, updatedAt = :updatedAt
        WHERE playlistId = :playlistId
        """
    )
    suspend fun markCompleted(playlistId: String, now: Long, updatedAt: String): Int

    @Query("DELETE FROM playlist_sessions")
    suspend fun clearAll()

    @Query("SELECT COUNT(*) FROM playlist_sessions")
    suspend fun count(): Int
}
