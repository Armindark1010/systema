package com.systema.music.library

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import com.systema.music.library.model.MusicTrack

/**
 * Reads the device audio index straight from `MediaStore.Audio.Media`.
 *
 * Design rules:
 *  - MediaStore is the only source of truth. We never walk the
 *    filesystem: that breaks under scoped storage and is far slower.
 *  - A fixed projection. Extra columns cost memory on every one of
 *    potentially 10k+ rows.
 *  - We never open or read the audio files themselves. Everything here
 *    comes from the index Android already maintains.
 *  - Rows are yielded in batches so the caller can persist
 *    incrementally instead of materialising the whole library.
 */
class MediaStoreScanner(private val context: Context) {

    companion object {
        private const val TAG = "SystemaScanner"

        /**
         * Codecs Android commonly indexes. Actual decode support is
         * per-device, which is exactly why we filter on IS_MUSIC and a
         * positive duration rather than trusting an extension list.
         * Known audio MIME prefixes are accepted; anything the device
         * indexed but cannot describe is skipped rather than crashing.
         */
        private val ACCEPTED_MIME_PREFIXES = listOf("audio/", "application/ogg", "application/x-ogg")

        /** Tracks shorter than this are almost always UI sounds. */
        private const val MIN_DURATION_MS = 1_000L

        /** Placeholder MediaStore substitutes for a missing tag. */
        private const val UNKNOWN_TAG = "<unknown>"
    }

    private val baseProjection = arrayOf(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.TRACK,
        MediaStore.Audio.Media.YEAR,
        MediaStore.Audio.Media.MIME_TYPE,
        MediaStore.Audio.Media.SIZE,
        MediaStore.Audio.Media.DATE_ADDED,
        MediaStore.Audio.Media.DATE_MODIFIED,
    )

