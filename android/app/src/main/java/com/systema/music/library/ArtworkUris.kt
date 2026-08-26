package com.systema.music.library

import android.content.ContentUris
import android.net.Uri

/**
 * Album artwork strategy.
 *
 * We hand the WebView a *content URI string* and nothing else:
 *
 *  - No Base64. Encoding thousands of covers would blow up both the
 *    database and the Capacitor bridge.
 *  - No bitmaps in Room. The database stores a short URI, never pixels.
 *  - No eager decoding. Nothing is loaded until an `<img>` actually
 *    requests it, so a 10k-track library costs 10k short strings, not
 *    10k decoded images.
 *  - Thumbnail sizing is the platform's job: the WebView requests the
 *    art at the size the layout needs, and on API 29+ callers can use
 *    `ContentResolver.loadThumbnail` against the same URI.
 *
 * When an album has no art, MediaStore simply fails to resolve the URI
 * and the existing SYSTEMA `<Artwork>` fallback renders instead — we
 * return null rather than inventing a placeholder here.
 */
object ArtworkUris {

    private val ALBUM_ART_BASE: Uri = Uri.parse("content://media/external/audio/albumart")

    /** Legacy-but-still-supported album art URI for an album id. */
    fun forAlbum(albumId: Long): String =
        ContentUris.withAppendedId(ALBUM_ART_BASE, albumId).toString()
}
