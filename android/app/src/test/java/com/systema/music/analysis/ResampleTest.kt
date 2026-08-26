package com.systema.music.analysis

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Verification of the streaming resampler used by PcmDecoder.
 *
 * The decoder converts source PCM to the analysis rate one codec
 * buffer at a time, which means the resampler has to survive being
 * restarted at arbitrary boundaries without drifting or glitching.
 * That seam behaviour is the part most likely to be subtly wrong, and
 * it cannot be tested through MediaCodec on a desktop JVM — so the
 * exact arithmetic is mirrored here and exercised directly.
 *
 * [resampleChunked] below MUST stay in step with the resampling block
 * in PcmDecoder.runDecodeLoop. It is a transcription of that loop, and
 * it exists so the loop can be proven correct at all.
 */
object ResampleTest {

    private var passed = 0
    private var failed = 0

    private fun ok(name: String, condition: Boolean, detail: String = "") {
        if (condition) {
            passed++
            println("  \u001B[32m✓\u001B[0m $name")
        } else {
            failed++
            println("  \u001B[31m✗\u001B[0m $name ${if (detail.isEmpty()) "" else "— $detail"}")
        }
    }

    /** Mirror of the decoder's per-buffer resample + carry logic. */
    private fun resampleChunked(
        source: FloatArray,
        srcRate: Int,
        dstRate: Int,
        chunk: Int,
    ): FloatArray {
        val out = ArrayList<Float>((source.size.toLong() * dstRate / srcRate).toInt() + 8)
        val ratio = srcRate.toDouble() / dstRate
        var resamplePosition = 0.0
        var offset = 0

        while (offset < source.size) {
            val n = min(chunk, source.size - offset)
            val mono = FloatArray(n) { source[offset + it] }

            var readIndex = resamplePosition
            while (readIndex < n) {
                val i0 = readIndex.toInt()
                val frac = (readIndex - i0).toFloat()
                val a = mono[i0]
                val b = if (i0 + 1 < n) mono[i0 + 1] else mono[n - 1]
                out.add(a + (b - a) * frac)
                readIndex += ratio
            }

            resamplePosition = readIndex - n
            offset += n
        }
        return out.toFloatArray()
    }

    private fun sine(freq: Double, rate: Int, samples: Int) =
        FloatArray(samples) { sin(2.0 * PI * freq * it / rate).toFloat() }

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n\u001B[1mSYSTEMA — Phase 13 decoder resampling\u001B[0m\n")

        val srcRate = 44100
        val dstRate = 22050
        val src = sine(440.0, srcRate, srcRate * 3)
        // Long, so Int overflow cannot corrupt the expectation.
        val expected = (src.size.toLong() * dstRate / srcRate).toInt()

        println("Output length is independent of chunking")
        for (chunk in listOf(1024, 4096, 777, 100_000)) {
            val out = resampleChunked(src, srcRate, dstRate, chunk)
            ok(
                "chunk=$chunk yields ~$expected samples (got ${out.size})",
                abs(out.size - expected) <= 2,
            )
        }

        println("\nNo drift accumulates over a long file")
        val long = sine(100.0, srcRate, srcRate * 300) // 5 minutes
        val outLong = resampleChunked(long, srcRate, dstRate, 4096)
        val expLong = (long.size.toLong() * dstRate / srcRate).toInt()
        ok(
            "5 minutes stays within 2 samples of ideal (exp $expLong, got ${outLong.size})",
            abs(outLong.size - expLong) <= 2,
        )

        println("\nChunk boundaries do not alter the signal")
        val a = resampleChunked(src, srcRate, dstRate, 1024)
        val b = resampleChunked(src, srcRate, dstRate, 4096)
        val c = resampleChunked(src, srcRate, dstRate, 333)
        var maxDiff = 0f
        for (i in 0 until min(a.size, b.size)) maxDiff = max(maxDiff, abs(a[i] - b[i]))
        var maxDiff2 = 0f
        for (i in 0 until min(a.size, c.size)) maxDiff2 = max(maxDiff2, abs(a[i] - c[i]))
        ok("1024 vs 4096 produce identical samples (maxdiff=$maxDiff)", maxDiff < 1e-6f)
        ok("1024 vs 333 produce identical samples (maxdiff=$maxDiff2)", maxDiff2 < 1e-6f)

        println("\nSignal properties survive the conversion")
        val rmsIn = sqrt(src.map { it.toDouble() * it }.average())
        val rmsOut = sqrt(a.map { it.toDouble() * it }.average())
        ok(
            "RMS preserved (in=%.4f out=%.4f)".format(rmsIn, rmsOut),
            abs(rmsIn - rmsOut) < 0.02,
        )

        var crossings = 0
        for (i in 1 until a.size) if ((a[i - 1] < 0f) != (a[i] < 0f)) crossings++
        val detectedHz = crossings / 2.0 / (a.size.toDouble() / dstRate)
        ok(
            "440 Hz stays 440 Hz (measured %.1f Hz)".format(detectedHz),
            abs(detectedHz - 440.0) < 5.0,
        )

        println("\nUpsampling (sources below the analysis rate)")
        val low = sine(200.0, 8000, 8000 * 2)
        val up = resampleChunked(low, 8000, 22050, 1024)
        val expUp = (low.size.toLong() * 22050 / 8000).toInt()
        ok("8 kHz to 22.05 kHz length correct (exp $expUp, got ${up.size})",
            abs(up.size - expUp) <= 2)

        var upCrossings = 0
        for (i in 1 until up.size) if ((up[i - 1] < 0f) != (up[i] < 0f)) upCrossings++
        val upHz = upCrossings / 2.0 / (up.size.toDouble() / 22050)
        ok("200 Hz survives upsampling (measured %.1f Hz)".format(upHz), abs(upHz - 200.0) < 5.0)

        println("\nEdge cases")
        val same = resampleChunked(src, 22050, 22050, 1024)
        ok("equal rates pass through unchanged in length", same.size == src.size)
        var identical = true
        for (i in src.indices) if (abs(same[i] - src[i]) > 1e-6f) { identical = false; break }
        ok("equal rates pass through sample-for-sample", identical)

        val tiny = resampleChunked(FloatArray(4) { 0.5f }, 44100, 22050, 1024)
        ok("a tiny buffer does not crash", tiny.isNotEmpty())

        val colour = if (failed == 0) "\u001B[32m" else "\u001B[31m"
        println("\n$colour$passed passed, $failed failed\u001B[0m\n")
        if (failed > 0) throw AssertionError("$failed resampling assertion(s) failed")
    }
}
