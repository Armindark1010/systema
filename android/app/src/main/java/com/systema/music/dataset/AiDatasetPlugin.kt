package com.systema.music.dataset

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.library.db.MusicLibraryDatabase
import com.systema.music.library.db.TrackAiAnalysisDao
import com.systema.music.library.db.TrackAiAnalysisEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

/**
 * Bridge to the persistent AI dataset (Phase 28).
 *
 * The WebView sends and receives plain JSON records; it never learns
 * about Room, SQL or entity shapes. Two separate methods write, and the
 * split is the safety boundary:
 *
 *   saveAnalysis — measurements + embedding. Cannot write labels.
 *   saveLabels   — human ground truth. Cannot write measurements.
 *
 * A single "save the whole record" method would make it possible for a
 * re-analysis payload to carry stale labels and clobber a human's work.
 *
 * Logging discipline: never log `sourceUri`, never log a vector, never
 * log label content. Ids and counts only.
 */
@CapacitorPlugin(name = "AiDataset")
class AiDatasetPlugin : Plugin() {

    private companion object {
        const val TAG = "SystemaAiDataset"
    }

    private val dao: TrackAiAnalysisDao by lazy {
        MusicLibraryDatabase.get(context).trackAiAnalysisDao()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /** Lets the web layer confirm a durable backend is present. */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", true).put("durable", true))
    }

    @PluginMethod
    fun saveAnalysis(call: PluginCall) {
        val id = call.getString("id")
        val trackId = call.getString("trackId")
        if (id.isNullOrBlank() || trackId.isNullOrBlank()) {
            call.reject("An id and trackId are required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val now = System.currentTimeMillis()
                val entity = call.toEntity(id, trackId, now)
                withContext(Dispatchers.IO) { dao.upsertAndSupersede(entity, now) }
                val saved = withContext(Dispatchers.IO) { dao.getById(id) }
                if (saved == null) {
                    // Read-back failed: report it rather than claiming success.
                    call.reject("The record did not persist.", "WRITE_FAILED")
                } else {
                    Log.i(TAG, "dataset_saved id=$id")
                    call.resolve(JSObject().put("record", saved.toJs()))
                }
            } catch (e: Exception) {
                Log.e(TAG, "dataset_save_failed id=$id", e)
                call.reject("The dataset write failed.", "WRITE_FAILED")
            }
        }
    }

