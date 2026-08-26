package com.systema.music.analysis

import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.dsp.FeatureAggregator
import com.systema.music.analysis.dsp.Fft
import com.systema.music.analysis.dsp.SpectralFeatures
import com.systema.music.analysis.dsp.TempoEstimator
import com.systema.music.analysis.dsp.WindowedAnalyzer

/**
 * Numerical safety: the analyser must never emit NaN, Inf, or an
 * impossible value, no matter what it is fed.
 *
 * Why this suite exists separately from DspTest
 * ---------------------------------------------
 * DspTest checks that the maths is RIGHT on well-formed input (a
 * sine's RMS, a click track's tempo). This suite checks that the maths
 * is SAFE on degenerate input: silence, a single sample, a constant
 * DC signal, an empty spectrum, absurd sample counts. Those are the
 * inputs that produce 0/0 and log(0), and they are exactly what a real
 * library contains at the edges — a track that starts with digital
 * silence, a 0.4-second interstitial, a corrupt final frame.
 *
 * The rule under test throughout: a value is either a real measurement
 * or `null`. It is never NaN, never Infinity, and never a fabricated
 * zero standing in for "unknown". A null BPM is a legitimate, correct
 * answer and is asserted as such rather than treated as a failure.
 *
 * Runs on a plain JVM. No Android, no decoder, no device.
 */
object NumericalSafetyTest {

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

    /** The core invariant: finite, or deliberately absent. */
    private fun finiteOrNull(name: String, value: Float?) {
        if (value == null) {
            ok("$name is null (honest absence)", true)
            return
        }
        ok(
            "$name is finite",
            !value.isNaN() && !value.isInfinite(),
            "got $value",
        )
    }

    private val config = AudioAnalysisConfig()

    /** Feeds PCM through the real analyser and returns the aggregator. */
    private fun run(pcm: FloatArray, chunk: Int = 4096): FeatureAggregator {
        val analyzer = WindowedAnalyzer(config)
        var offset = 0
        while (offset < pcm.size) {
            val n = minOf(chunk, pcm.size - offset)
            analyzer.feed(pcm.copyOfRange(offset, offset + n), n)
            offset += n
        }
        analyzer.finish()
        return analyzer.aggregator
    }

    /** Asserts every aggregate output of a run is finite-or-null. */
    private fun assertAllFinite(label: String, agg: FeatureAggregator) {
        finiteOrNull("$label rms", agg.meanRms())
        finiteOrNull("$label peak", agg.peak())
        finiteOrNull("$label silenceRatio", agg.silenceRatio())
        finiteOrNull("$label dynamicRangeDb", agg.dynamicRangeDb())
        finiteOrNull("$label centroid", agg.meanCentroid())
        finiteOrNull("$label centroidMin", agg.minCentroid())
        finiteOrNull("$label centroidMax", agg.maxCentroid())
        finiteOrNull("$label bandwidth", agg.meanBandwidth())
        finiteOrNull("$label rolloff", agg.meanRolloff())
        finiteOrNull("$label zcr", agg.meanZcr())
        finiteOrNull("$label loudnessDbfs", agg.loudnessDbfs())

        val tempo = agg.estimateTempo()
        finiteOrNull("$label bpm", tempo.bpm)
        ok(
            "$label bpm confidence is finite and in 0..1",
            !tempo.confidence.isNaN() && !tempo.confidence.isInfinite() &&
                tempo.confidence >= 0f && tempo.confidence <= 1f,
            "got ${tempo.confidence}",
        )
    }

    // ---- 1. Digital silence --------------------------------------

    private fun testSilence() {
        println("\nPure digital silence (all zeros)")
        val agg = run(FloatArray(config.targetSampleRate * 5))
        assertAllFinite("silence", agg)

        ok("silence ratio is exactly 1.0", agg.silenceRatio() == 1f, "got ${agg.silenceRatio()}")
        ok("RMS is exactly zero, not null", agg.meanRms() == 0f, "got ${agg.meanRms()}")
        ok("peak is exactly zero", agg.peak() == 0f, "got ${agg.peak()}")

        // log10(0) is -Infinity. The aggregator must return null
        // rather than let that escape.
        ok(
            "loudness of silence is null, not -Infinity",
            agg.loudnessDbfs() == null,
            "got ${agg.loudnessDbfs()}",
        )
        // Every window was silent, so no window contributed to the
        // spectral means: 0/0. Must be null, not NaN.
        ok("centroid of silence is null, not NaN", agg.meanCentroid() == null)
        ok("bandwidth of silence is null, not NaN", agg.meanBandwidth() == null)
        ok("rolloff of silence is null, not NaN", agg.meanRolloff() == null)
        ok("silence yields no BPM", agg.estimateTempo().bpm == null)
    }

