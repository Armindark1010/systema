package com.systema.music.library

/**
 * Stable track identity.
 *
 * A track's id is derived from the two pieces of information Android
 * guarantees to be stable for an indexed media item: the MediaStore
 * volume it lives on and its row `_ID` within that volume.
 *
 *     ms:external_primary:1234
 *
 * Deliberately NOT used as identity:
 *  - array indexes (reorder on every scan)
 *  - titles (duplicated, editable, non-unique)
 *  - random UUIDs (would orphan every record on each scan)
 *  - file paths (unavailable under scoped storage)
 *
 * The volume prefix matters: `_ID` values are only unique per volume,
 * so a track on internal storage and one on an SD card can share a row
 * id. Including the volume keeps them distinct.
 */
object TrackIdentity {
    private const val PREFIX = "ms"

    fun of(volumeName: String, mediaStoreId: Long): String = "$PREFIX:$volumeName:$mediaStoreId"
}
