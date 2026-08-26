package com.systema.music.library.model

/** Lifecycle of a library scan. */
enum class ScanState {
    IDLE,
    REQUESTING_PERMISSION,
    SCANNING,
    COMPLETED,
    ERROR,
}

/**
 * Real scan telemetry. Every counter reflects work that actually
 * happened — nothing here is simulated or interpolated.
 *
 * @param total exact number of items MediaStore reported, or null when
 *   the count could not be determined (indeterminate progress).
 */
data class ScanProgress(
    val state: ScanState = ScanState.IDLE,
    val discovered: Int = 0,
    val processed: Int = 0,
    val inserted: Int = 0,
    val updated: Int = 0,
    val removed: Int = 0,
    val unchanged: Int = 0,
    val total: Int? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val startedAt: Long? = null,
    val finishedAt: Long? = null,
) {
    val indeterminate: Boolean get() = total == null
}