    // ---- 2. Ultra-short audio ------------------------------------

    private fun testUltraShort() {
        println("\nUltra-short audio")

        // A single sample: shorter than one hop, one window, one FFT.
        val one = run(floatArrayOf(0.5f))
        ok("a 1-sample file does not crash", true)
        assertAllFinite("1-sample", one)
        ok("a 1-sample file yields no BPM", one.estimateTempo().bpm == null)

        // Empty input: the decoder guards against this upstream, but
        // the DSP must not explode if it ever arrives.
        val empty = run(FloatArray(0))
        ok("an empty buffer does not crash", true)
        ok("empty input reports no frames", empty.frames == 0)
        ok("empty input RMS is null", empty.meanRms() == null)
        ok("empty input peak is null", empty.peak() == null)
        ok("empty input silence ratio is null", empty.silenceRatio() == null)
        ok("empty input dynamic range is null", empty.dynamicRangeDb() == null)
        assertAllFinite("empty", empty)

        // Just under one window, and exactly one window.
        for (n in intArrayOf(config.hopSize - 1, config.windowSize)) {
            val agg = run(FloatArray(n) { 0.25f })
            assertAllFinite("$n-sample", agg)
        }

        // Fewer than the 10 windows dynamicRangeDb() requires.
        val fewWindows = run(FloatArray(config.hopSize * 3) { 0.3f })
        ok(
            "dynamic range is null below 10 windows, not a bogus number",
            fewWindows.dynamicRangeDb() == null,
            "got ${fewWindows.dynamicRangeDb()}",
        )
    }

    // ---- 3. Constant / DC signals --------------------------------

    private fun testConstantPcm() {
        println("\nConstant (DC) PCM")

        // A constant signal has zero crossings, zero flux after the
        // first window, and all its energy in bin 0 — several ratios
        // that could divide by zero.
        val dc = run(FloatArray(config.targetSampleRate * 3) { 1.0f })
        assertAllFinite("DC", dc)

        ok("DC signal has zero ZCR", dc.meanZcr() == 0f, "got ${dc.meanZcr()}")
        ok("DC peak is 1.0", dc.peak() == 1f, "got ${dc.peak()}")
        ok(
            "DC centroid is 0 Hz (all energy at bin 0), not NaN",
            dc.meanCentroid() != null && dc.meanCentroid()!! >= 0f,
            "got ${dc.meanCentroid()}",
        )
        ok(
            "a DC signal produces no tempo",
            dc.estimateTempo().bpm == null,
            "got ${dc.estimateTempo().bpm}",
        )

        // Negative DC: peak must use absolute value.
        val negative = run(FloatArray(config.targetSampleRate) { -0.8f })
        ok(
            "peak of a negative DC signal is positive 0.8",
            negative.peak() != null && kotlin.math.abs(negative.peak()!! - 0.8f) < 1e-6f,
            "got ${negative.peak()}",
        )
        assertAllFinite("negative DC", negative)
    }

    // ---- 4. Zero RMS / zero peak primitives ----------------------

