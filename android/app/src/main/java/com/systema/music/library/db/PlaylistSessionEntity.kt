package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room representation of an active playlist listening session (Continue Listening).
 *
 * Tracks both the current track resume pointer AND the actual listened ranges/segments
 * across all tracks in the playlist to calculate true listening progress without
 * fake jumps from track navigation or skipping.
 */
@Entity(
    tableName = "playlist_sessions",
    indices = [
        Index(value = ["lastPlayedAt"]),
        Index(value = ["completed"]),
    ],
)
data class PlaylistSessionEntity(
    @PrimaryKey
    @ColumnInfo(name = "playlistId")
    val playlistId: String,

    @ColumnInfo(name = "trackId")
    val trackId: String,

    @ColumnInfo(name = "trackIndex")
    val trackIndex: Int,

    @ColumnInfo(name = "positionSeconds")
    val positionSeconds: Double,

    @ColumnInfo(name = "durationSeconds")
    val durationSeconds: Double,

    @ColumnInfo(name = "lastPlayedAt")
    val lastPlayedAt: Long,

    @ColumnInfo(name = "updatedAt")
    val updatedAt: String,

    @ColumnInfo(name = "completed")
    val completed: Boolean,

    @ColumnInfo(name = "listenedRangesJson")
    val listenedRangesJson: String? = null,

    @ColumnInfo(name = "totalListenedSeconds")
    val totalListenedSeconds: Double = 0.0,
)
