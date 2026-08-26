package com.systema.music.analysis

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkQuery
import com.systema.music.analysis.db.MusicAnalysisDatabase
import com.systema.music.analysis.db.TrackAnalysisDao
import com.systema.music.analysis.db.TrackAnalysisEntity
import com.systema.music.analysis.db.fromResult
import com.systema.music.analysis.worker.AudioAnalysisWorker
import com.systema.music.library.MusicLibraryRepository
import com.systema.music.library.model.MusicTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Repository for audio analysis operations.
 * 
 * This class is the single entry point for all audio analysis functionality.
 * It coordinates between:
 * - The AudioAnalyzer (DSP computation)
 * - The MusicAnalysisDatabase (Room persistence)
 * - WorkManager (background processing)
 * - The MusicLibraryRepository (track metadata)
 * 
 * The repository provides:
 * - Analysis scheduling and status tracking
 * - Result caching and retrieval
 * - Version management
 * - Error handling
 * 
 * Thread safety: This class is thread-safe. All methods can be called
 * from any thread, and internal operations are dispatched appropriately.
 */
class AudioAnalysisRepository private constructor(
    private val context: Context,
    private val analysisDao: TrackAnalysisDao,
    private val workManager: WorkManager,
    private val libraryRepository: MusicLibraryRepository,
) {
    
    companion object {
        private const val TAG = "AudioAnalysisRepo"
        
        /**
         * Current analyzer version.
         * Increment this when DSP algorithms change.
         */
        const val CURRENT_ANALYZER_VERSION = 1
        
        /**
         * Work name prefix for analysis workers.
         */
        private const val WORK_NAME_PREFIX = "audio_analysis_"
        
        /**
         * Maximum number of concurrent analysis workers.
         */
        private const val MAX_CONCURRENT_WORKERS = 2
        
        @Volatile
        private var instance: AudioAnalysisRepository? = null
        
        fun get(context: Context): AudioAnalysisRepository {
            return instance ?: synchronized(this) {
                instance ?: run {
                    val app = context.applicationContext
                    AudioAnalysisRepository(
                        context = app,
                        analysisDao = MusicAnalysisDatabase.get(app).trackAnalysisDao(),
                        workManager = WorkManager.getInstance(app),
                        libraryRepository = MusicLibraryRepository.get(app),
                    ).also { instance = it }
                }
            }
        }
    }
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    // State for tracking analysis progress
    private val _analysisState = MutableStateFlow<AnalysisState>(AnalysisState.Idle)
    val analysisState: StateFlow<AnalysisState> = _analysisState.asStateFlow()
    
    /**
     * Analyze a single track.
     * 
     * This method:
     * - Checks if analysis already exists for the current version
     * - Schedules a worker if needed
     * - Returns immediately (analysis happens in background)
     * 
     * @param trackId ID of the track to analyze
     * @return true if analysis was scheduled, false if already exists
     */
    suspend fun analyzeTrack(trackId: String): Boolean {
        return withContext(Dispatchers.IO) {
            // Check if we already have analysis for this track and version
            val existing = analysisDao.getBySongAndVersion(trackId, CURRENT_ANALYZER_VERSION)
            if (existing != null) {
                Log.d(TAG, "Analysis already exists for $trackId v$CURRENT_ANALYZER_VERSION")
                return@withContext false
            }
            
            // Get track URI from library
            val track = libraryRepository.getTrack(trackId)
            if (track == null) {
                Log.w(TAG, "Track not found: $trackId")
                return@withContext false
            }
            
            // Schedule analysis worker
            scheduleAnalysis(track)
            return@withContext true
        }
    }
    
    /**
     * Analyze multiple tracks.
     * 
     * @param trackIds IDs of tracks to analyze
     * @return Number of tracks scheduled for analysis
     */
    suspend fun analyzeTracks(trackIds: List<String>): Int {
        var scheduled = 0
        
        for (trackId in trackIds) {
            if (analyzeTrack(trackId)) {
                scheduled++
            }
        }
        
        return scheduled
    }
    
    /**
     * Get analysis result for a track.
     * 
     * @param trackId ID of the track
     * @return Analysis result, or null if not analyzed yet
     */
    suspend fun getAnalysis(trackId: String): AudioAnalysisResult? {
        return withContext(Dispatchers.IO) {
            val entity = analysisDao.getBySongAndVersion(trackId, CURRENT_ANALYZER_VERSION)
            entity?.toResult()
        }
    }
    
    /**
     * Get analysis status for a track.
     * 
     * @param trackId ID of the track
     * @return Analysis status
     */
    suspend fun getAnalysisStatus(trackId: String): AnalysisStatus {
        return withContext(Dispatchers.IO) {
            val entity = analysisDao.getBySongAndVersion(trackId, CURRENT_ANALYZER_VERSION)
            
            if (entity != null) {
                if (entity.errorCode != null) {
                    AnalysisStatus.Failed(entity.errorCode, entity.errorMessage)
                } else {
                    AnalysisStatus.Complete
                }
            } else {
                // Check if worker is running for this track
                val workInfo = workManager.getWorkInfos(
                    WorkQuery.fromStates(
                        WorkInfo.State.RUNNING,
                        WorkInfo.State.ENQUEUED
                    )
                ).get()
                
                val isRunning = workInfo.any { 
                    it.tags.contains(WORK_NAME_PREFIX + trackId) 
                }
                
                if (isRunning) {
                    AnalysisStatus.InProgress
                } else {
                    AnalysisStatus.Pending
                }
            }
        }
    }
    
    /**
     * Cancel analysis for a track.
     * 
     * @param trackId ID of the track
     */
    fun cancelAnalysis(trackId: String) {
        scope.launch {
            val workName = WORK_NAME_PREFIX + trackId
            workManager.cancelAllWorkByTag(workName)
            Log.d(TAG, "Cancelled analysis for $trackId")
        }
    }
    
    /**
     * Cancel all pending analysis.
     */
    fun cancelAllAnalysis() {
        scope.launch {
            workManager.cancelAllWorkByTag(WORK_NAME_PREFIX)
            Log.d(TAG, "Cancelled all analysis workers")
        }
    }
    
    /**
     * Get tracks that need analysis.
     * 
     * @return List of track IDs that need analysis
     */
    suspend fun getTracksNeedingAnalysis(): List<String> {
        return withContext(Dispatchers.IO) {
            val keys = analysisDao.getTracksNeedingAnalysis(CURRENT_ANALYZER_VERSION)
            keys.map { it.songId }
        }
    }
    
    /**
     * Check if a track needs re-analysis.
     * 
     * A track needs re-analysis if:
     * - It has no analysis for the current version
     * - Its analysis failed
     * 
     * @param trackId ID of the track
     * @return true if re-analysis is needed
     */
    suspend fun needsReanalysis(trackId: String): Boolean {
        return withContext(Dispatchers.IO) {
            val entity = analysisDao.getBySongAndVersion(trackId, CURRENT_ANALYZER_VERSION)
            entity == null || entity.errorCode != null
        }
    }
    
    /**
     * Delete analysis for a track.
     * 
     * @param trackId ID of the track
     */
    suspend fun deleteAnalysis(trackId: String) {
        withContext(Dispatchers.IO) {
            analysisDao.deleteBySongIds(listOf(trackId))
        }
    }
    
    /**
     * Delete all analysis results.
     */
    suspend fun deleteAllAnalysis() {
        withContext(Dispatchers.IO) {
            analysisDao.deleteAll()
        }
    }
    
    /**
     * Get analysis statistics.
     */
    suspend fun getStatistics(): AnalysisStatistics {
        return withContext(Dispatchers.IO) {
            val totalTracks = try {
                libraryRepository.count()
            } catch (e: Exception) {
                0
            }
            
            val analyzedCount = analysisDao.countByVersion(CURRENT_ANALYZER_VERSION)
            val failedCount = analysisDao.getFailedAnalyses().size
            
            AnalysisStatistics(
                totalTracks = totalTracks,
                analyzedCount = analyzedCount,
                failedCount = failedCount,
                pendingCount = totalTracks - analyzedCount - failedCount,
            )
        }
    }
    
    /**
     * Schedule analysis for a track.
     */
    private fun scheduleAnalysis(track: MusicTrack) {
        val workName = WORK_NAME_PREFIX + track.id
        
        // Create input data
        val inputData = Data.Builder()
            .putString(AudioAnalysisWorker.KEY_TRACK_ID, track.id)
            .putString(AudioAnalysisWorker.KEY_URI, track.uri)
            .putInt(AudioAnalysisWorker.KEY_ANALYZER_VERSION, CURRENT_ANALYZER_VERSION)
            .build()
        
        // Create constraints
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .build()
        
        // Create work request
        val request = OneTimeWorkRequestBuilder<AudioAnalysisWorker>()
            .setInputData(inputData)
            .setConstraints(constraints)
            .addTag(workName)
            .addTag(WORK_NAME_PREFIX)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()
        
        // Enqueue work
        workManager.enqueueUniqueWork(
            workName,
            ExistingWorkPolicy.KEEP,
            request
        )
        
        Log.d(TAG, "Scheduled analysis for ${track.id}")
    }
    
    // Convert entity to result
    private fun TrackAnalysisEntity.toResult(): AudioAnalysisResult {
        return AudioAnalysisResult(
            songId = songId,
            durationMs = durationMs,
            sampleRate = sampleRate,
            channels = channels,
            analyzedSampleCount = analyzedSampleCount,
            rms = rms,
            peak = peak,
            dynamicRangeDb = dynamicRangeDb,
            silenceRatio = silenceRatio,
            spectralCentroid = spectralCentroid,
            spectralBandwidth = spectralBandwidth,
            spectralRolloff = spectralRolloff,
            zeroCrossingRate = zeroCrossingRate,
            bpm = bpm,
            bpmConfidence = bpmConfidence,
            loudnessDb = loudnessDb,
            decodeTimeMs = decodeTimeMs,
            dspTimeMs = dspTimeMs,
            totalAnalysisTimeMs = totalAnalysisTimeMs,
            realTimeFactor = realTimeFactor,
            analyzerVersion = analyzerVersion,
            analyzedAt = analyzedAt,
            errorCode = errorCode,
            errorMessage = errorMessage,
        )
    }
}

/**
 * State of the analysis system.
 */
sealed class AnalysisState {
    object Idle : AnalysisState()
    data class Analyzing(val trackId: String, val progress: Float) : AnalysisState()
    data class Error(val code: String, val message: String) : AnalysisState()
}

/**
 * Status of analysis for a specific track.
 */
sealed class AnalysisStatus {
    object Pending : AnalysisStatus()
    object InProgress : AnalysisStatus()
    object Complete : AnalysisStatus()
    data class Failed(val errorCode: String, val errorMessage: String?) : AnalysisStatus()
}

/**
 * Statistics about analysis coverage.
 */
data class AnalysisStatistics(
    val totalTracks: Int,
    val analyzedCount: Int,
    val failedCount: Int,
    val pendingCount: Int,
)