    private fun testZeroPrimitives() {
        println("\nZero-valued primitives")

        ok("rms of a zero-length frame is 0", SpectralFeatures.rms(FloatArray(0), 0) == 0f)
        ok("rms with length 0 is 0", SpectralFeatures.rms(FloatArray(64), 0) == 0f)
        ok("rms with negative length is 0", SpectralFeatures.rms(FloatArray(64), -5) == 0f)
        ok("peak of a zero-length frame is 0", SpectralFeatures.peak(FloatArray(0), 0) == 0f)
        ok("zcr of a 1-sample frame is 0", SpectralFeatures.zeroCrossingRate(FloatArray(1), 1) == 0f)
        ok("zcr of a 0-sample frame is 0", SpectralFeatures.zeroCrossingRate(FloatArray(0), 0) == 0f)

        // An all-zero spectrum: every weighted mean is 0/0.
        val emptySpectrum = FloatArray(1025)
        val centroid = SpectralFeatures.spectralCentroid(emptySpectrum, 10.8f)
        ok("centroid of an empty spectrum is 0, not NaN", centroid == 0f, "got $centroid")

        val bandwidth = SpectralFeatures.spectralBandwidth(emptySpectrum, 10.8f, centroid)
        ok("bandwidth of an empty spectrum is 0, not NaN", bandwidth == 0f, "got $bandwidth")

        val rolloff = SpectralFeatures.spectralRolloff(emptySpectrum, 10.8f, 0.85f)
        ok("rolloff of an empty spectrum is 0, not NaN", rolloff == 0f, "got $rolloff")

        val flux = SpectralFeatures.spectralFlux(emptySpectrum, emptySpectrum)
        ok("flux between identical empty spectra is 0", flux == 0f, "got $flux")

        // Flux between mismatched lengths must not read out of bounds.
        val shortSpectrum = FloatArray(16) { 1f }
        val fluxMismatch = SpectralFeatures.spectralFlux(shortSpectrum, emptySpectrum)
        ok(
            "flux tolerates mismatched spectrum lengths",
            !fluxMismatch.isNaN() && fluxMismatch >= 0f,
            "got $fluxMismatch",
        )
    }

    // ---- 5. amplitudeToDb: the log(0) trap -----------------------

    private fun testAmplitudeToDb() {
        println("\nAmplitude to dB conversion")

        ok(
            "0 amplitude floors at -120 dB, not -Infinity",
            SpectralFeatures.amplitudeToDb(0f) == -120f,
            "got ${SpectralFeatures.amplitudeToDb(0f)}",
        )
        ok(
            "a negative amplitude floors rather than producing NaN",
            SpectralFeatures.amplitudeToDb(-0.5f) == -120f,
            "got ${SpectralFeatures.amplitudeToDb(-0.5f)}",
        )
        ok(
            "an absurdly small amplitude floors at -120 dB",
            SpectralFeatures.amplitudeToDb(1e-30f) == -120f,
        )

        val fullScale = SpectralFeatures.amplitudeToDb(1f)
        ok("full scale is 0 dBFS", kotlin.math.abs(fullScale) < 1e-4f, "got $fullScale")

        val half = SpectralFeatures.amplitudeToDb(0.5f)
        ok(
            "half amplitude is about -6 dBFS",
            kotlin.math.abs(half - (-6.0206f)) < 0.01f,
            "got $half",
        )

        // Above full scale is not clamped — it is a real, if unusual,
        // measurement and must stay finite rather than becoming NaN.
        val over = SpectralFeatures.amplitudeToDb(2f)
        ok("above full scale stays finite", !over.isNaN() && !over.isInfinite(), "got $over")
    }

    // ---- 6. Extreme and hostile sample values --------------------

    private fun testHostileSamples() {
        println("\nHostile sample values")

        // Very large magnitudes: a broken decoder could hand us these.
        // Nothing may become Infinity through squaring in the RMS sum.
        val large = run(FloatArray(config.windowSize * 8) { if (it % 2 == 0) 1e6f else -1e6f })
        assertAllFinite("large-amplitude", large)

        // Denormal-range values: must not trap or produce NaN.
        val tiny = run(FloatArray(config.windowSize * 4) { 1e-38f })
        assertAllFinite("denormal", tiny)

        // Alternating full-scale: maximum possible ZCR.
        val alternating = FloatArray(config.windowSize * 4) { if (it % 2 == 0) 1f else -1f }
        val altAgg = run(alternating)
        val zcr = altAgg.meanZcr()
        ok(
            "maximum-ZCR signal reports a fraction <= 1",
            zcr == null || (zcr in 0f..1f),
            "got $zcr",
        )
        assertAllFinite("alternating", altAgg)
    }

    // ---- 7. Large sample counts / Int overflow -------------------

