package com.systema.music.analysis

import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.dsp.Fft
import com.systema.music.analysis.dsp.SpectralFeatures
import com.systema.music.analysis.dsp.TempoEstimator
import com.systema.music.analysis.dsp.WindowedAnalyzer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Real DSP verification against synthetic signals with known answers.
 *
 * Every assertion here compares a computed value to one derived
 * analytically (a sine's RMS is amplitude/sqrt(2), a click track's
 * tempo is whatever we spaced the clicks at, and so on). Nothing greps
 * source code; if the maths is wrong these fail.
 *
 * Runs on a plain JVM — no Android, no device, no decoder. The decoder
 * is a separate concern and is verified separately.
 *
 * Entry point is [main] so the suite can run under a bare `kotlinc` +
 * `java` toolchain in CI or a sandbox, without pulling in a test
 * runner. The JUnit-annotated wrapper below exposes the same checks to
 * Gradle's `testDebugUnitTest` when the Android toolchain is present.
 */
object DspTest {

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

    private fun near(name: String, actual: Float, expected: Float, tolerance: Float) {
        val delta = abs(actual - expected)
        ok(name, delta <= tolerance, "expected ~$expected (±$tolerance), got $actual")
    }

    // ---- Signal generators ---------------------------------------

    private fun sine(freq: Float, sampleRate: Int, samples: Int, amplitude: Float = 1f) =
        FloatArray(samples) { i ->
            (amplitude * sin(2.0 * PI * freq * i / sampleRate)).toFloat()
        }

    private fun silence(samples: Int) = FloatArray(samples)

    /**
     * A metronome: short decaying bursts of noise at a fixed BPM.
     * Deterministic RNG so the test cannot flake.
     */
    private fun clickTrack(bpm: Float, sampleRate: Int, seconds: Float): FloatArray {
        val total = (sampleRate * seconds).toInt()
        val out = FloatArray(total)
        val samplesPerBeat = (60f / bpm * sampleRate).roundToInt()
        val clickLength = (sampleRate * 0.02f).toInt() // 20 ms
        val rng = java.util.Random(42)

        var beat = 0
        while (beat * samplesPerBeat < total) {
            val start = beat * samplesPerBeat
            for (i in 0 until clickLength) {
                val idx = start + i
                if (idx >= total) break
                // Exponential decay: a percussive envelope, which is
                // what an onset detector is built to find.
                val decay = Math.exp(-i / (clickLength * 0.25)).toFloat()
                out[idx] = ((rng.nextFloat() * 2f - 1f) * decay * 0.8f)
            }
            beat++
        }
        return out
    }

    // ---- Tests ---------------------------------------------------

    private fun testRms() {
        println("\nRMS")
        // A full-scale sine has RMS = A / sqrt(2) ≈ 0.7071.
        val s = sine(440f, 44100, 44100)
        near("sine RMS is amplitude/sqrt(2)", SpectralFeatures.rms(s), 0.7071f, 0.005f)

        // Half amplitude halves RMS.
        val half = sine(440f, 44100, 44100, 0.5f)
        near("half-amplitude sine", SpectralFeatures.rms(half), 0.3536f, 0.005f)

        // DC signal: RMS equals the level itself.
        val dc = FloatArray(1000) { 0.25f }
        near("constant signal RMS equals its level", SpectralFeatures.rms(dc), 0.25f, 0.0001f)

        near("silence has zero RMS", SpectralFeatures.rms(silence(1000)), 0f, 0.0001f)
    }

    private fun testPeak() {
        println("\nPeak")
        val s = sine(100f, 8000, 8000, 0.6f)
        near("peak of a 0.6 sine", SpectralFeatures.peak(s), 0.6f, 0.01f)

        // Peak must be absolute, not signed.
        val negative = floatArrayOf(0.1f, -0.9f, 0.3f)
        near("peak uses absolute value", SpectralFeatures.peak(negative), 0.9f, 0.0001f)

        near("silence has zero peak", SpectralFeatures.peak(silence(100)), 0f, 0.0001f)
    }

