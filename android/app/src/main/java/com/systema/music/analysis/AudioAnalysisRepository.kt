package com.systema.music.analysis

import android.content.Context
import android.net.Uri
import android.util.Log
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import com.systema.music.analysis.model.AudioAnalysisResult
import com.systema.music.library.db.AnalysisStatus
import com.systema.music.library.db.AudioAnalysisDao
import com.systema.music.library.db.AudioAnalysisEntity
import com.systema.music.library.db.MusicLibraryDatabase
import com.systema.music.library.db.TrackDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Coordinates analysis: resolve the track, decode+analyse it, store
 * the result, and answer questions about what has been analysed.
 *
 * Mirrors the structure of MusicLibraryRepository (process singleton,
 * IO-confined, structured exceptions) so the analysis subsystem reads
 * like the rest of the codebase rather than a bolt-on.
 */
class AudioAnalysisRepository private constructor(
    private val context: Context,
    private val analysisDao: AudioAnalysisDao,
    private val trackDao: TrackDao,
    private val config: AudioAnalysisConfig,
) {

    companion object {
        private const val TAG = "SystemaAnalysisRepo"

        /**
         * Failures beyond this count are not retried automatically.
         * A file that has failed to decode three times is not going to
         * start working, and retrying it burns battery for nothing.
         */
        const val MAX_ATTEMPTS = 3

        @Volatile
        private var instance: AudioAnalysisRepository? = null

        fun get(context: Context): AudioAnalysisRepository {
            return instance ?: synchronized(this) {
                instance ?: build(context.applicationContext).also { instance = it }
            }
        }

        private fun build(context: Context): AudioAnalysisRepository {
            val db = MusicLibraryDatabase.get(context)
            return AudioAnalysisRepository(
                context = context,
                analysisDao = db.audioAnalysisDao(),
                trackDao = db.trackDao(),
                config = AudioAnalysisConfig(),
            )
        }
    }

    private val analyzer by lazy { AudioAnalyzer(context, config) }

    /**
     * Analyses one track and stores the result.
     *
     * @param force re-analyse even when a current-version result exists.
     * @return the stored result.
     */
    suspend fun analyzeTrack(
        trackId: String,
        force: Boolean = false,
        shouldCancel: () -> Boolean = { false },
    ): AudioAnalysisResult = withContext(Dispatchers.IO) {
        val existing = readAnalysis(trackId)

        // Skip work that has already been done at this DSP version.
        if (!force
            && existing != null
            && existing.status == AnalysisStatus.COMPLETED
            && existing.analyzerVersion == AudioAnalysisConfig.AUDIO_ANALYZER_VERSION
        ) {
            return@withContext existing.toResult()
        }

        val track = try {
            trackDao.findById(trackId)
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.DATABASE_ERROR,
                "The track could not be read from the library index.",
                e,
            )
        } ?: throw AudioAnalysisException(
            AudioAnalysisException.Code.NOT_FOUND,
            "No such track in the library.",
        )

        val uri = try {
            Uri.parse(track.uri)
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.INVALID_URI,
                "The track has an unreadable location.",
                e,
            )
        }

        val result = try {
            analyzer.analyze(trackId, uri, shouldCancel)
        } catch (e: AudioAnalysisException) {
            // Cancellation is not a track defect, so it must not count
            // against the retry budget or mark the file as broken.
            if (e.code != AudioAnalysisException.Code.CANCELLED) {
                recordFailure(trackId, e, existing)
            }
            throw e
        }

        try {
            analysisDao.upsert(result.toEntity())
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.DATABASE_ERROR,
                "The analysis could not be saved.",
                e,
            )
        }

        result
    }

    suspend fun getAnalysis(trackId: String): AudioAnalysisResult? = withContext(Dispatchers.IO) {
        readAnalysis(trackId)
            ?.takeIf { it.status == AnalysisStatus.COMPLETED }
            ?.toResult()
    }

    /** Status without the full payload: cheap enough to poll. */
    suspend fun getStatus(trackId: String): AnalysisStatusReport = withContext(Dispatchers.IO) {
        val row = readAnalysis(trackId)
        val current = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION

        when {
            row == null -> AnalysisStatusReport(
                trackId = trackId,
                status = AnalysisStatus.PENDING,
                analyzerVersion = null,
                needsAnalysis = true,
                errorCode = null,
                attemptCount = 0,
            )

            row.status == AnalysisStatus.COMPLETED && row.analyzerVersion < current ->
                AnalysisStatusReport(
                    trackId = trackId,
                    status = AnalysisStatus.PENDING,
                    analyzerVersion = row.analyzerVersion,
                    // Stale: analysed by an older DSP pipeline.
                    needsAnalysis = true,
                    errorCode = null,
                    attemptCount = row.attemptCount,
                )

            else -> AnalysisStatusReport(
                trackId = trackId,
                status = row.status,
                analyzerVersion = row.analyzerVersion,
                needsAnalysis = row.status != AnalysisStatus.COMPLETED
                    && row.attemptCount < MAX_ATTEMPTS,
                errorCode = row.errorCode,
                attemptCount = row.attemptCount,
            )
        }
    }

    /** Ids that have no current-version analysis, newest tracks first. */
    suspend fun findTracksNeedingAnalysis(limit: Int): List<String> = withContext(Dispatchers.IO) {
        analysisDao.findTracksNeedingAnalysis(
            AudioAnalysisConfig.AUDIO_ANALYZER_VERSION,
            limit.coerceIn(1, 500),
        )
    }

    suspend fun analysisSummary(): AnalysisSummary = withContext(Dispatchers.IO) {
        val version = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION
        AnalysisSummary(
            analyzerVersion = version,
            completed = analysisDao.countCompletedAtVersion(version),
            failed = analysisDao.countByStatus(AnalysisStatus.FAILED),
            pending = analysisDao.countTracksNeedingAnalysis(version),
        )
    }

    suspend fun clear() = withContext(Dispatchers.IO) { analysisDao.clear() }

    // ---- internals -------------------------------------------------

    private suspend fun readAnalysis(trackId: String): AudioAnalysisEntity? = try {
        analysisDao.getByTrackId(trackId)
    } catch (e: Exception) {
        throw AudioAnalysisException(
            AudioAnalysisException.Code.DATABASE_ERROR,
            "The stored analysis could not be read.",
            e,
        )
    }

    /**
     * Records a failure so the worker can stop retrying a file that
     * genuinely cannot be analysed. Never throws: a bookkeeping
     * failure must not mask the original error.
     */
    private suspend fun recordFailure(
        trackId: String,
        error: AudioAnalysisException,
        existing: AudioAnalysisEntity?,
    ) {
        try {
            if (existing == null) {
                analysisDao.upsert(
                    failureRow(trackId, error.codeName, attempt = 1),
                )
            } else {
                analysisDao.markFailure(
                    trackId = trackId,
                    status = AnalysisStatus.FAILED,
                    errorCode = error.codeName,
                    timestamp = System.currentTimeMillis(),
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not record analysis failure for $trackId", e)
        }
    }

    private fun failureRow(trackId: String, errorCode: String, attempt: Int) =
        AudioAnalysisEntity(
            trackId = trackId,
            analyzerVersion = AudioAnalysisConfig.AUDIO_ANALYZER_VERSION,
            status = AnalysisStatus.FAILED,
            analyzedAt = System.currentTimeMillis(),
            durationMs = 0,
            sampleRate = 0,
            channels = 0,
            analyzedSampleCount = 0,
            rms = null,
            peak = null,
            dynamicRangeDb = null,
            silenceRatio = null,
            spectralCentroid = null,
            spectralCentroidMin = null,
            spectralCentroidMax = null,
            spectralBandwidth = null,
            spectralRolloff = null,
            zeroCrossingRate = null,
            bpm = null,
            bpmConfidence = null,
            loudnessDbfs = null,
            decodeTimeMs = null,
            dspTimeMs = null,
            totalAnalysisTimeMs = null,
            errorCode = errorCode,
            attemptCount = attempt,
        )
}

/** Lightweight status answer for the bridge. */
data class AnalysisStatusReport(
    val trackId: String,
    val status: String,
    val analyzerVersion: Int?,
    val needsAnalysis: Boolean,
    val errorCode: String?,
    val attemptCount: Int,
)

/** Library-wide analysis progress. */
data class AnalysisSummary(
    val analyzerVersion: Int,
    val completed: Int,
    val failed: Int,
    val pending: Int,
)

// ---- mapping ---------------------------------------------------

internal fun AudioAnalysisResult.toEntity() = AudioAnalysisEntity(
    trackId = trackId,
    analyzerVersion = analyzerVersion,
    status = AnalysisStatus.COMPLETED,
    analyzedAt = analyzedAt,
    durationMs = durationMs,
    sampleRate = sampleRate,
    channels = channels,
    analyzedSampleCount = analyzedSampleCount,
    rms = rms,
    peak = peak,
    dynamicRangeDb = dynamicRangeDb,
    silenceRatio = silenceRatio,
    spectralCentroid = spectralCentroid,
    spectralCentroidMin = spectralCentroidMin,
    spectralCentroidMax = spectralCentroidMax,
    spectralBandwidth = spectralBandwidth,
    spectralRolloff = spectralRolloff,
    zeroCrossingRate = zeroCrossingRate,
    bpm = bpm,
    bpmConfidence = bpmConfidence,
    loudnessDbfs = loudnessDbfs,
    decodeTimeMs = decodeTimeMs,
    dspTimeMs = dspTimeMs,
    totalAnalysisTimeMs = totalAnalysisTimeMs,
    errorCode = null,
    attemptCount = 0,
)

internal fun AudioAnalysisEntity.toResult() = AudioAnalysisResult(
    trackId = trackId,
    durationMs = durationMs,
    sampleRate = sampleRate,
    channels = channels,
    analyzedSampleCount = analyzedSampleCount,
    rms = rms,
    peak = peak,
    dynamicRangeDb = dynamicRangeDb,
    silenceRatio = silenceRatio,
    spectralCentroid = spectralCentroid,
    spectralCentroidMin = spectralCentroidMin,
    spectralCentroidMax = spectralCentroidMax,
    spectralBandwidth = spectralBandwidth,
    spectralRolloff = spectralRolloff,
    zeroCrossingRate = zeroCrossingRate,
    bpm = bpm,
    bpmConfidence = bpmConfidence,
    loudnessDbfs = loudnessDbfs,
    analyzerVersion = analyzerVersion,
    analyzedAt = analyzedAt,
    decodeTimeMs = decodeTimeMs ?: 0,
    dspTimeMs = dspTimeMs ?: 0,
    totalAnalysisTimeMs = totalAnalysisTimeMs ?: 0,
)
