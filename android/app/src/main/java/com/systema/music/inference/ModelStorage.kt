package com.systema.music.inference

import android.content.Context
import android.util.Log
import java.io.File
import java.security.MessageDigest

/**
 * Where side-loaded model weights live on the device.
 *
 * WHY NOT IN GIT (§7)
 * -------------------
 * The candidate models run from ~15 MB (YAMNet) to ~620 MB
 * (LAION-CLAP). Committing those would bloat the repository
 * permanently, and git is a terrible fit for opaque binaries that
 * change wholesale. So weights are side-loaded per device and this
 * class is the one place that knows where they are.
 *
 * WHY app-specific EXTERNAL storage
 * ---------------------------------
 * getExternalFilesDir() is readable over adb/MTP without any runtime
 * permission and without MANAGE_EXTERNAL_STORAGE, so a developer can
 * simply push a file. It is also removed when the app is uninstalled,
 * so experiments do not litter the device.
 *
 *     adb push model.onnx \
 *       /sdcard/Android/data/com.systema.music/files/models/
 *
 * SAFETY
 * ------
 * This class only ever enumerates ITS OWN directory. It never touches
 * the music library, never scans user storage, and never reads
 * anything outside the models folder.
 */
class ModelStorage(private val context: Context) {

    companion object {
        const val MODELS_DIR = "models"
        const val EXTENSION = ".onnx"
        private const val TAG = "SystemaModelStorage"

        /** Marks a partially-copied import. Never matched by listInstalled(). */
        const val STAGING_SUFFIX = ".part"

        /**
         * Upper bound on an imported file, in bytes.
         *
         * 800 MB clears the largest candidate researched in Phase 16
         * (LAION-CLAP, ~620 MB) with headroom, while still refusing a
         * mis-selected multi-gigabyte file before it fills the
         * device. It is a storage guard, not a judgement about which
         * models are usable.
         */
        const val MAX_IMPORT_BYTES = 800L * 1024L * 1024L

        /**
         * Test-model identity, re-exported from [TestModel] so callers
         * that already hold a ModelStorage need not import both. The
         * definitions live in the Android-free file so the JVM test
         * suite can reach them.
         */
        const val TEST_MODEL_FILE = TestModel.FILE_NAME
        const val TEST_MODEL_ID = TestModel.ID
    }

