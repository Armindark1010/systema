package com.systema.music.inference

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import com.getcapacitor.JSObject

/**
 * Reads process memory around a model's lifecycle.
 *
 * WHY totalPss AND NOT THE JAVA HEAP
 * ----------------------------------
 * ONNX Runtime allocates its session, weights and arena in NATIVE
 * memory, not on the Java heap. `Runtime.getRuntime().totalMemory()`
 * would therefore show almost nothing while a 300 MB model was
 * resident — the exact opposite of what this test needs to detect.
 *
 * So the primary figure is `totalPss` (proportional set size), which
 * counts native allocations. `nativeHeap` is reported alongside it
 * because it isolates the malloc arena specifically. The Java heap is
 * recorded too, but only to show that it is NOT where the model lives.
 *
 * HONESTY ABOUT WHAT THESE NUMBERS ARE
 * ------------------------------------
 * PSS is sampled by the OS and includes a share of pages that are
 * dirty, shared, or not yet reclaimed. It is noisy at the few-MB
 * level and it is NOT an allocator ledger. A small positive delta
 * after unload does not prove a leak, and a single clean cycle does
 * not prove the absence of one. That is precisely why the lifecycle
 * test runs repeated cycles and reports the trend rather than a
 * verdict from one sample.
 */
data class MemorySample(
    /** Total proportional set size in KB — the headline figure. */
    val totalPssKb: Int,
    /** Native (malloc) portion in KB, where ORT actually allocates. */
    val nativeHeapKb: Int,
    /** Dalvik/ART heap in KB. Recorded to show the model is NOT here. */
    val javaHeapKb: Int,
    /** Java heap in use, from the JVM's own view, in KB. */
    val javaUsedKb: Int,
    val timestamp: Long,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("totalPssKb", totalPssKb)
        put("nativeHeapKb", nativeHeapKb)
        put("javaHeapKb", javaHeapKb)
        put("javaUsedKb", javaUsedKb)
        put("timestamp", timestamp)
    }

    companion object {
        /**
         * Samples current process memory. Never throws — a benchmark
         * must not die because a memory counter was unavailable; the
         * fields degrade to -1, which the UI shows as UNKNOWN rather
         * than as zero.
         */
        fun capture(context: Context): MemorySample {
            var totalPss = -1
            var nativeHeap = -1
            var javaHeap = -1
            try {
                val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val infos = am?.getProcessMemoryInfo(intArrayOf(android.os.Process.myPid()))
                if (infos != null && infos.isNotEmpty()) {
                    val mi = infos[0]
                    totalPss = mi.totalPss
                    nativeHeap = mi.nativePss
                    javaHeap = mi.dalvikPss
                }
            } catch (_: Throwable) {
                // Leave -1; unknown is not zero.
            }

            val javaUsed = try {
                val rt = Runtime.getRuntime()
                ((rt.totalMemory() - rt.freeMemory()) / 1024L).toInt()
            } catch (_: Throwable) {
                -1
            }

            return MemorySample(
                totalPssKb = totalPss,
                nativeHeapKb = nativeHeap,
                javaHeapKb = javaHeap,
                javaUsedKb = javaUsed,
                timestamp = System.currentTimeMillis(),
            )
        }

        /**
         * Best-effort quiescing before a sample.
         *
         * Not a guarantee: System.gc() is advisory and native memory is
         * not garbage collected at all. It only reduces the chance that
         * a pending Java collection is misread as a native leak. The
         * caller must still treat one sample as noise.
         */
        fun settle(delayMs: Long = 120L) {
            try {
                System.gc()
                System.runFinalization()
                Thread.sleep(delayMs)
                System.gc()
                Thread.sleep(delayMs)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (_: Throwable) {
                // Ignore; sampling continues regardless.
            }
        }
    }
}

/** One load → infer → unload cycle. */
data class MemoryCycle(
    val iteration: Int,
    val afterLoadKb: Int,
    val afterInferenceKb: Int,
    val afterUnloadKb: Int,
    val loadMs: Double,
    val inferenceMs: Double,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("iteration", iteration)
        put("afterLoadKb", afterLoadKb)
        put("afterInferenceKb", afterInferenceKb)
        put("afterUnloadKb", afterUnloadKb)
        put("loadMs", loadMs)
        put("inferenceMs", inferenceMs)
    }
}

/**
 * The verdict of a lifecycle run — deliberately three-valued.
 *
 * There is no "NO_LEAK" state. The strongest claim this test can
 * honestly make is STABLE: across N cycles, post-unload memory did not
 * trend upward beyond noise. That is evidence, not proof.
 */
enum class MemoryTrend {
    /** Post-unload memory returned to near baseline every cycle. */
    STABLE,

    /** Post-unload memory rose monotonically. Investigate. */
    GROWING,

    /** Too few cycles, or counters unavailable. */
    INCONCLUSIVE,
}

data class MemoryLifecycleReport(
    val runtimeId: String,
    val modelId: String,
    val modelSizeBytes: Long,
    val iterations: Int,
    val baseline: MemorySample,
    val cycles: List<MemoryCycle>,
    val finalSample: MemorySample,
    /** peak(afterLoad or afterInference) − baseline, in KB. */
    val peakDeltaKb: Int,
    /** final − baseline, in KB. The number that matters for leaks. */
    val netDeltaKb: Int,
    val trend: MemoryTrend,
    val environment: EnvironmentSnapshot,
    /** Plain-language caveat shown next to the numbers. */
    val caveat: String,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("runtimeId", runtimeId)
        put("modelId", modelId)
        put("modelSizeBytes", modelSizeBytes)
        put("iterations", iterations)
        put("baseline", baseline.toJs())
        put("finalSample", finalSample.toJs())
        put("peakDeltaKb", peakDeltaKb)
        put("netDeltaKb", netDeltaKb)
        put("trend", trend.name)
        put("caveat", caveat)
        put("environment", environment.toJs())
        put(
            "cycles",
            com.getcapacitor.JSArray().apply { cycles.forEach { put(it.toJs()) } },
        )
    }
}
