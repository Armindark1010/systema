package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room representation of a persistent playlist.
 *
 * Guaranteed to survive application termination, device reboots,
 * background memory purges, and updates.
 */
@Entity(
    tableName = "playlists",
    indices = [
        Index(value = ["title"]),
        Index(value = ["updatedAt"]),
    ],
)
data class PlaylistEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "description")
    val description: String?,

    @ColumnInfo(name = "cover")
    val cover: String?,

    @ColumnInfo(name = "kind")
    val kind: String, // "user", "ai", "system"

    @ColumnInfo(name = "createdAt")
    val createdAt: String,

    @ColumnInfo(name = "updatedAt")
    val updatedAt: String,

    @ColumnInfo(name = "aiMetaJson")
    val aiMetaJson: String?,
)