    /**
     * The models directory, created on demand.
     *
     * Returns null when external storage is genuinely unavailable
     * (ejected, or an emulator misconfiguration) rather than
     * pretending a path exists that cannot be written.
     */
    fun modelsDir(): File? {
        val base = context.getExternalFilesDir(null) ?: run {
            Log.w(TAG, "External files dir unavailable; cannot host models.")
            return null
        }
        val dir = File(base, MODELS_DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "Could not create ${dir.absolutePath}")
            return null
        }
        return dir
    }

    /** Absolute path for a model filename, or null if unavailable. */
    fun pathFor(fileName: String): String? =
        modelsDir()?.let { File(it, fileName).absolutePath }

    /** Lists installed .onnx files. Only this directory, never wider. */
    fun listInstalled(): List<InstalledModel> {
        val dir = modelsDir() ?: return emptyList()
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(EXTENSION) }
            ?: return emptyList()
        return files.sortedBy { it.name }.map {
            InstalledModel(
                fileName = it.name,
                absolutePath = it.absolutePath,
                sizeBytes = it.length(),
                lastModified = it.lastModified(),
            )
        }
    }

    fun isInstalled(fileName: String): Boolean {
        val dir = modelsDir() ?: return false
        val file = File(dir, fileName)
        return file.exists() && file.isFile && file.length() > 0
    }

    /**
     * SHA-256 of an installed model, for reproducibility records.
     *
     * Streamed in chunks: a 620 MB model must not be read into memory
     * just to be hashed.
     */
    fun checksum(fileName: String): String? {
        val dir = modelsDir() ?: return null
        val file = File(dir, fileName)
        if (!file.exists()) return null
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { stream ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (t: Throwable) {
            Log.w(TAG, "Could not checksum $fileName", t)
            null
        }
    }

    /**
     * Copies the bundled deterministic test model into the models dir.
     *
     * The TEST model — and only the test model — ships in the APK. It
     * is a few hundred bytes of pure arithmetic with no learned
     * weights, so it costs nothing and it makes the integration test
     * runnable on a fresh device with no adb push. Real candidate
     * models are never bundled.
     *
     * @return the absolute path, or null when the asset is absent.
     */
    fun installTestModelFromAssets(): String? {
        val dir = modelsDir() ?: return null
        val target = File(dir, TEST_MODEL_FILE)
        if (target.exists() && target.length() > 0) return target.absolutePath

        return try {
            context.assets.open("models/$TEST_MODEL_FILE").use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            Log.i(TAG, "Installed test model to ${target.absolutePath} (${target.length()} bytes)")
            target.absolutePath
        } catch (t: Throwable) {
            Log.w(TAG, "Test model asset not found in APK", t)
            null
        }
    }

    /** Human-readable instructions, shown in the UI when nothing is installed. */
    fun sideloadInstructions(): String {
        val dir = modelsDir()?.absolutePath ?: "<external storage unavailable>"
        return "adb push your-model.onnx $dir/"
    }

    // ---------------------------------------------------------------
    // In-app import (Phase 16.1)
    // ---------------------------------------------------------------
    // adb is not always available to the developer, so a model can
    // also arrive through the Android system file picker. The
    // destination is UNCHANGED — the same models directory the rest of
    // Phase 15/16 already uses — so an imported model is
    // indistinguishable from an adb-pushed one to every layer above.

    /**
     * A staging file for an in-progress import.
     *
     * Staged INSIDE the models directory, deliberately: a rename
     * within one filesystem is atomic, so a model either appears
     * complete or does not appear at all. A half-copied 15 MB file
     * that ONNX Runtime later rejects would be far more confusing
     * than no file.
     *
     * The `.part` suffix keeps it invisible to [listInstalled], which
     * matches only `.onnx`.
     */
    fun stagingFileFor(fileName: String): File? =
        modelsDir()?.let { File(it, "$fileName$STAGING_SUFFIX") }

    /**
     * Picks a filename that does not collide with an existing model.
     *
     * Overwriting silently would be the wrong call: a developer
     * comparing two exports of the same architecture would lose the
     * first one without being told.
     */
    fun uniqueFileNameFor(requested: String): String {
        val dir = modelsDir() ?: return requested
        val base = requested.removeSuffix(EXTENSION)
        if (!File(dir, "$base$EXTENSION").exists()) return "$base$EXTENSION"
        var n = 2
        while (n < 1000) {
            val candidate = "$base-$n$EXTENSION"
            if (!File(dir, candidate).exists()) return candidate
            n++
        }
        return "$base-${System.currentTimeMillis()}$EXTENSION"
    }

    /** Moves a validated staging file into place. */
    fun promoteStaging(staging: File, finalName: String): File? {
        val dir = modelsDir() ?: return null
        val target = File(dir, finalName)
        return if (staging.renameTo(target)) target else null
    }

    /** Removes a staging file. Safe to call when it does not exist. */
    fun discardStaging(staging: File?) {
        if (staging == null) return
        runCatching { if (staging.exists()) staging.delete() }
            .onFailure { Log.w(TAG, "Could not delete staging file ${staging.name}", it) }
    }

    /**
     * Deletes an installed model.
     *
     * Refuses to touch the bundled test model: the Phase 15 proof
     * depends on it being present, and removing it would silently
     * break the one check that shows ONNX Runtime really executes.
     */
    fun deleteInstalled(fileName: String): Boolean {
        if (fileName == TEST_MODEL_FILE) return false
        if (!fileName.endsWith(EXTENSION)) return false
        if (fileName.contains('/') || fileName.contains("..")) return false
        val dir = modelsDir() ?: return false
        val file = File(dir, fileName)
        return file.exists() && file.delete()
    }

    /**
     * Sanitises a filename supplied by a content provider.
     *
     * The display name comes from outside the app and is used to build
     * a path, so path separators and traversal segments are stripped
     * rather than trusted.
     */
    fun sanitiseFileName(raw: String?): String {
        val cleaned = (raw ?: "")
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .replace("..", "")
            .filter { it.isLetterOrDigit() || it in "-_. " }
            .trim()
            .replace(' ', '-')
        val base = cleaned.removeSuffix(EXTENSION).take(80)
        return if (base.isBlank()) "imported-model$EXTENSION" else "$base$EXTENSION"
    }
}

data class InstalledModel(
    val fileName: String,
    val absolutePath: String,
    val sizeBytes: Long,
    val lastModified: Long,
)
