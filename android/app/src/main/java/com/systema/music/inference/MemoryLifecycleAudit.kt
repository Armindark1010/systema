package com.systema.music.inference

import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject

/**
 * Named checkpoints in one evaluation run's memory history.
 *
 * The previous run reported 109.4 MB before and 1240.4 MB at peak.
 * Two samples cannot say whether that is the model, the decoder, the
 * ONNX arena, or the run accumulating something it should have
 * released - they only say "it went up". These checkpoints exist to
 * make the SHAPE of the curve visible, because that is what separates
 * those explanations.
 */
enum class MemoryCheckpoint {
    /** Before the session exists. The baseline everything is measured against. */
    BEFORE_MODEL_LOAD,

    /** Immediately after session creation. Isolates the model's own cost. */
    AFTER_MODEL_LOAD,

    /** After the first track. Shows the cost of one decode+infer cycle. */
    AFTER_TRACK_1,

    AFTER_TRACK_5,
    AFTER_TRACK_10,

    /** After the final track, before teardown. */
    AFTER_ALL_TRACKS,

    /** After unloadModel(). What the session gave back. */
    AFTER_SESSION_CLEANUP,

    /** After a short idle. Catches deferred reclaim that cleanup missed. */
    AFTER_IDLE,
}

/**
 * One sample, tagged with where in the run it was taken.
 *
 * Deltas are against the BEFORE_MODEL_LOAD baseline, so every row is
 * directly comparable and the reader never has to subtract.
 */
data class MemoryCheckpointSample(
    val checkpoint: MemoryCheckpoint,
    val sample: MemorySample,
    /** totalPss − baseline totalPss, in KB. Signed. */
    val deltaTotalKb: Int,
    /** nativePss − baseline nativePss, in KB, or null when unavailable. */
    val deltaNativeKb: Int?,
    /** dalvikPss − baseline dalvikPss, in KB, or null when unavailable. */
    val deltaJavaKb: Int?,
    /** Highest totalPss seen up to and including this checkpoint. */
    val runningPeakKb: Int,
    val elapsedMs: Double,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("checkpoint", checkpoint.name)
        put("sample", sample.toJs())
        put("deltaTotalKb", deltaTotalKb)
        deltaNativeKb?.let { put("deltaNativeKb", it) }
        deltaJavaKb?.let { put("deltaJavaKb", it) }
        put("runningPeakKb", runningPeakKb)
        putNumeric("elapsedMs", elapsedMs)
    }
}

/**
 * Where retained memory appears to live once the run is over.
 *
 * There is no LEAK value on purpose. PSS cannot distinguish a leak
 * from an allocator that has not returned pages to the OS, and
 * declaring one from the other would be a guess dressed as a finding.
 */
enum class MemoryAttribution {
    /** Growth is in the Java/ART heap. */
    JAVA_HEAP,

    /** Growth is in native memory - where ONNX Runtime allocates. */
    NATIVE_HEAP,

    /**
     * Native growth that survived unload. Consistent with the ORT
     * arena/allocator keeping pages, but NOT proof of that.
     */
    NATIVE_RETAINED_AFTER_CLEANUP,

    /** Returned to near baseline. Nothing meaningful retained. */
    RELEASED,

    /** Counters unavailable, or the split does not add up. */
    UNKNOWN,
}

/**
 * The audit's findings. Descriptive; it does not pronounce a leak.
 */
data class MemoryLifecycleAuditReport(
    val checkpoints: List<MemoryCheckpointSample>,
    val baselineKb: Int,
    val peakKb: Int,
    val finalKb: Int,
    val peakDeltaKb: Int,
    val netDeltaKb: Int,
    /** Share of the PEAK growth that was native, or null if unknown. */
    val peakNativeShare: Double?,
    /** Share of the RETAINED growth that is native, or null if unknown. */
    val retainedNativeShare: Double?,
    val attribution: MemoryAttribution,
    val rationale: String,
    val caveat: String,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("baselineKb", baselineKb)
        put("peakKb", peakKb)
        put("finalKb", finalKb)
        put("peakDeltaKb", peakDeltaKb)
        put("netDeltaKb", netDeltaKb)
        peakNativeShare?.let { putNumeric("peakNativeShare", it) }
        retainedNativeShare?.let { putNumeric("retainedNativeShare", it) }
        put("attribution", attribution.name)
        put("rationale", rationale)
        put("caveat", caveat)
        put("checkpoints", JSArray().apply { checkpoints.forEach { put(it.toJs()) } })
    }
}

