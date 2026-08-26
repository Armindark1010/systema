package com.systema.music.analysis

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import com.systema.music.analysis.decode.PcmDecoder
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.dsp.WindowedAnalyzer
import com.systema.music.analysis.model.AudioAnalysisResult

/**
 * Joins the decoder to the DSP and produces one [AudioAnalysisResult].
 *
 * Deliberately has no knowledge of Room, WorkManager or Capacitor —
 * those are wired around it. It also has no knowledge of the player:
 * analysis reads the file through its own decoder and never touches
 * ExoPlayer, the queue, the MediaSession or audio focus.
 *
 * Threading: [analyze] blocks and must be called from a background
 * dispatcher. It polls [shouldCancel] between decoder buffers so a
 * cancelled job stops in milliseconds rather than finishing the track.
 */
class AudioAnalyzer(
    private val context: Context,
    private val config: AudioAnalysisConfig = AudioAnalysisConfig(),
) {

    private companion object {
        const val TAG = "SystemaAudioAnalyzer"
    }

    /**
     * Analyses the audio at [uri].
     *
     * @throws AudioAnalysisException with a structured code for every
     *   anticipated failure. Callers are expected to record the code
     *   and move on — analysis failing must never affect playback.
     */
    fun analyze(
        trackId: String,
        uri: Uri,
        shouldCancel: () -> Boolean = { false },
    ): AudioAnalysisResult {
        val startedAt = SystemClock.elapsedRealtime()

        val analyzer = WindowedAnalyzer(config)
        val decoder = PcmDecoder(context, config)

        // Decode and DSP are interleaved (the sink runs inside the
        // decode loop), so they are timed by accumulation rather than
        // by wall-clock segments.
        var dspNanos = 0L

        val sink = PcmDecoder.PcmSink { samples, count ->
            val t0 = System.nanoTime()
            analyzer.feed(samples, count)
            dspNanos += System.nanoTime() - t0
        }

        val sourceInfo = try {
            decoder.decode(uri, sink, shouldCancel)
        } catch (e: AudioAnalysisException) {
            throw e
        } catch (e: OutOfMemoryError) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.OUT_OF_MEMORY,
                "Ran out of memory while analysing this track.",
            )
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.DECODER_ERROR,
                "Could not decode this track.",
                e,
            )
        }

        try {
            val t0 = System.nanoTime()
            analyzer.finish()
            dspNanos += System.nanoTime() - t0
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.DSP_ERROR,
                "Signal analysis failed for this track.",
                e,
            )
        }

        val aggregator = analyzer.aggregator

        if (aggregator.frames == 0) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.EMPTY_AUDIO,
                "The track contained no analysable audio.",
            )
        }

        val tempo = try {
            aggregator.estimateTempo()
        } catch (e: Exception) {
            // A tempo failure is not an analysis failure: every other
            // feature is still valid and worth storing.
            Log.w(TAG, "Tempo estimation failed for $trackId", e)
            com.systema.music.analysis.dsp.TempoEstimator.Tempo(null, 0f)
        }

        val totalMs = SystemClock.elapsedRealtime() - startedAt
        val dspMs = dspNanos / 1_000_000
        // Decode time is the remainder: total minus the time actually
        // spent inside the DSP sink.
        val decodeMs: Long = (totalMs - dspMs).coerceAtLeast(0L)

        val durationMs = if (sourceInfo.durationUs > 0) {
            sourceInfo.durationUs / 1000
        } else {
            // No container duration: derive it from what we analysed.
            analyzer.analyzedSampleCount * 1000 / config.targetSampleRate
        }

        return AudioAnalysisResult(
            trackId = trackId,
            durationMs = durationMs,
            sampleRate = config.targetSampleRate,
            channels = sourceInfo.channels,
            analyzedSampleCount = analyzer.analyzedSampleCount,
            rms = aggregator.meanRms(),
            peak = aggregator.peak(),
            dynamicRangeDb = aggregator.dynamicRangeDb(),
            silenceRatio = aggregator.silenceRatio(),
            spectralCentroid = aggregator.meanCentroid(),
            spectralCentroidMin = aggregator.minCentroid(),
            spectralCentroidMax = aggregator.maxCentroid(),
            spectralBandwidth = aggregator.meanBandwidth(),
            spectralRolloff = aggregator.meanRolloff(),
            zeroCrossingRate = aggregator.meanZcr(),
            bpm = tempo.bpm,
            bpmConfidence = tempo.confidence,
            loudnessDbfs = aggregator.loudnessDbfs(),
            analyzerVersion = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION,
            analyzedAt = System.currentTimeMillis(),
            decodeTimeMs = decodeMs,
            dspTimeMs = dspMs,
            totalAnalysisTimeMs = totalMs,
        )
    }
}
