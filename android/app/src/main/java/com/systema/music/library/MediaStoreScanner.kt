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

    private val projection: Array<String> = buildList {
        add(MediaStore.Audio.Media._ID)
        add(MediaStore.Audio.Media.TITLE)
        add(MediaStore.Audio.Media.ARTIST)
        add(MediaStore.Audio.Media.ALBUM)
        add(MediaStore.Audio.Media.ALBUM_ID)
        add(MediaStore.Audio.Media.DURATION)
        add(MediaStore.Audio.Media.TRACK)
        add(MediaStore.Audio.Media.YEAR)
        add(MediaStore.Audio.Media.MIME_TYPE)
        add(MediaStore.Audio.Media.SIZE)
        add(MediaStore.Audio.Media.DATE_ADDED)
        add(MediaStore.Audio.Media.DATE_MODIFIED)
        // ALBUM_ARTIST, DISC_NUMBER and GENRE became queryable columns
        // on API 30. On older devices they stay null rather than
        // triggering an extra per-track lookup.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            add(MediaStore.Audio.Media.ALBUM_ARTIST)
            add(MediaStore.Audio.Media.DISC_NUMBER)
            add(MediaStore.Audio.Media.GENRE)
        }
    }.toTypedArray()

    private val collection: Uri
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }

    private val volumeName: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.VOLUME_EXTERNAL
        } else {
            "external"
        }

    /** `IS_MUSIC` plus a sane duration keeps ringtones and UI blips out. */
    private val selection =
        "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= ?"

    private val selectionArgs = arrayOf(MIN_DURATION_MS.toString())

    /**
     * Exact number of audio items MediaStore will return, so scan
     * progress reports a real total instead of a fabricated one.
     * Returns null when the count cannot be determined; the caller
     * then reports an indeterminate scan.
     */
    fun countTracks(): Int? = try {
        context.contentResolver.query(
            collection,
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
     *
     * Suspending, and the batch callback suspends too, so persistence
     * happens inside the same structured-concurrency scope — no
     * `runBlocking`, no thread hand-off per batch.
     *
     * @param batchSize rows handed to [onBatch] at a time.
     * @param isCancelled polled between rows so a cancelled scan stops promptly.
     * @return total number of valid tracks emitted.
     */
    suspend fun scan(
        batchSize: Int,
        isCancelled: () -> Boolean = { false },
        onBatch: suspend (List<MusicTrack>) -> Unit,
    ): Int {
        var emitted = 0
        val cursor: Cursor = try {
            context.contentResolver.query(
                collection,
                projection,
                selection,
                selectionArgs,
                "${MediaStore.Audio.Media._ID} ASC",
            )
        } catch (e: SecurityException) {
            throw e // handled by the repository as a permission problem
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.MEDIASTORE_QUERY_FAILED,
                "The device media index could not be queried.",
                e,
            )
        } ?: throw MusicLibraryException(
            MusicLibraryException.Code.MEDIASTORE_UNAVAILABLE,
            "MediaStore returned no cursor for the audio collection.",
        )

        cursor.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val trackCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
            val yearCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
            val mimeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val sizeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val addedCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
            val modifiedCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
            // Optional columns — absent on API < 30.
            val albumArtistCol = c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ARTIST)
            val discCol = c.getColumnIndex(MediaStore.Audio.Media.DISC_NUMBER)
            val genreCol = c.getColumnIndex(MediaStore.Audio.Media.GENRE)

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
                    // One malformed row must never abort a whole scan.
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
        val mediaId = c.getLong(idCol)
        val duration = if (c.isNull(durationCol)) 0L else c.getLong(durationCol)
        if (duration < MIN_DURATION_MS) return null

        val mime = c.stringOrNull(mimeCol)
        if (mime != null && ACCEPTED_MIME_PREFIXES.none { mime.startsWith(it, ignoreCase = true) }) {
            return null
        }

        // MediaStore packs disc and track as DDDTTT (e.g. 2005 -> disc 2, track 5).
        val rawTrack = if (c.isNull(trackCol)) null else c.getInt(trackCol)
        val trackNumber = rawTrack?.let { if (it > 1000) it % 1000 else it }?.takeIf { it > 0 }
        val packedDisc = rawTrack?.let { if (it > 1000) it / 1000 else null }
        val discNumber = when {
            discCol >= 0 && !c.isNull(discCol) -> c.getInt(discCol).takeIf { it > 0 }
            else -> packedDisc
        }

        val albumId = if (c.isNull(albumIdCol)) null else c.getLong(albumIdCol)
        val contentUri = ContentUris.withAppendedId(collection, mediaId)

        return MusicTrack(
            id = TrackIdentity.of(volumeName, mediaId),
            mediaStoreId = mediaId,
            volumeName = volumeName,
            uri = contentUri.toString(),
            // TITLE is the only field we substitute, because a row with
            // no title at all cannot be rendered. Everything else stays
            // honestly null.
            title = c.stringOrNull(titleCol) ?: "Unknown title",
            // MediaStore writes the literal "<unknown>" when a tag is
            // absent. That is not real metadata, so we store null and
            // let the UI supply its own fallback label.
            artist = c.stringOrNull(artistCol)?.takeUnless { it == UNKNOWN_TAG },
            album = c.stringOrNull(albumCol)?.takeUnless { it == UNKNOWN_TAG },
            albumArtist = if (albumArtistCol >= 0) c.stringOrNull(albumArtistCol) else null,
            duration = duration,
            trackNumber = trackNumber,
            discNumber = discNumber,
            genre = if (genreCol >= 0) c.stringOrNull(genreCol) else null,
            year = if (c.isNull(yearCol)) null else c.getInt(yearCol).takeIf { it > 0 },
            mimeType = mime,
            fileSize = if (c.isNull(sizeCol)) 0L else c.getLong(sizeCol),
            dateAdded = if (c.isNull(addedCol)) 0L else c.getLong(addedCol),
            dateModified = if (c.isNull(modifiedCol)) 0L else c.getLong(modifiedCol),
            artworkUri = albumId?.let { ArtworkUris.forAlbum(it) },
            albumId = albumId,
        )
    }

    private fun Cursor.stringOrNull(column: Int): String? {
        if (column < 0 || isNull(column)) return null
        return getString(column)?.trim()?.takeIf { it.isNotEmpty() }
    }
}
