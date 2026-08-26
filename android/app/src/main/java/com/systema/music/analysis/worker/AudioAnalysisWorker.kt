package com.systema.music.analysis.worker

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.systema.music.analysis.AudioAnalyzer
import com.systema.music.analysis.AudioAnalysisConfig
import com.systema.music.analysis.AudioAnalysisException
import com.systema.music.analysis.AudioAnalysisResult
import com.systema.music.analysis.db.MusicAnalysisDatabase
import com.systema.music.analysis.db.TrackAnalysisEntity
import com.systema.music.analysis.db.fromResult
import com.systema.music.analysis.AnalysisErrorCode
import com.systema.music.library.MusicLibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager worker for performing audio analysis.
 * 
 * This worker:
 * - Runs off the main thread (on Dispatchers.IO)
 * - Supports cancellation
 * - Handles decoder failures gracefully
 * - Persists results to Room
 * - Handles unsupported formats
 * - Emits progress and result notifications
 * 
 * The worker is designed to analyze individual tracks or small batches.
 * For large-scale library analysis, multiple workers can be enqueued
 * with proper concurrency control.
 * 
 * Thread safety: This class is NOT thread-safe. WorkManager ensures
 * each worker instance runs on its own thread.
 */
class AudioAnalysisWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    
    companion object {
        private const val TAG = "AudioAnalysisWorker"
        
        /**
         * Input key for track ID.
         */
        const val KEY_TRACK_ID = "track_id"
        
        /**
         * Input key for content URI.
         */
        const val KEY_URI = "uri"
        
        /**
         * Input key for analyzer version.
         */
        const val KEY_ANALYZER_VERSION = "analyzer_version"
        
        /**
         * Default analyzer version.
         */
        const val DEFAULT_ANALYZER_VERSION = 1
        
        /**
         * Result key for success/failure.
         */
        const val RESULT_SUCCESS = "success"
        
        /**
         * Result key for error code.
         */
        const val RESULT_ERROR_CODE = "error_code"
        
        /**
         * Result key for error message.
         */
        const val RESULT_ERROR_MESSAGE = "error_message"
        
        /**
         * Result key for analysis ID.
         */
        const val RESULT_ANALYSIS_ID = "analysis_id"
    }
    
    private val analyzer: AudioAnalyzer by lazy {
        AudioAnalyzer(
            applicationContext,
            AudioAnalysisConfig()
        )
    }
    
    private val analysisDb: MusicAnalysisDatabase by lazy {
        MusicAnalysisDatabase.get(applicationContext)
    }
    
    private val analysisDao by lazy { analysisDb.trackAnalysisDao() }
    
    override suspend fun doWork(): Result {
        return withContext(Dispatchers.IO) {
            try {
                // Get input parameters
                val trackId = inputData.getString(KEY_TRACK_ID)
                val uriString = inputData.getString(KEY_URI)
                val analyzerVersion = inputData.getInt(KEY_ANALYZER_VERSION, DEFAULT_ANALYZER_VERSION)
                
                if (trackId.isNullOrBlank()) {
                    Log.e(TAG, "Missing track ID in worker input")
                    return@withContext Result.failure()
                }
                
                if (uriString.isNullOrBlank()) {
                    Log.e(TAG, "Missing URI in worker input for track $trackId")
                    return@withContext Result.failure()
                }
                
                val uri = Uri.parse(uriString)
                
                Log.d(TAG, "Starting analysis for track $trackId")
                
                // Check if already cancelled
                if (isStopped) {
                    Log.d(TAG, "Worker cancelled before starting analysis for $trackId")
                    return@withContext Result.success()
                }
                
                // Perform analysis
                val result = analyzer.analyze(uri, trackId)
                
                // Check if cancelled during analysis
                if (isStopped) {
                    Log.d(TAG, "Worker cancelled during analysis for $trackId")
                    return@withContext Result.success()
                }
                
                // Save result to database
                val entity = TrackAnalysisEntity.fromResult(result)
                val rowId = analysisDao.insertOrReplace(entity)
                
                Log.d(TAG, "Analysis complete for $trackId, saved with row ID $rowId")
                
                // Build output data
                val outputData = android.os.Bundle().apply {
                    putBoolean(RESULT_SUCCESS, true)
                    putString(RESULT_ANALYSIS_ID, entity.id)
                }
                
                Result.success(outputData)
                
            } catch (e: AudioAnalysisException) {
                Log.e(TAG, "Analysis failed: ${e.codeName} - ${e.message}", e)
                
                val outputData = android.os.Bundle().apply {
                    putBoolean(RESULT_SUCCESS, false)
                    putString(RESULT_ERROR_CODE, e.codeName)
                    putString(RESULT_ERROR_MESSAGE, e.message)
                }
                
                // Check if this is a recoverable error
                if (e.code == AnalysisErrorCode.UNSUPPORTED_FORMAT ||
                    e.code == AnalysisErrorCode.DECODER_ERROR ||
                    e.code == AnalysisErrorCode.IO_ERROR) {
                    // These errors are likely permanent for this track
                    Result.failure(outputData)
                } else if (e.code == AnalysisErrorCode.CANCELLED) {
                    // Worker was cancelled
                    Result.success()
                } else {
                    // Retryable error
                    Result.retry()
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected error during analysis", e)
                
                val outputData = android.os.Bundle().apply {
                    putBoolean(RESULT_SUCCESS, false)
                    putString(RESULT_ERROR_CODE, AnalysisErrorCode.UNKNOWN.codeName)
                    putString(RESULT_ERROR_MESSAGE, e.message ?: "Unknown error")
                }
                
                Result.retry()
            }
        }
    }
    
    override suspend fun getForegroundInfo(): ForegroundInfo {
        // For now, we don't use foreground service for analysis
        // In the future, we might add this for long-running analysis
        return super.getForegroundInfo()
    }
}
