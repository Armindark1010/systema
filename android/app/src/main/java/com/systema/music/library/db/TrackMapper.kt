package com.systema.music.library.db

import com.systema.music.library.model.MusicTrack

/**
 * Entity <-> domain mapping. Kept in one place so Room schema details
 * never leak into the scanner, the repository API or the bridge.
 */
object TrackMapper {

    fun toEntity(track: MusicTrack, scanToken: Long): TrackEntity = TrackEntity(
        id = track.id,
        mediaStoreId = track.mediaStoreId,
        volumeName = track.volumeName,
        uri = track.uri,
        title = track.title,
        artist = track.artist,
        album = track.album,
        albumArtist = track.albumArtist,
        duration = track.duration,
        trackNumber = track.trackNumber,
        discNumber = track.discNumber,
        genre = track.genre,
        year = track.year,
        mimeType = track.mimeType,
        fileSize = track.fileSize,
        dateAdded = track.dateAdded,
        dateModified = track.dateModified,
        artworkUri = track.artworkUri,
        albumId = track.albumId,
        lastSeenScan = scanToken,
    )

    fun toDomain(entity: TrackEntity): MusicTrack = MusicTrack(
        id = entity.id,
        mediaStoreId = entity.mediaStoreId,
        volumeName = entity.volumeName,
        uri = entity.uri,
        title = entity.title,
        artist = entity.artist,
        album = entity.album,
        albumArtist = entity.albumArtist,
        duration = entity.duration,
        trackNumber = entity.trackNumber,
        discNumber = entity.discNumber,
        genre = entity.genre,
        year = entity.year,
        mimeType = entity.mimeType,
        fileSize = entity.fileSize,
        dateAdded = entity.dateAdded,
        dateModified = entity.dateModified,
        artworkUri = entity.artworkUri,
        albumId = entity.albumId,
    )
}
