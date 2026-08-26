package com.systema.music.analysis

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Capacitor plugin for audio analysis.
 * 
 * This plugin exposes the audio analysis functionality to the frontend.
 * It provides a thin bridge that:
 * - Validates input
 * - Converts between JSON and Kotlin types
 * - Forwards calls to AudioAnalysisRepository
 * - Handles errors gracefully
 * 
 * The plugin exposes only what the frontend needs:
 * - analyzeTrack(trackId): Start analysis for a track
 * - getAnalysis(trackId): Get analysis result for a track
 * - getAnalysisStatus(trackId): Get analysis status for a track
 * - getStatistics(): Get overall analysis statistics
 * 
 * Events emitted:
 * - analysisStarted: { trackId }
 * - analysisProgress: { trackId, progress }
 * - analysisCompleted: { trackId, success, errorCode?, errorMessage? }
 */
@CapacitorPlugin(name = "AudioAnalysis")
class AudioAnalysisPlugin : Plugin() {
    
    companion object {
        private const val TAG = "AudioAnalysisPlugin"
        
        private const val EVENT_STARTED = "analysisStarted"
        private const val EVENT_PROGRESS = "analysisProgress"
        private const val EVENT_COMPLETED = "analysisCompleted"
        private const val EVENT_ERROR = "analysisError"
    }
    
    private val repository: AudioAnalysisRepository by lazy {
        AudioAnalysisRepository.get(context)
    }
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
    
    // ---------------------------------------------------------------
    // Analysis
    // ---------------------------------------------------------------
    
