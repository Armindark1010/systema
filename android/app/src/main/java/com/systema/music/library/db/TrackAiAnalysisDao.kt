package com.systema.music.library.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction

/**
 * Persistence for the AI dataset (Phase 28).
 *
 * THE CENTRAL SAFETY PROPERTY
 * ---------------------------
 * There is deliberately NO `@Insert(onConflict = REPLACE)` here.
 *
 * REPLACE would delete the existing row and insert a new one, silently
 * discarding the human label columns whenever a track was re-analysed.
 * Instead [upsertAnalysis] is a hand-written INSERT ... ON CONFLICT DO
 * UPDATE that lists exactly the analysis columns. The label columns are
 * absent from the update list, so re-analysis physically cannot touch
 * them — the guarantee is enforced by SQL, not by remembering to be
 * careful in Kotlin.
 *
 * [updateLabels] is the only statement that writes labels, and it
 * touches nothing else.
 */
@Dao
interface TrackAiAnalysisDao {

    /**
     * Inserts a new dataset row, or refreshes the analysis half of an
     * existing one.
     *
     * On conflict the excluded (incoming) values overwrite the
     * measurements, embedding, processing metadata and status.
     * `createdAt` keeps its original value, and every `label*` column
     * is left exactly as it was.
     */
    @Query(
        """
        INSERT INTO track_ai_analysis (
            id, schemaVersion, trackId, title, artist, album, sourceUri,
            bpm, bpmConfidence, loudnessDbfs, dynamicRangeDb, peak, rms,
            spectralCentroid, spectralBandwidth, spectralRolloff,
            zeroCrossingRate, silenceRatio, sourceDurationSec,
            analysedDurationSec, sourceSampleRate, modelSampleRate,
            windowsProcessed, embeddingVector, embeddingDimension,
            embeddingModel, embeddingModelVersion, normalized,
            preNormalizationL2, analyzerVersion, analysisDurationMs,
            decodeDurationMs, inferenceDurationMs, experimental,
            labelLanguage, labelGenres, labelMoods, labelVocal,
            labelEnergy, labelContexts, labelNotes, labelledAt,
            labelRevision, status, errorCode, errorMessage,
            createdAt, updatedAt, supersededAt, semanticJson
        ) VALUES (
            :id, :schemaVersion, :trackId, :title, :artist, :album, :sourceUri,
            :bpm, :bpmConfidence, :loudnessDbfs, :dynamicRangeDb, :peak, :rms,
            :spectralCentroid, :spectralBandwidth, :spectralRolloff,
            :zeroCrossingRate, :silenceRatio, :sourceDurationSec,
            :analysedDurationSec, :sourceSampleRate, :modelSampleRate,
            :windowsProcessed, :embeddingVector, :embeddingDimension,
            :embeddingModel, :embeddingModelVersion, :normalized,
            :preNormalizationL2, :analyzerVersion, :analysisDurationMs,
            :decodeDurationMs, :inferenceDurationMs, :experimental,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
            0, :status, :errorCode, :errorMessage,
            :now, :now, NULL, :semanticJson
        )
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            sourceUri = excluded.sourceUri,
            bpm = excluded.bpm,
            bpmConfidence = excluded.bpmConfidence,
            loudnessDbfs = excluded.loudnessDbfs,
            dynamicRangeDb = excluded.dynamicRangeDb,
            peak = excluded.peak,
            rms = excluded.rms,
            spectralCentroid = excluded.spectralCentroid,
            spectralBandwidth = excluded.spectralBandwidth,
            spectralRolloff = excluded.spectralRolloff,
            zeroCrossingRate = excluded.zeroCrossingRate,
            silenceRatio = excluded.silenceRatio,
            sourceDurationSec = excluded.sourceDurationSec,
            analysedDurationSec = excluded.analysedDurationSec,
            sourceSampleRate = excluded.sourceSampleRate,
            modelSampleRate = excluded.modelSampleRate,
            windowsProcessed = excluded.windowsProcessed,
            embeddingVector = excluded.embeddingVector,
            embeddingDimension = excluded.embeddingDimension,
            embeddingModel = excluded.embeddingModel,
            embeddingModelVersion = excluded.embeddingModelVersion,
            normalized = excluded.normalized,
            preNormalizationL2 = excluded.preNormalizationL2,
            analysisDurationMs = excluded.analysisDurationMs,
            decodeDurationMs = excluded.decodeDurationMs,
            inferenceDurationMs = excluded.inferenceDurationMs,
            status = excluded.status,
            errorCode = excluded.errorCode,
            errorMessage = excluded.errorMessage,
            updatedAt = excluded.updatedAt,
            supersededAt = NULL,
            -- Model predictions are analysis data, so a re-analysis
            -- replaces them. The label columns are deliberately absent
            -- from this entire SET clause and stay untouched.
            semanticJson = excluded.semanticJson
        """,
    )
    @Suppress("LongParameterList")
    suspend fun upsertAnalysis(
        id: String,
        schemaVersion: Int,
        semanticJson: String?,
        trackId: String,
        title: String?,
        artist: String?,
        album: String?,
        sourceUri: String?,
        bpm: Float?,
        bpmConfidence: Float?,
        loudnessDbfs: Float?,
        dynamicRangeDb: Float?,
        peak: Float?,
        rms: Float?,
        spectralCentroid: Float?,
        spectralBandwidth: Float?,
        spectralRolloff: Float?,
        zeroCrossingRate: Float?,
        silenceRatio: Float?,
        sourceDurationSec: Double?,
        analysedDurationSec: Double?,
        sourceSampleRate: Int?,
        modelSampleRate: Int?,
        windowsProcessed: Int?,
        embeddingVector: String?,
        embeddingDimension: Int?,
        embeddingModel: String?,
        embeddingModelVersion: String?,
        normalized: Boolean?,
        preNormalizationL2: Float?,
        analyzerVersion: Int,
        analysisDurationMs: Long?,
        decodeDurationMs: Long?,
        inferenceDurationMs: Long?,
        experimental: Boolean,
        status: String,
        errorCode: String?,
        errorMessage: String?,
        now: Long,
    )

