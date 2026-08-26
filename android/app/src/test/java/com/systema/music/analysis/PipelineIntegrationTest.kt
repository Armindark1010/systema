package com.systema.music.analysis

import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.dsp.WindowedAnalyzer
import com.systema.music.analysis.model.AudioAnalysisResult
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * End-to-end pipeline test: PCM stream in, AudioAnalysisResult out.
 *
 * What this covers and what it does not
 * -------------------------------------
 * This exercises everything downstream of the decoder — the exact
 * buffering, windowing, feature extraction, aggregation and result
 * assembly that AudioAnalyzer performs — by driving it with PCM in the
 * same bounded chunks MediaCodec would produce.
 *
 * It does NOT touch MediaExtractor/MediaCodec, which cannot run on a
 * desktop JVM. Decoding a real MP3/M4A from a MediaStore URI is
 * verified separately, on hardware. The claim ladder for Phase 13 is
 * therefore:
 *
 *   DSP maths .................. unit tested (DspTest)
 *   resampling seam ............ unit tested (ResampleTest)
 *   PCM -> result pipeline ..... integration tested (this file)
 *   content:// -> PCM .......... device only, NOT verified here
 *
 * The synthetic "songs" below have analytically known properties, so
 * the assertions check real values rather than merely that something
 * was produced.
 */
object PipelineIntegrationTest {

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

    private val config = AudioAnalysisConfig()

    /**
     * Runs PCM through the analyser exactly as AudioAnalyzer does,
     * including the chunked feed, and assembles the same result.
     *
     * Mirrors AudioAnalyzer.analyze() minus the decoder call, which is
     * the only part that needs Android.
     */
    private fun analyzePcm(trackId: String, pcm: FloatArray, channels: Int = 2): AudioAnalysisResult {
        val analyzer = WindowedAnalyzer(config)
        val started = System.currentTimeMillis()
        var dspNanos = 0L

        // Feed in decoder-sized chunks, deliberately not aligned to
        // the window size, to match real MediaCodec output.
        val chunk = 8192
        var offset = 0
        while (offset < pcm.size) {
            val n = minOf(chunk, pcm.size - offset)
            val buffer = FloatArray(n) { pcm[offset + it] }
            val t0 = System.nanoTime()
            analyzer.feed(buffer, n)
            dspNanos += System.nanoTime() - t0
            offset += n
        }
        val t0 = System.nanoTime()
        analyzer.finish()
        dspNanos += System.nanoTime() - t0

        val agg = analyzer.aggregator
        val tempo = agg.estimateTempo()
        val total = System.currentTimeMillis() - started
        val dspMs = dspNanos / 1_000_000

        return AudioAnalysisResult(
            trackId = trackId,
            durationMs = analyzer.analyzedSampleCount * 1000 / config.targetSampleRate,
            sampleRate = config.targetSampleRate,
            channels = channels,
            analyzedSampleCount = analyzer.analyzedSampleCount,
            rms = agg.meanRms(),
            peak = agg.peak(),
            dynamicRangeDb = agg.dynamicRangeDb(),
            silenceRatio = agg.silenceRatio(),
            spectralCentroid = agg.meanCentroid(),
            spectralCentroidMin = agg.minCentroid(),
            spectralCentroidMax = agg.maxCentroid(),
            spectralBandwidth = agg.meanBandwidth(),
            spectralRolloff = agg.meanRolloff(),
            zeroCrossingRate = agg.meanZcr(),
            bpm = tempo.bpm,
            bpmConfidence = tempo.confidence,
            loudnessDbfs = agg.loudnessDbfs(),
            analyzerVersion = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION,
            analyzedAt = System.currentTimeMillis(),
            decodeTimeMs = (total - dspMs).coerceAtLeast(0),
            dspTimeMs = dspMs,
            totalAnalysisTimeMs = total,
        )
    }

