package com.systema.music.library

import android.Manifest
import android.os.Build
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.systema.music.library.model.MusicTrack
import com.systema.music.library.model.ScanProgress
import com.systema.music.library.model.ScanState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * `MusicLibrary` — Capacitor bridge over the native library foundation.
 *
 * The bridge is intentionally thin: it validates input, converts
 * to/from JSON and forwards to [MusicLibraryRepository]. All real work
 * (MediaStore, Room, threading) lives below it.
 *
 * Events emitted:
 *   scanStarted   { total?, state }
 *   scanProgress  { discovered, processed, inserted, updated, removed, unchanged, total?, state }
 *   scanCompleted { ...same counters..., state: "COMPLETED" }
 *   scanError     { code, message, state: "ERROR" }
 */
@CapacitorPlugin(
    name = "MusicLibrary",
    permissions = [
        Permission(alias = "audio", strings = [Manifest.permission.READ_MEDIA_AUDIO]),
        Permission(alias = "storage", strings = [Manifest.permission.READ_EXTERNAL_STORAGE]),
    ],
)
class MusicLibraryPlugin : Plugin() {

    companion object {
        private const val TAG = "SystemaLibraryPlugin"
        const val AUDIO_ALIAS = "audio"
        const val STORAGE_ALIAS = "storage"

        private const val EVENT_STARTED = "scanStarted"
        private const val EVENT_PROGRESS = "scanProgress"
        private const val EVENT_COMPLETED = "scanCompleted"
        private const val EVENT_ERROR = "scanError"
    }

    private val repository: MusicLibraryRepository by lazy {
        MusicLibraryRepository.get(context)
    }