/**
 * Collects checkpoint samples across a run and attributes the result.
 *
 * Stateful and single-run: build one, call [record] as the run
 * progresses, then [finish]. It holds only small scalars, so the
 * auditor itself cannot meaningfully affect what it measures.
 */
class MemoryLifecycleAudit(private val context: Context) {

    companion object {
        /**
         * Growth below this is treated as noise rather than retention.
         *
         * PSS moves by a few MB from GC timing, JIT and shared-page
         * accounting alone. 8 MB is comfortably above that and far
         * below the ~1.1 GB swing being investigated, so the verdict
         * does not hinge on where exactly this sits.
         */
        const val NOISE_FLOOR_KB = 8 * 1024

        /**
         * Share of growth that must be native before the growth is
         * attributed to native memory.
         */
        const val NATIVE_DOMINANCE = 0.60

        /** Idle wait before the final sample. */
        const val IDLE_SETTLE_MS = 1200L
    }

    private val samples = ArrayList<MemoryCheckpointSample>()
    private var baseline: MemorySample? = null
    private var peakKb = Int.MIN_VALUE
    private val startNs = System.nanoTime()

    /**
     * Takes a sample at [checkpoint].
     *
     * [settle] runs a best-effort GC first. It is deliberately NOT
     * used before every checkpoint: forcing a collection mid-run
     * changes the very allocation behaviour being measured. It is used
     * for the baseline and the post-cleanup samples, where the
     * question is what is retained rather than what is in flight.
     */
    fun record(checkpoint: MemoryCheckpoint, settle: Boolean = false): MemoryCheckpointSample {
        if (settle) MemorySample.settle()
        val s = MemorySample.capture(context)

        if (baseline == null) baseline = s
        val base = baseline!!

        if (s.totalPssKb > peakKb) peakKb = s.totalPssKb

        val row = MemoryCheckpointSample(
            checkpoint = checkpoint,
            sample = s,
            deltaTotalKb = delta(s.totalPssKb, base.totalPssKb) ?: 0,
            deltaNativeKb = delta(s.nativeHeapKb, base.nativeHeapKb),
            deltaJavaKb = delta(s.javaHeapKb, base.javaHeapKb),
            runningPeakKb = peakKb,
            elapsedMs = (System.nanoTime() - startNs) / 1_000_000.0,
        )
        samples.add(row)
        return row
    }

    /** Unknown (−1) counters propagate as null rather than as a delta of −1. */
    private fun delta(now: Int, base: Int): Int? =
        if (now < 0 || base < 0) null else now - base

    /** True once the baseline exists, so callers can skip optional work. */
    fun hasBaseline(): Boolean = baseline != null

    /**
     * Which track-count checkpoint, if any, falls at [position].
     *
     * Returns null for positions that are not checkpoints, so the
     * caller records nothing rather than a duplicate row.
     */
    fun checkpointForPosition(position: Int, total: Int): MemoryCheckpoint? = when {
        position == 1 -> MemoryCheckpoint.AFTER_TRACK_1
        position == 5 -> MemoryCheckpoint.AFTER_TRACK_5
        position == 10 -> MemoryCheckpoint.AFTER_TRACK_10
        position == total -> MemoryCheckpoint.AFTER_ALL_TRACKS
        else -> null
    }

