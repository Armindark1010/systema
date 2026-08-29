package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Join table mapping tracks to playlists with position ordering.
 */
@Entity(
    tableName = "playlist_tracks",
    foreignKeys = [
        ForeignKey(
            entity = PlaylistEntity::class,
            parentColumns = ["id"],
            childColumns = ["playlistId"],
            onDelete = ForeignKey.CASCADE,
            onUpdate = ForeignKey.NO_ACTION,
        ),
    ],
    indices = [
        Index(value = ["playlistId", "position"], unique = true),
        Index(value = ["playlistId"]),
        Index(value = ["trackId"]),
    ],
)
data class PlaylistTrackEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "rowId")
    val rowId: Long = 0,

    @ColumnInfo(name = "playlistId")
    val playlistId: String,

    @ColumnInfo(name = "trackId")
    val trackId: String,

    @ColumnInfo(name = "position")
    val position: Int,

    @ColumnInfo(name = "addedAt")
    val addedAt: Long,
)
