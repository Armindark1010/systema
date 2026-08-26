package com.systema.music.library.model

/**
 * SYSTEMA — canonical local music track.
 *
 * This is the single shared representation that crosses every layer:
 *
 *   MediaStore -> Scanner -> Repository -> Room -> Capacitor -> Pinia
 *
 * Nullable fields are genuinely nullable: Android frequently reports no
 * album artist, no genre, no year and no artwork. We never invent
 * metadata here — the presentation layer owns fallbacks.
 */
data class MusicTrack(
    /** Stable synthetic identity, e.g. "ms:external_primary:1234". */
    val id: String,
    /** Raw MediaStore row id (`MediaStore.Audio.Media._ID`). */
    val mediaStoreId: Long,
    /** MediaStore volume this item lives on, part of its stable identity. */
    val volumeName: String,
    /** Playable content:// URI. Phase 2 (Media3) consumes this directly. */
    val uri: String,
    val title: String,
    val artist: String?,
    val album: String?,
    val albumArtist: String?,
    /** Milliseconds. */
    val duration: Long,
    val trackNumber: Int?,
    val discNumber: Int?,
    val genre: String?,
    val year: Int?,
    val mimeType: String?,
    /** Bytes. */
    val fileSize: Long,
    /** Epoch seconds, as reported by MediaStore. */
    val dateAdded: Long,
    /** Epoch seconds, as reported by MediaStore. Drives incremental sync. */
    val dateModified: Long,
    /**
     * Album-art content URI, or null when the device has no art for the
     * album. Never a bitmap, never Base64 — the WebView loads it lazily
     * through Capacitor's content bridge.
     */
    val artworkUri: String?,
    val albumId: Long?,
)