    /**
     * A synthetic "track": a bass line plus a hi-hat-ish click at a
     * known tempo, with a quiet intro and a fade-out. Analytically we
     * know its tempo, that it is not silent, and roughly where its
     * spectral energy sits.
     */
    private fun syntheticSong(bpm: Float, seconds: Float, rate: Int): FloatArray {
        val total = (rate * seconds).toInt()
        val out = FloatArray(total)
        val samplesPerBeat = (60f / bpm * rate).roundToInt()
        val rng = java.util.Random(7)

        for (i in 0 until total) {
            // Sustained bass tone at 110 Hz.
            out[i] = (0.25 * sin(2.0 * PI * 110.0 * i / rate)).toFloat()
        }

        // Percussive clicks on every beat.
        val clickLen = (rate * 0.03f).toInt()
        var beat = 0
        while (beat * samplesPerBeat < total) {
            val start = beat * samplesPerBeat
            for (j in 0 until clickLen) {
                val idx = start + j
                if (idx >= total) break
                val decay = Math.exp(-j / (clickLen * 0.2)).toFloat()
                out[idx] += (rng.nextFloat() * 2f - 1f) * decay * 0.6f
            }
            beat++
        }

        // Two seconds of near-silence at the head.
        val introSamples = minOf(rate * 2, total)
        for (i in 0 until introSamples) out[i] *= 0.0005f

        return out
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n\u001B[1mSYSTEMA — Phase 13 pipeline integration\u001B[0m\n")

        val rate = config.targetSampleRate

        println("Synthetic track at 128 BPM, 30 s, with a silent intro")
        val song = syntheticSong(128f, 30f, rate)
        val result = analyzePcm("synthetic:1", song)

        // ---- Basic ------------------------------------------------
        ok("duration is about 30 s (${result.durationMs} ms)",
            abs(result.durationMs - 30_000) < 500)
        ok("sample rate is the analysis rate", result.sampleRate == 22050)
        ok("channel count is carried through", result.channels == 2)
        ok("all samples were analysed (${result.analyzedSampleCount})",
            result.analyzedSampleCount == (rate * 30).toLong())

        // ---- Amplitude --------------------------------------------
        ok("RMS is present and plausible (${result.rms})",
            result.rms != null && result.rms!! > 0.05f && result.rms!! < 0.9f)
        ok("peak is present and below full scale (${result.peak})",
            result.peak != null && result.peak!! > 0.3f && result.peak!! <= 1.0f)
        ok("peak is at least as large as RMS", result.peak!! >= result.rms!!)

        // The intro is 2 s of a 30 s track: about 6.7%.
        val silence = result.silenceRatio!!
        ok("silence ratio reflects the 2 s intro (${"%.3f".format(silence)})",
            silence > 0.03f && silence < 0.12f)

        ok("dynamic range is positive (${result.dynamicRangeDb})",
            result.dynamicRangeDb != null && result.dynamicRangeDb!! > 0f)

        // ---- Spectral ---------------------------------------------
        ok("centroid is within the analysis band (${result.spectralCentroid})",
            result.spectralCentroid != null
                && result.spectralCentroid!! > 0f
                && result.spectralCentroid!! < rate / 2f)
        ok("centroid min <= mean <= max",
            result.spectralCentroidMin!! <= result.spectralCentroid!!
                && result.spectralCentroid!! <= result.spectralCentroidMax!!)
        ok("bandwidth is positive", result.spectralBandwidth!! > 0f)
        ok("rolloff is within the analysis band",
            result.spectralRolloff!! > 0f && result.spectralRolloff!! <= rate / 2f)
        ok("ZCR is a fraction (${result.zeroCrossingRate})",
            result.zeroCrossingRate!! > 0f && result.zeroCrossingRate!! < 1f)

        // ---- Tempo ------------------------------------------------
        ok("BPM was determined (${result.bpm})", result.bpm != null)
        if (result.bpm != null) {
            val detected = result.bpm!!
            val exact = abs(detected - 128f) <= 128f * 0.06f
            val octave = abs(detected - 64f) <= 6f || abs(detected - 256f) <= 20f
            ok("BPM is 128 or a clean octave of it (got ${"%.1f".format(detected)})", exact || octave)
            ok("BPM is exactly 128 within tolerance (got ${"%.1f".format(detected)})", exact)
        }
        ok("BPM confidence is reported (${result.bpmConfidence})",
            result.bpmConfidence != null && result.bpmConfidence!! in 0f..1f)

        // ---- Loudness ---------------------------------------------
        ok("loudness is negative dBFS (${result.loudnessDbfs})",
            result.loudnessDbfs != null && result.loudnessDbfs!! < 0f && result.loudnessDbfs!! > -60f)

        // ---- Provenance & instrumentation -------------------------
        ok("analyzer version is stamped",
            result.analyzerVersion == AudioAnalysisConfig.AUDIO_ANALYZER_VERSION)
        ok("timing is recorded", result.totalAnalysisTimeMs >= 0 && result.dspTimeMs >= 0)
        ok("real-time factor is computable (${result.realTimeFactor})",
            result.realTimeFactor != null)
        ok("analysis is faster than real time (RTF=${"%.4f".format(result.realTimeFactor)})",
            result.realTimeFactor!! < 1.0f)

        println("\n  \u001B[2mmeasured: RTF=${"%.4f".format(result.realTimeFactor)} " +
            "dsp=${result.dspTimeMs}ms total=${result.totalAnalysisTimeMs}ms " +
            "for ${result.durationMs}ms of audio\u001B[0m")

        // ---- A different tempo must give a different answer -------
        println("\nA second track at a different tempo")
        val slow = analyzePcm("synthetic:2", syntheticSong(90f, 25f, rate))
        ok("90 BPM track returns a tempo", slow.bpm != null)
        if (slow.bpm != null) {
            ok("90 BPM detected within tolerance (got ${"%.1f".format(slow.bpm!!)})",
                abs(slow.bpm!! - 90f) <= 90f * 0.06f)
        }
        ok("the two tracks report different tempi",
            result.bpm != null && slow.bpm != null && abs(result.bpm!! - slow.bpm!!) > 10f)

        // ---- Fully silent input -----------------------------------
        println("\nA silent file")
        val silent = analyzePcm("synthetic:silent", FloatArray(rate * 10))
        ok("silence ratio is 1.0", abs(silent.silenceRatio!! - 1f) < 0.001f)
        ok("silent audio yields no BPM", silent.bpm == null)
        ok("RMS is zero, not null", silent.rms != null && silent.rms!! < 0.0001f)
        ok("spectral features are null for a fully silent file",
            silent.spectralCentroid == null)
        ok("loudness is null rather than a fake number", silent.loudnessDbfs == null)

        // ---- A very short file ------------------------------------
        println("\nA very short file")
        val shortPcm = FloatArray(3000) { (0.4 * sin(2.0 * PI * 440.0 * it / rate)).toFloat() }
        val short = analyzePcm("synthetic:short", shortPcm)
        ok("short file still produces amplitude features", short.rms != null)
        ok("short file declines to report a tempo", short.bpm == null)
        ok("short file does not crash the pipeline", short.analyzedSampleCount == 3000L)

        // ---- Determinism ------------------------------------------
        println("\nDeterminism")
        val again = analyzePcm("synthetic:1", song)
        ok("same input gives the same RMS", again.rms == result.rms)
        ok("same input gives the same centroid", again.spectralCentroid == result.spectralCentroid)
        ok("same input gives the same BPM", again.bpm == result.bpm)
        ok("same input gives the same silence ratio", again.silenceRatio == result.silenceRatio)

        val colour = if (failed == 0) "\u001B[32m" else "\u001B[31m"
        println("\n$colour$passed passed, $failed failed\u001B[0m\n")
        if (failed > 0) throw AssertionError("$failed pipeline assertion(s) failed")
    }
}
