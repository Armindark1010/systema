package com.systema.music.library.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

/**
 * Data Access Object for persistent playlists in Room SQLite.
 */
@Dao
interface PlaylistDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdatePlaylist(playlist: PlaylistEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTrackEntries(entries: List<PlaylistTrackEntity>)

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId")
    suspend fun deleteTracksForPlaylist(playlistId: String)

    @Transaction
    suspend fun upsertPlaylistWithTracks(playlist: PlaylistEntity, trackIds: List<String>) {
        insertOrUpdatePlaylist(playlist)
        deleteTracksForPlaylist(playlist.id)
        val now = System.currentTimeMillis()
        val entries = trackIds.mapIndexed { index, trackId ->
            PlaylistTrackEntity(
                playlistId = playlist.id,
                trackId = trackId,
                position = index,
                addedAt = now,
            )
        }
        if (entries.isNotEmpty()) {
            insertTrackEntries(entries)
        }
    }

    @Transaction
    @Query("SELECT * FROM playlists WHERE id = :id")
    suspend fun getPlaylistWithTracks(id: String): PlaylistWithTracks?

    @Transaction
    @Query("SELECT * FROM playlists ORDER BY updatedAt DESC")
    suspend fun getAllPlaylistsWithTracks(): List<PlaylistWithTracks>

    @Query("DELETE FROM playlists WHERE id = :id")
    suspend fun deletePlaylist(id: String): Int

    @Query("SELECT COUNT(*) FROM playlists")
    suspend fun count(): Int

    @Query("DELETE FROM playlists")
    suspend fun clearAll()
}
