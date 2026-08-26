package com.systema.music;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.systema.music.analysis.AudioAnalysisPlugin;
import com.systema.music.library.MusicLibraryPlugin;
import com.systema.music.player.PlayerPlugin;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SystemaMain";

    /** Arbitrary, local to this Activity. */
    private static final int REQ_POST_NOTIFICATIONS = 3001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate(): BridgeActivity builds the
        // Bridge inside its own onCreate, and only plugins present on the
        // builder at that moment are exported to the WebView via
        // window.Capacitor.PluginHeaders.
        //
        // Bridge.registerPlugin() swallows PluginLoadException and merely
        // logs it, so a plugin that fails to construct disappears silently
        // and the web layer sees exactly what a browser sees. Log loudly
        // on both sides of registration so that failure is never silent.
        Log.i(TAG, "Registering MusicLibraryPlugin");
        try {
            registerPlugin(MusicLibraryPlugin.class);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to register MusicLibraryPlugin", t);
        }

        Log.i(TAG, "Registering PlayerPlugin");
        try {
            registerPlugin(PlayerPlugin.class);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to register PlayerPlugin", t);
        }

        // Phase 13 DSP analysis. Registration failing here must never
        // affect playback: the web layer treats a missing plugin as
        // "analysis unavailable" and carries on.
        Log.i(TAG, "Registering AudioAnalysisPlugin");
        try {
            registerPlugin(AudioAnalysisPlugin.class);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to register AudioAnalysisPlugin", t);
        }

        super.onCreate(savedInstanceState);

        // Ask for POST_NOTIFICATIONS natively, right at startup.
        //
        // The media notification cannot be posted on Android 13+ until
        // this is granted, and Android silently drops the post rather
        // than reporting an error — which is exactly what "no
        // notification appears" looks like.
        //
        // This runs here, in the Activity, instead of relying on the
        // WebView: the JS path only fires once the bridge is up and the
        // player composable has initialised, which is later than the
        // first track can start, and it never runs at all if the plugin
        // fails to register. Doing it natively makes it unconditional.
        //
        // Playback never depends on the outcome. A denial only hides
        // the notification; audio, lock-screen controls and Bluetooth
        // buttons all keep working.
        requestNotificationPermissionIfNeeded();

        if (getBridge() != null) {
            boolean present = getBridge().getPlugin("MusicLibrary") != null;
            Log.i(TAG, "MusicLibrary plugin registered with bridge: " + present);
            Log.i(TAG, "Player plugin registered with bridge: "
                + (getBridge().getPlugin("Player") != null));
            Log.i(TAG, "AudioAnalysis plugin registered with bridge: "
                + (getBridge().getPlugin("AudioAnalysis") != null));
            if (!present) {
                Log.e(
                    TAG,
                    "MusicLibrary is NOT registered. The WebView will fall back to mock data. "
                        + "Look for an earlier PluginLoadException / InvalidPluginException."
                );
            }
        }
    }

    /**
     * Requests POST_NOTIFICATIONS on Android 13+ only.
     *
     * Below API 33 the permission does not exist and notifications need
     * no runtime grant, so nothing is requested there.
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            Log.i(TAG, "POST_NOTIFICATIONS not required below API 33");
            return;
        }

        boolean granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;

        if (granted) {
            Log.i(TAG, "POST_NOTIFICATIONS already granted");
            return;
        }

        Log.i(TAG, "Requesting POST_NOTIFICATIONS");
        try {
            ActivityCompat.requestPermissions(
                this,
                new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                REQ_POST_NOTIFICATIONS
            );
        } catch (Throwable t) {
            // Never fatal: the app must keep playing music either way.
            Log.w(TAG, "Could not request POST_NOTIFICATIONS", t);
        }
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode, String[] permissions, int[] grantResults
    ) {
        if (requestCode == REQ_POST_NOTIFICATIONS) {
            boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Log.i(TAG, "POST_NOTIFICATIONS granted: " + granted);
            if (!granted) {
                Log.i(TAG, "Media notification will be hidden; playback continues normally.");
            }
            // Deliberately not forwarded to Capacitor: this is not a
            // plugin-initiated request and Capacitor has no pending call
            // for it. The Player plugin's own getNotificationPermission()
            // reads the live state whenever the frontend asks.
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
}
