package com.systema.music.analysis.dsp

/**
 * Streaming aggregation of per-window features.
 *
 * The analyser produces one feature set per window — several thousand
 * for a normal track. Keeping them all would mean tens of thousands of
 * floats retained for the duration of the analysis, for statistics
 * that can be computed incrementally. So nothing is stored per window
 * except the running accumulators below.
 *
 * The one exception is [rmsHistory], which the dynamic-range estimate
 * genuinely needs (percentiles cannot be computed in a single pass
 * without keeping the values). It stores ONE float per window — for a
 * five-minute track at hop 1024 that is ~6400 floats, about 25 KB, and
 * it is bounded by the configured analysis ceiling. That is a
 * deliberate, measured exception rather than an oversight.
 */
class FeatureAggregator(private val config: AudioAnalysisConfig) {

    private var windowCount = 0
    private var silentWindows = 0

    private var rmsSum = 0.0
    private var peakMax = 0f

    private var centroidSum = 0.0
    private var centroidMin = Float.MAX_VALUE
    private var centroidMax = 0f
    private var bandwidthSum = 0.0
    private var rolloffSum = 0.0
    private var zcrSum = 0.0

    /** Only non-silent windows contribute to spectral means. */
    private var voicedWindows = 0

    private val rmsHistory = ArrayList<Float>(4096)
    private val onsetEnvelope = ArrayList<Float>(4096)

    val frames: Int get() = windowCount

    fun addWindow(
        rms: Float,
        peak: Float,
        zcr: Float,
        centroid: Float,
        bandwidth: Float,
        rolloff: Float,
        flux: Float,
        isSilent: Boolean,
    ) {
        windowCount++

        rmsSum += rms
        rmsHistory.add(rms)
        if (peak > peakMax) peakMax = peak

        // The onset envelope must stay on the full timeline, including
        // silent stretches: a gap is information the tempo estimator
        // needs, and dropping it would compress time and skew the BPM.
        onsetEnvelope.add(flux)

        if (isSilent) {
            silentWindows++
            // Spectral descriptors of near-silence are numerically
            // meaningless (they describe the noise floor), so they are
            // excluded from the timbre averages.
            return
        }

        voicedWindows++
        centroidSum += centroid
        if (centroid < centroidMin) centroidMin = centroid
        if (centroid > centroidMax) centroidMax = centroid
        bandwidthSum += bandwidth
        rolloffSum += rolloff
        zcrSum += zcr
    }

    fun meanRms(): Float? = if (windowCount == 0) null else (rmsSum / windowCount).toFloat()

    fun peak(): Float? = if (windowCount == 0) null else peakMax

    fun silenceRatio(): Float? =
        if (windowCount == 0) null else silentWindows.toFloat() / windowCount

    fun meanCentroid(): Float? = mean(centroidSum)
    fun minCentroid(): Float? =
        if (voicedWindows == 0 || centroidMin == Float.MAX_VALUE) null else centroidMin

    fun maxCentroid(): Float? = if (voicedWindows == 0) null else centroidMax
    fun meanBandwidth(): Float? = mean(bandwidthSum)
    fun meanRolloff(): Float? = mean(rolloffSum)
    fun meanZcr(): Float? = mean(zcrSum)

    private fun mean(sum: Double): Float? =
        if (voicedWindows == 0) null else (sum / voicedWindows).toFloat()

    /**
     * Dynamic range in dB, as the gap between the 95th and 10th
     * percentile of window RMS.
     *
     * Percentiles rather than max/min because a single click or one
     * digital-silence frame would otherwise define the whole range.
     */
    fun dynamicRangeDb(): Float? {
        if (rmsHistory.size < 10) return null
        val sorted = rmsHistory.toFloatArray()
        sorted.sort()

        val loud = percentile(sorted, 0.95f)
        val quiet = percentile(sorted, 0.10f)
        if (loud <= 0f) return null

        val loudDb = SpectralFeatures.amplitudeToDb(loud)
        val quietDb = SpectralFeatures.amplitudeToDb(quiet)
        return (loudDb - quietDb).coerceAtLeast(0f)
    }

    private fun percentile(sorted: FloatArray, p: Float): Float {
        if (sorted.isEmpty()) return 0f
        val index = ((sorted.size - 1) * p).toInt().coerceIn(0, sorted.size - 1)
        return sorted[index]
    }

    /**
     * RMS-derived loudness in dBFS. See the field documentation on
     * AudioAnalysisResult.loudnessDbfs — this is explicitly NOT LUFS.
     */
    fun loudnessDbfs(): Float? {
        val mean = meanRms() ?: return null
        if (mean <= 0f) return null
        return SpectralFeatures.amplitudeToDb(mean)
    }

    fun onsetEnvelope(): FloatArray = onsetEnvelope.toFloatArray()

    fun estimateTempo(): TempoEstimator.Tempo =
        TempoEstimator.estimate(onsetEnvelope(), config.hopSeconds, config)
}