    /** Bridge-scoped supervisor; cancelled with the plugin. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The alias whose permission actually matters on this API level. */
    private val activeAlias: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) AUDIO_ALIAS else STORAGE_ALIAS

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    // ---------------------------------------------------------------
    // Permissions
    // ---------------------------------------------------------------

    @PluginMethod
    fun hasPermission(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("granted", repository.hasPermission())
                .put("status", repository.permissionState()),
        )
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (repository.hasPermission()) {
            call.resolve(
                JSObject().put("granted", true).put("status", MusicPermissions.GRANTED),
            )
            return
        }
        requestPermissionForAlias(activeAlias, call, "permissionCallback")
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        val granted = repository.hasPermission()
        // A denial is a normal outcome, never a crash and never a
        // rejected promise — the frontend gets a structured result.
        call.resolve(
            JSObject()
                .put("granted", granted)
                .put("status", if (granted) MusicPermissions.GRANTED else MusicPermissions.DENIED),
        )
    }

    // ---------------------------------------------------------------
    // Scanning
    // ---------------------------------------------------------------

    @PluginMethod
    fun scan(call: PluginCall) {
        try {
            var announced = false
            repository.startScan { progress ->
                if (!announced) {
                    announced = true
                    notifyListeners(EVENT_STARTED, progress.toJs())
                }
                when (progress.state) {
                    ScanState.COMPLETED -> notifyListeners(EVENT_COMPLETED, progress.toJs())
                    ScanState.ERROR -> notifyListeners(EVENT_ERROR, progress.toJs())
                    else -> notifyListeners(EVENT_PROGRESS, progress.toJs())
                }
            }
            // Resolves as soon as the scan is accepted. Real results
            // arrive as events, so a 10k-track library never blocks a
            // single bridge call.
            call.resolve(JSObject().put("started", true).put("state", ScanState.SCANNING.name))
        } catch (e: MusicLibraryException) {
            rejectStructured(call, e)
        } catch (e: Exception) {
            rejectUnknown(call, "The library scan could not be started.", e)
        }
    }

    @PluginMethod
    fun cancelScan(call: PluginCall) {
        repository.cancelScan()
        call.resolve(JSObject().put("cancelled", true))
    }

    @PluginMethod
    fun getScanStatus(call: PluginCall) {
        val progress = repository.progress.value
        call.resolve(progress.toJs().put("scanning", repository.isScanning()))
    }

    // ---------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------

    @PluginMethod
    fun getLibraryCount(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(JSObject().put("count", repository.count()))
            } catch (e: MusicLibraryException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The library count could not be read.", e)
            }
        }
    }

    @PluginMethod
    fun getTracks(call: PluginCall) {
        val limit = call.getInt("limit") ?: MusicLibraryRepository.DEFAULT_PAGE_LIMIT
        val offset = call.getInt("offset") ?: 0
        if (limit <= 0) {
            call.reject(
                "limit must be greater than zero.",
                MusicLibraryException.Code.INVALID_ARGUMENT.name,
            )
            return
        }

        scope.launch {
            try {
                val page = repository.getTracks(
                    offset = offset,
                    limit = limit,
                    sort = TrackSort.from(call.getString("sort")),
                    order = SortOrder.from(call.getString("order")),
                    query = call.getString("query"),
                )
                val items = JSArray()
                page.items.forEach { items.put(it.toJs()) }

                call.resolve(
                    JSObject()
                        .put("tracks", items)
                        .put("total", page.total)
                        .put("offset", page.offset)
                        .put("limit", page.limit)
                        .put("hasMore", page.hasMore)
                        .also { result ->
                            page.nextOffset?.let { result.put("nextOffset", it) }
                        },
                )
            } catch (e: MusicLibraryException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The library page could not be read.", e)
            }
        }
    }

    @PluginMethod
    fun getTrack(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("id is required.", MusicLibraryException.Code.INVALID_ARGUMENT.name)
            return
        }

        scope.launch {
            try {
                val track = repository.getTrack(id)
                if (track == null) {
                    call.reject("Track not found.", MusicLibraryException.Code.NOT_FOUND.name)
                } else {
                    call.resolve(JSObject().put("track", track.toJs()))
                }
            } catch (e: MusicLibraryException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The track could not be read.", e)
            }
        }
    }

    @PluginMethod
    fun clearLibrary(call: PluginCall) {
        scope.launch {
            try {
                repository.clear()
                call.resolve(JSObject().put("cleared", true))
            } catch (e: MusicLibraryException) {
                rejectStructured(call, e)
            } catch (e: Exception) {
                rejectUnknown(call, "The library index could not be cleared.", e)
            }
        }
    }

    // ---------------------------------------------------------------
    // Serialization
    // ---------------------------------------------------------------

    private fun MusicTrack.toJs(): JSObject = JSObject()
        .put("id", id)
        .put("mediaStoreId", mediaStoreId)
        .put("volumeName", volumeName)
        .put("uri", uri)
        .put("title", title)
        .putNullable("artist", artist)
        .putNullable("album", album)
        .putNullable("albumArtist", albumArtist)
        .put("duration", duration)
        .putNullable("trackNumber", trackNumber)
        .putNullable("discNumber", discNumber)
        .putNullable("genre", genre)
        .putNullable("year", year)
        .putNullable("mimeType", mimeType)
        .put("fileSize", fileSize)
        .put("dateAdded", dateAdded)
        .put("dateModified", dateModified)
        // Raw content:// URI. The TypeScript layer runs it through
        // Capacitor.convertFileSrc() so the WebView fetches it lazily,
        // only when an <img> actually renders. No bitmap, no Base64,
        // no decoding here.
        .putNullable("artworkUri", artworkUri)
        .putNullable("albumId", albumId)

    private fun ScanProgress.toJs(): JSObject = JSObject()
        .put("state", state.name)
        .put("discovered", discovered)
        .put("processed", processed)
        .put("inserted", inserted)
        .put("updated", updated)
        .put("removed", removed)
        .put("unchanged", unchanged)
        .put("indeterminate", indeterminate)
        .putNullable("total", total)
        .putNullable("errorCode", errorCode)
        .putNullable("errorMessage", errorMessage)
        .putNullable("startedAt", startedAt)
        .putNullable("finishedAt", finishedAt)

    private fun JSObject.putNullable(key: String, value: Any?): JSObject {
        // JSONObject.NULL, not JSObject.NULL: Kotlin does not inherit
        // Java static members through a subclass reference.
        if (value == null) put(key, JSONObject.NULL) else put(key, value)
        return this
    }

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    private fun rejectStructured(call: PluginCall, e: MusicLibraryException) {
        Log.w(TAG, "${e.codeName}: ${e.message}", e)
        call.reject(e.message, e.codeName)
    }

    /** Never forwards a stack trace or raw exception text to the WebView. */
    private fun rejectUnknown(call: PluginCall, message: String, e: Exception) {
        Log.e(TAG, message, e)
        call.reject(message, MusicLibraryException.Code.UNKNOWN.name)
    }
}