    private val projection: Array<String> = buildList {
        addAll(baseProjection)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            add(MediaStore.Audio.Media.ALBUM_ARTIST)
            add(MediaStore.Audio.Media.DISC_NUMBER)
            add(MediaStore.Audio.Media.GENRE)
        }
    }.toTypedArray()

    private val collection: Uri
        get() = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

    private val volumeName: String
        get() = "external"

    /**
     * Resilient selection query:
     * - Accepts IS_MUSIC != 0 OR IS_MUSIC IS NULL OR audio MIME types (captures Telegram/browser downloads).
     * - Excludes system ringtones, notifications, and alarms.
     * - Allows zero/uncomputed duration for newly downloaded files while filtering clicks < 500ms.
     */
    private val selection = buildString {
        append("(")
        append("${MediaStore.Audio.Media.IS_MUSIC} != 0")
        append(" OR ${MediaStore.Audio.Media.IS_MUSIC} IS NULL")
        append(" OR ${MediaStore.Audio.Media.MIME_TYPE} LIKE 'audio/%'")
        append(")")
        append(" AND (${MediaStore.Audio.Media.IS_RINGTONE} = 0 OR ${MediaStore.Audio.Media.IS_RINGTONE} IS NULL)")
        append(" AND (${MediaStore.Audio.Media.IS_NOTIFICATION} = 0 OR ${MediaStore.Audio.Media.IS_NOTIFICATION} IS NULL)")
        append(" AND (${MediaStore.Audio.Media.IS_ALARM} = 0 OR ${MediaStore.Audio.Media.IS_ALARM} IS NULL)")
        append(" AND (${MediaStore.Audio.Media.DURATION} >= ? OR ${MediaStore.Audio.Media.DURATION} IS NULL OR ${MediaStore.Audio.Media.DURATION} = 0)")
    }

    private val selectionArgs = arrayOf("500")

    private fun queryMediaStore(
        proj: Array<String>,
        sel: String?,
        args: Array<String>?,
        sortOrder: String?,
    ): Cursor? {
        try {
            return context.contentResolver.query(collection, proj, sel, args, sortOrder)
        } catch (e: SecurityException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Full query failed, retrying with base projection and simple filter", e)
        }

        try {
            return context.contentResolver.query(
                collection,
                baseProjection,
                "${MediaStore.Audio.Media.DURATION} >= ? OR ${MediaStore.Audio.Media.DURATION} IS NULL OR ${MediaStore.Audio.Media.DURATION} = 0",
                arrayOf("500"),
                sortOrder,
            )
        } catch (e: SecurityException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Simple query failed, querying without selection", e)
        }

        return context.contentResolver.query(collection, baseProjection, null, null, sortOrder)
    }

    /**
     * Exact number of audio items MediaStore will return.
     * Returns null when the count cannot be determined.
     */
    fun countTracks(): Int? = try {
        queryMediaStore(
            arrayOf(MediaStore.Audio.Media._ID),
            selection,
            selectionArgs,
            null,
        )?.use { it.count }
    } catch (e: Exception) {
        Log.w(TAG, "Track count failed", e)
        null
    }

    /**
     * Streams the audio index in batches.
     */
    suspend fun scan(
        batchSize: Int,
        isCancelled: () -> Boolean = { false },
        onBatch: suspend (List<MusicTrack>) -> Unit,
    ): Int {
        var emitted = 0
        val cursor: Cursor = try {
            queryMediaStore(
                projection,
                selection,
                selectionArgs,
                "${MediaStore.Audio.Media._ID} ASC",
            )
        } catch (e: SecurityException) {
            throw e
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.MEDIASTORE_QUERY_FAILED,
                "The device media index could not be queried: ${e.message}",
                e,
            )
        } ?: throw MusicLibraryException(
            MusicLibraryException.Code.MEDIASTORE_UNAVAILABLE,
            "MediaStore returned no cursor for the audio collection.",
        )

        cursor.use { c ->
            val idCol = c.getColumnIndex(MediaStore.Audio.Media._ID)
            val titleCol = c.getColumnIndex(MediaStore.Audio.Media.TITLE)
            val artistCol = c.getColumnIndex(MediaStore.Audio.Media.ARTIST)
            val albumCol = c.getColumnIndex(MediaStore.Audio.Media.ALBUM)
            val albumIdCol = c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID)
            val durationCol = c.getColumnIndex(MediaStore.Audio.Media.DURATION)
            val trackCol = c.getColumnIndex(MediaStore.Audio.Media.TRACK)
            val yearCol = c.getColumnIndex(MediaStore.Audio.Media.YEAR)
            val mimeCol = c.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE)
            val sizeCol = c.getColumnIndex(MediaStore.Audio.Media.SIZE)
            val addedCol = c.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED)
            val modifiedCol = c.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED)
            // ALBUM_ARTIST, DISC_NUMBER, GENRE are API 30+ (Android 11) constants.
            // Accessing the field reference on API < 30 throws NoSuchFieldError,
            // so we guard each one behind a version check.
            val albumArtistCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ARTIST)
            } else {
                -1
            }
            val discCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                c.getColumnIndex(MediaStore.Audio.Media.DISC_NUMBER)
            } else {
                -1
            }
            val genreCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                c.getColumnIndex(MediaStore.Audio.Media.GENRE)
            } else {
                -1
            }

            if (idCol < 0) {
                throw MusicLibraryException(
                    MusicLibraryException.Code.MEDIASTORE_QUERY_FAILED,
                    "MediaStore cursor missing _ID column",
                )
            }

            val batch = ArrayList<MusicTrack>(batchSize)

            while (c.moveToNext()) {
                if (isCancelled()) break

                val track = try {
                    readRow(
                        c, idCol, titleCol, artistCol, albumCol, albumIdCol, durationCol,
                        trackCol, yearCol, mimeCol, sizeCol, addedCol, modifiedCol,
                        albumArtistCol, discCol, genreCol,
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "Skipping unreadable MediaStore row", e)
                    null
                }

                if (track != null) {
                    batch.add(track)
                    emitted++
                    if (batch.size >= batchSize) {
                        onBatch(ArrayList(batch))
                        batch.clear()
                    }
                }
            }

            if (batch.isNotEmpty() && !isCancelled()) onBatch(ArrayList(batch))
        }

        return emitted
    }

    private fun readRow(
        c: Cursor,
        idCol: Int, titleCol: Int, artistCol: Int, albumCol: Int, albumIdCol: Int,
        durationCol: Int, trackCol: Int, yearCol: Int, mimeCol: Int, sizeCol: Int,
        addedCol: Int, modifiedCol: Int, albumArtistCol: Int, discCol: Int, genreCol: Int,
    ): MusicTrack? {
        if (idCol < 0 || c.isNull(idCol)) return null
        val mediaId = c.getLong(idCol)
        val duration = if (durationCol >= 0 && !c.isNull(durationCol)) c.getLong(durationCol) else 0L
        if (duration in 1..499) return null

        val mime = if (mimeCol >= 0) c.stringOrNull(mimeCol) else null
        val isAudioMime = mime == null ||
            ACCEPTED_MIME_PREFIXES.any { mime.startsWith(it, ignoreCase = true) } ||
            mime.equals("application/octet-stream", ignoreCase = true) ||
            mime.equals("video/mp4", ignoreCase = true) ||
            mime.equals("video/3gpp", ignoreCase = true)
        if (!isAudioMime) {
            return null
        }

        val rawTrack = if (trackCol >= 0 && !c.isNull(trackCol)) c.getInt(trackCol) else null
        val trackNumber = rawTrack?.let { if (it > 1000) it % 1000 else it }?.takeIf { it > 0 }
        val packedDisc = rawTrack?.let { if (it > 1000) it / 1000 else null }
        val discNumber = when {
            discCol >= 0 && !c.isNull(discCol) -> c.getInt(discCol).takeIf { it > 0 }
            else -> packedDisc
        }

        val albumId = if (albumIdCol >= 0 && !c.isNull(albumIdCol)) c.getLong(albumIdCol) else null
        val contentUri = ContentUris.withAppendedId(collection, mediaId)

        return MusicTrack(
            id = TrackIdentity.of(volumeName, mediaId),
            mediaStoreId = mediaId,
            volumeName = volumeName,
            uri = contentUri.toString(),
            title = (if (titleCol >= 0) c.stringOrNull(titleCol) else null) ?: "Unknown title",
            artist = if (artistCol >= 0) c.stringOrNull(artistCol)?.takeUnless { it == UNKNOWN_TAG } else null,
            album = if (albumCol >= 0) c.stringOrNull(albumCol)?.takeUnless { it == UNKNOWN_TAG } else null,
            albumArtist = if (albumArtistCol >= 0) c.stringOrNull(albumArtistCol) else null,
            duration = duration,
            trackNumber = trackNumber,
            discNumber = discNumber,
            genre = if (genreCol >= 0) c.stringOrNull(genreCol) else null,
            year = if (yearCol >= 0 && !c.isNull(yearCol)) c.getInt(yearCol).takeIf { it > 0 } else null,
            mimeType = mime,
            fileSize = if (sizeCol >= 0 && !c.isNull(sizeCol)) c.getLong(sizeCol) else 0L,
            dateAdded = if (addedCol >= 0 && !c.isNull(addedCol)) c.getLong(addedCol) else 0L,
            dateModified = if (modifiedCol >= 0 && !c.isNull(modifiedCol)) c.getLong(modifiedCol) else 0L,
            artworkUri = albumId?.let { ArtworkUris.forAlbum(it) },
            albumId = albumId,
        )
    }

    private fun Cursor.stringOrNull(column: Int): String? {
        if (column < 0 || isNull(column)) return null
        return getString(column)?.trim()?.takeIf { it.isNotEmpty() }
    }
}
