package com.systema.music.player

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * SYSTEMA — the foreground playback service.
 *
 * This is what makes playback survive the Activity. Media3 hosts the
 * session here, in a service the system keeps alive while audio is
 * playing, so locking the phone or pressing Home no longer takes the
 * player down with the UI.
 *
 * Architecture
 * ------------
 * The service does *not* own a player. It publishes the process-wide
 * [PlayerEngine] singleton that Phase 2 already built:
 *
 *     PlayerEngine (one ExoPlayer)
 *         -> MediaSession (this service)
 *             -> notification / lock screen / Bluetooth
 *
 * There is exactly one ExoPlayer, one queue and one MediaSession in the
 * process. Everything the user can press — the in-app transport, the
 * notification, the lock screen, a headset button — ends up calling the
 * same [Player] instance, so Phase 2's shuffle, repeat and
 * previous-threshold semantics apply uniformly and are never
 * reimplemented per surface.
 *
 * Lifecycle
 * ---------
 * Media3 starts the foreground service and posts the media notification
 * on its own once playback begins; we do not build notifications, and
 * nothing here polls or ticks. [onTaskRemoved] decides what happens when
 * the user swipes the app away, and [onDestroy] releases the session.
 *
 * Note the service is *not* exported: only this app and the system media
 * button dispatcher talk to it.
 */
class PlaybackService : MediaSessionService() {

    private companion object {
        const val TAG = "SystemaPlaybackSvc"
    }

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()

        // The same engine the Capacitor plugin drives. Application
        // context only — the service must never hold an Activity.
        val player = try {
            PlayerEngine.get(applicationContext).sessionPlayer()
        } catch (t: Throwable) {
            // The engine could not build an ExoPlayer on this device.
            // Nothing to publish, so shut down rather than sitting here
            // as a service with no session.
            Log.e(TAG, "No player available; stopping service", t)
            stopSelf()
            return
        }

        // Tapping the notification or lock-screen artwork reopens
        // SYSTEMA rather than launching a fresh task.
        val sessionActivity = packageManager
            .getLaunchIntentForPackage(packageName)
            ?.let { intent ->
                PendingIntent.getActivity(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
            }

        mediaSession = try {
            MediaSession.Builder(this, player)
                .apply { sessionActivity?.let(::setSessionActivity) }
                // No custom MediaSession.Callback.
                //
                // An earlier version installed one that intersected the
                // available commands with player.isCommandAvailable() at
                // connect time. onConnect fires for the notification's
                // own controller while the player is still empty, so
                // COMMAND_PLAY_PAUSE was evaluated as unavailable and
                // stripped — permanently, because the command set is
                // fixed at connect. Media3 will not build a media
                // notification without a play/pause action, so no
                // notification ever appeared.
                //
                // Media3's default already tracks command availability
                // dynamically and notifies controllers as it changes,
                // which is exactly the behaviour we want.
                .build()
        } catch (t: Throwable) {
            // A session failure must not crash the app; in-app playback
            // still works, only the background controls are missing.
            Log.e(TAG, "MediaSession could not be created", t)
            null
        }

        Log.i(TAG, "Playback service created (session=${mediaSession != null})")
    }

    /**
     * Grants controllers the commands SYSTEMA actually supports.
     *
     * Media3 derives the notification's buttons and its progress bar
     * from the session's available commands. The default connection
     * result is usually enough, but being explicit here documents the
     * contract and guarantees the seek commands survive: a scrubber
     * only appears if COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM is available,
     * and skip buttons need COMMAND_SEEK_TO_{NEXT,PREVIOUS}.
     *
     * Crucially the command set is intersected with what the PLAYER
     * reports, so we never advertise something ExoPlayer cannot do —
     * seeking an unseekable or still-unknown-duration item stays
     * correctly unavailable until the duration resolves.
     */
    /**
     * Hands the session to controllers: the system media button
     * receiver, the notification, Android Auto, Wear, and so on.
     */
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    /**
     * The user swiped SYSTEMA out of Recents.
     *
     * If audio is still playing we keep the session alive — that is the
     * behaviour people expect from a music app, and the notification
     * remains the way to control it. If playback is stopped or paused
     * there is nothing worth keeping a service for, so we shut down
     * cleanly instead of lingering with a dead notification.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            Log.i(TAG, "Task removed while idle — stopping service")
            stopSelf()
        } else {
            Log.i(TAG, "Task removed while playing — session stays alive")
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Log.i(TAG, "Playback service destroyed")

        // Release the session but NOT the player: the engine is
        // process-scoped and may be reused if the UI comes back. The
        // engine's own release() is the single place that tears the
        // ExoPlayer down.
        mediaSession?.run {
            release()
            mediaSession = null
        }

        super.onDestroy()
    }
}
