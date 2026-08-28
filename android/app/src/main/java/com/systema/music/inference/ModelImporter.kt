package com.systema.music.inference

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Imports a .onnx file the user picked with the Android file picker.
 *
 * WHY THIS EXISTS
 * ---------------
 * adb is not reliably available, so a developer must be able to hand
 * SYSTEMA a model using only the phone. The Storage Access Framework
 * gives a content:// URI for exactly one user-chosen file — no
 * directory access, no scanning, no permission to anything else.
 *
 * WHAT IT DOES NOT CHANGE
 * -----------------------
 * The destination is the SAME models directory Phase 15 already uses,
 * and the imported file is registered through the SAME catalog. Once
 * imported, a picked model is indistinguishable from an adb-pushed
 * one, and it is consumed by the SAME OnnxInferenceRuntime. There is
 * no second inference path and no JavaScript runtime.
 *
 * THE VALIDATION RULE
 * -------------------
 * A file is not a model because it ends in .onnx. The only authority
 * on whether ONNX Runtime can execute a file is ONNX Runtime, so the
 * candidate is copied to a staging file and then genuinely LOADED
 * through the existing [InferenceRuntime] contract. If the session
 * does not build, the staging file is deleted and nothing is
 * registered. A corrupt file never reaches the catalog.
 *
 * WHAT IT REFUSES TO INVENT
 * -------------------------
 * Input name, shape, type, output shape and embedding width are read
 * FROM THE GRAPH. Sample rate and preprocessing are NOT in an ONNX
 * graph in any reliable form, so they are reported as UNKNOWN. They
 * are never inferred from the filename — a file called yamnet.onnx is
 * not evidence that it is YAMNet, or that it wants 16 kHz.
 */