    /**
     * Writes human labels for one record.
     *
     * Rejects when the row does not exist instead of creating one: a
     * label without an analysis has nothing to describe.
     */
    @PluginMethod
    fun saveLabels(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("An id is required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val existing = withContext(Dispatchers.IO) { dao.getById(id) }
                if (existing == null) {
                    call.reject("No dataset record with that id.", "NOT_FOUND")
                    return@launch
                }

                val now = System.currentTimeMillis()
                withContext(Dispatchers.IO) {
                    dao.updateLabels(
                        id = id,
                        language = call.getString("language"),
                        genres = call.getArray("genres")?.toString(),
                        moods = call.getArray("moods")?.toString(),
                        vocal = call.getString("vocal"),
                        energy = call.getString("energy"),
                        contexts = call.getArray("contexts")?.toString(),
                        notes = call.getString("notes"),
                        labelledAt = now,
                        revision = call.getInt("revision") ?: (existing.labelRevision + 1),
                        now = now,
                    )
                }
                val saved = withContext(Dispatchers.IO) { dao.getById(id) }
                Log.i(TAG, "labels_saved id=$id")
                call.resolve(JSObject().put("record", saved?.toJs()))
            } catch (e: Exception) {
                Log.e(TAG, "labels_save_failed id=$id", e)
                call.reject("The label write failed.", "WRITE_FAILED")
            }
        }
    }

    @PluginMethod
    fun getById(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("An id is required.", "INVALID_ARGUMENT")
            return
        }
        scope.launch {
            try {
                val row = withContext(Dispatchers.IO) { dao.getById(id) }
                call.resolve(JSObject().put("record", row?.toJs()))
            } catch (e: Exception) {
                call.reject("The dataset read failed.", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun getByTrackId(call: PluginCall) {
        val trackId = call.getString("trackId")
        if (trackId.isNullOrBlank()) {
            call.reject("A trackId is required.", "INVALID_ARGUMENT")
            return
        }
        scope.launch {
            try {
                val rows = withContext(Dispatchers.IO) { dao.getByTrackId(trackId) }
                call.resolve(JSObject().put("records", rows.toJsArray()))
            } catch (e: Exception) {
                call.reject("The dataset read failed.", "READ_FAILED")
            }
        }
    }

    /**
     * Returns every row.
     *
     * Filtering, sorting and pagination happen in the web layer so the
     * semantics live in one tested place. This is a developer dataset
     * of a few hundred rows; paginating in SQL would add a second
     * implementation of the same rules for no user-visible gain.
     */
    @PluginMethod
    fun getAll(call: PluginCall) {
        scope.launch {
            try {
                val rows = withContext(Dispatchers.IO) { dao.getAll() }
                call.resolve(JSObject().put("records", rows.toJsArray()))
            } catch (e: Exception) {
                call.reject("The dataset read failed.", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun deleteById(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("An id is required.", "INVALID_ARGUMENT")
            return
        }
        scope.launch {
            try {
                val n = withContext(Dispatchers.IO) { dao.deleteById(id) }
                call.resolve(JSObject().put("deleted", n > 0))
            } catch (e: Exception) {
                call.reject("The delete failed.", "WRITE_FAILED")
            }
        }
    }

    /**
     * Writes an export to shared Documents storage.
     *
     * The web layer produces the text (it owns the format); this only
     * persists it somewhere that survives an uninstall, which the Room
     * database itself cannot do.
     */
    @PluginMethod
    fun exportToFile(call: PluginCall) {
        val fileName = call.getString("fileName")
        val content = call.getString("content")
        val mimeType = call.getString("mimeType") ?: "application/json"

        if (fileName.isNullOrBlank() || content == null) {
            call.reject("A fileName and content are required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            val result = withContext(Dispatchers.IO) {
                DatasetExporter(context).writeToDocuments(fileName, content, mimeType)
            }
            if (result.ok) {
                call.resolve(
                    JSObject()
                        .put("path", result.displayPath)
                        .put("bytes", result.bytesWritten),
                )
            } else {
                call.reject(result.error ?: "The export failed.", "EXPORT_FAILED")
            }
        }
    }

    @PluginMethod
    fun stats(call: PluginCall) {
        scope.launch {
            try {
                val (total, labelled, withEmbedding) = withContext(Dispatchers.IO) {
                    Triple(dao.count(), dao.countLabelled(), dao.countWithEmbedding())
                }
                call.resolve(
                    JSObject()
                        .put("total", total)
                        .put("labelled", labelled)
                        .put("withEmbedding", withEmbedding),
                )
            } catch (e: Exception) {
                call.reject("The dataset read failed.", "READ_FAILED")
            }
        }
    }

    // -----------------------------------------------------------------
    // Mapping
    // -----------------------------------------------------------------

    private fun PluginCall.toEntity(id: String, trackId: String, now: Long) =
        TrackAiAnalysisEntity(
            id = id,
            schemaVersion = getInt("schemaVersion") ?: 1,
            trackId = trackId,
            title = getString("title"),
            artist = getString("artist"),
            album = getString("album"),
            sourceUri = getString("sourceUri"),
            bpm = getFloatOrNull("bpm"),
            bpmConfidence = getFloatOrNull("bpmConfidence"),
            loudnessDbfs = getFloatOrNull("loudnessDbfs"),
            dynamicRangeDb = getFloatOrNull("dynamicRangeDb"),
            peak = getFloatOrNull("peak"),
            rms = getFloatOrNull("rms"),
            spectralCentroid = getFloatOrNull("spectralCentroid"),
            spectralBandwidth = getFloatOrNull("spectralBandwidth"),
            spectralRolloff = getFloatOrNull("spectralRolloff"),
            zeroCrossingRate = getFloatOrNull("zeroCrossingRate"),
            silenceRatio = getFloatOrNull("silenceRatio"),
            sourceDurationSec = getDoubleOrNull("sourceDurationSec"),
            analysedDurationSec = getDoubleOrNull("analysedDurationSec"),
            sourceSampleRate = getInt("sourceSampleRate"),
            modelSampleRate = getInt("modelSampleRate"),
            windowsProcessed = getInt("windowsProcessed"),
            // The complete vector, serialised verbatim. Never truncated.
            embeddingVector = getArray("embeddingVector")?.toString(),
            embeddingDimension = getInt("embeddingDimension"),
            embeddingModel = getString("embeddingModel"),
            embeddingModelVersion = getString("embeddingModelVersion"),
            normalized = getBoolean("normalized"),
            preNormalizationL2 = getFloatOrNull("preNormalizationL2"),
            analyzerVersion = getInt("analyzerVersion") ?: 1,
            analysisDurationMs = getLongOrNull("analysisDurationMs"),
            decodeDurationMs = getLongOrNull("decodeDurationMs"),
            inferenceDurationMs = getLongOrNull("inferenceDurationMs"),
            experimental = getBoolean("experimental", true) ?: true,
            // Labels are NOT read from an analysis payload. The DAO's
            // upsert ignores these columns for an existing row, and a
            // new row starts unlabelled.
            labelLanguage = null,
            labelGenres = null,
            labelMoods = null,
            labelVocal = null,
            labelEnergy = null,
            labelContexts = null,
            labelNotes = null,
            labelledAt = null,
            labelRevision = 0,
            status = getString("status") ?: "COMPLETED",
            errorCode = getString("errorCode"),
            errorMessage = getString("errorMessage"),
            createdAt = now,
            updatedAt = now,
            supersededAt = null,
        )

    private fun PluginCall.getFloatOrNull(key: String): Float? =
        if (data.has(key) && !data.isNull(key)) data.optDouble(key).toFloat() else null

    private fun PluginCall.getDoubleOrNull(key: String): Double? =
        if (data.has(key) && !data.isNull(key)) data.optDouble(key) else null

    private fun PluginCall.getLongOrNull(key: String): Long? =
        if (data.has(key) && !data.isNull(key)) data.optLong(key) else null

    private fun List<TrackAiAnalysisEntity>.toJsArray(): JSArray {
        val arr = JSArray()
        for (row in this) arr.put(row.toJs())
        return arr
    }

    private fun TrackAiAnalysisEntity.toJs(): JSObject = JSObject().apply {
        put("id", id)
        put("schemaVersion", schemaVersion)
        put("trackId", trackId)
        put("title", title)
        put("artist", artist)
        put("album", album)
        put("sourceUri", sourceUri)
        put("bpm", bpm)
        put("bpmConfidence", bpmConfidence)
        put("loudnessDbfs", loudnessDbfs)
        put("dynamicRangeDb", dynamicRangeDb)
        put("peak", peak)
        put("rms", rms)
        put("spectralCentroid", spectralCentroid)
        put("spectralBandwidth", spectralBandwidth)
        put("spectralRolloff", spectralRolloff)
        put("zeroCrossingRate", zeroCrossingRate)
        put("silenceRatio", silenceRatio)
        put("sourceDurationSec", sourceDurationSec)
        put("analysedDurationSec", analysedDurationSec)
        put("sourceSampleRate", sourceSampleRate)
        put("modelSampleRate", modelSampleRate)
        put("windowsProcessed", windowsProcessed)
        // Parsed back into a real array so the web layer receives
        // numbers, not a string it would have to re-parse.
        put("embeddingVector", embeddingVector?.let { runCatching { JSONArray(it) }.getOrNull() })
        put("embeddingDimension", embeddingDimension)
        put("embeddingModel", embeddingModel)
        put("embeddingModelVersion", embeddingModelVersion)
        put("normalized", normalized)
        put("preNormalizationL2", preNormalizationL2)
        put("analyzerVersion", analyzerVersion)
        put("analysisDurationMs", analysisDurationMs)
        put("decodeDurationMs", decodeDurationMs)
        put("inferenceDurationMs", inferenceDurationMs)
        put("experimental", experimental)
        put("labelLanguage", labelLanguage)
        put("labelGenres", labelGenres?.let { runCatching { JSONArray(it) }.getOrNull() })
        put("labelMoods", labelMoods?.let { runCatching { JSONArray(it) }.getOrNull() })
        put("labelVocal", labelVocal)
        put("labelEnergy", labelEnergy)
        put("labelContexts", labelContexts?.let { runCatching { JSONArray(it) }.getOrNull() })
        put("labelNotes", labelNotes)
        put("labelledAt", labelledAt)
        put("labelRevision", labelRevision)
        put("status", status)
        put("errorCode", errorCode)
        put("errorMessage", errorMessage)
        put("createdAt", createdAt)
        put("updatedAt", updatedAt)
        put("supersededAt", supersededAt)
    }
}