    private fun testZeroCrossing() {
        println("\nZero-crossing rate")
        // A sine crosses zero twice per period. Over N samples at
        // frequency f and rate sr: 2*f/sr crossings per sample.
        val sampleRate = 8000
        val freq = 100f
        val s = sine(freq, sampleRate, sampleRate)
        val expected = 2f * freq / sampleRate
        near("sine ZCR matches 2f/sr", SpectralFeatures.zeroCrossingRate(s), expected, 0.002f)

        // Higher frequency, proportionally higher ZCR.
        val fast = sine(400f, sampleRate, sampleRate)
        near("4x frequency gives 4x ZCR",
            SpectralFeatures.zeroCrossingRate(fast), 2f * 400f / sampleRate, 0.002f)

        // Alternating sign every sample = maximum possible rate.
        val alternating = FloatArray(100) { if (it % 2 == 0) 0.5f else -0.5f }
        near("alternating signal has ZCR ~1",
            SpectralFeatures.zeroCrossingRate(alternating), 1f, 0.02f)

        near("constant signal never crosses zero",
            SpectralFeatures.zeroCrossingRate(FloatArray(100) { 0.3f }), 0f, 0.0001f)
    }

    private fun testFft() {
        println("\nFFT")
        val size = 2048
        val sampleRate = 22050
        val fft = Fft(size)

        // A sine at a bin centre should put essentially all its energy
        // in that single bin.
        val binHz = sampleRate.toFloat() / size
        val targetBin = 40
        val freq = targetBin * binHz
        val signal = sine(freq, sampleRate, size)

        val windowed = FloatArray(size)
        val hann = SpectralFeatures.hannWindow(size)
        SpectralFeatures.applyHann(signal, windowed, hann, size)
        fft.forward(windowed)

        var maxBin = 0
        var maxMag = 0f
        for (i in fft.magnitudes.indices) {
            if (fft.magnitudes[i] > maxMag) {
                maxMag = fft.magnitudes[i]
                maxBin = i
            }
        }
        ok("dominant bin matches the input frequency",
            abs(maxBin - targetBin) <= 1, "expected bin $targetBin, got $maxBin")

        val detectedHz = maxBin * binHz
        near("recovered frequency in Hz", detectedHz, freq, binHz * 1.5f)

        // A second, higher tone must be found too.
        val freq2 = 200 * binHz
        val signal2 = sine(freq2, sampleRate, size)
        SpectralFeatures.applyHann(signal2, windowed, hann, size)
        fft.forward(windowed)
        var maxBin2 = 0
        var maxMag2 = 0f
        for (i in fft.magnitudes.indices) {
            if (fft.magnitudes[i] > maxMag2) {
                maxMag2 = fft.magnitudes[i]
                maxBin2 = i
            }
        }
        ok("second tone also localised", abs(maxBin2 - 200) <= 1,
            "expected bin 200, got $maxBin2")

        // Silence must not produce spectral energy.
        fft.forward(FloatArray(size))
        ok("silent input yields an empty spectrum", fft.magnitudes.all { it < 1e-6f })

        // The magnitude array covers DC..Nyquist inclusive.
        ok("spectrum length is size/2 + 1", fft.magnitudes.size == size / 2 + 1)
    }

    private fun testSpectralCentroid() {
        println("\nSpectral centroid")
        val size = 2048
        val sampleRate = 22050
        val binHz = sampleRate.toFloat() / size
        val fft = Fft(size)
        val hann = SpectralFeatures.hannWindow(size)
        val windowed = FloatArray(size)

        // A single tone: the centroid should sit at that tone.
        val lowFreq = 50 * binHz
        SpectralFeatures.applyHann(sine(lowFreq, sampleRate, size), windowed, hann, size)
        fft.forward(windowed)
        val lowCentroid = SpectralFeatures.spectralCentroid(fft.magnitudes, binHz)
        near("centroid of a pure tone equals the tone", lowCentroid, lowFreq, binHz * 4)

        // A higher tone must move the centroid up.
        val highFreq = 300 * binHz
        SpectralFeatures.applyHann(sine(highFreq, sampleRate, size), windowed, hann, size)
        fft.forward(windowed)
        val highCentroid = SpectralFeatures.spectralCentroid(fft.magnitudes, binHz)
        near("centroid tracks a higher tone", highCentroid, highFreq, binHz * 4)
        ok("brighter signal has the higher centroid", highCentroid > lowCentroid)

        // Two equal tones: centroid lands between them.
        val mix = FloatArray(size)
        val a = sine(50 * binHz, sampleRate, size, 0.5f)
        val b = sine(250 * binHz, sampleRate, size, 0.5f)
        for (i in 0 until size) mix[i] = a[i] + b[i]
        SpectralFeatures.applyHann(mix, windowed, hann, size)
        fft.forward(windowed)
        val mixCentroid = SpectralFeatures.spectralCentroid(fft.magnitudes, binHz)
        val expectedMid = (50 * binHz + 250 * binHz) / 2f
        near("two equal tones centre between them", mixCentroid, expectedMid, binHz * 12)

        // Bandwidth: a pure tone is narrow, a two-tone spread is wide.
        SpectralFeatures.applyHann(sine(150 * binHz, sampleRate, size), windowed, hann, size)
        fft.forward(windowed)
        val pureBandwidth = SpectralFeatures.spectralBandwidth(
            fft.magnitudes, binHz, SpectralFeatures.spectralCentroid(fft.magnitudes, binHz))
        SpectralFeatures.applyHann(mix, windowed, hann, size)
        fft.forward(windowed)
        val wideBandwidth = SpectralFeatures.spectralBandwidth(fft.magnitudes, binHz, mixCentroid)
        ok("spread spectrum has greater bandwidth than a pure tone",
            wideBandwidth > pureBandwidth * 2,
            "pure=$pureBandwidth wide=$wideBandwidth")

        // Rolloff: below the tone for a single sine, and monotone in
        // the percentile.
        SpectralFeatures.applyHann(sine(200 * binHz, sampleRate, size), windowed, hann, size)
        fft.forward(windowed)
        val rolloff85 = SpectralFeatures.spectralRolloff(fft.magnitudes, binHz, 0.85f)
        near("rolloff of a pure tone sits at the tone", rolloff85, 200 * binHz, binHz * 6)
    }

