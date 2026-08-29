package com.systema.music.dataset

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File

/**
 * Writes a dataset export to SHARED storage (Phase 28).
 *
 * WHY NOT getExternalFilesDir()
 * -----------------------------
 * That directory is app-specific and Android deletes it on uninstall,
 * which is precisely the failure this export exists to prevent. The
 * Room database has the same limitation: it survives restart, update,
 * reboot and cache clearing, but not a reinstall.
 *
 * Writing to the shared Documents collection produces a file that
 * belongs to the user rather than the app. It stays on the device
 * after an uninstall, can be copied off over MTP, and can be
 * re-imported into a fresh install. That is what makes the collected
 * dataset genuinely recoverable.
 *
 * NO PERMISSION IS REQUESTED
 * --------------------------
 * On API 29+ MediaStore lets an app create its own entries in a shared
 * collection without WRITE_EXTERNAL_STORAGE. On older devices the file
 * goes to the public Documents directory, which needs the legacy
 * permission the app already declares for the library scan; if that is
 * unavailable the write fails honestly rather than silently.
 *
 * This class only ever CREATES files under Documents/SYSTEMA. It never
 * enumerates, reads or deletes anything the user owns.
 */
class DatasetExporter(private val context: Context) {

    companion object {
        private const val TAG = "SystemaDatasetExport"

        /** Everything this app writes stays inside one folder. */
        const val SUBDIR = "SYSTEMA"
    }

    data class ExportResult(
        val ok: Boolean,
        /** A displayable location, never a raw absolute path to logs. */
        val displayPath: String?,
        val bytesWritten: Long,
        val error: String?,
    )

    /**
     * Writes [content] to Documents/SYSTEMA/[fileName].
     *
     * The content is produced by the web layer, which owns the export
     * format; this class is only responsible for getting bytes onto
     * durable storage.
     */
    fun writeToDocuments(fileName: String, content: String, mimeType: String): ExportResult {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeViaMediaStore(fileName, content, mimeType)
            } else {
                writeLegacy(fileName, content)
            }
        } catch (e: Exception) {
            // The exception may name a path; log the type, not the message.
            Log.e(TAG, "export_failed type=${e.javaClass.simpleName}")
            ExportResult(false, null, 0, "The export could not be written to storage.")
        }
    }

    private fun writeViaMediaStore(
        fileName: String,
        content: String,
        mimeType: String,
    ): ExportResult {
        val relative = "${Environment.DIRECTORY_DOCUMENTS}/$SUBDIR"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relative)
            // Marks the entry incomplete so nothing reads a half-written
            // dataset while it is still being streamed.
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Files.getContentUri("external"), values)
            ?: return ExportResult(false, null, 0, "Storage rejected the new file.")

        var written = 0L
        resolver.openOutputStream(uri)?.use { out ->
            val bytes = content.toByteArray(Charsets.UTF_8)
            out.write(bytes)
            out.flush()
            written = bytes.size.toLong()
        } ?: return ExportResult(false, null, 0, "The file could not be opened for writing.")

        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, values, null, null)

        Log.i(TAG, "export_ok bytes=$written")
        return ExportResult(true, "Documents/$SUBDIR/$fileName", written, null)
    }

    /** Pre-Q devices, where MediaStore has no RELATIVE_PATH. */
    private fun writeLegacy(fileName: String, content: String): ExportResult {
        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            SUBDIR,
        )
        if (!dir.exists() && !dir.mkdirs()) {
            return ExportResult(false, null, 0, "The export folder could not be created.")
        }
        val file = File(dir, fileName)
        val bytes = content.toByteArray(Charsets.UTF_8)
        file.writeBytes(bytes)
        Log.i(TAG, "export_ok_legacy bytes=${bytes.size}")
        return ExportResult(true, "Documents/$SUBDIR/$fileName", bytes.size.toLong(), null)
    }
}
