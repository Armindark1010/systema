package com.systema.music.player

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.MediaStyleNotificationHelper
import com.systema.music.R

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
 * [PlayerEngine] singleton:
 *
 *     PlayerEngine (one ExoPlayer)
 *         -> MediaSession (this service)
 *             -> notification / lock screen / Bluetooth
 *
 * There is exactly one ExoPlayer, one queue and one MediaSession in the
 * process. Everything the user can press — the in-app transport, the
 * notification, the lock screen, a headset button — ends up calling the
 * same [Player] instance.
 *
 * Lifecycle
 * ---------
 * Uses Media3's [DefaultMediaNotificationProvider] with [MediaStyleNotificationHelper]
 * so Android renders the full System Media Player card (title, artist, album art,
 * seekbar, and playback action controls).
 */
class PlaybackService : MediaSessionService() {

    private companion object {
        const val TAG = "SystemaPlaybackSvc"
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "systema_playback_channel"
    }

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()

        // 1. Create NotificationChannel for Android 8.0+ (Oreo+)
        createNotificationChannel()

        // 2. Obtain shared ExoPlayer instance
        val player = try {
            PlayerEngine.get(applicationContext).sessionPlayer()
        } catch (t: Throwable) {
            Log.e(TAG, "No player available; stopping service", t)
            stopSelf()
            return
        }

        // 3. Configure PendingIntent for tapping notification to reopen SYSTEMA
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

        // 4. Build MediaSession attached to the shared ExoPlayer
        mediaSession = try {
            MediaSession.Builder(this, player)
                .apply { sessionActivity?.let(::setSessionActivity) }
                .build()
        } catch (t: Throwable) {
            Log.e(TAG, "MediaSession could not be created", t)
            null
        }

        // 5. Connect Media3 DefaultMediaNotificationProvider so live playback updates the card
        try {
            val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.default_notification_channel_name)
                .setNotificationId(NOTIFICATION_ID)
                .build()
            setMediaNotificationProvider(notificationProvider)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to set DefaultMediaNotificationProvider", t)
        }

        // 6. Start initial foreground notification with MediaStyle to satisfy Android's 5s deadline
        startInitialForeground(sessionActivity)

        Log.i(TAG, "Playback service created (session=${mediaSession != null})")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelName = try {
                getString(R.string.default_notification_channel_name)
            } catch (_: Throwable) {
                "Playback"
            }
            val channel = NotificationChannel(
                CHANNEL_ID,
                channelName,
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "SYSTEMA music playback controls"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun startInitialForeground(sessionActivity: PendingIntent?) {
        try {
            val appTitle = try {
                getString(R.string.app_name)
            } catch (_: Throwable) {
                "SYSTEMA"
            }

            val session = mediaSession
            val builder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(appTitle)
                .setContentText("SYSTEMA Audio Engine")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .apply {
                    sessionActivity?.let { setContentIntent(it) }
                    if (session != null) {
                        setStyle(MediaStyleNotificationHelper.MediaStyle(session))
                    }
                }

            val notification = builder.build()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            Log.i(TAG, "Initial MediaStyle foreground notification started successfully")
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start initial foreground notification", t)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }

    /**
     * Hands the session to controllers: system media button receiver,
     * notification, lock screen, Android Auto, Bluetooth devices.
     */
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    /**
     * The user swiped SYSTEMA out of Recents.
     * If audio is still playing, keep the session alive.
     * If idle/paused, stop service cleanly.
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

        mediaSession?.run {
            release()
            mediaSession = null
        }

        super.onDestroy()
    }
}
