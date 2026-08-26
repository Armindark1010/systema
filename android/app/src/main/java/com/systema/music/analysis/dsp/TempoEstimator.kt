package com.systema.music.analysis.dsp

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Tempo estimation from an onset-strength envelope.
 *
 * Pipeline
 * --------
 *   spectral flux per window   (computed upstream, one value per hop)
 *        v
 *   normalise + subtract local mean   -> onset envelope
 *        v
 *   autocorrelation over the plausible tempo lag range
 *        v
 *   peak picking -> tempo candidates
 *        v
 *   octave-aware scoring -> BPM + confidence
 *
 * Why autocorrelation rather than a comb-filter bank or a beat
 * tracker: it is O(lags x frames) with no state, needs no training,
 * and answers the question actually being asked here ("what period
 * does this envelope repeat at?"). A full beat tracker would give
 * downbeat positions too, which nothing in this phase consumes.
 *
 * This does NOT claim to be accurate on rubato, live, or ambient
 * material. It reports a confidence and the caller is expected to
 * discard low-confidence results rather than trust them.
 */
object TempoEstimator {

    /**
     * @param bpm null when no candidate cleared the confidence floor.
     * @param confidence 0..1, the normalised strength of the winning
     *   autocorrelation peak relative to its neighbourhood.
     */
    data class Tempo(val bpm: Float?, val confidence: Float)

    /**
     * @param onsetEnvelope one onset-strength value per analysis hop.
     * @param hopSeconds seconds between consecutive envelope values.
     */
    fun estimate(
        onsetEnvelope: FloatArray,
        hopSeconds: Float,
        config: AudioAnalysisConfig,
    ): Tempo {
        // Below ~4 seconds of envelope there is not enough evidence for
        // even one slow-tempo period to repeat convincingly.
        val minFrames = (4f / hopSeconds).roundToInt()
        if (onsetEnvelope.size < minFrames || onsetEnvelope.size < 16) {
            return Tempo(null, 0f)
        }

        val envelope = preprocess(onsetEnvelope)

        // Lag range, in frames, matching the configured BPM window.
        // lag = 60 / (bpm * hopSeconds)
        val minLag = (60f / (config.maxBpm * hopSeconds)).roundToInt().coerceAtLeast(1)
        val maxLag = (60f / (config.minBpm * hopSeconds)).roundToInt()
            .coerceAtMost(envelope.size / 2)

        if (maxLag <= minLag) return Tempo(null, 0f)

        val correlation = autocorrelate(envelope, minLag, maxLag)
        if (correlation.isEmpty()) return Tempo(null, 0f)

        // Normalise to 0..1 so confidence means something comparable
        // across tracks of different loudness and density.
        val maxCorr = correlation.max()
        if (maxCorr <= 0f) return Tempo(null, 0f)
        for (i in correlation.indices) correlation[i] /= maxCorr

        val candidates = pickPeaks(correlation, minLag, hopSeconds)
        if (candidates.isEmpty()) return Tempo(null, 0f)

        val winner = resolveOctaves(candidates, correlation, minLag, hopSeconds)

        if (winner.confidence < config.minBpmConfidence) {
            // Honest absence. A wrong-but-confident BPM would corrupt
            // every downstream phase that trusts it.
            return Tempo(null, winner.confidence)
        }
        return winner
    }

    /**
     * Normalises the envelope and removes its local trend.
     *
     * Subtracting a moving average matters: without it, a track that
     * simply gets louder produces a large DC component whose
     * autocorrelation dwarfs the periodic structure, and every track
     * "detects" the longest lag available.
     */
    private fun preprocess(raw: FloatArray): FloatArray {
        val out = FloatArray(raw.size)
        val windowRadius = 8

        for (i in raw.indices) {
            val from = (i - windowRadius).coerceAtLeast(0)
            val to = (i + windowRadius).coerceAtMost(raw.size - 1)
            var sum = 0f
            for (j in from..to) sum += raw[j]
            val localMean = sum / (to - from + 1)
            // Half-wave rectify: only energy ABOVE the local average
            // counts as an onset.
            out[i] = (raw[i] - localMean).coerceAtLeast(0f)
        }
        return out
    }

    private fun autocorrelate(envelope: FloatArray, minLag: Int, maxLag: Int): FloatArray {
        val result = FloatArray(maxLag - minLag + 1)
        for (lag in minLag..maxLag) {
            var sum = 0.0
            val n = envelope.size - lag
            for (i in 0 until n) {
                sum += envelope[i].toDouble() * envelope[i + lag]
            }
            // Divide by the overlap length, otherwise short lags win
            // purely by having more terms in the sum.
            result[lag - minLag] = if (n > 0) (sum / n).toFloat() else 0f
        }
        return result
    }

    private data class Candidate(val bpm: Float, val strength: Float, val lag: Int)

    /** Local maxima of the normalised autocorrelation, strongest first. */
    private fun pickPeaks(
        correlation: FloatArray,
        minLag: Int,
        hopSeconds: Float,
    ): List<Candidate> {
        val peaks = mutableListOf<Candidate>()
        for (i in 1 until correlation.size - 1) {
            val v = correlation[i]
            if (v > correlation[i - 1] && v >= correlation[i + 1] && v > 0.1f) {
                val lag = i + minLag
                peaks += Candidate(lagToBpm(lag, hopSeconds), v, lag)
            }
        }
        return peaks.sortedByDescending { it.strength }.take(8)
    }

    private fun lagToBpm(lag: Int, hopSeconds: Float): Float = 60f / (lag * hopSeconds)

    /**
     * Resolves half/double-tempo ambiguity.
     *
     * Autocorrelation peaks at the true period AND at every integer
     * multiple of it, so 160 BPM material also peaks hard at 80. The
     * strongest peak is therefore not automatically the right answer.
     *
     * Strategy: for each candidate, add supporting evidence from its
     * own harmonics (half, double), then prefer the result that lands
     * in the range most music actually occupies. Confidence is reduced
     * when a competing octave is nearly as strong, because that is
     * exactly the case where we might be wrong.
     */
    private fun resolveOctaves(
        candidates: List<Candidate>,
        correlation: FloatArray,
        minLag: Int,
        hopSeconds: Float,
    ): Tempo {
        var best: Candidate? = null
        var bestScore = 0f

        for (candidate in candidates) {
            var score = candidate.strength

            // Harmonic support: a true tempo usually also shows energy
            // at double the period (half the BPM).
            score += 0.5f * strengthAt(candidate.lag * 2, correlation, minLag)
            score += 0.3f * strengthAt(candidate.lag / 2, correlation, minLag)

            // Mild prior toward 70-180 BPM, where the overwhelming
            // majority of recorded music sits. Applied as a gentle
            // multiplier, never as a hard filter.
            score *= perceptualWeight(candidate.bpm)

            if (score > bestScore) {
                bestScore = score
                best = candidate
            }
        }

        val winner = best ?: return Tempo(null, 0f)

        // Confidence starts from the peak's own normalised strength,
        // then is penalised if an octave rival is nearly as strong.
        var confidence = winner.strength

        val rivalLags = intArrayOf(winner.lag * 2, winner.lag / 2)
        for (rival in rivalLags) {
            val rivalStrength = strengthAt(rival, correlation, minLag)
            if (rivalStrength > winner.strength * 0.85f) {
                confidence *= 0.7f
            }
        }

        // A single dominant peak in a noisy field is more trustworthy
        // than several peaks of similar height.
        val runnerUp = candidates.firstOrNull { abs(it.lag - winner.lag) > 2 }
        if (runnerUp != null && runnerUp.strength > winner.strength * 0.9f) {
            confidence *= 0.85f
        }

        return Tempo(winner.bpm, confidence.coerceIn(0f, 1f))
    }

    private fun strengthAt(lag: Int, correlation: FloatArray, minLag: Int): Float {
        val index = lag - minLag
        if (index < 0 || index >= correlation.size) return 0f
        return correlation[index]
    }

    /** Gentle preference for tempi in the common musical range. */
    private fun perceptualWeight(bpm: Float): Float = when {
        bpm < 60f -> 0.7f
        bpm < 70f -> 0.9f
        bpm <= 180f -> 1.0f
        bpm <= 200f -> 0.9f
        else -> 0.7f
    }
}