class ModelImporter(
    private val context: Context,
    private val storage: ModelStorage,
    private val contracts: ModelContractStore,
) {

    private companion object {
        const val TAG = "SystemaModelImport"
        const val COPY_BUFFER = 1 shl 16
    }

    /**
     * Copies, validates and registers one user-selected file.
     *
     * @param uri a content:// URI from ACTION_OPEN_DOCUMENT, for a
     *   single file the user chose by hand
     * @param runtime the EXISTING runtime, used to prove the file
     *   loads. Passed in rather than constructed so validation cannot
     *   drift from the runtime that will actually run the benchmark.
     */
    suspend fun import(uri: Uri, runtime: InferenceRuntime): ImportReport =
        withContext(Dispatchers.IO) {
            if (!runtime.isAvailable()) {
                // No silent substitution. If ONNX Runtime is not
                // present, the import fails saying so rather than
                // validating against something else (§13).
                return@withContext ImportReport.failure(
                    code = InferenceErrorCode.RUNTIME_UNAVAILABLE,
                    message = "${runtime.label} is unavailable, so this file cannot be " +
                        "validated. Nothing was imported. SYSTEMA will not accept a " +
                        "model it has not proved loadable.",
                )
            }

            val declaredName = storage.sanitiseFileName(queryDisplayName(uri))
            val declaredSize = querySize(uri)

            if (declaredSize != null && declaredSize <= 0L) {
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_INVALID,
                    "The selected file is empty (0 bytes).",
                    fileName = declaredName,
                )
            }
            if (declaredSize != null && declaredSize > ModelStorage.MAX_IMPORT_BYTES) {
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_INVALID,
                    "The selected file is ${formatBytes(declaredSize)}, above the " +
                        "${formatBytes(ModelStorage.MAX_IMPORT_BYTES)} import limit.",
                    fileName = declaredName,
                    sizeBytes = declaredSize,
                )
            }

            val finalName = storage.uniqueFileNameFor(declaredName)
            val staging = storage.stagingFileFor(finalName)
                ?: return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_NOT_FOUND,
                    "Model storage is unavailable on this device, so nothing could " +
                        "be written.",
                    fileName = declaredName,
                )

            // ---- COPY ----
            val copied = try {
                copyToStaging(uri, staging)
            } catch (t: Throwable) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_LOAD_FAILED,
                    "Could not read the selected file: ${t.message}",
                    fileName = declaredName,
                )
            }

            if (copied <= 0L) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_INVALID,
                    "The selected file produced no data.",
                    fileName = declaredName,
                )
            }

            // ---- CHEAP STRUCTURAL CHECK ----
            // Rejecting an obvious non-model here saves building a
            // session, and gives a far clearer message than ORT's
            // native protobuf error. It is a fast reject only: passing
            // it proves nothing, so the real load still happens below.
            if (!looksLikeOnnx(staging)) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_INVALID,
                    "This file is not an ONNX model. Its contents do not match the " +
                        "ONNX protobuf format — a renamed .mp3, .zip or text file " +
                        "will fail here.",
                    fileName = declaredName,
                    sizeBytes = copied,
                )
            }

            // ---- REAL VALIDATION: load it through the real runtime ----
            val probe = ModelDescriptor(
                modelId = finalName.removeSuffix(ModelStorage.EXTENSION),
                modelName = finalName,
                version = "imported",
                filePath = staging.absolutePath,
                // Fully dynamic: SYSTEMA is asking the file what it is,
                // not asserting anything about it.
                inputShape = listOf(-1L),
                inputType = TensorType.FLOAT32,
                inputSampleRate = null,
                inputChannels = null,
                outputShape = listOf(-1L),
                outputType = TensorType.FLOAT32,
                sizeBytes = copied,
                checksum = null,
                inputFormat = InputFormat.RAW_TENSOR,
            )

            val info = try {
                runtime.loadModel(probe)
            } catch (e: InferenceException) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    e.code,
                    "${runtime.label} could not load this file: ${e.message}",
                    fileName = declaredName,
                    sizeBytes = copied,
                )
            } catch (t: Throwable) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_LOAD_FAILED,
                    "Unexpected failure validating this file: ${t.message}",
                    fileName = declaredName,
                    sizeBytes = copied,
                )
            } finally {
                // The validation session must not stay resident. The
                // benchmark loads the model itself, and leaving this
                // one open would hold native memory and make the next
                // cold-load measurement meaningless.
                runCatching { runtime.unloadModel() }
            }

            // ---- PROMOTE ----
            val promoted = storage.promoteStaging(staging, finalName)
            if (promoted == null) {
                storage.discardStaging(staging)
                return@withContext ImportReport.failure(
                    InferenceErrorCode.MODEL_LOAD_FAILED,
                    "The model validated but could not be moved into model storage.",
                    fileName = declaredName,
                    sizeBytes = copied,
                )
            }

            val modelId = finalName.removeSuffix(ModelStorage.EXTENSION)

            // ---- IDENTITY (§1) ----
            // SHA-256 of the promoted file, streamed in chunks. This is
            // what lets a device result be tied to an exact file later:
            // "CLAP" is not an identity, a digest is.
            val sha256 = storage.checksum(finalName)
            val importedAt = System.currentTimeMillis()

            // ---- RECORD WHAT THE GRAPH ACTUALLY SAYS ----
            // Note what is NOT recorded: sample rate and preprocessing.
            // Those are not in the graph, so they stay unknown until a
            // developer explicitly declares them.
            val contract = ModelContract(
                modelId = modelId,
                inputName = info.inputs.firstOrNull()?.name,
                inputShape = info.inputs.firstOrNull()?.shape ?: emptyList(),
                inputType = info.inputs.firstOrNull()?.type ?: "UNKNOWN",
                outputName = info.outputs.firstOrNull()?.name,
                outputShape = info.outputs.firstOrNull()?.shape ?: emptyList(),
                embeddingDimension = info.outputs.firstOrNull()?.trailingDimension()?.toInt(),
                sampleRate = null,
                inputFormat = null,
                preprocessingStatus = PreprocessingStatus.UNKNOWN,
                declaredBy = ContractSource.GRAPH,
            )
            contracts.save(contract)

            Log.i(
                TAG,
                "[AI-BENCHMARK] model_imported id=$modelId bytes=$copied " +
                    "inputs=${info.inputNames} outputs=${info.outputNames}",
            )

            ImportReport(
                ok = true,
                fileName = finalName,
                modelId = modelId,
                sizeBytes = promoted.length(),
                validation = ValidationStatus.VALID_ONNX_MODEL,
                runtimeLabel = runtime.label,
                inputs = info.inputs,
                outputs = info.outputs,
                contract = contract,
                loadMs = info.loadMs,
                sha256 = sha256,
                importedAt = importedAt,
                errorCode = null,
                message = "Loaded successfully by ${runtime.label}. Preprocessing is " +
                    "still UNKNOWN: an ONNX graph does not record sample rate or " +
                    "feature extraction, so that must be declared before benchmarking.",
            )
        }

    /**
     * Streams the picked file into staging.
     *
     * Streamed in 64 KB chunks because these files reach hundreds of
     * megabytes; reading one into memory would kill the process on a
     * mid-range phone.
     */
    private fun copyToStaging(uri: Uri, staging: File): Long {
        storage.discardStaging(staging)
        var total = 0L
        context.contentResolver.openInputStream(uri).use { input ->
            if (input == null) {
                throw IllegalStateException(
                    "The file provider returned no data for the selected document.",
                )
            }
            staging.outputStream().use { output ->
                val buffer = ByteArray(COPY_BUFFER)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    total += read
                    if (total > ModelStorage.MAX_IMPORT_BYTES) {
                        throw IllegalStateException(
                            "File exceeds the ${formatBytes(ModelStorage.MAX_IMPORT_BYTES)} " +
                                "import limit.",
                        )
                    }
                }
                output.flush()
            }
        }
        return total
    }

    /**
     * A fast structural sniff for the ONNX protobuf envelope.
     *
     * An ONNX file is a serialised ModelProto. Field 1 (ir_version) is
     * a varint, so the file almost always begins with byte 0x08, and
     * the producer/domain strings appear early. This checks for that
     * shape and for the "onnx" marker in the header region.
     *
     * IMPORTANT: this is a REJECT filter, not an accept filter.
     * Passing it means "worth trying to load"; only ONNX Runtime
     * building a session proves the file is usable. Anything that
     * passes here still goes through the real load below.
     */
    private fun looksLikeOnnx(file: File): Boolean = try {
        val header = ByteArray(minOf(1024, file.length().toInt().coerceAtLeast(0)))
        file.inputStream().use { it.read(header) }
        if (header.size < 8) {
            false
        } else {
            val text = String(header, Charsets.ISO_8859_1)
            // Field 1 varint (ir_version) is the canonical opener.
            val protobufStart = header[0] == 0x08.toByte()
            // Common producer/opset markers that appear in the header.
            val hasMarker = text.contains("onnx", ignoreCase = true) ||
                text.contains("pytorch", ignoreCase = true) ||
                text.contains("tf2onnx", ignoreCase = true) ||
                text.contains("keras", ignoreCase = true)
            // Obvious impostors, rejected with certainty.
            val isKnownOther = text.startsWith("PK") || // zip / tflite bundles
                text.startsWith("%PDF") ||
                text.startsWith("ID3") || // mp3
                text.startsWith("RIFF") || // wav
                text.startsWith("\u0089PNG") ||
                text.startsWith("{") || // json
                text.startsWith("<") // xml / html
            !isKnownOther && (protobufStart || hasMarker)
        }
    } catch (t: Throwable) {
        Log.w(TAG, "Could not sniff ${file.name}", t)
        false
    }

    /** The provider's display name. May be null; never trusted as a path. */
    private fun queryDisplayName(uri: Uri): String? = queryColumn(uri, OpenableColumns.DISPLAY_NAME)

    private fun querySize(uri: Uri): Long? =
        queryColumn(uri, OpenableColumns.SIZE)?.toLongOrNull()

    private fun queryColumn(uri: Uri, column: String): String? = try {
        var cursor: Cursor? = null
        try {
            cursor = context.contentResolver.query(uri, arrayOf(column), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(column)
                if (idx >= 0 && !cursor.isNull(idx)) cursor.getString(idx) else null
            } else {
                null
            }
        } finally {
            cursor?.close()
        }
    } catch (t: Throwable) {
        // A provider that will not answer metadata queries is normal.
        // The import proceeds; the name simply falls back.
        Log.w(TAG, "Could not query $column", t)
        null
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L * 1024L -> "%.2f GB".format(bytes / (1024.0 * 1024.0 * 1024.0))
    bytes >= 1024L * 1024L -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> "%.1f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}

/** Whether ONNX Runtime could actually build a session from the file. */
enum class ValidationStatus {
    VALID_ONNX_MODEL,
    REJECTED,
}

/**
 * How much SYSTEMA knows about a model's preprocessing.
 *
 * There is no "PROBABLY" state on purpose. Either the contract is
 * established and inference is meaningful, or it is not and the
 * benchmark must refuse.
 */
enum class PreprocessingStatus {
    /** Declared and consistent with the graph. Benchmarking allowed. */
    VERIFIED,

    /** Not yet declared. Benchmarking refused with PREPROCESSING_UNAVAILABLE. */
    UNKNOWN,

    /** Needs a front end SYSTEMA does not implement (mel, STFT). */
    BLOCKED,
}

/** Where a piece of contract information came from. */
enum class ContractSource {
    /** Read out of the ONNX graph. Trustworthy. */
    GRAPH,

    /** Asserted by the developer in the lab UI. Recorded as such. */
    DEVELOPER_DECLARED,
}

/**
 * What SYSTEMA knows about one imported model.
 *
 * Split by provenance deliberately. Shapes and types come from the
 * graph and are facts. Sample rate and input format cannot be read
 * from an ONNX file, so they are null until a developer states them,
 * and [declaredBy] records that they were stated rather than
 * discovered. A benchmark report can then never imply SYSTEMA
 * verified something a human asserted.
 */
data class ModelContract(
    val modelId: String,
    val inputName: String?,
    val inputShape: List<Long>,
    val inputType: String,
    val outputName: String?,
    val outputShape: List<Long>,
    /** Trailing output dimension from the graph, null when dynamic. */
    val embeddingDimension: Int?,
    /** Null until declared: not present in an ONNX graph. */
    val sampleRate: Int?,
    /** Null until declared. */
    val inputFormat: InputFormat?,
    val preprocessingStatus: PreprocessingStatus,
    val declaredBy: ContractSource,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("modelId", modelId)
        put("inputName", inputName)
        put("inputShape", JSArray(inputShape.toTypedArray()))
        put("inputType", inputType)
        put("outputName", outputName)
        put("outputShape", JSArray(outputShape.toTypedArray()))
        put("embeddingDimension", embeddingDimension)
        put("sampleRate", sampleRate)
        put("inputFormat", inputFormat?.name)
        put("preprocessingStatus", preprocessingStatus.name)
        put("declaredBy", declaredBy.name)
    }
}

