package com.systema.music.player.model

/**
 * SYSTEMA — player domain models.
 *
 * These mirror the TypeScript contract in `playerPlugin.ts` one-for-one.
 * Nothing Media3-specific leaks into them, which is what will let the
 * engine move behind a MediaSessionService later without touching the
 * bridge or the frontend.
 */

/**
 * One playable item. Deliberately a small metadata envelope around a
 * `content://` URI — never audio bytes, never a bitmap.
 */
data class PlayerTrack(
    /** SYSTEMA identity, e.g. "ms:external_primary:1234". */
    val id: String,
    /** Playable content:// URI straight from MediaStore. */
    val uri: String,
    val title: String,
    val artist: String?,
    val album: String?,
    /** content:// album art URI, or null. Passed by reference only. */
    val artworkUri: String?,
    /** Milliseconds, or 0 when unknown. */
    val duration: Long,
)

/**
 * Playback lifecycle, normalised away from ExoPlayer's integer states
 * so the frontend never has to know Media3 constants.
 */
enum class PlaybackState {
    IDLE,
    BUFFERING,
    READY,
    ENDED;

    val lowercase: String get() = name.lowercase()
}

enum class RepeatMode {
    OFF,
    ONE,
    ALL;

    val lowercase: String get() = name.lowercase()

    companion object {
        /** Tolerant parse; unknown values fall back to OFF. */
        fun from(raw: String?): RepeatMode = when (raw?.lowercase()) {
            "one" -> ONE
            "all" -> ALL
            else -> OFF
        }
    }
}

/**
 * Full snapshot of native playback. Emitted on state changes so the
 * Pinia store can mirror the engine without ever polling it.
 */
data class PlayerSnapshot(
    val state: PlaybackState,
    val isPlaying: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val bufferedPositionMs: Long,
    val currentIndex: Int,
    val queueSize: Int,
    val shuffle: Boolean,
    val repeatMode: RepeatMode,
    val currentTrackId: String?,
    /**
     * True when playback is paused because Media3 lost audio focus (a
     * call, another music app) rather than because the user paused.
     * Lets the UI describe an interruption without guessing.
     */
    val interrupted: Boolean = false,
)

/**
 * Structured playback failure. Mirrors MusicLibraryException's
 * contract: a stable machine code plus a short sentence. Kotlin stack
 * traces stay in logcat and never reach the WebView.
 */
class PlayerException(
    val code: Code,
    override val message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {

    enum class Code {
        /** The stored content:// URI no longer resolves. */
        INVALID_URI,
        /** URI resolves but the file is gone or unreadable. */
        FILE_UNAVAILABLE,
        /** Media3 could not decode the stream. */
        DECODER_ERROR,
        /** Container/codec the device cannot play. */
        UNSUPPORTED_FORMAT,
        /** Any other Media3 playback error. */
        PLAYBACK_ERROR,
        /** Read permission was revoked after the scan. */
        PERMISSION_DENIED,
        /** ExoPlayer could not be constructed. */
        INITIALIZATION_FAILED,
        /** Caller passed something the engine cannot use. */
        INVALID_ARGUMENT,
        /** Requested track/queue entry does not exist. */
        NOT_FOUND,
        UNKNOWN,
    }

    val codeName: String get() = code.name
}
