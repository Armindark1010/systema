package com.systema.music.playlists

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.library.db.MusicLibraryDatabase
import com.systema.music.library.db.PlaylistDao
import com.systema.music.library.db.PlaylistEntity
import com.systema.music.library.db.PlaylistWithTracks
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

/**
 * `Playlists` — Capacitor bridge to Room SQLite for durable user playlists (Phase 29).
 */
@CapacitorPlugin(name = "Playlists")
class PlaylistsPlugin : Plugin() {

    private companion object {
        const val TAG = "SystemaPlaylists"
    }

    private val dao: PlaylistDao by lazy {
        MusicLibraryDatabase.get(context).playlistDao()
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
                .put("table", "playlists")
                .put("version", 5)
        )
    }

    @PluginMethod
    fun getAllPlaylists(call: PluginCall) {
        scope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    dao.getAllPlaylistsWithTracks()
                }
                Log.i(TAG, "PLAYLIST_READ count=${list.size}")
                Log.i(TAG, "PLAYLIST_COUNT count=${list.size}")

                val arr = JSArray()
                for (item in list) {
                    arr.put(item.toJs())
                }
                call.resolve(JSObject().put("playlists", arr).put("count", list.size))
            } catch (e: Exception) {
                Log.e(TAG, "PLAYLIST_READ_FAILED", e)
                call.reject("Failed to read playlists from Room SQLite: ${e.message}", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun getPlaylistById(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("id is required", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val item = withContext(Dispatchers.IO) {
                    dao.getPlaylistWithTracks(id)
                }
                val res = JSObject()
                if (item != null) {
                    res.put("playlist", item.toJs())
                } else {
                    res.put("playlist", null)
                }
                call.resolve(res)
            } catch (e: Exception) {
                call.reject("Failed to read playlist: ${e.message}", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun savePlaylist(call: PluginCall) {
        val id = call.getString("id")
        val title = call.getString("title")
        val description = call.getString("description")
        val cover = call.getString("cover")
        val kind = call.getString("kind") ?: "user"
        val createdAt = call.getString("createdAt") ?: java.util.Date().toString()
        val updatedAt = call.getString("updatedAt") ?: java.util.Date().toString()
        val aiMetaJson = call.getObject("aiMeta")?.toString()

        val rawTracks = call.getArray("trackIds")
        val trackIds = mutableListOf<String>()
        if (rawTracks != null) {
            for (i in 0 until rawTracks.length()) {
                val tid = rawTracks.optString(i)
                if (!tid.isNullOrBlank()) {
                    trackIds.add(tid)
                }
            }
        }

        if (id.isNullOrBlank() || title.isNullOrBlank()) {
            call.reject("id and title are required", "INVALID_ARGUMENT")
            return
        }

        val entity = PlaylistEntity(
            id = id,
            title = title.trim(),
            description = description?.trim(),
            cover = cover,
            kind = kind,
            createdAt = createdAt,
            updatedAt = updatedAt,
            aiMetaJson = aiMetaJson,
        )

        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    dao.upsertPlaylistWithTracks(entity, trackIds)
                }
                Log.i(TAG, "PLAYLIST_WRITE id=$id tracksCount=${trackIds.size}")
                val count = withContext(Dispatchers.IO) { dao.count() }
                Log.i(TAG, "PLAYLIST_COUNT count=$count")
                call.resolve(JSObject().put("saved", true).put("id", id))
            } catch (e: Exception) {
                Log.e(TAG, "PLAYLIST_WRITE_FAILED id=$id", e)
                call.reject("Failed to save playlist to Room SQLite: ${e.message}", "WRITE_FAILED")
            }
        }
    }

    @PluginMethod
    fun deletePlaylist(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("id is required", "INVALID_ARGUMENT")
            return
        }

        scope.launch {
            try {
                val deleted = withContext(Dispatchers.IO) {
                    dao.deletePlaylist(id)
                }
                Log.i(TAG, "PLAYLIST_DELETE id=$id success=${deleted > 0}")
                val count = withContext(Dispatchers.IO) { dao.count() }
                Log.i(TAG, "PLAYLIST_COUNT count=$count")
                call.resolve(JSObject().put("deleted", deleted > 0))
            } catch (e: Exception) {
                Log.e(TAG, "PLAYLIST_DELETE_FAILED id=$id", e)
                call.reject("Failed to delete playlist: ${e.message}", "WRITE_FAILED")
            }
        }
    }

    @PluginMethod
    fun count(call: PluginCall) {
        scope.launch {
            try {
                val count = withContext(Dispatchers.IO) { dao.count() }
                Log.i(TAG, "PLAYLIST_COUNT count=$count")
                call.resolve(JSObject().put("count", count))
            } catch (e: Exception) {
                call.reject("Failed to read count: ${e.message}", "READ_FAILED")
            }
        }
    }

    private fun PlaylistWithTracks.toJs(): JSObject = JSObject().apply {
        put("id", playlist.id)
        put("title", playlist.title)
        put("description", playlist.description)
        put("cover", playlist.cover)
        put("kind", playlist.kind)
        put("createdAt", playlist.createdAt)
        put("updatedAt", playlist.updatedAt)
        if (!playlist.aiMetaJson.isNullOrBlank()) {
            try {
                put("aiMeta", JSObject(playlist.aiMetaJson))
            } catch (_: Exception) {}
        }
        val tracksArr = JSArray()
        for (tid in orderedTrackIds) {
            tracksArr.put(tid)
        }
        put("trackIds", tracksArr)
    }
}