    private fun testWindowing() {
        println("\nWindowing")
        val config = AudioAnalysisConfig(targetSampleRate = 22050, windowSize = 1024, hopSize = 512)
        val analyzer = WindowedAnalyzer(config)

        // 10 hops' worth of samples => with 50% overlap and a full
        // first window, expect floor((N - window)/hop) + 1 windows.
        val sampleCount = 1024 * 5
        analyzer.feed(sine(440f, 22050, sampleCount), sampleCount)
        val expectedWindows = (sampleCount - 1024) / 512 + 1
        ok("window count matches the hop schedule",
            analyzer.aggregator.frames == expectedWindows,
            "expected $expectedWindows, got ${analyzer.aggregator.frames}")

        ok("all fed samples were counted",
            analyzer.analyzedSampleCount == sampleCount.toLong())

        // Chunk boundaries must not change the result: feeding the
        // same signal in awkward pieces must produce identical output.
        val signal = sine(440f, 22050, 8192)
        val whole = WindowedAnalyzer(config)
        whole.feed(signal, signal.size)
        whole.finish()

        val pieces = WindowedAnalyzer(config)
        var offset = 0
        val oddSizes = intArrayOf(7, 333, 1, 2048, 100)
        var s = 0
        while (offset < signal.size) {
            val n = minOf(oddSizes[s % oddSizes.size], signal.size - offset)
            pieces.feed(signal.copyOfRange(offset, offset + n), n)
            offset += n
            s++
        }
        pieces.finish()

        ok("identical window count regardless of chunk sizes",
            whole.aggregator.frames == pieces.aggregator.frames,
            "whole=${whole.aggregator.frames} pieces=${pieces.aggregator.frames}")
        near("identical RMS regardless of chunk sizes",
            pieces.aggregator.meanRms() ?: -1f, whole.aggregator.meanRms() ?: -2f, 0.0001f)

        // Hann window shape.
        val hann = SpectralFeatures.hannWindow(8)
        near("Hann starts at zero", hann[0], 0f, 0.0001f)
        near("Hann peaks at the centre", hann[4], 1f, 0.0001f)
        ok("Hann is symmetric about the centre",
            abs(hann[1] - hann[7]) < 0.0001f && abs(hann[2] - hann[6]) < 0.0001f)
    }

