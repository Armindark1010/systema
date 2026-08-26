package com.systema.music.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.systema.music.player.model.PlaybackState
import com.systema.music.player.model.PlayerException
import com.systema.music.player.model.PlayerSnapshot
import com.systema.music.player.model.PlayerTrack
import com.systema.music.player.model.RepeatMode

/**
 * SYSTEMA — the native audio engine.
 *
 * Owns exactly one [ExoPlayer] for the whole application session and is
 * the source of truth for playback state. The bridge above it only
 * translates; it never keeps a second copy of the state.
 *
 * Design notes
 * ------------
 * *Single instance.* One player is created lazily on first use and
 * reused for every track. Media3's own playlist API handles track
 * transitions, so we never build a player per track.
 *
 * *Streaming, never copying.* Tracks are handed to ExoPlayer as
 * `content://` URIs. Nothing is copied to app storage and no audio is
 * read into memory by us — ExoPlayer buffers incrementally.
 *
 * *Queue lives in Media3.* Rather than tracking a parallel queue, the
 * ExoPlayer playlist *is* the queue. That is what makes shuffle,
 * repeat and boundary behaviour correct by construction instead of
 * re-implemented. [trackIds] only maps playlist indices back to
 * SYSTEMA ids.
 *
 * *Main-thread affinity.* ExoPlayer must be touched from the thread it
 * was built on. Every public entry point hops to the main looper.
 *
 * *Session-ready.* No Activity is retained (application context only)
 * and all state is derived from the player, so this class can later be
 * hosted inside a MediaSessionService without restructuring.
 */
class PlayerEngine private constructor(context: Context) {

    companion object {
        private const val TAG = "SystemaPlayerEngine"

        @Volatile
        private var instance: PlayerEngine? = null

        /** Process-wide singleton. Application context only — no leaks. */
        fun get(context: Context): PlayerEngine =
            instance ?: synchronized(this) {
                instance ?: PlayerEngine(context.applicationContext).also { instance = it }
            }
    }

    private val appContext: Context = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private var player: ExoPlayer? = null

    /** Playlist index -> SYSTEMA track id. Parallel to the ExoPlayer timeline. */
    private val trackIds = mutableListOf<String>()

    /** Metadata by track id, so snapshots can name the current track. */
    private val trackById = mutableMapOf<String, PlayerTrack>()

    // ---- Listener plumbing -------------------------------------

    /** Consumers (the Capacitor plugin) observe through these. */
    interface Listener {
        fun onSnapshot(snapshot: PlayerSnapshot)
        fun onTrackChanged(trackId: String?, index: Int)
        fun onError(error: PlayerException, trackId: String?)
        fun onQueueChanged(trackIds: List<String>, currentIndex: Int)
    }

    private val listeners = mutableListOf<Listener>()

    fun addListener(listener: Listener) {
        synchronized(listeners) { listeners.add(listener) }
    }

    fun removeListener(listener: Listener) {
        synchronized(listeners) { listeners.remove(listener) }
    }

    private fun forEachListener(block: (Listener) -> Unit) {
        val copy = synchronized(listeners) { listeners.toList() }
        copy.forEach {
            try {
                block(it)
            } catch (t: Throwable) {
                // A misbehaving consumer must never take down playback.
                Log.e(TAG, "Listener threw", t)
            }
        }
    }

