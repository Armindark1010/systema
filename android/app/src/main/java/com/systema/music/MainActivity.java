package com.systema.music;

import com.getcapacitor.BridgeActivity;
import com.systema.music.library.MusicLibraryPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Register SYSTEMA's native plugins before the bridge starts so
        // the WebView can resolve them on first load.
        registerPlugin(MusicLibraryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
