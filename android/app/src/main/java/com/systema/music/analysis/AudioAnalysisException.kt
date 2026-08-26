package com.systema.music.analysis

/**
 * Structured analysis failure that can cross the Capacitor boundary.
 *
 * Mirrors the convention already used by MusicLibraryException: a
 * stable machine-readable [code] plus a short human sentence, with
 * stack traces left in logcat rather than shipped to the WebView.
 *
 * Analysis is strictly secondary to playback. Every one of these codes
 * represents a condition the player must survive untouched.
 */
class AudioAnalysisException(
    val code: Code,
    override val message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {

    enum class Code {
        /** No decoder on this device handles the track's codec. */
        UNSUPPORTED_FORMAT,

        /** MediaCodec/MediaExtractor failed partway through. */
        DECODER_ERROR,

        /** The URI was malformed, or the ContentResolver rejected it. */
        INVALID_URI,

        /** The file decoded successfully but contained no audio. */
        EMPTY_AUDIO,

        /** Decoded PCM was structurally unusable (bad rate/channels). */
        INVALID_PCM,

        /** A DSP stage threw. Should be unreachable; kept for honesty. */
        DSP_ERROR,

        /** Tempo could not be established with sufficient confidence. */
        BPM_UNAVAILABLE,

        /** The caller (or WorkManager) cancelled the job. */
        CANCELLED,

        /** Allocation failed — the analyser backs off rather than dies. */
        OUT_OF_MEMORY,

        /** Persistence failed after a successful analysis. */
        DATABASE_ERROR,

        /** The requested track is not in the library index. */
        NOT_FOUND,

        UNKNOWN,
    }

    val codeName: String get() = code.name
}
