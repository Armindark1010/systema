package com.systema.music.inference.clap

import android.util.Log

/**
 * Structured [CLAP] logging (§9).
 *
 * Every lifecycle transition is logged with a fixed tag and a fixed
 * event name so a crash report can be read as a sequence rather than
 * reconstructed from prose. If the app dies mid-inference, the last
 * event tells you exactly which stage it died in.
 *
 * PRIVACY: raw audio is never logged. Only shapes, durations, rates
 * and counts. There is deliberately no overload that accepts a
 * FloatArray of samples.
 */
object ClapLog {

    const val TAG = "CLAP"

    // Lifecycle events, exactly as specified in §9.
    const val IMPORT = "IMPORT"
    const val VALIDATE = "VALIDATE"
    const val LOAD_START = "LOAD_START"
    const val LOAD_SUCCESS = "LOAD_SUCCESS"
    const val INFERENCE_START = "INFERENCE_START"
    const val INFERENCE_END = "INFERENCE_END"
    const val EMBEDDING_VALID = "EMBEDDING_VALID"
    const val UNLOAD_START = "UNLOAD_START"
    const val UNLOAD_SUCCESS = "UNLOAD_SUCCESS"
    const val MEMORY_BEFORE = "MEMORY_BEFORE"
    const val MEMORY_AFTER = "MEMORY_AFTER"
    /** The input format derived from the loaded graph (Phase 21.1). */
    const val CONTRACT_DERIVED = "CONTRACT_DERIVED"
    const val GUARD_REFUSED = "GUARD_REFUSED"
    const val FAILURE = "FAILURE"

    // Phase 23.1 lifecycle tracing. These answer "is the session the
    // one the lab loaded, or a different/absent one?" using object
    // identity only — never audio, never embeddings.
    const val SESSION_IDENTITY = "SESSION_IDENTITY"
    const val SESSION_STATE = "SESSION_STATE"

    /** One structured line. Fields are `key=value`, space separated. */
    fun event(event: String, vararg fields: Pair<String, Any?>) {
        Log.i(TAG, render(event, fields))
    }

    fun warn(event: String, vararg fields: Pair<String, Any?>) {
        Log.w(TAG, render(event, fields))
    }

    /**
     * Failure log carrying the full §9 diagnostic set.
     *
     * Everything the brief asks for is a named parameter so no site
     * can quietly omit half of it and leave an unactionable report.
     */
    fun failure(
        stage: String,
        throwable: Throwable?,
        modelId: String?,
        modelSizeBytes: Long?,
        inputShape: List<Long>?,
        inputType: String?,
        sampleRate: Int?,
        audioDurationSec: Double?,
        memoryBeforeKb: Int?,
        memoryAfterKb: Int?,
        extra: String? = null,
    ) {
        val line = render(
            FAILURE,
            arrayOf(
                "stage" to stage,
                "exceptionType" to (throwable?.javaClass?.name ?: "none"),
                "message" to (throwable?.message ?: extra ?: "no message"),
                "modelId" to modelId,
                "modelSizeBytes" to modelSizeBytes,
                "inputShape" to inputShape?.joinToString("x"),
                "inputType" to inputType,
                "sampleRate" to sampleRate,
                "audioDurationSec" to audioDurationSec,
                "memoryBeforeKb" to memoryBeforeKb,
                "memoryAfterKb" to memoryAfterKb,
            ),
        )
        if (throwable != null) Log.e(TAG, line, throwable) else Log.e(TAG, line)
    }

    private fun render(event: String, fields: Array<out Pair<String, Any?>>): String {
        val sb = StringBuilder(event)
        for ((k, v) in fields) {
            sb.append(' ').append(k).append('=').append(v ?: "unknown")
        }
        return sb.toString()
    }
}
