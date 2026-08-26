package com.systema.music.player

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.systema.music.player.model.PlayerException
import com.systema.music.player.model.PlayerSnapshot
import com.systema.music.player.model.PlayerTrack
import com.systema.music.player.model.RepeatMode
import org.json.JSONObject

/**
 * `Player` — Capacitor bridge over [PlayerEngine].
 *
 * Mirrors the shape of `MusicLibraryPlugin`: validate, convert, forward.
 * No playback logic lives here and no state is cached — every answer is
 * read from the engine, which is the single source of truth.
 *
 * Events emitted:
 *   playbackStateChanged { state, isPlaying, buffering, ... }
 *   currentTrackChanged  { trackId, index }
 *   positionChanged      { positionMs, durationMs }
 *   durationChanged      { durationMs }
 *   bufferingChanged     { buffering }
 *   queueChanged         { trackIds, currentIndex }
 *   playerError          { code, message, trackId }
 */
@CapacitorPlugin(name = "Player")
class PlayerPlugin : Plugin() {

    companion object {
        private const val TAG = "SystemaPlayerPlugin"

        private const val EVENT_PLAYBACK_STATE = "playbackStateChanged"
        private const val EVENT_TRACK_CHANGED = "currentTrackChanged"
        private const val EVENT_POSITION = "positionChanged"
        private const val EVENT_DURATION = "durationChanged"
        private const val EVENT_BUFFERING = "bufferingChanged"
        private const val EVENT_QUEUE = "queueChanged"
        private const val EVENT_ERROR = "playerError"
    }

    private val engine: PlayerEngine by lazy { PlayerEngine.get(context) }

    /**
     * Last values forwarded to the WebView. Used purely to suppress
     * redundant events: Media3 emits several callbacks for one logical
     * change, and re-sending identical payloads would waste bridge
     * traffic the UI cannot use.
     */
    private var lastDurationMs = -1L
    private var lastBuffering: Boolean? = null

    private val engineListener = object : PlayerEngine.Listener {
        override fun onSnapshot(snapshot: PlayerSnapshot) {
            notifyListeners(EVENT_PLAYBACK_STATE, snapshot.toJs())

            if (snapshot.durationMs != lastDurationMs) {
                lastDurationMs = snapshot.durationMs
                notifyListeners(EVENT_DURATION, JSObject().put("durationMs", snapshot.durationMs))
            }

            val buffering = snapshot.state == com.systema.music.player.model.PlaybackState.BUFFERING
            if (buffering != lastBuffering) {
                lastBuffering = buffering
                notifyListeners(EVENT_BUFFERING, JSObject().put("buffering", buffering))
            }
        }

        override fun onTrackChanged(trackId: String?, index: Int) {
            notifyListeners(
                EVENT_TRACK_CHANGED,
                JSObject().putNullable("trackId", trackId).put("index", index),
            )
        }

        override fun onError(error: PlayerException, trackId: String?) {
            notifyListeners(
                EVENT_ERROR,
                JSObject()
                    .put("code", error.codeName)
                    .put("message", error.message)
                    .putNullable("trackId", trackId),
            )
        }

        override fun onQueueChanged(trackIds: List<String>, currentIndex: Int) {
            notifyListeners(
                EVENT_QUEUE,
                JSObject()
                    .put("trackIds", JSArray(trackIds))
                    .put("currentIndex", currentIndex),
            )
        }
    }

    override fun load() {
        super.load()
        engine.addListener(engineListener)
    }

    override fun handleOnDestroy() {
        // Detach only. The engine is process-scoped and deliberately
        // outlives the Activity so playback survives a configuration
        // change; releasing it here would kill audio on every rotation.
        engine.removeListener(engineListener)
        super.handleOnDestroy()
    }

    // ---------------------------------------------------------------
    // Transport
    // ---------------------------------------------------------------

