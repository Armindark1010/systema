package com.systema.music.analysis

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.model.AudioAnalysisResult
import com.systema.music.analysis.work.AudioAnalysisScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Minimal bridge to the on-device DSP analyser.
 *
 * Surface is deliberately small: analyse, read, check status, queue a
 * batch. The WebView learns numbers and nothing else — no FFT sizes,
 * no window functions, no decoder details. If the DSP is rewritten in
 * Phase 14, this contract does not move.
 *
 * There is no event stream in this phase because no UI consumes one.
 */
@CapacitorPlugin(name = "AudioAnalysis")
class AudioAnalysisPlugin : Plugin() {

    private companion object {
        const val TAG = "SystemaAnalysisPlugin"
    }

    private val repository: AudioAnalysisRepository by lazy {
        AudioAnalysisRepository.get(context)
    }

    /** Bridge-scoped supervisor; cancelled with the plugin. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /**
     * Analyses one track synchronously with respect to the caller's
     * promise (off the main thread here), resolving with the result.
     *
     * Intended for a single track the user asked about. Bulk work goes
     * through [enqueueBatch] so it is subject to WorkManager's
     * constraints rather than running while the user waits.
     */
    @PluginMethod
    fun analyzeTrack(call: PluginCall) {
        val trackId = call.getString("trackId")
        if (trackId.isNullOrBlank()) {
            call.reject("A trackId is required.", AudioAnalysisException.Code.NOT_FOUND.name)
            return
        }
        val force = call.getBoolean("force", false) ?: false

        scope.launch {
            try {
                val result = repository.analyzeTrack(trackId, force)
                call.resolve(result.toJs())
            } catch (e: AudioAnalysisException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The track could not be analysed.", e)
            }
        }
    }

    /** Returns a stored analysis, or `{ analysis: null }` if there is none. */
    @PluginMethod
    fun getAnalysis(call: PluginCall) {
        val trackId = call.getString("trackId")
        if (trackId.isNullOrBlank()) {
            call.reject("A trackId is required.", AudioAnalysisException.Code.NOT_FOUND.name)
            return
        }

        scope.launch {
            try {
                val result = repository.getAnalysis(trackId)
                call.resolve(
                    JSObject().apply {
                        if (result == null) put("analysis", JSONObject.NULL)
                        else put("analysis", result.toJs())
                    },
                )
            } catch (e: AudioAnalysisException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The analysis could not be read.", e)
            }
        }
    }

    @PluginMethod
    fun getAnalysisStatus(call: PluginCall) {
        val trackId = call.getString("trackId")
        if (trackId.isNullOrBlank()) {
            call.reject("A trackId is required.", AudioAnalysisException.Code.NOT_FOUND.name)
            return
        }

        scope.launch {
            try {
                val status = repository.getStatus(trackId)
                call.resolve(
                    JSObject()
                        .put("trackId", status.trackId)
                        .put("status", status.status)
                        .putNullable("analyzerVersion", status.analyzerVersion)
                        .put("needsAnalysis", status.needsAnalysis)
                        .putNullable("errorCode", status.errorCode)
                        .put("attemptCount", status.attemptCount),
                )
            } catch (e: AudioAnalysisException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The analysis status could not be read.", e)
            }
        }
    }

    /** Library-wide counters plus the current DSP version. */
    @PluginMethod
    fun getAnalysisSummary(call: PluginCall) {
        scope.launch {
            try {
                val summary = repository.analysisSummary()
                call.resolve(
                    JSObject()
                        .put("analyzerVersion", summary.analyzerVersion)
                        .put("completed", summary.completed)
                        .put("failed", summary.failed)
                        .put("pending", summary.pending)
                        .put("busy", AudioAnalysisScheduler.isBusy(context)),
                )
            } catch (e: AudioAnalysisException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The analysis summary could not be read.", e)
            }
        }
    }

    /**
     * Queues a bounded batch through WorkManager. Returns immediately;
     * progress is observed by polling [getAnalysisSummary].
     */
    @PluginMethod
    fun enqueueBatch(call: PluginCall) {
        val batchSize = call.getInt("batchSize") ?: 10
        try {
            AudioAnalysisScheduler.enqueueBatch(context, batchSize)
            call.resolve(JSObject().put("enqueued", true))
        } catch (e: Exception) {
            rejectUnknown(call, "Analysis work could not be scheduled.", e)
        }
    }

    @PluginMethod
    fun cancelAnalysis(call: PluginCall) {
        try {
            AudioAnalysisScheduler.cancelAll(context)
            call.resolve(JSObject().put("cancelled", true))
        } catch (e: Exception) {
            rejectUnknown(call, "Analysis work could not be cancelled.", e)
        }
    }

    // ---------------------------------------------------------------
    // Serialization
    // ---------------------------------------------------------------

    private fun AudioAnalysisResult.toJs(): JSObject = JSObject()
        .put("trackId", trackId)
        .put("durationMs", durationMs)
        .put("sampleRate", sampleRate)
        .put("channels", channels)
        .put("analyzedSampleCount", analyzedSampleCount)
        .putNullable("rms", rms)
        .putNullable("peak", peak)
        .putNullable("dynamicRangeDb", dynamicRangeDb)
        .putNullable("silenceRatio", silenceRatio)
        .putNullable("spectralCentroid", spectralCentroid)
        .putNullable("spectralCentroidMin", spectralCentroidMin)
        .putNullable("spectralCentroidMax", spectralCentroidMax)
        .putNullable("spectralBandwidth", spectralBandwidth)
        .putNullable("spectralRolloff", spectralRolloff)
        .putNullable("zeroCrossingRate", zeroCrossingRate)
        .putNullable("bpm", bpm)
        .putNullable("bpmConfidence", bpmConfidence)
        // Named to match the model: RMS-derived dBFS, NOT LUFS.
        .putNullable("loudnessDbfs", loudnessDbfs)
        .put("analyzerVersion", analyzerVersion)
        .put("analyzedAt", analyzedAt)
        .put("decodeTimeMs", decodeTimeMs)
        .put("dspTimeMs", dspTimeMs)
        .put("totalAnalysisTimeMs", totalAnalysisTimeMs)
        .putNullable("realTimeFactor", realTimeFactor)

    private fun JSObject.putNullable(key: String, value: Any?): JSObject {
        // JSONObject.NULL, not JSObject.NULL — Kotlin does not inherit
        // Java statics through a subclass reference.
        if (value == null) put(key, JSONObject.NULL) else put(key, value)
        return this
    }

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    private fun rejectStructured(call: PluginCall, e: AudioAnalysisException) {
        Log.w(TAG, "${e.codeName}: ${e.message}", e)
        call.reject(e.message, e.codeName)
    }

    /** Never forwards a stack trace or raw exception text to the WebView. */
    private fun rejectUnknown(call: PluginCall, message: String, e: Exception) {
        Log.e(TAG, message, e)
        call.reject(message, AudioAnalysisException.Code.UNKNOWN.name)
    }
}

/** Exposed for the analyzer-version check in TypeScript. */
val CURRENT_ANALYZER_VERSION: Int get() = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION
