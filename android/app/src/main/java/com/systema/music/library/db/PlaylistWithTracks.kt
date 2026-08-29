package com.systema.music.library.db

import androidx.room.Embedded
import androidx.room.Relation

/**
 * Composite Room relation returning a playlist and its ordered tracks.
 */
data class PlaylistWithTracks(
    @Embedded
    val playlist: PlaylistEntity,

    @Relation(
        parentColumn = "id",
        entityColumn = "playlistId",
    )
    val trackEntries: List<PlaylistTrackEntity>,
) {
    val orderedTrackIds: List<String>
        get() = trackEntries.sortedBy { it.position }.map { it.trackId }
}
