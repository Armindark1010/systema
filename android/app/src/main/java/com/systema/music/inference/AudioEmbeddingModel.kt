package com.systema.music.inference

/**
 * The model-agnostic embedding contract (§3).
 *
 * WHY AN INTERFACE RATHER THAN A CLAP CLASS
 * -----------------------------------------
 * Preprocessing belongs to the model, not to the caller. CLAP wants
 * 48 kHz log-mel; YAMNet wants 16 kHz waveform; the next family will
 * want something else again. If the caller owns preprocessing, every
 * new model edits the caller, and sooner or later one model is fed
 * another model's front end and silently produces nonsense.
 *
 * So the adapter owns decode-shaping, resampling, preprocessing,
 * inference and pooling, and the caller only ever sees a normalised
 * vector. PlayerEngine never sees any of it (§8).
 */
interface AudioEmbeddingModel {

    /** Stable identifier of the underlying registered model. */
    val modelId: String

    /** Model family, e.g. "CLAP". Used for reporting, never for logic. */
    val family: String

    /** Everything the UI needs to describe this model. */
    fun getMetadata(): EmbeddingModelMetadata

    /**
     * Creates the inference session. Must be paired with [unload].
     *
     * Implementations must refuse to load a second session while one
     * is live rather than silently replacing it (§4: never load
     * multiple copies).
     */
    suspend fun load(): EmbeddingModelLoadResult

    /**
     * Checks the loaded graph really matches what this adapter will
     * feed it. Runs after [load] and before any real audio (§2).
     */
    suspend fun validate(): EmbeddingValidationReport

    /**
     * Embeds decoded mono PCM.
     *
     * @param pcm mono float samples.
     * @param pcmSampleRate the rate [pcm] is actually at; the adapter
     *   resamples to whatever the model requires.
     * @return an L2-normalised vector.
     */
    suspend fun embedAudio(pcm: FloatArray, pcmSampleRate: Int): EmbeddingResult

    /**
     * Releases the session and every buffer held with it.
     *
     * Must be safe to call when nothing is loaded, and must not throw:
     * cleanup running after a failure is the case that matters most.
     */
    suspend fun unload()

    fun isLoaded(): Boolean

    /**
     * Whether this model can also embed text (§7).
     *
     * Answered from the loaded graph, never from the family name: a
     * CLAP audio tower exported on its own has no text encoder, and
     * claiming otherwise would promise a capability that does not
     * exist.
     */
    fun supportsText(): Boolean = false

    /**
     * Embeds text into the SAME normalised space as [embedAudio] (§7).
     *
     * The default throws rather than returning a plausible-looking
     * vector. An audio-only export must fail loudly here; a zero or
     * random vector would flow into cosine similarity and produce
     * confident nonsense.
     */
    suspend fun embedText(text: String): EmbeddingResult =
        throw InferenceException(
            InferenceErrorCode.MODEL_INVALID,
            "Model $modelId does not contain a text encoder. Text embedding is " +
                "unavailable. Import a CLAP text-tower export to enable it.",
        )
}

/** Static description of a model, for the UI and for reports. */
data class EmbeddingModelMetadata(
    val modelId: String,
    val name: String,
    val family: String,
    val architecture: String,
    val format: String,
    /** Sample rate the model requires, Hz. */
    val sampleRate: Int,
    /** e.g. "log_mel_spectrogram". */
    val inputType: String,
    /** Null until proven by a real forward pass. */
    val embeddingDimension: Int?,
    val sizeBytes: Long,
    val sha256: String?,
    /** IMPORTED / VALIDATED / DEVICE_TESTED. Never PRODUCTION (§10). */
    val status: String,
    val runtimeId: String,
    val inputNames: List<String> = emptyList(),
    val outputNames: List<String> = emptyList(),
    val supportsText: Boolean = false,
    val notes: String? = null,
    /**
     * How the input format was DERIVED from the graph, in plain words.
     * Shown verbatim so a reader can see the reasoning rather than
     * trusting a label.
     */
    val architectureNote: String? = null,
) {
    fun toJs() = com.getcapacitor.JSObject().apply {
        put("id", modelId)
        put("name", name)
        put("family", family)
        put("architecture", architecture)
        put("format", format)
        put("sampleRate", sampleRate)
        put("inputType", inputType)
        put("architectureNote", architectureNote ?: "")
        put("embeddingDimension", embeddingDimension ?: -1)
        put("sizeBytes", sizeBytes)
        put("sha256", sha256 ?: "")
        put("status", status)
        put("runtimeId", runtimeId)
        put("supportsText", supportsText)
        put("notes", notes ?: "")
        put("inputNames", com.getcapacitor.JSArray().apply { inputNames.forEach { put(it) } })
        put("outputNames", com.getcapacitor.JSArray().apply { outputNames.forEach { put(it) } })
    }
}

data class EmbeddingModelLoadResult(
    val loadMs: Double,
    val inputNames: List<String>,
    val outputNames: List<String>,
    val declaredInputShape: List<Long>,
    val sizeBytes: Long,
)

/** Result of the §2 dry validation. Never a bare boolean. */
data class EmbeddingValidationReport(
    val ok: Boolean,
    /** Ordered checks, each PASS or FAIL with a technical reason. */
    val checks: List<ValidationCheck>,
    val embeddingDimension: Int?,
    val failureCode: InferenceErrorCode?,
    val failureMessage: String?,
) {
    fun toJs() = com.getcapacitor.JSObject().apply {
        put("ok", ok)
        put("embeddingDimension", embeddingDimension ?: -1)
        put("failureCode", failureCode?.name ?: "")
        put("failureMessage", failureMessage ?: "")
        put(
            "checks",
            com.getcapacitor.JSArray().apply {
                checks.forEach { put(it.toJs()) }
            },
        )
    }
}

data class ValidationCheck(
    val name: String,
    val passed: Boolean,
    val detail: String,
) {
    fun toJs() = com.getcapacitor.JSObject().apply {
        put("name", name)
        put("passed", passed)
        put("detail", detail)
    }
}

data class EmbeddingResult(
    /** L2-normalised. */
    val embedding: FloatArray,
    val dimension: Int,
    /** L2 norm BEFORE normalisation; proves the vector was non-degenerate. */
    val preNormL2: Double,
    val windowsProcessed: Int,
    val decodeMs: Double,
    val preprocessingMs: Double,
    val inferenceMs: Double,
    val totalMs: Double,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EmbeddingResult) return false
        return dimension == other.dimension &&
            embedding.contentEquals(other.embedding)
    }

    override fun hashCode(): Int = 31 * dimension + embedding.contentHashCode()
}