    /** Plays one track immediately, replacing the queue with it. */
    @PluginMethod
    fun play(call: PluginCall) {
        val trackObject = call.getObject("track")
        if (trackObject == null) {
            // No track supplied: this is a plain resume.
            engine.play()
            call.resolve()
            return
        }

        try {
            val track = trackObject.toPlayerTrack()
            engine.setQueueAndPlay(listOf(track), 0)
            call.resolve()
        } catch (e: PlayerException) {
            rejectStructured(call, e)
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        engine.pause()
        call.resolve()
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        engine.play()
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        engine.stop()
        call.resolve()
    }

    @PluginMethod
    fun next(call: PluginCall) {
        engine.next()
        call.resolve()
    }

    @PluginMethod
    fun previous(call: PluginCall) {
        engine.previous()
        call.resolve()
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val position = call.getLong("positionMs")
        if (position == null) {
            rejectInvalid(call, "seekTo requires positionMs.")
            return
        }
        engine.seekTo(position)
        call.resolve()
    }

    /** Relative seek backing the ±15s hold controls. */
    @PluginMethod
    fun seekBy(call: PluginCall) {
        val delta = call.getLong("deltaMs")
        if (delta == null) {
            rejectInvalid(call, "seekBy requires deltaMs.")
            return
        }
        engine.seekBy(delta)
        call.resolve()
    }

    @PluginMethod
    fun getCurrentPosition(call: PluginCall) {
        call.resolve(JSObject().put("positionMs", engine.positionMs()))
    }

    @PluginMethod
    fun getDuration(call: PluginCall) {
        call.resolve(JSObject().put("durationMs", engine.durationMs()))
    }

    /** Full state snapshot, used once on startup to sync the store. */
    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(engine.snapshot().toJs())
    }

    // ---------------------------------------------------------------
    // Queue
    // ---------------------------------------------------------------

    @PluginMethod
    fun setQueue(call: PluginCall) {
        val raw = call.getArray("tracks")
        if (raw == null) {
            rejectInvalid(call, "setQueue requires a tracks array.")
            return
        }

        try {
            val tracks = raw.toPlayerTracks()
            val startIndex = call.getInt("startIndex") ?: 0
            // `autoPlay` false lets the frontend stage a queue without
            // interrupting whatever is currently playing.
            if (call.getBoolean("autoPlay", true) == true) {
                engine.setQueueAndPlay(tracks, startIndex, call.getLong("positionMs") ?: 0L)
            } else {
                engine.setQueue(tracks, startIndex)
            }
            call.resolve()
        } catch (e: PlayerException) {
            rejectStructured(call, e)
        } catch (t: Throwable) {
            rejectUnknown(call, "The queue could not be set.", t)
        }
    }

    @PluginMethod
    fun addToQueue(call: PluginCall) {
        val trackObject = call.getObject("track")
        if (trackObject == null) {
            rejectInvalid(call, "addToQueue requires a track.")
            return
        }
        try {
            engine.addToQueue(trackObject.toPlayerTrack(), call.getInt("index"))
            call.resolve()
        } catch (e: PlayerException) {
            rejectStructured(call, e)
        }
    }

    @PluginMethod
    fun removeFromQueue(call: PluginCall) {
        val trackId = call.getString("trackId")
        if (trackId.isNullOrBlank()) {
            rejectInvalid(call, "removeFromQueue requires a trackId.")
            return
        }
        engine.removeFromQueue(trackId)
        call.resolve()
    }

    @PluginMethod
    fun moveInQueue(call: PluginCall) {
        val from = call.getInt("fromIndex")
        val to = call.getInt("toIndex")
        if (from == null || to == null) {
            rejectInvalid(call, "moveInQueue requires fromIndex and toIndex.")
            return
        }
        engine.moveInQueue(from, to)
        call.resolve()
    }

    @PluginMethod
    fun clearQueue(call: PluginCall) {
        engine.clearQueue()
        call.resolve()
    }

    @PluginMethod
    fun skipToIndex(call: PluginCall) {
        val index = call.getInt("index")
        if (index == null) {
            rejectInvalid(call, "skipToIndex requires an index.")
            return
        }
        engine.skipToIndex(index)
        call.resolve()
    }