    /**
     * Attributes the retained growth and returns the report.
     *
     * The logic is intentionally conservative. Anything that does not
     * clearly resolve to Java or native becomes UNKNOWN; there is no
     * branch that guesses.
     */
    fun finish(): MemoryLifecycleAuditReport {
        val base = baseline
        val last = samples.lastOrNull()

        if (base == null || last == null) {
            return MemoryLifecycleAuditReport(
                checkpoints = samples.toList(),
                baselineKb = -1,
                peakKb = -1,
                finalKb = -1,
                peakDeltaKb = 0,
                netDeltaKb = 0,
                peakNativeShare = null,
                retainedNativeShare = null,
                attribution = MemoryAttribution.UNKNOWN,
                rationale = "No memory samples were captured.",
                caveat = CAVEAT,
            )
        }

        val netDelta = last.sample.totalPssKb - base.totalPssKb
        val peakDelta = peakKb - base.totalPssKb

        val peakRow = samples.maxByOrNull { it.sample.totalPssKb }
        val peakNativeShare = peakRow?.deltaNativeKb
            ?.takeIf { peakDelta > 0 }
            ?.let { it.toDouble() / peakDelta }

        val retainedNativeShare = last.deltaNativeKb
            ?.takeIf { netDelta > 0 }
            ?.let { it.toDouble() / netDelta }

        val cleanupRow = samples.lastOrNull {
            it.checkpoint == MemoryCheckpoint.AFTER_SESSION_CLEANUP ||
                it.checkpoint == MemoryCheckpoint.AFTER_IDLE
        }

        val attribution: MemoryAttribution
        val rationale: String

        when {
            netDelta <= NOISE_FLOOR_KB -> {
                attribution = MemoryAttribution.RELEASED
                rationale = "Final PSS is ${mb(netDelta)} MB above baseline, within the " +
                    "${mb(NOISE_FLOOR_KB)} MB noise floor. Peak reached " +
                    "${mb(peakDelta)} MB above baseline and came back down."
            }

            last.deltaNativeKb == null || last.deltaJavaKb == null -> {
                attribution = MemoryAttribution.UNKNOWN
                rationale = "Process retains ${mb(netDelta)} MB above baseline, but the " +
                    "native/Java split was unavailable on this device, so it cannot " +
                    "be attributed."
            }

            retainedNativeShare != null && retainedNativeShare >= NATIVE_DOMINANCE -> {
                attribution = if (cleanupRow != null) {
                    MemoryAttribution.NATIVE_RETAINED_AFTER_CLEANUP
                } else {
                    MemoryAttribution.NATIVE_HEAP
                }
                rationale = buildString {
                    append("Of ${mb(netDelta)} MB retained, ")
                    append("${pct(retainedNativeShare)} is native and ")
                    append("${mb(last.deltaJavaKb)} MB is Java heap. ")
                    if (cleanupRow != null) {
                        append("This persisted after unloadModel(), which is consistent ")
                        append("with the ONNX Runtime allocator holding pages rather than ")
                        append("returning them to the OS - but PSS cannot prove that, ")
                        append("and it is NOT evidence of a leak.")
                    } else {
                        append("No post-cleanup sample was taken, so it is unknown ")
                        append("whether unloading would release it.")
                    }
                }
            }

            last.deltaJavaKb > netDelta / 2 -> {
                attribution = MemoryAttribution.JAVA_HEAP
                rationale = "Of ${mb(netDelta)} MB retained, ${mb(last.deltaJavaKb)} MB is " +
                    "Java heap - more than half. Java-side objects are being held; " +
                    "this is the one case the GC could still reclaim."
            }

            else -> {
                attribution = MemoryAttribution.UNKNOWN
                rationale = "Process retains ${mb(netDelta)} MB above baseline. Native " +
                    "delta ${mb(last.deltaNativeKb)} MB and Java delta " +
                    "${mb(last.deltaJavaKb)} MB do not account for it, so the " +
                    "remainder sits in mappings PSS does not attribute " +
                    "(code, graphics, stacks, or shared pages)."
            }
        }

        return MemoryLifecycleAuditReport(
            checkpoints = samples.toList(),
            baselineKb = base.totalPssKb,
            peakKb = peakKb,
            finalKb = last.sample.totalPssKb,
            peakDeltaKb = peakDelta,
            netDeltaKb = netDelta,
            peakNativeShare = peakNativeShare,
            retainedNativeShare = retainedNativeShare,
            attribution = attribution,
            rationale = rationale,
            caveat = CAVEAT,
        )
    }
}

private const val CAVEAT =
    "PSS is an OS estimate that includes a share of shared pages and is noisy " +
        "at the few-MB level. Elevated memory after a run is NOT by itself a " +
        "leak: native allocators routinely keep freed pages mapped for reuse. " +
        "These figures describe one run on one device."

private fun mb(kb: Int): String = String.format("%.1f", kb / 1024.0)

private fun pct(v: Double): String = String.format("%.0f%%", v * 100)
