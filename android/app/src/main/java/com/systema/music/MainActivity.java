package com.systema.music;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.systema.music.analysis.AudioAnalysisPlugin;
import com.systema.music.dataset.AiDatasetPlugin;
import com.systema.music.inference.InferencePlugin;
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

        // Phase 15 ONNX inference, used only by the developer
        // benchmark lab. If ONNX Runtime's native library is missing
        // for this ABI the class still loads — availability is probed
        // lazily inside the runtime — so registration failing here
        // would indicate a genuine build problem, not a device
        // limitation. Either way it must not affect playback.
        Log.i(TAG, "Registering InferencePlugin");
        try {
            registerPlugin(InferencePlugin.class);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to register InferencePlugin", t);
        }

        // Phase 28 dataset collection. Unlike the plugins above, a
        // failure here is NOT harmless-and-quiet: the web layer would
        // fall back to a volatile store, and someone could label an
        // entire library into a map that dies with the tab. The
        // frontend detects the missing plugin and refuses to report a
        // successful save, but that only works if this line is here.
        Log.i(TAG, "Registering AiDatasetPlugin");
        try {
            registerPlugin(AiDatasetPlugin.class);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to register AiDatasetPlugin", t);
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

        installRendererDiagnostics();

        if (getBridge() != null) {
            boolean present = getBridge().getPlugin("MusicLibrary") != null;
            Log.i(TAG, "MusicLibrary plugin registered with bridge: " + present);
            Log.i(TAG, "Player plugin registered with bridge: "
                + (getBridge().getPlugin("Player") != null));
            Log.i(TAG, "AudioAnalysis plugin registered with bridge: "
                + (getBridge().getPlugin("AudioAnalysis") != null));
            Log.i(TAG, "Inference plugin registered with bridge: "
                + (getBridge().getPlugin("Inference") != null));

            boolean datasetPresent = getBridge().getPlugin("AiDataset") != null;
            Log.i(TAG, "AiDataset plugin registered with bridge: " + datasetPresent);
            if (!datasetPresent) {
                Log.e(
                    TAG,
                    "AiDataset is NOT registered. The dataset page will report NOT PERSISTED "
                        + "and refuse to save labels. Look for an earlier PluginLoadException."
                );
            }
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
     * Makes a WebView renderer death visible instead of silent.
     *
     * WHY THIS EXISTS
     * ---------------
     * When the WebView's render process dies — almost always because it
     * hit its per-renderer memory cap — Android tears the whole app
     * down. By default Capacitor does not handle onRenderProcessGone,
     * so the failure surfaces to the user as "the app closed itself"
     * with nothing in logcat that names a cause, and no Java stack
     * trace, because no Java exception was ever thrown.
     *
     * That is exactly what "runs for a few minutes, then crashes"
     * looks like, and it is indistinguishable from a native crash
     * without this hook. Logging `didCrash()` separates the two cases
     * definitively:
     *
     *   didCrash = false → the SYSTEM killed the renderer, i.e. it was
     *                      out of memory. Look at the heap figures
     *                      logged below.
     *   didCrash = true  → the renderer itself crashed (a WebView/Chromium
     *                      bug), which is a very different investigation.
     *
     * Returning false preserves the existing behaviour — the process
     * still goes away — because silently reloading the WebView would
     * hide a real bug and lose playback state. This is a diagnostic,
     * not a workaround.
     *
     * Diagnose with:
     *   adb logcat -s SystemaMain
     */
    private void installRendererDiagnostics() {
        if (getBridge() == null) {
            Log.w(TAG, "No bridge; renderer diagnostics not installed");
            return;
        }

        logMemoryState("startup");

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean rendererCrashed =
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash();

                Log.e(TAG, "WEBVIEW RENDER PROCESS GONE — the app is about to die.");
                Log.e(TAG, "  didCrash=" + rendererCrashed
                    + (rendererCrashed
                        ? "  (the renderer itself crashed — a WebView bug, not memory)"
                        : "  (the SYSTEM killed the renderer — almost certainly out of memory)"));
                logMemoryState("at renderer death");

                // Not handled: let the default teardown happen. Swallowing
                // this would mask the bug rather than fix it.
                return false;
            }
        });
    }

    /**
     * Logs the Java heap and this app's total memory footprint.
     *
     * The renderer runs in a separate process with its own limit, so
     * these numbers do not capture it directly — but a Java heap that
     * climbs steadily between the two log points is strong evidence
     * that the WebView side is growing too.
     */
    private void logMemoryState(String when) {
        try {
            Runtime runtime = Runtime.getRuntime();
            long usedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024);
            long maxMb = runtime.maxMemory() / (1024 * 1024);

            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            int pssMb = 0;
            if (am != null) {
                Debug.MemoryInfo[] infos = am.getProcessMemoryInfo(new int[]{ android.os.Process.myPid() });
                if (infos != null && infos.length > 0) {
                    pssMb = infos[0].getTotalPss() / 1024;
                }
            }

            Log.i(TAG, "MEMORY " + when + ": javaHeap=" + usedMb + "/" + maxMb + "MB, totalPss=" + pssMb + "MB");
        } catch (Throwable t) {
            // Diagnostics must never be the thing that breaks the app.
            Log.w(TAG, "Could not read memory state", t);
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