    @PluginMethod
    fun analyzeTrack(call: PluginCall) {
        val trackId = call.getString("trackId")
        
        if (trackId.isNullOrBlank()) {
            call.reject("trackId is required.", "INVALID_ARGUMENT")
            return
        }
        
        scope.launch {
            try {
                val scheduled = repository.analyzeTrack(trackId)
                
                if (scheduled) {
                    notifyListeners(EVENT_STARTED, JSObject().put("trackId", trackId))
                    call.resolve(JSObject().put("scheduled", true))
                } else {
                    // Already analyzed or in progress
                    call.resolve(JSObject().put("scheduled", false).put("alreadyExists", true))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error scheduling analysis for $trackId", e)
                call.reject("Failed to schedule analysis: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    @PluginMethod
    fun analyzeTracks(call: PluginCall) {
        val trackIds = call.getArray("trackIds")
        
        if (trackIds == null || trackIds.length() == 0) {
            call.reject("trackIds is required and must not be empty.", "INVALID_ARGUMENT")
            return
        }
        
        val ids = mutableListOf<String>()
        for (i in 0 until trackIds.length()) {
            val id = trackIds.optString(i)
            if (id.isNotBlank()) {
                ids.add(id)
            }
        }
        
        if (ids.isEmpty()) {
            call.reject("No valid track IDs provided.", "INVALID_ARGUMENT")
            return
        }
        
        scope.launch {
            try {
                val scheduled = repository.analyzeTracks(ids)
                call.resolve(JSObject().put("scheduled", scheduled))
            } catch (e: Exception) {
                Log.e(TAG, "Error scheduling analysis for ${ids.size} tracks", e)
                call.reject("Failed to schedule analysis: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    // ---------------------------------------------------------------
    // Query
    // ---------------------------------------------------------------
    
    @PluginMethod
    fun getAnalysis(call: PluginCall) {
        val trackId = call.getString("trackId")
        
        if (trackId.isNullOrBlank()) {
            call.reject("trackId is required.", "INVALID_ARGUMENT")
            return
        }
        
        scope.launch {
            try {
                val result = repository.getAnalysis(trackId)
                
                if (result != null) {
                    call.resolve(JSObject().put("analysis", result.toJs()))
                } else {
                    call.resolve(JSObject().put("analysis", JSONObject.NULL))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error getting analysis for $trackId", e)
                call.reject("Failed to get analysis: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    @PluginMethod
    fun getAnalysisStatus(call: PluginCall) {
        val trackId = call.getString("trackId")
        
        if (trackId.isNullOrBlank()) {
            call.reject("trackId is required.", "INVALID_ARGUMENT")
            return
        }
        
        scope.launch {
            try {
                val status = repository.getAnalysisStatus(trackId)
                call.resolve(JSObject().put("status", status.toJs()))
            } catch (e: Exception) {
                Log.e(TAG, "Error getting status for $trackId", e)
                call.reject("Failed to get status: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    @PluginMethod
    fun getStatistics(call: PluginCall) {
        scope.launch {
            try {
                val stats = repository.getStatistics()
                call.resolve(stats.toJs())
            } catch (e: Exception) {
                Log.e(TAG, "Error getting statistics", e)
                call.reject("Failed to get statistics: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    @PluginMethod
    fun needsReanalysis(call: PluginCall) {
        val trackId = call.getString("trackId")
        
        if (trackId.isNullOrBlank()) {
            call.reject("trackId is required.", "INVALID_ARGUMENT")
            return
        }
        
        scope.launch {
            try {
                val needs = repository.needsReanalysis(trackId)
                call.resolve(JSObject().put("needsReanalysis", needs))
            } catch (e: Exception) {
                Log.e(TAG, "Error checking reanalysis for $trackId", e)
                call.reject("Failed to check reanalysis: ${e.message}", "UNKNOWN")
            }
        }
    }
    
    // ---------------------------------------------------------------
    // Control
    // ---------------------------------------------------------------
    
    @PluginMethod
    fun cancelAnalysis(call: PluginCall) {
        val trackId = call.getString("trackId")
        
        if (trackId.isNullOrBlank()) {
            call.reject("trackId is required.", "INVALID_ARGUMENT")
            return
        }
        
        try {
            repository.cancelAnalysis(trackId)
            call.resolve(JSObject().put("cancelled", true))
        } catch (e: Exception) {
            Log.e(TAG, "Error cancelling analysis for $trackId", e)
            call.reject("Failed to cancel analysis: ${e.message}", "UNKNOWN")
        }
    }
    
    @PluginMethod
    fun cancelAllAnalysis(call: PluginCall) {
        try {
            repository.cancelAllAnalysis()
            call.resolve(JSObject().put("cancelled", true))
        } catch (e: Exception) {
            Log.e(TAG, "Error cancelling all analysis", e)
            call.reject("Failed to cancel all analysis: ${e.message}", "UNKNOWN")
        }
    }
    
    // ---------------------------------------------------------------
    // Serialization
    // ---------------------------------------------------------------
    
    private fun AudioAnalysisResult.toJs(): JSObject {
        return JSObject()
            .put("songId", songId)
            .put("durationMs", durationMs)
            .put("sampleRate", sampleRate)
            .put("channels", channels)
            .put("analyzedSampleCount", analyzedSampleCount)
            .putNullable("rms", rms)
            .putNullable("peak", peak)
            .putNullable("dynamicRangeDb", dynamicRangeDb)
            .putNullable("silenceRatio", silenceRatio)
            .putNullable("spectralCentroid", spectralCentroid)
            .putNullable("spectralBandwidth", spectralBandwidth)
            .putNullable("spectralRolloff", spectralRolloff)
            .putNullable("zeroCrossingRate", zeroCrossingRate)
            .putNullable("bpm", bpm)
            .putNullable("bpmConfidence", bpmConfidence)
            .putNullable("loudnessDb", loudnessDb)
            .put("decodeTimeMs", decodeTimeMs)
            .put("dspTimeMs", dspTimeMs)
            .put("totalAnalysisTimeMs", totalAnalysisTimeMs)
            .put("realTimeFactor", realTimeFactor)
            .put("analyzerVersion", analyzerVersion)
            .put("analyzedAt", analyzedAt)
            .putNullable("errorCode", errorCode)
            .putNullable("errorMessage", errorMessage)
    }
    
    private fun AnalysisStatus.toJs(): JSObject {
        return when (this) {
            AnalysisStatus.Pending -> JSObject().put("state", "pending")
            AnalysisStatus.InProgress -> JSObject().put("state", "in_progress")
            AnalysisStatus.Complete -> JSObject().put("state", "complete")
            is AnalysisStatus.Failed -> JSObject()
                .put("state", "failed")
                .put("errorCode", errorCode)
                .putNullable("errorMessage", errorMessage)
        }
    }
    
    private fun AnalysisStatistics.toJs(): JSObject {
        return JSObject()
            .put("totalTracks", totalTracks)
            .put("analyzedCount", analyzedCount)
            .put("failedCount", failedCount)
            .put("pendingCount", pendingCount)
    }
    
    private fun JSObject.putNullable(key: String, value: Any?): JSObject {
        if (value == null) put(key, JSONObject.NULL) else put(key, value)
        return this
    }
}
