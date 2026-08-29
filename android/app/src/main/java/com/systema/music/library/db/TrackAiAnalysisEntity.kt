package com.systema.music.library.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One collected AI-dataset row (Phase 28).
 *
 * WHY THIS IS SEPARATE FROM `song_analysis`
 * -----------------------------------------
 * `song_analysis` holds exactly one current DSP result per track and
 * is owned by the background analyser. This table is a research
 * dataset: it keeps a row per (track, model, modelVersion,
 * analyzerVersion) so an embedding stays paired with the exact build
 * that produced it. Mixing the two would either destroy the DSP
 * worker's one-row-per-track invariant or destroy reproducibility.
 *
 * NO FOREIGN KEY TO `tracks`
 * --------------------------
 * Deliberate, and the opposite choice from AudioAnalysisEntity. A
 * hand-labelled dataset row is expensive to recreate — someone sat and
 * listened to the song. A library rescan that briefly drops a track,
 * or a track whose MediaStore id changes, must not CASCADE away human
 * labels. Orphan rows are acceptable here; lost labels are not.
 * `trackId` is still the join key when the track does exist.
 *
 * GROUND TRUTH IS PHYSICALLY SEPARATE
 * -----------------------------------
 * The label columns are only ever written by the labeling path
 * ([TrackAiAnalysisDao.updateLabels]). The analysis upsert
 * ([TrackAiAnalysisDao.upsertAnalysis]) lists its columns explicitly
 * and does not include them, so a re-analysis cannot overwrite a human
 * judgement even by accident.
 *
 * The embedding is stored as a JSON array of floats in a TEXT column.
 * A BLOB of raw bytes would be smaller, but it would also be opaque to
 * `sqlite3`, tie the file to one float encoding, and make the export
 * path lossy. Dataset legibility beats a few hundred kilobytes.
 */
@Entity(
    tableName = "track_ai_analysis",
    indices = [
        // Drives "all rows for this track" and the Full Player lookup.
        Index(value = ["trackId"]),
        // Drives the dataset page's model/version grouping.
        Index(value = ["embeddingModel", "embeddingModelVersion"]),
        // Drives the labelled/unlabelled split.
        Index(value = ["labelRevision"]),
        Index(value = ["status"]),
        Index(value = ["updatedAt"]),
    ],
)
data class TrackAiAnalysisEntity(
    /** `trackId::model::modelVersion::analyzerVersion`. */
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "schemaVersion")
    val schemaVersion: Int,

    // ---- Track identity ----------------------------------------
    @ColumnInfo(name = "trackId")
    val trackId: String,

    @ColumnInfo(name = "title")
    val title: String?,

    @ColumnInfo(name = "artist")
    val artist: String?,

    @ColumnInfo(name = "album")
    val album: String?,

    /**
     * MediaStore content URI. Needed to re-decode for reproducibility.
     * Never a filesystem path, and never written to logs.
     */
    @ColumnInfo(name = "sourceUri")
    val sourceUri: String?,

    // ---- Audio measurements ------------------------------------
    @ColumnInfo(name = "bpm") val bpm: Float?,
    @ColumnInfo(name = "bpmConfidence") val bpmConfidence: Float?,
    @ColumnInfo(name = "loudnessDbfs") val loudnessDbfs: Float?,
    @ColumnInfo(name = "dynamicRangeDb") val dynamicRangeDb: Float?,
    @ColumnInfo(name = "peak") val peak: Float?,
    @ColumnInfo(name = "rms") val rms: Float?,
    @ColumnInfo(name = "spectralCentroid") val spectralCentroid: Float?,
    @ColumnInfo(name = "spectralBandwidth") val spectralBandwidth: Float?,
    @ColumnInfo(name = "spectralRolloff") val spectralRolloff: Float?,
    @ColumnInfo(name = "zeroCrossingRate") val zeroCrossingRate: Float?,
    @ColumnInfo(name = "silenceRatio") val silenceRatio: Float?,
    @ColumnInfo(name = "sourceDurationSec") val sourceDurationSec: Double?,
    @ColumnInfo(name = "analysedDurationSec") val analysedDurationSec: Double?,
    @ColumnInfo(name = "sourceSampleRate") val sourceSampleRate: Int?,
    @ColumnInfo(name = "modelSampleRate") val modelSampleRate: Int?,
    @ColumnInfo(name = "windowsProcessed") val windowsProcessed: Int?,

    // ---- Embedding ---------------------------------------------
    /** Complete vector as a JSON float array. Never truncated. */
    @ColumnInfo(name = "embeddingVector")
    val embeddingVector: String?,

    @ColumnInfo(name = "embeddingDimension") val embeddingDimension: Int?,
    @ColumnInfo(name = "embeddingModel") val embeddingModel: String?,
    @ColumnInfo(name = "embeddingModelVersion") val embeddingModelVersion: String?,
    @ColumnInfo(name = "normalized") val normalized: Boolean?,
    @ColumnInfo(name = "preNormalizationL2") val preNormalizationL2: Float?,

    // ---- Processing metadata -----------------------------------
    @ColumnInfo(name = "analyzerVersion") val analyzerVersion: Int,
    @ColumnInfo(name = "analysisDurationMs") val analysisDurationMs: Long?,
    @ColumnInfo(name = "decodeDurationMs") val decodeDurationMs: Long?,
    @ColumnInfo(name = "inferenceDurationMs") val inferenceDurationMs: Long?,

    /** Under evaluation. No model here is production-selected. */
    @ColumnInfo(name = "experimental") val experimental: Boolean,

    // ---- Ground truth (HUMAN ONLY) -----------------------------
    @ColumnInfo(name = "labelLanguage") val labelLanguage: String?,
    /** JSON array. */
    @ColumnInfo(name = "labelGenres") val labelGenres: String?,
    @ColumnInfo(name = "labelMoods") val labelMoods: String?,
    @ColumnInfo(name = "labelVocal") val labelVocal: String?,
    @ColumnInfo(name = "labelEnergy") val labelEnergy: String?,
    @ColumnInfo(name = "labelContexts") val labelContexts: String?,
    @ColumnInfo(name = "labelNotes") val labelNotes: String?,
    @ColumnInfo(name = "labelledAt") val labelledAt: Long?,
    /** 0 = never labelled by a human. */
    @ColumnInfo(name = "labelRevision") val labelRevision: Int,

    // ---- Status ------------------------------------------------
    @ColumnInfo(name = "status") val status: String,
    @ColumnInfo(name = "errorCode") val errorCode: String?,
    @ColumnInfo(name = "errorMessage") val errorMessage: String?,

    @ColumnInfo(name = "createdAt") val createdAt: Long,
    @ColumnInfo(name = "updatedAt") val updatedAt: Long,
    /** Set when a newer model build replaced this row. Never deleted. */
    @ColumnInfo(name = "supersededAt") val supersededAt: Long?,
)
