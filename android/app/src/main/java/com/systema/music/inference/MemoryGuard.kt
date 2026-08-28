package com.systema.music.inference

import android.app.ActivityManager
import android.content.Context
import android.util.Log

/**
 * Pre-flight memory admission control (§4).
 *
 * WHY THIS EXISTS
 * ---------------
 * A previous experimental model froze the whole device during
 * inference. That is not a bug you can catch: by the time the
 * allocation fails, the system is already thrashing and the Android
 * low-memory killer may take the app — or the foreground UI — with it.
 * The only reliable defence is to refuse to start.
 *
 * So this asks, BEFORE any session is created: given what this model
 * will plausibly need, and what the system actually has free right
 * now, is starting responsible?
 *
 * HONESTY ABOUT WHAT THIS CAN AND CANNOT DO
 * -----------------------------------------
 * The requirement estimate is a stated, documented heuristic — not a
 * measurement. It is derived from the model file size plus the tensor
 * footprint the caller declares. It can be wrong. It is therefore
 * deliberately conservative, and its reasoning is reported to the UI
 * so a human can see the arithmetic rather than trusting a verdict.
 *
 * This guard reduces the chance of an OOM. It cannot eliminate it, and
 * nothing here should be read as a guarantee that inference is safe.
 */
object MemoryGuard {

    private const val TAG = "SystemaMemoryGuard"

    /**
     * Multiplier applied to the model file size to estimate resident
     * cost. An ONNX graph is not just mapped: weights are materialised,
     * and the runtime allocates arena space for intermediate
     * activations. 2.0x is the working assumption and is stated in the
     * report rather than hidden.
     */
    const val MODEL_RESIDENT_FACTOR = 2.0

    /**
     * Headroom the system must retain after the estimated allocation,
     * so that the OS, the audio pipeline and the foreground UI are not
     * pushed into the killer's range by our benchmark.
     */
    const val REQUIRED_HEADROOM_MB = 192L

    /**
     * Absolute floor. Below this much free system memory we refuse
     * regardless of the model, because the device is already under
     * pressure and adding an inference session invites a freeze.
     */
    const val ABSOLUTE_MIN_AVAILABLE_MB = 256L

    data class Decision(
        val allowed: Boolean,
        /** Free system memory reported by ActivityManager, MB. */
        val availableMb: Long,
        /** Total system memory, MB. */
        val totalMb: Long,
        /** True when Android already considers itself low on memory. */
        val systemLowMemory: Boolean,
        /** Estimated resident cost of this run, MB. Heuristic. */
        val estimatedRequiredMb: Long,
        /** Java heap ceiling for this process, MB. */
        val javaHeapLimitMb: Long,
        val javaHeapUsedMb: Long,
        /** Machine-readable reason; STARTED when allowed. */
        val reasonCode: String,
        /** Human-readable explanation, including the arithmetic. */
        val explanation: String,
    ) {
        fun toJs() = com.getcapacitor.JSObject().apply {
            put("allowed", allowed)
            put("availableMb", availableMb)
            put("totalMb", totalMb)
            put("systemLowMemory", systemLowMemory)
            put("estimatedRequiredMb", estimatedRequiredMb)
            put("javaHeapLimitMb", javaHeapLimitMb)
            put("javaHeapUsedMb", javaHeapUsedMb)
            put("reasonCode", reasonCode)
            put("explanation", explanation)
            put("headroomMb", REQUIRED_HEADROOM_MB)
            put("modelResidentFactor", MODEL_RESIDENT_FACTOR)
            put(
                "caveat",
                "estimatedRequiredMb is a documented heuristic (model size x " +
                    "$MODEL_RESIDENT_FACTOR plus declared tensor bytes), not a " +
                    "measurement. It reduces the chance of an OOM; it does not " +
                    "guarantee inference will fit.",
            )
        }
    }