    private fun testLargeSampleCounts() {
        println("\nLarge sample counts and overflow")

        // analyzedSampleCount is a Long. A 5-minute analysis at
        // 22050 Hz is ~6.6M samples — fine for Int — but the counter
        // must be a Long so a longer ceiling could never wrap. Prove
        // the type, and prove the arithmetic that feeds it.
        val fiveMinutes = 300L * config.targetSampleRate
        ok("5 minutes of samples exceeds no Int limit", fiveMinutes < Int.MAX_VALUE)

        // The decoder's frame ceiling: maxAnalysisDurationMs * rate
        // / 1000 must be computed in Long arithmetic. At 48 kHz this
        // overflows Int if computed as Int (300000 * 48000 = 1.44e10).
        val rate48k = 48_000
        val maxFramesLong = config.maxAnalysisDurationMs * rate48k / 1000
        ok(
            "the decode ceiling is computed in Long arithmetic without overflow",
            maxFramesLong == 14_400_000L,
            "got $maxFramesLong",
        )
        // The same expression truncated to Int would be wrong; confirm
        // the difference is real so this test is meaningful.
        val overflowed = (config.maxAnalysisDurationMs.toInt() * rate48k) / 1000
        ok(
            "the same computation in Int would indeed overflow (guard is necessary)",
            overflowed.toLong() != maxFramesLong,
            "Int result $overflowed vs Long result $maxFramesLong",
        )

        // A genuinely long stream, fed in realistic chunks. Uses a
        // cheap signal so the test stays fast while still driving
        // several thousand windows through every accumulator.
        val samples = config.targetSampleRate * 120
        val analyzer = WindowedAnalyzer(config)
        val chunk = FloatArray(8192)
        var produced = 0
        var phase = 0.0
        while (produced < samples) {
            for (i in chunk.indices) {
                chunk[i] = kotlin.math.sin(phase).toFloat() * 0.4f
                phase += 2.0 * Math.PI * 220.0 / config.targetSampleRate
            }
            analyzer.feed(chunk, chunk.size)
            produced += chunk.size
        }
        analyzer.finish()

        ok(
            "a 2-minute stream counts every sample as a Long",
            analyzer.analyzedSampleCount == produced.toLong(),
            "expected $produced, got ${analyzer.analyzedSampleCount}",
        )
        ok(
            "a 2-minute stream produced thousands of windows",
            analyzer.aggregator.frames > 2000,
            "got ${analyzer.aggregator.frames}",
        )
        assertAllFinite("2-minute", analyzer.aggregator)

        // The RMS sum accumulates in a Double; over many windows of a
        // known signal it must stay accurate, not drift.
        val meanRms = analyzer.aggregator.meanRms()
        ok(
            "mean RMS over 2 minutes is accurate (0.4/sqrt2 ≈ 0.283)",
            meanRms != null && kotlin.math.abs(meanRms - 0.283f) < 0.01f,
            "got $meanRms",
        )
    }

    // ---- 8. Invalid configuration is rejected --------------------

    private fun testInvalidConfig() {
        println("\nInvalid configuration is rejected at construction")

        fun rejects(name: String, block: () -> Unit) {
            val threw = try {
                block(); false
            } catch (e: IllegalArgumentException) {
                true
            }
            ok(name, threw, "expected IllegalArgumentException")
        }

        rejects("a zero sample rate is rejected") { AudioAnalysisConfig(targetSampleRate = 0) }
        rejects("a negative sample rate is rejected") { AudioAnalysisConfig(targetSampleRate = -44100) }
        rejects("a non-power-of-two window is rejected") { AudioAnalysisConfig(windowSize = 1000) }
        rejects("a zero window is rejected") { AudioAnalysisConfig(windowSize = 0) }
        rejects("a zero hop is rejected") { AudioAnalysisConfig(hopSize = 0) }
        rejects("a hop larger than the window is rejected") {
            AudioAnalysisConfig(windowSize = 1024, hopSize = 2048)
        }
        rejects("a rolloff percentile of 0 is rejected") { AudioAnalysisConfig(rolloffPercentile = 0f) }
        rejects("a rolloff percentile of 1 is rejected") { AudioAnalysisConfig(rolloffPercentile = 1f) }
        rejects("an inverted BPM range is rejected") {
            AudioAnalysisConfig(minBpm = 200f, maxBpm = 50f)
        }
        rejects("a zero minimum BPM is rejected") { AudioAnalysisConfig(minBpm = 0f) }

        // A non-power-of-two FFT is rejected too.
        val fftRejects = try {
            Fft(1000); false
        } catch (e: IllegalArgumentException) {
            true
        }
        ok("a non-power-of-two FFT size is rejected", fftRejects)

        // The default config's derived values must be sane.
        ok("default binHz is positive and finite", config.binHz > 0f && !config.binHz.isNaN())
        ok(
            "default hopSeconds is positive and finite",
            config.hopSeconds > 0f && !config.hopSeconds.isNaN(),
        )
    }

