package com.systema.music.session

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.library.db.MusicLibraryDatabase
import com.systema.music.library.db.PlaylistSessionDao
import com.systema.music.library.db.PlaylistSessionEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * `PlaylistSession` — Capacitor bridge to Room SQLite for durable playlist sessions.
 */
@CapacitorPlugin(name = "PlaylistSession")
class PlaylistSessionPlugin : Plugin() {

    private companion object {
        const val TAG = "SystemaPlaylistSession"
    }

    private val dao: PlaylistSessionDao by lazy {
        MusicLibraryDatabase.get(context).playlistSessionDao()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("available", true)
                .put("durable", true)
                .put("engine", "room-sqlite")
                .put("database", "systema-music-library.db")
                .put("table", "playlist_sessions")
                .put("version", 4)
        )
    }

    @PluginMethod
    fun saveSession(call: PluginCall) {
        val playlistId = call.getString("playlistId")
        val trackId = call.getString("trackId")
        val trackIndex = call.getInt("trackIndex") ?: 0
        val positionSeconds = call.getDouble("positionSeconds") ?: 0.0
        val durationSeconds = call.getDouble("durationSeconds") ?: 0.0
        val lastPlayedAt = call.getLong("lastPlayedAt") ?: System.currentTimeMillis()
        val updatedAt = call.getString("updatedAt") ?: java.util.Date().toString()
        val completed = call.getBoolean("completed") ?: false
        val listenedRangesJson = call.getObject("listenedRanges")?.toString() ?: call.getString("listenedRangesJson")
        val totalListenedSeconds = call.getDouble("totalListenedSeconds") ?: 0.0

        if (playlistId.isNullOrBlank() || trackId.isNullOrBlank()) {
            call.reject("playlistId and trackId are required.", "INVALID_ARGUMENT")
            return
        }

        val entity = PlaylistSessionEntity(
            playlistId = playlistId,
            trackId = trackId,
            trackIndex = trackIndex.coerceAtLeast(0),
            positionSeconds = positionSeconds.coerceAtLeast(0.0),
            durationSeconds = durationSeconds.coerceAtLeast(0.0),
            lastPlayedAt = lastPlayedAt,
            updatedAt = updatedAt,
            completed = completed,
            listenedRangesJson = listenedRangesJson,
            totalListenedSeconds = totalListenedSeconds.coerceAtLeast(0.0),
        )

        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    dao.upsert(entity)
                }
                Log.d(TAG, "playlist_session_saved playlistId=$playlistId trackId=$trackId pos=$positionSeconds listened=$totalListenedSeconds")
                call.resolve(JSObject().put("saved", true).put("session", entity.toJs()))
            } catch (e: Exception) {
                Log.e(TAG, "playlist_session_save_failed playlistId=$playlistId", e)
                call.reject("Failed to persist session to Room SQLite: ${e.message}", "WRITE_FAILED")
            }
        }
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        val playlistId = call.getString("playlistId")
        if (playlistId.isNullOrBlank()) {
            call.reject("playlistId is required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val entity = withContext(Dispatchers.IO) {
                    dao.getById(playlistId)
                }
                val res = JSObject()
                if (entity != null) {
                    res.put("session", entity.toJs())
                } else {
                    res.put("session", null)
                }
                call.resolve(res)
            } catch (e: Exception) {
                call.reject("Failed to read session from Room: ${e.message}", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun getAllSessions(call: PluginCall) {
        scope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    dao.getAll()
                }
                val arr = JSArray()
                for (s in list) {
                    arr.put(s.toJs())
                }
                call.resolve(JSObject().put("sessions", arr))
            } catch (e: Exception) {
                call.reject("Failed to read sessions from Room: ${e.message}", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun getIncompleteSessions(call: PluginCall) {
        scope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    dao.getAllIncomplete()
                }
                val arr = JSArray()
                for (s in list) {
                    arr.put(s.toJs())
                }
                call.resolve(JSObject().put("sessions", arr))
            } catch (e: Exception) {
                call.reject("Failed to read incomplete sessions from Room: ${e.message}", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun deleteSession(call: PluginCall) {
        val playlistId = call.getString("playlistId")
        if (playlistId.isNullOrBlank()) {
            call.reject("playlistId is required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val deleted = withContext(Dispatchers.IO) {
                    dao.deleteById(playlistId)
                }
                call.resolve(JSObject().put("deleted", deleted > 0))
            } catch (e: Exception) {
                call.reject("Failed to delete session: ${e.message}", "WRITE_FAILED")
            }
        }
    }

    @PluginMethod
    fun markCompleted(call: PluginCall) {
        val playlistId = call.getString("playlistId")
        if (playlistId.isNullOrBlank()) {
            call.reject("playlistId is required.", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val now = System.currentTimeMillis()
                val dateStr = java.util.Date().toString()
                withContext(Dispatchers.IO) {
                    dao.markCompleted(playlistId, now, dateStr)
                }
                call.resolve(JSObject().put("completed", true))
            } catch (e: Exception) {
                call.reject("Failed to mark completed: ${e.message}", "WRITE_FAILED")
            }
        }
    }

    private fun PlaylistSessionEntity.toJs(): JSObject = JSObject().apply {
        put("playlistId", playlistId)
        put("trackId", trackId)
        put("trackIndex", trackIndex)
        put("positionSeconds", positionSeconds)
        put("durationSeconds", durationSeconds)
        put("lastPlayedAt", lastPlayedAt)
        put("updatedAt", updatedAt)
        put("completed", completed)
        put("totalListenedSeconds", totalListenedSeconds)
        if (!listenedRangesJson.isNullOrBlank()) {
            try {
                put("listenedRanges", JSObject(listenedRangesJson))
            } catch (_: Exception) {
                put("listenedRangesJson", listenedRangesJson)
            }
        }
    }
}
