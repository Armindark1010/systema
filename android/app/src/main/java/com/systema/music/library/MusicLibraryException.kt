package com.systema.music.library

/**
 * Structured failure that can safely cross the Capacitor boundary.
 *
 * The frontend receives a stable machine-readable [code] and a short
 * human sentence. Stack traces stay in logcat — they are never sent to
 * the WebView.
 */
class MusicLibraryException(
    val code: Code,
    override val message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {

    enum class Code {
        PERMISSION_DENIED,
        MEDIASTORE_UNAVAILABLE,
        MEDIASTORE_QUERY_FAILED,
        DATABASE_ERROR,
        INVALID_ARGUMENT,
        SCAN_IN_PROGRESS,
        NOT_FOUND,
        UNKNOWN,
    }

    val codeName: String get() = code.name
}