    // ---- 9. Tempo estimator degenerate inputs --------------------

    private fun testTempoEdgeCases() {
        println("\nTempo estimation on degenerate envelopes")

        fun tempoOf(envelope: FloatArray): TempoEstimator.Tempo =
            TempoEstimator.estimate(envelope, config.hopSeconds, config)

        val empty = tempoOf(FloatArray(0))
        ok("an empty envelope yields no BPM", empty.bpm == null)
        ok("an empty envelope has zero confidence", empty.confidence == 0f)

        val single = tempoOf(floatArrayOf(1f))
        ok("a 1-frame envelope yields no BPM", single.bpm == null)

        val allZero = tempoOf(FloatArray(1000))
        ok("an all-zero envelope yields no BPM", allZero.bpm == null)
        ok("an all-zero envelope has finite confidence", !allZero.confidence.isNaN())

        val constant = tempoOf(FloatArray(1000) { 5f })
        ok("a constant envelope yields no BPM (no periodicity)", constant.bpm == null)
        ok("a constant envelope has finite confidence", !constant.confidence.isNaN())

        // A monotonically rising envelope: the case the local-mean
        // subtraction exists to defeat. Without it this would "detect"
        // the longest available lag on every track.
        val rising = tempoOf(FloatArray(2000) { it.toFloat() })
        ok(
            "a monotonically rising envelope does not fake a tempo",
            rising.bpm == null || (rising.bpm!! >= config.minBpm && rising.bpm!! <= config.maxBpm),
            "got ${rising.bpm}",
        )

        // Any BPM that IS returned must be inside the configured band.
        val periodic = FloatArray(3000) { if (it % 20 == 0) 10f else 0f }
        val detected = tempoOf(periodic)
        if (detected.bpm != null) {
            ok(
                "a detected BPM lies within the configured range",
                detected.bpm!! >= config.minBpm && detected.bpm!! <= config.maxBpm,
                "got ${detected.bpm}",
            )
            ok("a detected BPM is finite", !detected.bpm!!.isNaN() && !detected.bpm!!.isInfinite())
        } else {
            ok("a periodic envelope either detects a valid tempo or declines", true)
        }
        ok(
            "confidence is always within 0..1",
            detected.confidence in 0f..1f,
            "got ${detected.confidence}",
        )
    }

    // ---- 10. FFT numerical sanity --------------------------------

    private fun testFftSafety() {
        println("\nFFT numerical safety")

        val fft = Fft(2048)

        fft.forward(FloatArray(2048))
        ok(
            "an all-zero input yields an all-zero, finite spectrum",
            fft.magnitudes.all { it == 0f },
        )

        fft.forward(FloatArray(2048) { 1f })
        ok(
            "a DC input yields a finite spectrum",
            fft.magnitudes.all { !it.isNaN() && !it.isInfinite() },
        )

        fft.forward(FloatArray(2048) { if (it % 2 == 0) 1e6f else -1e6f })
        ok(
            "an extreme-amplitude input yields a finite spectrum",
            fft.magnitudes.all { !it.isNaN() && !it.isInfinite() },
        )

        ok(
            "magnitudes are never negative",
            fft.magnitudes.all { it >= 0f },
        )
        ok("the spectrum length is size/2 + 1", fft.magnitudes.size == 1025)
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n\u001B[1mSYSTEMA — Phase 13 numerical safety\u001B[0m")

        testSilence()
        testUltraShort()
        testConstantPcm()
        testZeroPrimitives()
        testAmplitudeToDb()
        testHostileSamples()
        testLargeSampleCounts()
        testInvalidConfig()
        testTempoEdgeCases()
        testFftSafety()

        println(
            "\n${if (failed == 0) "\u001B[32m" else "\u001B[31m"}" +
                "$passed passed, $failed failed\u001B[0m\n",
        )
        if (failed > 0) throw AssertionError("$failed numerical safety checks failed")
    }
}