    // ---- Main-thread helpers -----------------------------------

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else mainHandler.post(block)
    }

    /**
     * Runs [block] on the main thread and waits for the result.
     * Only used by the few genuinely synchronous getters.
     */
    private fun <T> onMainSync(fallback: T, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result = fallback
        val latch = java.util.concurrent.CountDownLatch(1)
        mainHandler.post {
            try {
                result = block()
            } catch (t: Throwable) {
                Log.e(TAG, "onMainSync failed", t)
            } finally {
                latch.countDown()
            }
        }
        // Bounded: never hang the bridge if the main thread is busy.
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return result
    }

    // ---- Player lifecycle --------------------------------------

    /**
     * Builds the player on first use. Safe to call repeatedly.
     * @throws PlayerException if ExoPlayer cannot be constructed.
     */
    private fun ensurePlayer(): ExoPlayer {
        player?.let { return it }

        return try {
            val built = ExoPlayer.Builder(appContext)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    // Let Media3 own audio focus: pause on calls, duck
                    // for notifications. Correct behaviour for free.
                    /* handleAudioFocus = */ true,
                )
                // Pause instead of continuing into a speaker when
                // headphones are unplugged.
                .setHandleAudioBecomingNoisy(true)
                .build()
                .also { it.addListener(playerListener) }

            player = built
            Log.i(TAG, "ExoPlayer initialised")
            built
        } catch (t: Throwable) {
            Log.e(TAG, "ExoPlayer initialisation failed", t)
            throw PlayerException(
                PlayerException.Code.INITIALIZATION_FAILED,
                "The audio engine could not be started on this device.",
                t,
            )
        }
    }

    /** Releases the player and clears all references. */
    fun release() = onMain {
        player?.let {
            try {
                it.removeListener(playerListener)
                it.release()
            } catch (t: Throwable) {
                Log.e(TAG, "Release failed", t)
            }
        }
        player = null
        trackIds.clear()
        trackById.clear()
        Log.i(TAG, "ExoPlayer released")
    }

    // ---- Media3 -> SYSTEMA event mapping -----------------------

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) = emitSnapshot()

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = emitSnapshot()

        override fun onIsPlayingChanged(isPlaying: Boolean) = emitSnapshot()

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val index = player?.currentMediaItemIndex ?: -1
            forEachListener { it.onTrackChanged(trackIdAt(index), index) }
            emitSnapshot()
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = emitSnapshot()

        override fun onRepeatModeChanged(repeatMode: Int) = emitSnapshot()

        override fun onPlayerError(error: PlaybackException) {
            val index = player?.currentMediaItemIndex ?: -1
            val trackId = trackIdAt(index)
            val mapped = mapPlaybackError(error)
            Log.e(TAG, "Playback error on ${trackId ?: "unknown"}: ${error.errorCodeName}", error)

            forEachListener { it.onError(mapped, trackId) }

            // One bad file must not end the session. Move past it when
            // there is somewhere to go; otherwise stop cleanly.
            val current = player
            if (current != null && current.hasNextMediaItem()) {
                Log.i(TAG, "Skipping unplayable item at $index")
                current.seekToNextMediaItem()
                current.prepare()
            } else {
                current?.stop()
            }
            emitSnapshot()
        }
    }

    /** Translates Media3 error codes into the SYSTEMA contract. */
    private fun mapPlaybackError(error: PlaybackException): PlayerException {
        val code = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND ->
                PlayerException.Code.FILE_UNAVAILABLE

            PlaybackException.ERROR_CODE_IO_NO_PERMISSION ->
                PlayerException.Code.PERMISSION_DENIED

            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            ->
                PlayerException.Code.INVALID_URI

            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            ->
                PlayerException.Code.DECODER_ERROR

            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
            ->
                PlayerException.Code.UNSUPPORTED_FORMAT

            else -> PlayerException.Code.PLAYBACK_ERROR
        }

        val message = when (code) {
            PlayerException.Code.FILE_UNAVAILABLE ->
                "This file is no longer available on the device."
            PlayerException.Code.PERMISSION_DENIED ->
                "SYSTEMA no longer has permission to read this file."
            PlayerException.Code.INVALID_URI ->
                "This track's location could not be opened."
            PlayerException.Code.DECODER_ERROR ->
                "This track could not be decoded."
            PlayerException.Code.UNSUPPORTED_FORMAT ->
                "This audio format is not supported on this device."
            else ->
                "Playback failed for this track."
        }

        return PlayerException(code, message, error)
    }

    private fun trackIdAt(index: Int): String? = trackIds.getOrNull(index)

    // ---- Snapshots ---------------------------------------------

    /** Reads the live player state. Must be called on the main thread. */
    private fun snapshotNow(): PlayerSnapshot {
        val p = player
        if (p == null) {
            return PlayerSnapshot(
                state = PlaybackState.IDLE,
                isPlaying = false,
                positionMs = 0,
                durationMs = 0,
                bufferedPositionMs = 0,
                currentIndex = -1,
                queueSize = trackIds.size,
                shuffle = false,
                repeatMode = RepeatMode.OFF,
                currentTrackId = null,
            )
        }

        val state = when (p.playbackState) {
            Player.STATE_BUFFERING -> PlaybackState.BUFFERING
            Player.STATE_READY -> PlaybackState.READY
            Player.STATE_ENDED -> PlaybackState.ENDED
            else -> PlaybackState.IDLE
        }

        // C.TIME_UNSET surfaces as 0 rather than a negative sentinel the
        // UI would have to special-case.
        val duration = p.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0L
        val index = p.currentMediaItemIndex

        return PlayerSnapshot(
            state = state,
            isPlaying = p.isPlaying,
            positionMs = p.currentPosition.coerceAtLeast(0),
            durationMs = duration,
            bufferedPositionMs = p.bufferedPosition.coerceAtLeast(0),
            currentIndex = if (trackIds.isEmpty()) -1 else index,
            queueSize = trackIds.size,
            shuffle = p.shuffleModeEnabled,
            repeatMode = when (p.repeatMode) {
                Player.REPEAT_MODE_ONE -> RepeatMode.ONE
                Player.REPEAT_MODE_ALL -> RepeatMode.ALL
                else -> RepeatMode.OFF
            },
            currentTrackId = trackIdAt(index),
        )
    }

    private fun emitSnapshot() {
        val snapshot = snapshotNow()
        forEachListener { it.onSnapshot(snapshot) }
    }

    private fun emitQueueChanged() {
        val ids = trackIds.toList()
        val index = player?.currentMediaItemIndex ?: -1
        forEachListener { it.onQueueChanged(ids, index) }
    }

    /** Current state, safe to call from any thread. */
    fun snapshot(): PlayerSnapshot = onMainSync(
        PlayerSnapshot(
            PlaybackState.IDLE, false, 0, 0, 0, -1, 0, false, RepeatMode.OFF, null,
        ),
    ) { snapshotNow() }

    /** Live position only — the cheap read used by the progress ticker. */
    fun positionMs(): Long = onMainSync(0L) { player?.currentPosition?.coerceAtLeast(0) ?: 0L }

    fun durationMs(): Long = onMainSync(0L) {
        player?.duration?.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0L
    }

    fun currentTrack(): PlayerTrack? = onMainSync(null) {
        trackIdAt(player?.currentMediaItemIndex ?: -1)?.let { trackById[it] }
    }

    // ---- Media item construction -------------------------------

    /**
     * Wraps a track as a Media3 item.
     *
     * Metadata travels as references — text and a URI. Artwork is a
     * `content://` URI so whoever renders it (a future notification or
     * lock screen) loads it lazily; no bitmap is decoded here.
     */
    private fun toMediaItem(track: PlayerTrack): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(track.artworkUri?.let(Uri::parse))
            .setIsPlayable(true)
            .build()

        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(Uri.parse(track.uri))
            .setMediaMetadata(metadata)
            .build()
    }

    private fun validate(track: PlayerTrack) {
        if (track.uri.isBlank()) {
            throw PlayerException(
                PlayerException.Code.INVALID_URI,
                "This track has no playable location.",
            )
        }
    }

    // ---- Transport ---------------------------------------------

    /**
     * Replaces the queue with [tracks] and starts at [startIndex].
     *
     * Errors are reported through the listener rather than thrown: the
     * call is asynchronous on the main thread by then.
     */
    fun setQueueAndPlay(tracks: List<PlayerTrack>, startIndex: Int, positionMs: Long = 0) = onMain {
        try {
            val p = ensurePlayer()
            val valid = tracks.filter { it.uri.isNotBlank() }

            if (valid.isEmpty()) {
                p.clearMediaItems()
                trackIds.clear()
                trackById.clear()
                emitQueueChanged()
                emitSnapshot()
                return@onMain
            }

            val safeIndex = startIndex.coerceIn(0, valid.lastIndex)

            trackIds.clear()
            trackById.clear()
            valid.forEach {
                trackIds.add(it.id)
                trackById[it.id] = it
            }

            p.setMediaItems(valid.map(::toMediaItem), safeIndex, positionMs)
            p.prepare()
            p.playWhenReady = true

            emitQueueChanged()
            forEachListener { it.onTrackChanged(trackIdAt(safeIndex), safeIndex) }
            emitSnapshot()
        } catch (e: PlayerException) {
            forEachListener { it.onError(e, null) }
        } catch (t: Throwable) {
            Log.e(TAG, "setQueueAndPlay failed", t)
            forEachListener {
                it.onError(
                    PlayerException(PlayerException.Code.UNKNOWN, "Playback could not be started.", t),
                    null,
                )
            }
        }
    }

    /** Replaces the queue without changing what is playing. */
    fun setQueue(tracks: List<PlayerTrack>, startIndex: Int) = onMain {
        try {
            val p = ensurePlayer()
            val valid = tracks.filter { it.uri.isNotBlank() }
            val safeIndex = if (valid.isEmpty()) 0 else startIndex.coerceIn(0, valid.lastIndex)

            trackIds.clear()
            trackById.clear()
            valid.forEach {
                trackIds.add(it.id)
                trackById[it.id] = it
            }

            p.setMediaItems(valid.map(::toMediaItem), safeIndex, 0)
            p.prepare()

            emitQueueChanged()
            emitSnapshot()
        } catch (t: Throwable) {
            Log.e(TAG, "setQueue failed", t)
        }
    }

    fun play() = onMain {
        try {
            val p = ensurePlayer()
            if (p.mediaItemCount == 0) return@onMain
            if (p.playbackState == Player.STATE_IDLE || p.playbackState == Player.STATE_ENDED) {
                p.seekTo(p.currentMediaItemIndex, 0)
                p.prepare()
            }
            p.play()
        } catch (t: Throwable) {
            Log.e(TAG, "play failed", t)
        }
    }

    fun pause() = onMain { player?.pause() }

    fun stop() = onMain {
        player?.let {
            it.stop()
            it.seekTo(0)
        }
        emitSnapshot()
    }

    /**
     * Next track.
     *
     * Uses Media3's own navigation, which already honours shuffle order
     * and repeat mode. With REPEAT_ONE an explicit Next should still
     * advance — repeat-one applies to *automatic* transitions, not to a
     * deliberate skip — so the mode is briefly bypassed.
     */
    fun next() = onMain {
        val p = player ?: return@onMain
        if (p.repeatMode == Player.REPEAT_MODE_ONE) {
            val saved = p.repeatMode
            p.repeatMode = Player.REPEAT_MODE_OFF
            if (p.hasNextMediaItem()) p.seekToNextMediaItem()
            p.repeatMode = saved
        } else if (p.hasNextMediaItem()) {
            p.seekToNextMediaItem()
        } else {
            // End of a non-repeating queue: park at the start, stopped.
            p.pause()
            p.seekTo(0)
        }
        emitSnapshot()
    }

    /**
     * Previous track, with the conventional "restart first" behaviour:
     * more than [restartThresholdMs] into a track, Previous restarts it
     * instead of moving back.
     */
    fun previous(restartThresholdMs: Long = 3_000) = onMain {
        val p = player ?: return@onMain
        if (p.currentPosition > restartThresholdMs || !p.hasPreviousMediaItem()) {
            p.seekTo(0)
        } else {
            p.seekToPreviousMediaItem()
        }
        emitSnapshot()
    }

    /** Absolute seek, clamped to [0, duration]. */
    fun seekTo(positionMs: Long) = onMain {
        val p = player ?: return@onMain
        val duration = p.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        p.seekTo(positionMs.coerceIn(0, duration))
        emitSnapshot()
    }

    /** Relative seek for the ±15s controls. Clamped at both ends. */
    fun seekBy(deltaMs: Long) = onMain {
        val p = player ?: return@onMain
        val duration = p.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        p.seekTo((p.currentPosition + deltaMs).coerceIn(0, duration))
        emitSnapshot()
    }

    /** Jumps to a queue index. */
    fun skipToIndex(index: Int) = onMain {
        val p = player ?: return@onMain
        if (index !in trackIds.indices) return@onMain
        p.seekTo(index, 0)
        p.prepare()
        p.play()
        emitSnapshot()
    }

    /** Plays the given track id if it is in the queue. */
    fun skipToTrackId(trackId: String) = onMain {
        val index = trackIds.indexOf(trackId)
        if (index >= 0) skipToIndex(index)
    }

    // ---- Queue editing -----------------------------------------

    fun addToQueue(track: PlayerTrack, atIndex: Int? = null) = onMain {
        try {
            validate(track)
            val p = ensurePlayer()
            val target = atIndex?.coerceIn(0, trackIds.size) ?: trackIds.size

            p.addMediaItem(target, toMediaItem(track))
            trackIds.add(target, track.id)
            trackById[track.id] = track

            if (p.playbackState == Player.STATE_IDLE) p.prepare()
            emitQueueChanged()
            emitSnapshot()
        } catch (e: PlayerException) {
            forEachListener { it.onError(e, track.id) }
        } catch (t: Throwable) {
            Log.e(TAG, "addToQueue failed", t)
        }
    }

    fun removeFromQueue(trackId: String) = onMain {
        val p = player ?: return@onMain
        val index = trackIds.indexOf(trackId)
        if (index < 0) return@onMain

        p.removeMediaItem(index)
        trackIds.removeAt(index)
        // Keep metadata only while some queue entry still references it.
        if (!trackIds.contains(trackId)) trackById.remove(trackId)

        emitQueueChanged()
        emitSnapshot()
    }

    fun moveInQueue(fromIndex: Int, toIndex: Int) = onMain {
        val p = player ?: return@onMain
        if (fromIndex !in trackIds.indices || toIndex !in trackIds.indices) return@onMain
        if (fromIndex == toIndex) return@onMain

        // ExoPlayer keeps the playing item playing across a move, which
        // is exactly the desired reorder behaviour.
        p.moveMediaItem(fromIndex, toIndex)
        trackIds.add(toIndex, trackIds.removeAt(fromIndex))

        emitQueueChanged()
        emitSnapshot()
    }

    fun clearQueue() = onMain {
        val p = player ?: return@onMain
        p.clearMediaItems()
        trackIds.clear()
        trackById.clear()
        emitQueueChanged()
        emitSnapshot()
    }

    // ---- Modes -------------------------------------------------

    /**
     * Real shuffle: Media3 keeps the playlist order intact and applies
     * a stable internal shuffle order on top. The current track keeps
     * playing, previous/next stay coherent, and the order survives for
     * the session — unlike picking a random track on every Next.
     */
    fun setShuffle(enabled: Boolean) = onMain {
        player?.shuffleModeEnabled = enabled
        emitSnapshot()
    }

    fun setRepeatMode(mode: RepeatMode) = onMain {
        player?.repeatMode = when (mode) {
            RepeatMode.ONE -> Player.REPEAT_MODE_ONE
            RepeatMode.ALL -> Player.REPEAT_MODE_ALL
            RepeatMode.OFF -> Player.REPEAT_MODE_OFF
        }
        emitSnapshot()
    }

    fun setVolume(volume: Float) = onMain {
        player?.volume = volume.coerceIn(0f, 1f)
    }

    /** Current queue as SYSTEMA ids, in playlist order. */
    fun queueTrackIds(): List<String> = onMainSync(emptyList()) { trackIds.toList() }
}
