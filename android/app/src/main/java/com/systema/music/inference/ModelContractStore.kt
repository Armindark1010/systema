package com.systema.music.inference

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Remembers what is known about each imported model.
 *
 * WHY PERSIST THIS AT ALL
 * -----------------------
 * The shapes can be re-read from the graph on every load, but the
 * parts that CANNOT be read — sample rate, input format, whether the
 * preprocessing contract has been established — are developer
 * assertions. Losing them on every app restart would mean re-entering
 * them before each benchmark, and the likely outcome of that friction
 * is someone loosening the check instead.
 *
 * SharedPreferences, not Room: this is a handful of records for a
 * developer diagnostic, and adding a table plus a migration to the
 * user-facing library database for it would be disproportionate.
 *
 * SAFETY
 * ------
 * Nothing here touches the music library, the analysis database, or
 * production model selection. It stores metadata about files the
 * developer explicitly imported and nothing else.
 */
class ModelContractStore(context: Context) {

    private companion object {
        const val PREFS = "systema_model_contracts"
        const val KEY = "contracts"
        const val TAG = "SystemaContracts"
    }

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun all(): List<ModelContract> = try {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        (0 until arr.length()).mapNotNull { i -> fromJson(arr.optJSONObject(i)) }
    } catch (t: Throwable) {
        // A corrupt preference must not brick the lab. An empty list
        // means "nothing known", which is the safe default: every
        // model then reports UNKNOWN preprocessing and refuses to
        // benchmark until re-declared.
        Log.w(TAG, "Could not read stored contracts", t)
        emptyList()
    }

    fun find(modelId: String): ModelContract? = all().firstOrNull { it.modelId == modelId }

    fun save(contract: ModelContract) {
        val merged = all().filter { it.modelId != contract.modelId } + contract
        write(merged)
    }

    fun remove(modelId: String) {
        write(all().filter { it.modelId != modelId })
    }

    private fun write(contracts: List<ModelContract>) {
        try {
            val arr = JSONArray()
            contracts.forEach { arr.put(toJson(it)) }
            prefs.edit().putString(KEY, arr.toString()).apply()
        } catch (t: Throwable) {
            Log.w(TAG, "Could not persist contracts", t)
        }
    }

    private fun toJson(c: ModelContract): JSONObject = JSONObject().apply {
        put("modelId", c.modelId)
        put("inputName", c.inputName ?: JSONObject.NULL)
        put("inputShape", JSONArray().also { a -> c.inputShape.forEach { a.put(it) } })
        put("inputType", c.inputType)
        put("outputName", c.outputName ?: JSONObject.NULL)
        put("outputShape", JSONArray().also { a -> c.outputShape.forEach { a.put(it) } })
        put("embeddingDimension", c.embeddingDimension ?: JSONObject.NULL)
        put("sampleRate", c.sampleRate ?: JSONObject.NULL)
        put("inputFormat", c.inputFormat?.name ?: JSONObject.NULL)
        put("preprocessingStatus", c.preprocessingStatus.name)
        put("declaredBy", c.declaredBy.name)
    }

    private fun fromJson(o: JSONObject?): ModelContract? {
        if (o == null) return null
        val id = o.optString("modelId").takeIf { it.isNotBlank() } ?: return null
        return ModelContract(
            modelId = id,
            inputName = o.optStringOrNull("inputName"),
            inputShape = o.optLongList("inputShape"),
            inputType = o.optString("inputType", "UNKNOWN"),
            outputName = o.optStringOrNull("outputName"),
            outputShape = o.optLongList("outputShape"),
            embeddingDimension = if (o.isNull("embeddingDimension")) null
            else o.optInt("embeddingDimension"),
            sampleRate = if (o.isNull("sampleRate")) null else o.optInt("sampleRate"),
            inputFormat = o.optStringOrNull("inputFormat")?.let { name ->
                // An unrecognised stored value degrades to null
                // (= unknown), never to a default format. Defaulting
                // here would silently license a benchmark.
                runCatching { InputFormat.valueOf(name) }.getOrNull()
            },
            preprocessingStatus = runCatching {
                PreprocessingStatus.valueOf(o.optString("preprocessingStatus"))
            }.getOrDefault(PreprocessingStatus.UNKNOWN),
            declaredBy = runCatching {
                ContractSource.valueOf(o.optString("declaredBy"))
            }.getOrDefault(ContractSource.GRAPH),
        )
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

private fun JSONObject.optLongList(key: String): List<Long> {
    val arr = optJSONArray(key) ?: return emptyList()
    return (0 until arr.length()).map { arr.optLong(it) }
}
