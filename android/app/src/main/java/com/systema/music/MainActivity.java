package com.systema.music;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.systema.music.library.MusicLibraryPlugin;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SystemaMain";

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

        super.onCreate(savedInstanceState);

        if (getBridge() != null) {
            boolean present = getBridge().getPlugin("MusicLibrary") != null;
            Log.i(TAG, "MusicLibrary plugin registered with bridge: " + present);
            if (!present) {
                Log.e(
                    TAG,
                    "MusicLibrary is NOT registered. The WebView will fall back to mock data. "
                        + "Look for an earlier PluginLoadException / InvalidPluginException."
                );
            }
        }
    }
}