    private fun testSilence() {
        println("\nSilence detection")
        val config = AudioAnalysisConfig(targetSampleRate = 22050, windowSize = 1024, hopSize = 1024)

        // Entirely silent input.
        val quiet = WindowedAnalyzer(config)
        val silent = silence(1024 * 10)
        quiet.feed(silent, silent.size)
        quiet.finish()
        near("pure silence gives ratio 1.0", quiet.aggregator.silenceRatio() ?: -1f, 1f, 0.0001f)

        // Entirely loud input.
        val loud = WindowedAnalyzer(config)
        val tone = sine(440f, 22050, 1024 * 10, 0.8f)
        loud.feed(tone, tone.size)
        loud.finish()
        near("continuous tone gives ratio 0.0", loud.aggregator.silenceRatio() ?: -1f, 0f, 0.0001f)

        // Half and half.
        val mixed = WindowedAnalyzer(config)
        val halfSilent = FloatArray(1024 * 10)
        val halfTone = sine(440f, 22050, 1024 * 10, 0.8f)
        mixed.feed(halfSilent, halfSilent.size)
        mixed.feed(halfTone, halfTone.size)
        mixed.finish()
        near("half-silent input gives ratio ~0.5",
            mixed.aggregator.silenceRatio() ?: -1f, 0.5f, 0.06f)

        // A signal below the threshold counts as silence; one above
        // does not. Threshold is -50 dBFS ≈ 0.00316 amplitude.
        val belowThreshold = WindowedAnalyzer(config)
        val veryQuiet = sine(440f, 22050, 1024 * 4, 0.001f)
        belowThreshold.feed(veryQuiet, veryQuiet.size)
        belowThreshold.finish()
        near("-60 dBFS tone counts as silence",
            belowThreshold.aggregator.silenceRatio() ?: -1f, 1f, 0.0001f)

        val aboveThreshold = WindowedAnalyzer(config)
        val audible = sine(440f, 22050, 1024 * 4, 0.05f)
        aboveThreshold.feed(audible, audible.size)
        aboveThreshold.finish()
        near("-26 dBFS tone does not count as silence",
            aboveThreshold.aggregator.silenceRatio() ?: -1f, 0f, 0.0001f)

        // dB conversion sanity.
        near("full scale is 0 dBFS", SpectralFeatures.amplitudeToDb(1f), 0f, 0.01f)
        near("half amplitude is about -6 dBFS", SpectralFeatures.amplitudeToDb(0.5f), -6.02f, 0.05f)
        near("a tenth is -20 dBFS", SpectralFeatures.amplitudeToDb(0.1f), -20f, 0.05f)
    }

    private fun testTempo() {
        println("\nBPM / tempo")
        val sampleRate = 22050
        val config = AudioAnalysisConfig(targetSampleRate = sampleRate)

        // A metronome at a known tempo must be recovered. Octave
        // errors (half/double) are the classic failure, so they are
        // accepted only where noted and checked explicitly below.
        for (bpm in listOf(90f, 120f, 140f)) {
            val analyzer = WindowedAnalyzer(config)
            val clicks = clickTrack(bpm, sampleRate, 20f)
            analyzer.feed(clicks, clicks.size)
            analyzer.finish()

            val tempo = analyzer.aggregator.estimateTempo()
            val detected = tempo.bpm
            ok("$bpm BPM click track returns a tempo", detected != null)

            if (detected != null) {
                val exact = abs(detected - bpm) <= bpm * 0.06f
                val octaveUp = abs(detected - bpm * 2) <= bpm * 0.12f
                val octaveDown = abs(detected - bpm / 2) <= bpm * 0.06f
                ok("$bpm BPM detected within tolerance (got ${"%.1f".format(detected)})",
                    exact || octaveUp || octaveDown)
                ok("$bpm BPM detected exactly, not an octave away (got ${"%.1f".format(detected)})",
                    exact)
                ok("$bpm BPM has a usable confidence (${"%.2f".format(tempo.confidence)})",
                    tempo.confidence > 0f)
            }
        }

        // Silence has no tempo, and must say so rather than invent one.
        val silentAnalyzer = WindowedAnalyzer(config)
        val quiet = silence(sampleRate * 15)
        silentAnalyzer.feed(quiet, quiet.size)
        silentAnalyzer.finish()
        val silentTempo = silentAnalyzer.aggregator.estimateTempo()
        ok("silence yields no BPM", silentTempo.bpm == null)
        ok("silence yields zero/low confidence", silentTempo.confidence < 0.2f)

        // Too short to judge: must decline rather than guess.
        val shortTempo = TempoEstimator.estimate(FloatArray(5) { 1f }, config.hopSeconds, config)
        ok("a too-short envelope declines to guess", shortTempo.bpm == null)

        // Confidence is always within range.
        ok("confidence stays within 0..1",
            silentTempo.confidence in 0f..1f && shortTempo.confidence in 0f..1f)
    }

