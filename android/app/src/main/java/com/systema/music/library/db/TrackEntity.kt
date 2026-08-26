package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room representation of one local audio item.
 *
 * Indexes are deliberately limited to the columns the library actually
 * sorts/filters on. Every extra index costs write throughput during a
 * full 10k-track scan, so we do not index columns we never query.
 *
 * The schema is intentionally flat for Phase 1. Future phases add
 * separate entities (Artist, Album, Playlist, AIAnalysis, ChatHistory)
 * that reference `id` — they are NOT created here.
 */
@Entity(
    tableName = "tracks",
    indices = [
        Index(value = ["mediaStoreId", "volumeName"], unique = true),
        Index(value = ["artist"]),
        Index(value = ["album"]),
        Index(value = ["title"]),
        Index(value = ["dateAdded"]),
        // Drives stale-record cleanup at the end of every scan.
        Index(value = ["lastSeenScan"]),
    ],
)
data class TrackEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "mediaStoreId")
    val mediaStoreId: Long,

    @ColumnInfo(name = "volumeName")
    val volumeName: String,

    @ColumnInfo(name = "uri")
    val uri: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "artist")
    val artist: String?,

    @ColumnInfo(name = "album")
    val album: String?,

    @ColumnInfo(name = "albumArtist")
    val albumArtist: String?,

    @ColumnInfo(name = "duration")
    val duration: Long,

    @ColumnInfo(name = "trackNumber")
    val trackNumber: Int?,

    @ColumnInfo(name = "discNumber")
    val discNumber: Int?,

    @ColumnInfo(name = "genre")
    val genre: String?,

    @ColumnInfo(name = "year")
    val year: Int?,

    @ColumnInfo(name = "mimeType")
    val mimeType: String?,

    @ColumnInfo(name = "fileSize")
    val fileSize: Long,

    @ColumnInfo(name = "dateAdded")
    val dateAdded: Long,

    @ColumnInfo(name = "dateModified")
    val dateModified: Long,

    @ColumnInfo(name = "artworkUri")
    val artworkUri: String?,

    @ColumnInfo(name = "albumId")
    val albumId: Long?,

    /**
     * Token of the last scan that observed this row. Rows carrying an
     * older token after a scan completes no longer exist on the device
     * and are removed. This avoids ever sending a giant `NOT IN (...)`
     * list of ids to SQLite.
     */
    @ColumnInfo(name = "lastSeenScan")
    val lastSeenScan: Long,
)

/**
 * Narrow projection used by the incremental-sync diff. Loading only
 * these three columns keeps a 10k-track comparison cheap instead of
 * materialising every full row.
 */
data class TrackSyncKey(
    val id: String,
    val dateModified: Long,
    val fileSize: Long,
)
