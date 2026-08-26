package com.systema.music.analysis.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for storing audio analysis results.
 * 
 * This table stores the results of DSP analysis for each track.
 * Each track can have at most one analysis record per analyzer version.
 * When the analyzer version changes, old records are marked for re-analysis.
 * 
 * Indexes:
 * - Primary key: id (composite of songId + analyzerVersion)
 * - songId: for querying all analysis versions for a track
 * - analyzerVersion: for finding all records from a specific version
 * - analyzedAt: for finding recently analyzed tracks
 */
@Entity(
    tableName = "track_analysis",
    indices = [
        Index(value = ["songId"]),
        Index(value = ["analyzerVersion"]),
        Index(value = ["analyzedAt"]),
        // Unique constraint: one analysis per song per version
        Index(value = ["songId", "analyzerVersion"], unique = true),
    ],
)
data class TrackAnalysisEntity(
    /**
     * Composite primary key: songId + analyzerVersion.
     * This ensures each track has at most one analysis per version.
     */
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    /**
     * The track ID this analysis belongs to.
     * References the `id` field in the `tracks` table.
     */
    @ColumnInfo(name = "songId")
    val songId: String,

    /**
     * Version of the analyzer that produced this result.
     * Used to detect when re-analysis is needed.
     */
    @ColumnInfo(name = "analyzerVersion")
    val analyzerVersion: Int,

    /**
     * Timestamp when analysis was performed (epoch milliseconds).
     */
    @ColumnInfo(name = "analyzedAt")
    val analyzedAt: Long,

    /**
     * Duration of the audio in milliseconds.
     */
    @ColumnInfo(name = "durationMs")
    val durationMs: Long,

    /**
     * Sample rate of the decoded audio in Hz.
     */
    @ColumnInfo(name = "sampleRate")
    val sampleRate: Int,

    /**
     * Number of audio channels.
     */
    @ColumnInfo(name = "channels")
    val channels: Int,

    /**
     * Total number of samples analyzed.
     */
    @ColumnInfo(name = "analyzedSampleCount")
    val analyzedSampleCount: Long,

    // ---------------------------------------------------------------
    // Amplitude / Energy features
    // ---------------------------------------------------------------

    /**
     * Root Mean Square amplitude (0.0 to 1.0, where 1.0 is full scale).
     * Null if not computed.
     */
    @ColumnInfo(name = "rms")
    val rms: Float?,

    /**
     * Peak amplitude (0.0 to 1.0, where 1.0 is full scale).
     * Null if not computed.
     */
    @ColumnInfo(name = "peak")
    val peak: Float?,

    /**
     * Dynamic range estimate in dB.
     * Null if not computed.
     */
    @ColumnInfo(name = "dynamicRangeDb")
    val dynamicRangeDb: Float?,

    /**
     * Ratio of silent samples to total samples (0.0 to 1.0).
     * Null if not computed.
     */
    @ColumnInfo(name = "silenceRatio")
    val silenceRatio: Float?,

    // ---------------------------------------------------------------
    // Spectral features
    // ---------------------------------------------------------------

    /**
     * Spectral centroid in Hz.
     * Null if not computed.
     */
    @ColumnInfo(name = "spectralCentroid")
    val spectralCentroid: Float?,

    /**
     * Spectral bandwidth in Hz.
     * Null if not computed.
     */
    @ColumnInfo(name = "spectralBandwidth")
    val spectralBandwidth: Float?,

    /**
     * Spectral rolloff in Hz (85% energy).
     * Null if not computed.
     */
    @ColumnInfo(name = "spectralRolloff")
    val spectralRolloff: Float?,

    /**
     * Zero-crossing rate (crossings per second).
     * Null if not computed.
     */
    @ColumnInfo(name = "zeroCrossingRate")
    val zeroCrossingRate: Float?,

    // ---------------------------------------------------------------
    // Tempo features
    // ---------------------------------------------------------------

    /**
     * Estimated tempo in beats per minute.
     * Null if confidence is too low or BPM could not be determined.
     */
    @ColumnInfo(name = "bpm")
    val bpm: Float?,

    /**
     * Confidence in the BPM estimate (0.0 to 1.0).
     * Null if BPM is null.
     */
    @ColumnInfo(name = "bpmConfidence")
    val bpmConfidence: Float?,

    // ---------------------------------------------------------------
    // Loudness
    // ---------------------------------------------------------------

    /**
     * Loudness estimate in dBFS (decibels relative to full scale).
     * This is RMS-derived, NOT LUFS.
     * Null if not computed.
     */
    @ColumnInfo(name = "loudnessDb")
    val loudnessDb: Float?,

    // ---------------------------------------------------------------
    // Performance metrics
    // ---------------------------------------------------------------

    /**
     * Time spent decoding in milliseconds.
     */
    @ColumnInfo(name = "decodeTimeMs")
    val decodeTimeMs: Long,

    /**
     * Time spent in DSP computation in milliseconds.
     */
    @ColumnInfo(name = "dspTimeMs")
    val dspTimeMs: Long,

    /**
     * Total analysis time in milliseconds.
     */
    @ColumnInfo(name = "totalAnalysisTimeMs")
    val totalAnalysisTimeMs: Long,

    /**
     * Real-time factor: analysisTime / audioDuration.
     */
    @ColumnInfo(name = "realTimeFactor")
    val realTimeFactor: Float,

    // ---------------------------------------------------------------
    // Error tracking
    // ---------------------------------------------------------------

    /**
     * Error code if analysis failed, null otherwise.
     */
    @ColumnInfo(name = "errorCode")
    val errorCode: String?,

    /**
     * Error message if analysis failed, null otherwise.
     */
    @ColumnInfo(name = "errorMessage")
    val errorMessage: String?,
)

/**
 * Narrow projection for checking if analysis exists for a track.
 */
data class TrackAnalysisKey(
    val songId: String,
    val analyzerVersion: Int,
    val analyzedAt: Long,
)

/**
 * Factory for creating TrackAnalysisEntity from AudioAnalysisResult.
 */
fun TrackAnalysisEntity.fromResult(result: com.systema.music.analysis.AudioAnalysisResult): TrackAnalysisEntity {
    return TrackAnalysisEntity(
        id = "${result.songId}:v${result.analyzerVersion}",
        songId = result.songId,
        analyzerVersion = result.analyzerVersion,
        analyzedAt = result.analyzedAt,
        durationMs = result.durationMs,
        sampleRate = result.sampleRate,
        channels = result.channels,
        analyzedSampleCount = result.analyzedSampleCount,
        rms = result.rms,
        peak = result.peak,
        dynamicRangeDb = result.dynamicRangeDb,
        silenceRatio = result.silenceRatio,
        spectralCentroid = result.spectralCentroid,
        spectralBandwidth = result.spectralBandwidth,
        spectralRolloff = result.spectralRolloff,
        zeroCrossingRate = result.zeroCrossingRate,
        bpm = result.bpm,
        bpmConfidence = result.bpmConfidence,
        loudnessDb = result.loudnessDb,
        decodeTimeMs = result.decodeTimeMs,
        dspTimeMs = result.dspTimeMs,
        totalAnalysisTimeMs = result.totalAnalysisTimeMs,
        realTimeFactor = result.realTimeFactor,
        errorCode = result.errorCode,
        errorMessage = result.errorMessage,
    )
}
