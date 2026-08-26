package com.systema.music.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
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

        /** Matches the in-app +/-15s transport controls. */
        private const val SEEK_INCREMENT_MS = 15_000L

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

    /** True once PlaybackService has been asked to start this session. */
    private var serviceStarted = false

    /**
     * True when the most recent pause came from losing audio focus
     * rather than from the user. Surfaced in the snapshot so the UI can
     * describe an interruption honestly; cleared as soon as playback
     * resumes.
     */
    private var lastPauseWasInterruption = false

    /** Playlist index -> SYSTEMA track id. Parallel to the ExoPlayer timeline. */
    private val trackIds = mutableListOf<String>()

    /** Metadata by track id, so snapshots can name the current track. */
    private val trackById = mutableMapOf<String, PlayerTrack>()

    /**
     * Track ids Media3 has already failed to play in this session.
     *
     * A permanently broken file (deleted, corrupt, unsupported codec)
     * fails the same way every time, so retrying it is pure waste.
     * Cleared whenever the queue is replaced — the user may have fixed
     * the underlying problem, and a fresh context deserves a fresh try.
     */
    private val failedTrackIds = mutableSetOf<String>()

    /**
     * The next queue index after [fromIndex] that has not already
     * failed, honouring repeat-all's wrap-around, or null when every
     * remaining item is known-bad.
     */
    private fun nextPlayableIndexFrom(fromIndex: Int): Int? {
        val p = player ?: return null
        if (trackIds.isEmpty()) return null

        val wrap = p.repeatMode == Player.REPEAT_MODE_ALL
        var i = fromIndex + 1
        while (i < trackIds.size) {
            if (trackIds[i] !in failedTrackIds) return i
            i++
        }
        if (!wrap) return null
        // Wrapped search, bounded by fromIndex so we cannot spin.
        i = 0
        while (i <= fromIndex && i < trackIds.size) {
            if (trackIds[i] !in failedTrackIds) return i
            i++
        }
        return null
    }

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
                // Declaring the increments is what makes ExoPlayer
                // advertise COMMAND_SEEK_BACK / COMMAND_SEEK_FORWARD in
                // its available commands, which is how the notification
                // and Android Auto decide whether to offer those
                // buttons. Matches the in-app +/-15s controls exactly so
                // every surface steps by the same amount.
                .setSeekBackIncrementMs(SEEK_INCREMENT_MS)
                .setSeekForwardIncrementMs(SEEK_INCREMENT_MS)
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

    /**
     * Starts [PlaybackService] so the session outlives the Activity.
     *
     * Called when playback is requested — at that point the app is
     * foreground and permitted to start a service. Media3 handles the
     * foreground promotion and the notification from there, so this
     * runs once per session rather than on any kind of timer.
     *
     * Failures are swallowed deliberately: on the rare occasion Android
     * refuses the start (an aggressive OEM, or a background race), audio
     * still plays through the Activity-hosted player. Losing background
     * controls is far better than crashing the app.
     */
    private fun ensureServiceStarted() {
        if (serviceStarted) return
        try {
            val intent = Intent(appContext, PlaybackService::class.java)

            // startForegroundService, not startService.
            //
            // A plain startService() leaves the service in the background
            // state, and Media3 will not post a media notification for a
            // background service — which is exactly why the notification
            // never appeared even though audio played fine. From API 26
            // the system also requires the foreground variant here and
            // expects startForeground() within ~5s; MediaSessionService
            // makes that call itself as soon as it has a session.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }

            serviceStarted = true
            Log.i(TAG, "Playback service started in foreground mode")
        } catch (t: Throwable) {
            // Android 12+ throws ForegroundServiceStartNotAllowedException
            // if we somehow got here from the background. Audio still
            // plays; only the notification is missing.
            Log.w(TAG, "Could not start playback service; in-app playback continues", t)
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
        failedTrackIds.clear()

        // Drop any armed sleep timer with the player it would have
        // paused, so no handler message outlives the engine.
        mainHandler.removeCallbacks(sleepRunnable)
        sleepDeadlineAt = null

        // Let the service shut down with the player it was publishing,
        // so no empty notification is left behind.
        if (serviceStarted) {
            try {
                appContext.stopService(Intent(appContext, PlaybackService::class.java))
            } catch (t: Throwable) {
                Log.w(TAG, "Stopping playback service failed", t)
            }
            serviceStarted = false
        }
        Log.i(TAG, "ExoPlayer released")
    }

    // ---- Media3 -> SYSTEMA event mapping -----------------------

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) = emitSnapshot()

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            // Bring the playback service up as soon as the user asks for
            // audio, while the app is still foreground and allowed to
            // start it. Media3 promotes it to a foreground service and
            // posts the notification itself once playback is running.
            if (playWhenReady) ensureServiceStarted()

            // AUDIO FOCUS, reported rather than re-implemented.
            //
            // Media3 already handles focus correctly because the player
            // is built with handleAudioFocus = true: it ducks for a
            // transient-may-duck request (navigation prompts), pauses
            // for a transient one (a call), and stops for a permanent
            // loss (another music app). We deliberately do not fight
            // any of that.
            //
            // What was missing is that the frontend could not tell an
            // interruption apart from the user pressing pause — both
            // arrived as isPlaying=false. Forwarding the reason lets
            // the UI stay honest without changing the behaviour.
            lastPauseWasInterruption =
                !playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS

            if (lastPauseWasInterruption) {
                Log.i(TAG, "Paused by audio focus loss")
            }

            emitSnapshot()
        }

        /**
         * Media3's own ducking notification.
         *
         * Purely informational: the volume change is already applied by
         * the focus handler. We log it so a field report of "the music
         * went quiet" is diagnosable from logcat.
         */
        override fun onVolumeChanged(volume: Float) {
            Log.d(TAG, "Player volume now $volume")
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            // Playback is back: whatever interrupted it is over.
            if (isPlaying) lastPauseWasInterruption = false
            emitSnapshot()
        }

        /**
         * A seek happened — from the notification, the lock screen, a
         * Bluetooth remote, or our own transport.
         *
         * Without this the position moved natively but nothing told the
         * WebView, so the in-app progress bar kept counting from where
         * it was and only corrected on the next unrelated event. Media3
         * raises a SEEK discontinuity for exactly this case; forwarding
         * one snapshot re-anchors the UI clock immediately.
         *
         * This is event-driven, not polled: it fires once per seek.
         */
        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK ||
                reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT
            ) {
                emitSnapshot()
            }
        }

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

            // Remember the failure so we never retry this item again in
            // this session. Without this a queue of unplayable files
            // under REPEAT_ALL wraps around and retries the first
            // broken track forever, pegging the CPU and spamming the
            // frontend with identical errors.
            if (trackId != null) failedTrackIds.add(trackId)

            val current = player
            if (current == null) {
                emitSnapshot()
                return
            }

            // One bad file must not end the session: advance to the
            // next item that has not already failed. Skipping over the
            // known-bad ones is what stops the error loop.
            val nextPlayable = nextPlayableIndexFrom(index)
            if (nextPlayable != null) {
                Log.i(TAG, "Skipping unplayable item at $index -> $nextPlayable")
                current.seekTo(nextPlayable, 0)
                current.prepare()
            } else {
                // Everything left is known-broken. Stop cleanly rather
                // than looping; the frontend already has the error.
                Log.w(TAG, "No playable item remains; stopping")
                failedTrackIds.clear()
                current.stop()
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
            // Only meaningful while actually paused.
            interrupted = lastPauseWasInterruption && !p.isPlaying,
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

    /**
     * The underlying [Player], for the MediaSession to publish.
     *
     * This is deliberately the *same* instance every caller drives —
     * the session wraps it rather than owning a second player, so the
     * notification, lock screen and Bluetooth buttons all operate on
     * one queue with one set of shuffle/repeat semantics.
     *
     * Must be called from the main thread (the service's onCreate is).
     */
    fun sessionPlayer(): ExoPlayer = ensurePlayer()

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
            // A new context deserves a fresh attempt at every track.
            failedTrackIds.clear()
            valid.forEach {
                trackIds.add(it.id)
                trackById[it.id] = it
            }

            p.setMediaItems(valid.map(::toMediaItem), safeIndex, positionMs)
            p.prepare()

            // Bring the service up BEFORE playback starts. Starting it
            // from the playWhenReady listener alone was too late and too
            // indirect: by then the notification had already been
            // skipped for the first item. This call is latched, so the
            // duplicate from the listener is a no-op.
            ensureServiceStarted()

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
            // A new context deserves a fresh attempt at every track.
            failedTrackIds.clear()
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
            // Resuming after the service was torn down must bring it
            // back, otherwise playback continues with no notification.
            ensureServiceStarted()
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

    /**
     * The seekable upper bound, or null while it is genuinely unknown.
     *
     * Media3 reports an unknown duration as [C.TIME_UNSET], but during
     * preparation it also briefly reports **0**, and a 0 upper bound
     * clamped every seek to the start of the track. That is what made
     * "seek immediately after a track change" and "seek before the
     * duration is known" silently jump to 0:00 instead of the
     * requested position. Both cases are now treated as "unknown", and
     * an unknown bound means we pass the request through and let
     * ExoPlayer clamp it once the timeline resolves.
     */
    private fun seekableDurationMs(p: ExoPlayer): Long? =
        p.duration.takeIf { it != C.TIME_UNSET && it > 0 }

    /** Absolute seek, clamped to [0, duration] when the duration is known. */
    fun seekTo(positionMs: Long) = onMain {
        try {
            val p = player ?: return@onMain
            if (p.mediaItemCount == 0) return@onMain
            val duration = seekableDurationMs(p)
            // Negative requests always clamp; the upper bound only
            // applies once it is real.
            val target = if (duration != null) {
                positionMs.coerceIn(0, duration)
            } else {
                positionMs.coerceAtLeast(0)
            }
            p.seekTo(target)
            emitSnapshot()
        } catch (t: Throwable) {
            // An out-of-range seek against a timeline that changed
            // underneath us must not take the session down.
            Log.w(TAG, "seekTo failed", t)
        }
    }

    /** Relative seek for the ±15s controls. Clamped at both ends. */
    fun seekBy(deltaMs: Long) = onMain {
        try {
            val p = player ?: return@onMain
            if (p.mediaItemCount == 0) return@onMain
            val duration = seekableDurationMs(p)
            val raw = p.currentPosition + deltaMs
            val target = if (duration != null) raw.coerceIn(0, duration) else raw.coerceAtLeast(0)
            p.seekTo(target)
            emitSnapshot()
        } catch (t: Throwable) {
            Log.w(TAG, "seekBy failed", t)
        }
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
        failedTrackIds.clear()
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

    // ---- Sleep timer -------------------------------------------

    /**
     * SLEEP TIMER — native, because the WebView one could not work.
     *
     * The previous implementation was a `setInterval` in the WebView.
     * Android freezes or heavily throttles a backgrounded WebView, so
     * the countdown stalled in exactly the situation the feature
     * exists for: screen off, phone in a pocket. It also only flipped a
     * Pinia boolean, so the real audio never stopped.
     *
     * This version lives beside the player:
     *
     * - **One mechanism.** A single [Handler] message on the main
     *   looper. No thread, no coroutine scope, no wakelock and no
     *   per-second tick — the handler wakes once, at the end.
     * - **Absolute deadline.** We store the wall-clock instant the
     *   timer should fire and derive the remaining time from it, so a
     *   suspended CPU cannot make the timer drift or lose time the way
     *   a decrementing counter does.
     * - **Survives the Activity.** The engine is process-scoped and the
     *   service keeps the process alive while audio plays, so
     *   recreating the Activity leaves the deadline untouched.
     * - **Independent of the queue.** Nothing here is bound to a track,
     *   so Next/Previous cannot reset it.
     *
     * Not an alarm/wakelock by design: it only needs to fire while
     * audio is playing, and playing audio already keeps the process
     * alive. Asking for a wakelock would keep the CPU up for nothing.
     */

    /** Wall-clock ms when the timer fires, or null when inactive. */
    private var sleepDeadlineAt: Long? = null

    private val sleepRunnable = Runnable { onSleepTimerExpired() }

    /** Fired when the timer elapses, so the bridge can tell the UI. */
    interface SleepTimerListener {
        fun onSleepTimerChanged(deadlineAt: Long?, remainingMs: Long)
        fun onSleepTimerExpired()
    }

    private val sleepListeners = mutableListOf<SleepTimerListener>()

    fun addSleepTimerListener(listener: SleepTimerListener) {
        synchronized(sleepListeners) { sleepListeners.add(listener) }
    }

    fun removeSleepTimerListener(listener: SleepTimerListener) {
        synchronized(sleepListeners) { sleepListeners.remove(listener) }
    }

    private fun forEachSleepListener(block: (SleepTimerListener) -> Unit) {
        val copy = synchronized(sleepListeners) { sleepListeners.toList() }
        copy.forEach {
            try {
                block(it)
            } catch (t: Throwable) {
                Log.e(TAG, "Sleep listener threw", t)
            }
        }
    }

    /**
     * Arms the timer for [durationMs] from now, replacing any existing
     * one. A non-positive duration cancels instead.
     */
    fun setSleepTimer(durationMs: Long) = onMain {
        mainHandler.removeCallbacks(sleepRunnable)

        if (durationMs <= 0) {
            sleepDeadlineAt = null
            Log.i(TAG, "Sleep timer cancelled")
            forEachSleepListener { it.onSleepTimerChanged(null, 0) }
            return@onMain
        }

        val deadline = System.currentTimeMillis() + durationMs
        sleepDeadlineAt = deadline
        mainHandler.postDelayed(sleepRunnable, durationMs)
        Log.i(TAG, "Sleep timer armed for ${durationMs}ms")
        forEachSleepListener { it.onSleepTimerChanged(deadline, durationMs) }
    }

    fun cancelSleepTimer() = setSleepTimer(0)

    /** Milliseconds left, or 0 when no timer is armed. */
    fun sleepRemainingMs(): Long = onMainSync(0L) {
        val deadline = sleepDeadlineAt ?: return@onMainSync 0L
        (deadline - System.currentTimeMillis()).coerceAtLeast(0)
    }

    fun sleepDeadlineAtMs(): Long? = onMainSync(null) { sleepDeadlineAt }

    /**
     * The timer elapsed: pause the REAL player.
     *
     * Pause rather than stop, so the user reopens the app exactly where
     * they fell asleep. Pausing the shared player is enough for every
     * surface to follow — MediaSession publishes the new state to the
     * notification and lock screen on its own, and the snapshot below
     * carries it to Pinia. Nothing is faked at any layer.
     */
    private fun onSleepTimerExpired() {
        sleepDeadlineAt = null
        Log.i(TAG, "Sleep timer expired — pausing playback")
        try {
            player?.pause()
        } catch (t: Throwable) {
            Log.e(TAG, "Sleep timer could not pause the player", t)
        }
        forEachSleepListener {
            it.onSleepTimerChanged(null, 0)
            it.onSleepTimerExpired()
        }
        emitSnapshot()
    }
}