    /**
     * The ONLY statement that writes ground truth.
     *
     * Touches no measurement, no embedding and no status column, so a
     * labeling save can never corrupt collected data.
     */
    @Query(
        """
        UPDATE track_ai_analysis SET
            labelLanguage = :language,
            labelGenres = :genres,
            labelMoods = :moods,
            labelVocal = :vocal,
            labelEnergy = :energy,
            labelContexts = :contexts,
            labelNotes = :notes,
            labelledAt = :labelledAt,
            labelRevision = :revision,
            updatedAt = :now
        WHERE id = :id
        """,
    )
    @Suppress("LongParameterList")
    suspend fun updateLabels(
        id: String,
        language: String?,
        genres: String?,
        moods: String?,
        vocal: String?,
        energy: String?,
        contexts: String?,
        notes: String?,
        labelledAt: Long?,
        revision: Int,
        now: Long,
    )

    @Query("SELECT * FROM track_ai_analysis WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): TrackAiAnalysisEntity?

    @Query("SELECT * FROM track_ai_analysis WHERE trackId = :trackId ORDER BY updatedAt DESC")
    suspend fun getByTrackId(trackId: String): List<TrackAiAnalysisEntity>

    /** Retires older model builds without destroying their data. */
    @Query(
        "UPDATE track_ai_analysis SET supersededAt = :now " +
            "WHERE trackId = :trackId AND id != :keepId AND supersededAt IS NULL",
    )
    suspend fun supersedeOthers(trackId: String, keepId: String, now: Long)

    /**
     * Writes an analysis and retires superseded siblings atomically.
     *
     * Without the transaction a crash between the two statements would
     * leave two rows both claiming to be current for one track.
     */
    @Transaction
    @Suppress("LongParameterList")
    suspend fun upsertAndSupersede(
        entity: TrackAiAnalysisEntity,
        now: Long,
    ) {
        upsertAnalysis(
            id = entity.id,
            schemaVersion = entity.schemaVersion,
            semanticJson = entity.semanticJson,
            trackId = entity.trackId,
            title = entity.title,
            artist = entity.artist,
            album = entity.album,
            sourceUri = entity.sourceUri,
            bpm = entity.bpm,
            bpmConfidence = entity.bpmConfidence,
            loudnessDbfs = entity.loudnessDbfs,
            dynamicRangeDb = entity.dynamicRangeDb,
            peak = entity.peak,
            rms = entity.rms,
            spectralCentroid = entity.spectralCentroid,
            spectralBandwidth = entity.spectralBandwidth,
            spectralRolloff = entity.spectralRolloff,
            zeroCrossingRate = entity.zeroCrossingRate,
            silenceRatio = entity.silenceRatio,
            sourceDurationSec = entity.sourceDurationSec,
            analysedDurationSec = entity.analysedDurationSec,
            sourceSampleRate = entity.sourceSampleRate,
            modelSampleRate = entity.modelSampleRate,
            windowsProcessed = entity.windowsProcessed,
            embeddingVector = entity.embeddingVector,
            embeddingDimension = entity.embeddingDimension,
            embeddingModel = entity.embeddingModel,
            embeddingModelVersion = entity.embeddingModelVersion,
            normalized = entity.normalized,
            preNormalizationL2 = entity.preNormalizationL2,
            analyzerVersion = entity.analyzerVersion,
            analysisDurationMs = entity.analysisDurationMs,
            decodeDurationMs = entity.decodeDurationMs,
            inferenceDurationMs = entity.inferenceDurationMs,
            experimental = entity.experimental,
            status = entity.status,
            errorCode = entity.errorCode,
            errorMessage = entity.errorMessage,
            now = now,
        )
        supersedeOthers(entity.trackId, entity.id, now)
    }

    // ---- Dataset page queries -------------------------------------

    @Query("SELECT * FROM track_ai_analysis ORDER BY updatedAt DESC")
    suspend fun getAll(): List<TrackAiAnalysisEntity>

    @Query("SELECT COUNT(*) FROM track_ai_analysis")
    suspend fun count(): Int

    @Query("SELECT COUNT(*) FROM track_ai_analysis WHERE labelRevision > 0")
    suspend fun countLabelled(): Int

    @Query("SELECT COUNT(*) FROM track_ai_analysis WHERE status = :status")
    suspend fun countByStatus(status: String): Int

    @Query("SELECT COUNT(*) FROM track_ai_analysis WHERE embeddingVector IS NOT NULL")
    suspend fun countWithEmbedding(): Int

    @Query("DELETE FROM track_ai_analysis WHERE id = :id")
    suspend fun deleteById(id: String): Int

    @Query("DELETE FROM track_ai_analysis")
    suspend fun clear()
}
