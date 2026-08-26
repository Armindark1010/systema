package com.systema.music.analysis.dsp

/**
 * The DSP core: turns a stream of mono PCM into aggregated features.
 *
 * Deliberately free of Android imports. The decoder pushes samples in
 * via [feed] in whatever chunk sizes it happens to produce, and this
 * class re-frames them into fixed windows. That separation is what
 * lets the entire DSP path be tested on a desktop JVM with synthetic
 * signals, with the decoder tested separately.
 *
 * Memory
 * ------
 * Fixed cost regardless of track length:
 *   frame       windowSize floats
 *   windowed    windowSize floats
 *   prevSpectrum (windowSize/2 + 1) floats
 *   Fft internals ~2.5 x windowSize floats
 *
 * At the default 2048 that is roughly 60 KB total, allocated once. The
 * PCM stream itself is never retained — samples are consumed into the
 * running frame and dropped. A 60-second track and a 60-minute track
 * use the same memory here (the only growth is the aggregator's
 * one-float-per-window history, documented there).
 *
 * Framing
 * -------
 * Overlapping windows are produced by keeping the last (windowSize -
 * hopSize) samples after each emission, so the caller does not need to
 * know anything about overlap.
 */
class WindowedAnalyzer(private val config: AudioAnalysisConfig) {

    private val windowSize = config.windowSize
    private val hopSize = config.hopSize

    private val frame = FloatArray(windowSize)
    private val windowed = FloatArray(windowSize)
    private val hann = SpectralFeatures.hannWindow(windowSize)
    private val fft = Fft(windowSize)
    private var prevSpectrum = FloatArray(windowSize / 2 + 1)

    /** How many samples of [frame] are currently filled. */
    private var filled = 0

    private val silenceThresholdAmplitude =
        Math.pow(10.0, (config.silenceThresholdDb / 20f).toDouble()).toFloat()

    val aggregator = FeatureAggregator(config)

    private var totalSamples = 0L

    val analyzedSampleCount: Long get() = totalSamples

    /**
     * Feeds [count] mono samples from [samples], emitting windows as
     * they complete. Any partial remainder is retained for the next
     * call, so chunk boundaries never split a window.
     */
    fun feed(samples: FloatArray, count: Int) {
        var offset = 0
        while (offset < count) {
            val toCopy = minOf(windowSize - filled, count - offset)
            System.arraycopy(samples, offset, frame, filled, toCopy)
            filled += toCopy
            offset += toCopy
            totalSamples += toCopy

            if (filled == windowSize) {
                processFrame(windowSize)
                // Slide by the hop, keeping the overlap for the next
                // window rather than discarding the whole frame.
                val keep = windowSize - hopSize
                if (keep > 0) System.arraycopy(frame, hopSize, frame, 0, keep)
                filled = keep
            }
        }
    }

    /**
     * Processes whatever remains after the last full window.
     *
     * The tail is zero-padded rather than dropped so a short file
     * (or the final fragment of any file) still contributes.
     */
    fun finish() {
        if (filled >= hopSize) {
            for (i in filled until windowSize) frame[i] = 0f
            processFrame(filled)
        }
        filled = 0
    }

    private fun processFrame(validLength: Int) {
        // ---- Time-domain features on the RAW frame ----------------
        // Not the windowed copy: a Hann taper drives both edges to
        // zero, which would systematically understate RMS and could
        // erase a peak that happens to sit near a frame boundary.
        val rms = SpectralFeatures.rms(frame, validLength)
        val peak = SpectralFeatures.peak(frame, validLength)
        val zcr = SpectralFeatures.zeroCrossingRate(frame, validLength)

        val isSilent = rms < silenceThresholdAmplitude

        // ---- Spectral features on the WINDOWED copy ---------------
        SpectralFeatures.applyHann(frame, windowed, hann, validLength)
        fft.forward(windowed)

        val magnitudes = fft.magnitudes
        val binHz = config.binHz

        val centroid = SpectralFeatures.spectralCentroid(magnitudes, binHz)
        val bandwidth = SpectralFeatures.spectralBandwidth(magnitudes, binHz, centroid)
        val rolloff = SpectralFeatures.spectralRolloff(magnitudes, binHz, config.rolloffPercentile)
        val flux = SpectralFeatures.spectralFlux(magnitudes, prevSpectrum)

        aggregator.addWindow(
            rms = rms,
            peak = peak,
            zcr = zcr,
            centroid = centroid,
            bandwidth = bandwidth,
            rolloff = rolloff,
            flux = flux,
            isSilent = isSilent,
        )

        // Keep this window's spectrum for the next flux computation.
        // Copied into a persistent buffer because fft.magnitudes is
        // overwritten by the next transform.
        System.arraycopy(magnitudes, 0, prevSpectrum, 0, magnitudes.size)
    }
}