    /**
     * @param modelSizeBytes size of the model file on disk.
     * @param tensorBytes bytes the caller will allocate for input and
     *   output tensors for ONE window. Callers that stream must pass
     *   the per-window figure, not the whole track.
     */
    fun evaluate(
        context: Context,
        modelSizeBytes: Long,
        tensorBytes: Long = 0L,
    ): Decision {
        val mi = ActivityManager.MemoryInfo()
        var availableMb = -1L
        var totalMb = -1L
        var lowMemory = false
        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (am != null) {
                am.getMemoryInfo(mi)
                availableMb = mi.availMem / BYTES_PER_MB
                totalMb = mi.totalMem / BYTES_PER_MB
                lowMemory = mi.lowMemory
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Could not read system memory info", t)
        }

        val rt = Runtime.getRuntime()
        val javaHeapLimitMb = rt.maxMemory() / BYTES_PER_MB
        val javaHeapUsedMb = (rt.totalMemory() - rt.freeMemory()) / BYTES_PER_MB

        val modelResidentMb =
            (modelSizeBytes * MODEL_RESIDENT_FACTOR).toLong() / BYTES_PER_MB
        val tensorMb = tensorBytes / BYTES_PER_MB
        val estimatedRequiredMb = modelResidentMb + tensorMb

        // If we could not read memory at all, refuse. Proceeding blind
        // is precisely how the previous freeze happened.
        if (availableMb < 0) {
            return Decision(
                allowed = false,
                availableMb = availableMb,
                totalMb = totalMb,
                systemLowMemory = lowMemory,
                estimatedRequiredMb = estimatedRequiredMb,
                javaHeapLimitMb = javaHeapLimitMb,
                javaHeapUsedMb = javaHeapUsedMb,
                reasonCode = "MEMORY_UNREADABLE",
                explanation =
                    "Free system memory could not be read on this device, so the " +
                        "guard cannot confirm there is room. Refusing to start " +
                        "rather than risking a system-wide freeze.",
            )
        }

        if (lowMemory) {
            return Decision(
                allowed = false,
                availableMb = availableMb,
                totalMb = totalMb,
                systemLowMemory = true,
                estimatedRequiredMb = estimatedRequiredMb,
                javaHeapLimitMb = javaHeapLimitMb,
                javaHeapUsedMb = javaHeapUsedMb,
                reasonCode = "SYSTEM_LOW_MEMORY",
                explanation =
                    "Android reports the system is already low on memory " +
                        "(${availableMb} MB free of ${totalMb} MB). Starting " +
                        "inference now could push the device into a freeze. " +
                        "Close other apps and try again.",
            )
        }

        if (availableMb < ABSOLUTE_MIN_AVAILABLE_MB) {
            return Decision(
                allowed = false,
                availableMb = availableMb,
                totalMb = totalMb,
                systemLowMemory = false,
                estimatedRequiredMb = estimatedRequiredMb,
                javaHeapLimitMb = javaHeapLimitMb,
                javaHeapUsedMb = javaHeapUsedMb,
                reasonCode = "BELOW_ABSOLUTE_FLOOR",
                explanation =
                    "Only ${availableMb} MB of system memory is free, below the " +
                        "${ABSOLUTE_MIN_AVAILABLE_MB} MB floor this benchmark requires " +
                        "regardless of model size.",
            )
        }

        val needed = estimatedRequiredMb + REQUIRED_HEADROOM_MB
        if (availableMb < needed) {
            return Decision(
                allowed = false,
                availableMb = availableMb,
                totalMb = totalMb,
                systemLowMemory = false,
                estimatedRequiredMb = estimatedRequiredMb,
                javaHeapLimitMb = javaHeapLimitMb,
                javaHeapUsedMb = javaHeapUsedMb,
                reasonCode = "INSUFFICIENT_MEMORY",
                explanation =
                    "This model is estimated to need about ${estimatedRequiredMb} MB " +
                        "(file size x $MODEL_RESIDENT_FACTOR plus ${tensorMb} MB of " +
                        "tensors), plus ${REQUIRED_HEADROOM_MB} MB of headroom so the " +
                        "system stays responsive: ${needed} MB in total. Only " +
                        "${availableMb} MB is free. Refusing to start.",
            )
        }

        return Decision(
            allowed = true,
            availableMb = availableMb,
            totalMb = totalMb,
            systemLowMemory = false,
            estimatedRequiredMb = estimatedRequiredMb,
            javaHeapLimitMb = javaHeapLimitMb,
            javaHeapUsedMb = javaHeapUsedMb,
            reasonCode = "STARTED",
            explanation =
                "${availableMb} MB free; estimated need ${estimatedRequiredMb} MB " +
                    "plus ${REQUIRED_HEADROOM_MB} MB headroom. Proceeding. This is a " +
                    "heuristic, not a guarantee.",
        )
    }

    private const val BYTES_PER_MB = 1024L * 1024L
}