/** The outcome of one import attempt. */
data class ImportReport(
    val ok: Boolean,
    val fileName: String,
    val modelId: String?,
    val sizeBytes: Long,
    val validation: ValidationStatus,
    val runtimeLabel: String?,
    val inputs: List<TensorSignature>,
    val outputs: List<TensorSignature>,
    val contract: ModelContract?,
    val loadMs: Double?,
    /** SHA-256 of the promoted file (§1). Null when import failed. */
    val sha256: String? = null,
    /** Epoch millis the file was registered (§1). */
    val importedAt: Long? = null,
    val errorCode: InferenceErrorCode?,
    val message: String,
) {
    companion object {
        fun failure(
            code: InferenceErrorCode,
            message: String,
            fileName: String = "unknown",
            sizeBytes: Long = 0L,
        ) = ImportReport(
            ok = false,
            fileName = fileName,
            modelId = null,
            sizeBytes = sizeBytes,
            validation = ValidationStatus.REJECTED,
            runtimeLabel = null,
            inputs = emptyList(),
            outputs = emptyList(),
            contract = null,
            loadMs = null,
            errorCode = code,
            message = message,
        )
    }

    fun toJs(): JSObject = JSObject().apply {
        put("ok", ok)
        put("fileName", fileName)
        put("modelId", modelId)
        put("sizeBytes", sizeBytes)
        put("validation", validation.name)
        put("runtimeLabel", runtimeLabel)
        put("loadMs", loadMs)
        put("errorCode", errorCode?.name)
        put("message", message)
        put("inputs", signaturesToJs(inputs))
        put("outputs", signaturesToJs(outputs))
        put("contract", contract?.toJs())
        put("sha256", sha256 ?: "")
        put("importedAt", importedAt ?: 0L)
    }
}

internal fun signaturesToJs(list: List<TensorSignature>): JSArray {
    val arr = JSArray()
    list.forEach { sig ->
        arr.put(
            JSObject().apply {
                put("name", sig.name)
                put("shape", JSArray(sig.shape.toTypedArray()))
                put("type", sig.type)
                put("elementCount", sig.elementCount())
            },
        )
    }
    return arr
}