    @PluginMethod
    fun getQueue(call: PluginCall) {
        val snapshot = engine.snapshot()
        call.resolve(
            JSObject()
                .put("trackIds", JSArray(engine.queueTrackIds()))
                .put("currentIndex", snapshot.currentIndex),
        )
    }

    // ---------------------------------------------------------------
    // Modes
    // ---------------------------------------------------------------

    @PluginMethod
    fun setShuffle(call: PluginCall) {
        engine.setShuffle(call.getBoolean("enabled", false) == true)
        call.resolve()
    }

    @PluginMethod
    fun setRepeatMode(call: PluginCall) {
        engine.setRepeatMode(RepeatMode.from(call.getString("mode")))
        call.resolve()
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getFloat("volume")
        if (volume == null) {
            rejectInvalid(call, "setVolume requires a volume.")
            return
        }
        engine.setVolume(volume)
        call.resolve()
    }

    // ---------------------------------------------------------------
    // Conversion helpers
    // ---------------------------------------------------------------

    private fun JSObject.toPlayerTrack(): PlayerTrack {
        val id = getString("id")
        val uri = getString("uri")

        if (id.isNullOrBlank()) {
            throw PlayerException(PlayerException.Code.INVALID_ARGUMENT, "A track is missing its id.")
        }
        if (uri.isNullOrBlank()) {
            throw PlayerException(PlayerException.Code.INVALID_URI, "\"$id\" has no playable location.")
        }

        return PlayerTrack(
            id = id,
            uri = uri,
            title = getString("title") ?: "UNKNOWN TITLE",
            artist = optNullableString("artist"),
            album = optNullableString("album"),
            artworkUri = optNullableString("artworkUri"),
            duration = optLong("duration", 0L),
        )
    }

    private fun JSArray.toPlayerTracks(): List<PlayerTrack> {
        val out = ArrayList<PlayerTrack>(length())
        for (i in 0 until length()) {
            val item = optJSONObject(i) ?: continue
            try {
                out.add(JSObject.fromJSONObject(item).toPlayerTrack())
            } catch (e: PlayerException) {
                // One malformed row must not fail the whole queue.
                Log.w(TAG, "Skipping unusable queue entry at $i: ${e.message}")
            }
        }
        return out
    }

    /** Treats JSON null and absent alike, unlike JSObject.getString. */
    private fun JSObject.optNullableString(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return optString(key).takeIf { it.isNotBlank() }
    }

    private fun PlayerSnapshot.toJs(): JSObject = JSObject()
        .put("state", state.lowercase)
        .put("isPlaying", isPlaying)
        .put("positionMs", positionMs)
        .put("durationMs", durationMs)
        .put("bufferedPositionMs", bufferedPositionMs)
        .put("currentIndex", currentIndex)
        .put("queueSize", queueSize)
        .put("shuffle", shuffle)
        .put("repeatMode", repeatMode.lowercase)
        .putNullable("currentTrackId", currentTrackId)

    private fun JSObject.putNullable(key: String, value: Any?): JSObject {
        // JSONObject.NULL, not JSObject.NULL: Kotlin does not inherit
        // Java static members through a subclass reference.
        if (value == null) put(key, JSONObject.NULL) else put(key, value)
        return this
    }

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    private fun rejectStructured(call: PluginCall, e: PlayerException) {
        Log.w(TAG, "Rejecting call: ${e.codeName} — ${e.message}")
        call.reject(e.message, e.codeName)
    }

    private fun rejectInvalid(call: PluginCall, message: String) {
        call.reject(message, PlayerException.Code.INVALID_ARGUMENT.name)
    }

    private fun rejectUnknown(call: PluginCall, message: String, t: Throwable) {
        // The stack trace goes to logcat only — never across the bridge.
        Log.e(TAG, message, t)
        call.reject(message, PlayerException.Code.UNKNOWN.name)
    }
}
