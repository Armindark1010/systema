package com.systema.music.analysis

/**
 * Structured error codes for audio analysis failures.
 *
 * These are used to distinguish different failure modes and handle them
 * appropriately in the UI and retry logic.
 */
enum class AnalysisErrorCode(val codeName: String) {
    UNSUPPORTED_FORMAT("UNSUPPORTED_FORMAT"),
    DECODER_ERROR("DECODER_ERROR"),
    INVALID_URI("INVALID_URI"),
    EMPTY_AUDIO("EMPTY_AUDIO"),
    INVALID_PCM("INVALID_PCM"),
    DSP_ERROR("DSP_ERROR"),
    BPM_UNAVAILABLE("BPM_UNAVAILABLE"),
    CANCELLED("CANCELLED"),
    OUT_OF_MEMORY("OUT_OF_MEMORY"),
    UNKNOWN("UNKNOWN"),
    
    /**
     * IO error (file not found, permission denied, etc.)
     */
    IO_ERROR("IO_ERROR"),
    
    /**
     * Timeout during analysis
     */
    TIMEOUT("TIMEOUT"),
}

/**
 * Exception thrown when audio analysis fails.
 */
class AudioAnalysisException(
    val code: AnalysisErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    val codeName: String get() = code.codeName
}
