package com.systema.music.library

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Android-version-aware audio permission handling.
 *
 * API 33+  : READ_MEDIA_AUDIO (granular media permission)
 * API 24-32: READ_EXTERNAL_STORAGE
 *
 * We never request WRITE_EXTERNAL_STORAGE, MANAGE_EXTERNAL_STORAGE or
 * any unrelated permission — reading the audio index is all Phase 1
 * needs, and MediaStore already honours scoped storage for us.
 *
 * On API 34+ the user can additionally grant *partial* media access
 * (READ_MEDIA_VISUAL_USER_SELECTED). That selector covers images and
 * video only; audio remains all-or-nothing, so a granted
 * READ_MEDIA_AUDIO is still a complete audio grant.
 */
object MusicPermissions {

    /** The single runtime permission this app needs for its library. */
    val required: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, required) == PackageManager.PERMISSION_GRANTED

    /**
     * Capacitor-style permission state string.
     * `prompt` is reported when we have not been granted access yet;
     * the plugin layer upgrades this to `denied` once the OS reports a
     * permanent refusal.
     */
    fun stateFor(context: Context): String =
        if (hasPermission(context)) GRANTED else PROMPT

    const val GRANTED = "granted"
    const val DENIED = "denied"
    const val PROMPT = "prompt"
    const val PROMPT_WITH_RATIONALE = "prompt-with-rationale"
}