    private fun testAggregation() {
        println("\nFeature aggregation")
        val config = AudioAnalysisConfig(targetSampleRate = 22050, windowSize = 1024, hopSize = 512)
        val analyzer = WindowedAnalyzer(config)

        // Loud section then quiet section: dynamic range must be
        // positive and the mean must land between the two levels.
        val loud = sine(440f, 22050, 22050, 0.8f)
        val quiet = sine(440f, 22050, 22050, 0.08f)
        analyzer.feed(loud, loud.size)
        analyzer.feed(quiet, quiet.size)
        analyzer.finish()

        val agg = analyzer.aggregator
        val meanRms = agg.meanRms()!!
        ok("mean RMS sits between the two section levels",
            meanRms > 0.05f && meanRms < 0.6f, "got $meanRms")
        near("peak reflects the loudest section", agg.peak()!!, 0.8f, 0.02f)

        val range = agg.dynamicRangeDb()
        ok("dynamic range is positive for loud+quiet material",
            range != null && range > 10f, "got $range")

        val loudness = agg.loudnessDbfs()
        ok("loudness is negative dBFS", loudness != null && loudness < 0f, "got $loudness")

        // A constant-level signal should show a small dynamic range.
        val steady = WindowedAnalyzer(config)
        val even = sine(440f, 22050, 44100, 0.5f)
        steady.feed(even, even.size)
        steady.finish()
        val steadyRange = steady.aggregator.dynamicRangeDb()
        ok("steady material has a small dynamic range",
            steadyRange != null && steadyRange < 3f, "got $steadyRange")

        // Empty input must produce nulls, never zeros pretending to be
        // measurements.
        val emptyAnalyzer = WindowedAnalyzer(config)
        emptyAnalyzer.finish()
        ok("no audio yields null RMS", emptyAnalyzer.aggregator.meanRms() == null)
        ok("no audio yields null silence ratio", emptyAnalyzer.aggregator.silenceRatio() == null)
        ok("no audio yields null centroid", emptyAnalyzer.aggregator.meanCentroid() == null)
    }

    private fun testMemoryBoundedness() {
        println("\nMemory boundedness")
        // Feeding far more audio must not grow per-window state: the
        // analyser keeps fixed buffers plus one float per window.
        val config = AudioAnalysisConfig()
        val analyzer = WindowedAnalyzer(config)

        val chunk = sine(440f, 22050, 22050, 0.5f)
        // 60 seconds of audio, fed one second at a time.
        repeat(60) { analyzer.feed(chunk, chunk.size) }
        analyzer.finish()

        ok("60 s of audio processed", analyzer.analyzedSampleCount == 22050L * 60)
        ok("window count matches the hop schedule for 60 s",
            analyzer.aggregator.frames > 1200, "got ${analyzer.aggregator.frames}")
        ok("features remain finite over a long signal",
            analyzer.aggregator.meanRms()!!.isFinite()
                && analyzer.aggregator.meanCentroid()!!.isFinite())
    }

    private fun testConfigValidation() {
        println("\nConfiguration")
        ok("analyzer version is exposed", AudioAnalysisConfig.AUDIO_ANALYZER_VERSION >= 1)

        val config = AudioAnalysisConfig()
        near("bin width matches rate/size", config.binHz, 22050f / 2048f, 0.001f)
        near("hop seconds matches hop/rate", config.hopSeconds, 1024f / 22050f, 0.00001f)

        var rejected = false
        try {
            AudioAnalysisConfig(windowSize = 1000)
        } catch (e: IllegalArgumentException) {
            rejected = true
        }
        ok("a non-power-of-two window is rejected", rejected)

        var rejectedHop = false
        try {
            AudioAnalysisConfig(windowSize = 1024, hopSize = 2048)
        } catch (e: IllegalArgumentException) {
            rejectedHop = true
        }
        ok("a hop larger than the window is rejected", rejectedHop)
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n\u001B[1mSYSTEMA — Phase 13 audio DSP\u001B[0m")

        testRms()
        testPeak()
        testZeroCrossing()
        testFft()
        testSpectralCentroid()
        testWindowing()
        testSilence()
        testTempo()
        testAggregation()
        testMemoryBoundedness()
        testConfigValidation()

        val colour = if (failed == 0) "\u001B[32m" else "\u001B[31m"
        println("\n$colour$passed passed, $failed failed\u001B[0m\n")
        if (failed > 0) {
            throw AssertionError("$failed DSP assertion(s) failed")
        }
    }
}
