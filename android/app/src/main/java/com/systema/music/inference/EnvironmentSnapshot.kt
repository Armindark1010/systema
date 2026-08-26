package com.systema.music.inference

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.getcapacitor.JSObject

/**
 * The device state a measurement was taken in.
 *
 * WHY THIS EXISTS (Phase 14 §1)
 * -----------------------------
 * On the Poco X7 Pro the SAME track measured 12.77 s with the screen
 * on and 29.58 s with it off — a 2.32x difference, applied near
 * uniformly to decode AND DSP, i.e. whole-process CPU throttling
 * rather than any defect in either stage. Without this metadata those
 * two numbers sit in the same results table looking like a real
 * regression, and someone eventually "optimises" code that was never
 * slow.
 *
 * So every benchmark result carries the conditions it was produced
 * under, and results from different conditions are never averaged.
 *
 * STRICTLY FOR INTERPRETATION
 * ---------------------------
 * Nothing here changes how anything executes. No thermal-based
 * throttling, no charging-based scheduling. It is a label on the
 * measurement, nothing more.
 */
data class EnvironmentSnapshot(
    val deviceModel: String,
    val deviceManufacturer: String,
    val androidVersion: String,
    val apiLevel: Int,
    /** True when the screen was interactive during the measurement. */
    val screenOn: Boolean,
    val charging: Boolean,
    /** 0..100, or null when unreadable. */
    val batteryLevel: Int?,
    /**
     * Coarse OS thermal bucket (NONE/LIGHT/MODERATE/SEVERE/CRITICAL/
     * EMERGENCY/SHUTDOWN), or UNAVAILABLE below API 29.
     *
     * Deliberately NOT a temperature: the platform exposes a bucket,
     * and inventing degrees from it would be fabricated precision.
     */
    val thermalStatus: String,
    val timestamp: Long,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("deviceModel", deviceModel)
        put("deviceManufacturer", deviceManufacturer)
        put("androidVersion", androidVersion)
        put("apiLevel", apiLevel)
        put("screenOn", screenOn)
        put("charging", charging)
        if (batteryLevel != null) put("batteryLevel", batteryLevel) else put("batteryLevel", null as Any?)
        put("thermalStatus", thermalStatus)
        put("timestamp", timestamp)
    }

    companion object {
        const val THERMAL_UNAVAILABLE = "UNAVAILABLE"

        /**
         * Reads current device state. Never throws: a benchmark must
         * not fail because a battery broadcast was unavailable, so
         * every field degrades to a null or UNKNOWN.
         */
        fun capture(context: Context): EnvironmentSnapshot {
            val screenOn = try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                pm?.isInteractive ?: true
            } catch (_: Throwable) {
                true
            }

            var charging = false
            var batteryLevel: Int? = null
            try {
                val status: Intent? = context.registerReceiver(
                    null,
                    IntentFilter(Intent.ACTION_BATTERY_CHANGED),
                )
                if (status != null) {
                    val plugged = status.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                    charging = plugged == BatteryManager.BATTERY_STATUS_CHARGING ||
                        plugged == BatteryManager.BATTERY_STATUS_FULL
                    val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                    if (level >= 0 && scale > 0) {
                        batteryLevel = (level * 100f / scale).toInt()
                    }
                }
            } catch (_: Throwable) {
                // Leave the defaults; an unknown battery is not an error.
            }

            val thermal = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                    when (pm?.currentThermalStatus) {
                        PowerManager.THERMAL_STATUS_NONE -> "NONE"
                        PowerManager.THERMAL_STATUS_LIGHT -> "LIGHT"
                        PowerManager.THERMAL_STATUS_MODERATE -> "MODERATE"
                        PowerManager.THERMAL_STATUS_SEVERE -> "SEVERE"
                        PowerManager.THERMAL_STATUS_CRITICAL -> "CRITICAL"
                        PowerManager.THERMAL_STATUS_EMERGENCY -> "EMERGENCY"
                        PowerManager.THERMAL_STATUS_SHUTDOWN -> "SHUTDOWN"
                        else -> THERMAL_UNAVAILABLE
                    }
                } else {
                    THERMAL_UNAVAILABLE
                }
            } catch (_: Throwable) {
                THERMAL_UNAVAILABLE
            }

            return EnvironmentSnapshot(
                deviceModel = Build.MODEL ?: "unknown",
                deviceManufacturer = Build.MANUFACTURER ?: "unknown",
                androidVersion = Build.VERSION.RELEASE ?: "unknown",
                apiLevel = Build.VERSION.SDK_INT,
                screenOn = screenOn,
                charging = charging,
                batteryLevel = batteryLevel,
                thermalStatus = thermal,
                timestamp = System.currentTimeMillis(),
            )
        }
    }
}
