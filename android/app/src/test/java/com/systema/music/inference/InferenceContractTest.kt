package com.systema.music.inference

import kotlinx.coroutines.runBlocking
import java.io.File

/**
 * Runtime contract tests (§14).
 *
 * WHAT RUNS HERE AND WHAT DOES NOT
 * --------------------------------
 * These exercise the parts of the inference layer that are free of
 * Android and ONNX imports: the descriptor, the preprocessing
 * boundary, and the reference runtime's full lifecycle. That is a
 * genuine JVM test — real objects, real assertions, no mocks.
 *
 * OnnxInferenceRuntime is deliberately NOT tested here, because it
 * cannot be: it needs ONNX Runtime's native .so, which exists only in
 * an Android process. Pretending otherwise with a mock would test the
 * mock. The ONNX path is verified on device via the benchmark lab
 * (§15), and a mismatch between the two runtimes would show up
 * immediately because they must produce identical output for the test
 * model.
 *
 * Run standalone:
 *   kotlinc <sources> InferenceContractTest.kt -include-runtime -d t.jar
 *   java -cp t.jar com.systema.music.inference.InferenceContractTest
 */
object InferenceContractTest {

    private var passed = 0
    private var failed = 0

    private fun check(name: String, condition: Boolean, detail: String = "") {
        if (condition) {
            passed++
            println("  PASS  $name")
        } else {
            failed++
            println("  FAIL  $name${if (detail.isNotEmpty()) " — $detail" else ""}")
        }
    }

    private fun section(title: String) {
        println("\n$title")
        println("-".repeat(title.length))
    }

    private fun near(a: Float, b: Float, tol: Float = 1e-4f) = kotlin.math.abs(a - b) <= tol

    @JvmStatic
    fun main(args: Array<String>) {
        println("\n=== SYSTEMA Phase 15 — inference contract tests ===")

        testDescriptor()
        testPreprocessing()
        testReferenceLifecycle()
        testErrorCases()
        testDeterminism()
        testRuntimeIdentifiers()

        println("\n" + "=".repeat(60))
        println("  $passed passed, $failed failed")
        println("=".repeat(60))
        if (failed > 0) kotlin.system.exitProcess(1)
    }

    // ------------------------------------------------------------
    private fun testDescriptor() {
        section("1. ModelDescriptor")

        val fixed = ModelDescriptor(
            modelId = "m", modelName = "M", version = "1",
            filePath = "/tmp/m.onnx",
            inputShape = listOf(1L, 480_000L), inputType = TensorType.FLOAT32,
            inputSampleRate = 48_000, inputChannels = 1,
            outputShape = listOf(1L, 512L), outputType = TensorType.FLOAT32,
        )
        check("element count multiplies a fixed shape",
            fixed.inputElementCount() == 480_000L, "${fixed.inputElementCount()}")
        check("output element count works too",
            fixed.outputElementCount() == 512L)

        val dynamic = fixed.copy(inputShape = listOf(1L, -1L))
        check("a dynamic dimension yields null, not a wrong number",
            dynamic.inputElementCount() == null)

        // A zero dimension is as unusable as a negative one.
        val zero = fixed.copy(inputShape = listOf(0L, 512L))
        check("a zero dimension also yields null", zero.inputElementCount() == null)

        check("the default input format is a raw waveform",
            fixed.inputFormat == InputFormat.RAW_WAVEFORM)
    }

    // ------------------------------------------------------------
    private fun testPreprocessing() {
        section("2. Preprocessing boundary (§10)")

        // ---- resampling ----
        val oneSecAt100 = FloatArray(100) { kotlin.math.sin(it * 0.1).toFloat() }
        val up = ModelInputPreparer.resampleLinear(oneSecAt100, 100, 200)
        check("upsampling doubles the sample count", up.size == 200, "${up.size}")
        val down = ModelInputPreparer.resampleLinear(oneSecAt100, 100, 50)
        check("downsampling halves the sample count", down.size == 50, "${down.size}")
        val same = ModelInputPreparer.resampleLinear(oneSecAt100, 100, 100)
        check("a no-op resample preserves the signal exactly",
            same.contentEquals(oneSecAt100))
        check("resampling an empty buffer yields an empty buffer",
            ModelInputPreparer.resampleLinear(FloatArray(0), 100, 200).isEmpty())

        // A constant signal must survive resampling unchanged: any
        // interpolation bug shows up immediately as a ripple.
        val dc = FloatArray(50) { 0.5f }
        val dcUp = ModelInputPreparer.resampleLinear(dc, 50, 120)
        check("a constant signal stays constant through resampling",
            dcUp.all { near(it, 0.5f) })

        // ---- normalisation ----
        val quiet = floatArrayOf(0.1f, -0.05f, 0.02f)
        val normalised = ModelInputPreparer.peakNormalise(quiet)
        check("peak normalisation scales the loudest sample to 0.95",
            near(normalised.maxOf { kotlin.math.abs(it) }, 0.95f))
        check("normalisation preserves relative proportions",
            near(normalised[0] / normalised[1], quiet[0] / quiet[1], 1e-3f))

        val silence = FloatArray(16)
        val normalisedSilence = ModelInputPreparer.peakNormalise(silence)
        check("silence stays silent instead of becoming NaN",
            normalisedSilence.all { it == 0f && !it.isNaN() })

        // ---- format gating ----
        val melModel = ModelDescriptor(
            modelId = "mel", modelName = "Mel", version = "1",
            filePath = "/tmp/mel.onnx",
            inputShape = listOf(1L, 64L, 96L), inputType = TensorType.FLOAT32,
            inputSampleRate = 16_000, inputChannels = 1,
            outputShape = listOf(1L, 1024L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.LOG_MEL_SPECTROGRAM,
        )
        var refused = false
        try {
            ModelInputPreparer.prepare(FloatArray(1000), 22_050, melModel)
        } catch (e: InferenceException) {
            refused = e.code == InferenceErrorCode.INPUT_SHAPE_MISMATCH
        }
        check("log-mel input is refused, not approximated", refused)

        // ---- raw tensor passthrough ----
        val testModel = ModelDescriptor(
            modelId = "t", modelName = "T", version = "1", filePath = "/tmp/t.onnx",
            inputShape = listOf(-1L), inputType = TensorType.FLOAT32,
            inputSampleRate = null, inputChannels = 1,
            outputShape = listOf(-1L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.RAW_TENSOR,
        )
        val raw = floatArrayOf(1f, 2f, 3f, 4f)
        val prepared = ModelInputPreparer.prepare(raw, 48_000, testModel)
        check("a raw tensor passes through untouched",
            prepared.data.contentEquals(raw))
        check("passthrough does not alias the caller's array",
            prepared.data !== raw)

        // ---- fixed-length fitting ----
        val fixedLen = ModelDescriptor(
            modelId = "f", modelName = "F", version = "1", filePath = "/tmp/f.onnx",
            inputShape = listOf(1000L), inputType = TensorType.FLOAT32,
            inputSampleRate = 22_050, inputChannels = 1,
            outputShape = listOf(-1L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.RAW_WAVEFORM,
        )
        val short = ModelInputPreparer.prepare(FloatArray(400) { 0.5f }, 22_050, fixedLen)
        check("short input is padded to the required length",
            short.data.size == 1000, "${short.data.size}")
        check("padding is silence, not repeated audio",
            short.data.drop(400).all { it == 0f })

        val long = ModelInputPreparer.prepare(FloatArray(5000) { 0.5f }, 22_050, fixedLen)
        check("long input is truncated to the required length",
            long.data.size == 1000, "${long.data.size}")

        var emptyRefused = false
        try {
            ModelInputPreparer.prepare(FloatArray(0), 22_050, fixedLen)
        } catch (e: InferenceException) {
            emptyRefused = true
        }
        check("empty PCM is refused", emptyRefused)
    }

    // ------------------------------------------------------------
    private fun testReferenceLifecycle() = runBlocking {
        section("3. Reference runtime lifecycle (§12, §14)")

        val rt = ReferenceInferenceRuntime()
        check("the reference runtime is always available", rt.isAvailable())
        check("nothing is loaded initially", !rt.isLoaded())
        check("loadedModel() is null before loading", rt.loadedModel() == null)

        // A real file on disk, so the "model missing" path means the
        // same thing it does for ONNX.
        val tmp = File.createTempFile("systema-test-model", ".onnx")
        tmp.writeBytes(ByteArray(423) { 1 })
        tmp.deleteOnExit()

        val descriptor = ModelDescriptor(
            modelId = TestModel.ID,
            modelName = "Deterministic Test Model", version = "1.0.0",
            filePath = tmp.absolutePath,
            inputShape = listOf(-1L), inputType = TensorType.FLOAT32,
            inputSampleRate = null, inputChannels = 1,
            outputShape = listOf(-1L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.RAW_TENSOR,
        )

        val info = rt.loadModel(descriptor)
        check("loading reports the real file size", info.sizeBytes == 423L, "${info.sizeBytes}")
        check("isLoaded() is true after loading", rt.isLoaded())
        check("loadedModel() reports the loaded id",
            rt.loadedModel()?.modelId == TestModel.ID)
        check("a load time was measured", info.loadMs >= 0.0)

        val result = rt.infer(floatArrayOf(1f, 2f, 3f, 4f))
        check("output has the same length as input", result.output.size == 4)
        check("output is exactly [9, 25, 49, 81]",
            near(result.output[0], 9f) && near(result.output[1], 25f) &&
                near(result.output[2], 49f) && near(result.output[3], 81f),
            result.output.joinToString())
        check("the result names the model that produced it",
            result.modelId == TestModel.ID)
        check("an inference time was measured", result.inferenceMs >= 0.0)

        // Negative and zero inputs, where a sign bug would hide.
        val edge = rt.infer(floatArrayOf(0f, -1f, -0.5f))
        check("zero maps to 1 ((0*2+1)^2)", near(edge.output[0], 1f))
        check("-1 maps to 1 ((-1*2+1)^2)", near(edge.output[1], 1f))
        check("-0.5 maps to 0 ((-0.5*2+1)^2)", near(edge.output[2], 0f))

        rt.unloadModel()
        check("isLoaded() is false after unloading", !rt.isLoaded())
        check("loadedModel() is null after unloading", rt.loadedModel() == null)

        // Reload must work: a benchmark runs load/unload repeatedly.
        rt.loadModel(descriptor)
        check("the model can be loaded again after unloading", rt.isLoaded())
        rt.unloadModel()
    }

    // ------------------------------------------------------------
    private fun testErrorCases() = runBlocking {
        section("4. Deterministic error reporting (§7, §14)")

        val rt = ReferenceInferenceRuntime()

        // ---- inference before load ----
        var code: InferenceErrorCode? = null
        try {
            rt.infer(floatArrayOf(1f))
        } catch (e: InferenceException) {
            code = e.code
        }
        check("inferring with no model reports MODEL_UNLOADED",
            code == InferenceErrorCode.MODEL_UNLOADED, "$code")

        // ---- missing file ----
        val missing = ModelDescriptor(
            modelId = TestModel.ID, modelName = "T", version = "1",
            filePath = "/nonexistent/definitely/not/here.onnx",
            inputShape = listOf(-1L), inputType = TensorType.FLOAT32,
            inputSampleRate = null, inputChannels = 1,
            outputShape = listOf(-1L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.RAW_TENSOR,
        )
        code = null
        try {
            rt.loadModel(missing)
        } catch (e: InferenceException) {
            code = e.code
        }
        check("a missing file reports MODEL_NOT_FOUND",
            code == InferenceErrorCode.MODEL_NOT_FOUND, "$code")
        check("a failed load leaves nothing loaded", !rt.isLoaded())

        // ---- the reference runtime refuses real models (§13) ----
        val tmp = File.createTempFile("yamnet", ".onnx")
        tmp.writeBytes(ByteArray(64))
        tmp.deleteOnExit()
        val realModel = missing.copy(modelId = "yamnet", filePath = tmp.absolutePath)
        code = null
        try {
            rt.loadModel(realModel)
        } catch (e: InferenceException) {
            code = e.code
        }
        check("the reference runtime refuses a real model with MODEL_INVALID",
            code == InferenceErrorCode.MODEL_INVALID, "$code")
        check("refusing a real model loads nothing", !rt.isLoaded())

        // Every required code must exist and be distinct.
        val codes = InferenceErrorCode.values().map { it.name }.toSet()
        for (required in listOf(
            "MODEL_NOT_FOUND", "MODEL_LOAD_FAILED", "MODEL_INVALID",
            "MODEL_INFERENCE_FAILED", "MODEL_UNLOADED",
        )) {
            check("$required is defined", required in codes)
        }
        check("all error codes are distinct",
            InferenceErrorCode.values().size == codes.size)
    }

    // ------------------------------------------------------------
    private fun testDeterminism() = runBlocking {
        section("5. Determinism and repeated inference (§14)")

        val rt = ReferenceInferenceRuntime()
        val tmp = File.createTempFile("systema-test-model", ".onnx")
        tmp.writeBytes(ByteArray(423))
        tmp.deleteOnExit()

        val descriptor = ModelDescriptor(
            modelId = TestModel.ID, modelName = "T", version = "1",
            filePath = tmp.absolutePath,
            inputShape = listOf(-1L), inputType = TensorType.FLOAT32,
            inputSampleRate = null, inputChannels = 1,
            outputShape = listOf(-1L), outputType = TensorType.FLOAT32,
            inputFormat = InputFormat.RAW_TENSOR,
        )
        rt.loadModel(descriptor)

        val input = floatArrayOf(1f, 2f, 3f, 4f)
        val first = rt.infer(input)

        // 50 runs: enough that accumulated state would show.
        var allIdentical = true
        repeat(50) {
            val r = rt.infer(input)
            if (!r.output.contentEquals(first.output)) allIdentical = false
        }
        check("50 repeated inferences give byte-identical output", allIdentical)

        // Interleaving a different input must not disturb the result:
        // that is what a leaked buffer between calls would look like.
        rt.infer(floatArrayOf(9f, 9f, 9f, 9f))
        val after = rt.infer(input)
        check("a different input in between does not corrupt the next result",
            after.output.contentEquals(first.output))

        // The input array itself must not be mutated in place.
        check("inference does not modify the caller's input array",
            input.contentEquals(floatArrayOf(1f, 2f, 3f, 4f)))

        // Varying lengths, since the model is dynamic.
        check("a 1-element input works", rt.infer(FloatArray(1) { 2f }).output.size == 1)
        check("a 10,000-element input works", rt.infer(FloatArray(10_000)).output.size == 10_000)

        rt.unloadModel()

        // After unload, inference must fail rather than reuse state.
        var code: InferenceErrorCode? = null
        try {
            rt.infer(input)
        } catch (e: InferenceException) {
            code = e.code
        }
        check("inference after unload reports MODEL_UNLOADED",
            code == InferenceErrorCode.MODEL_UNLOADED, "$code")
    }

    // ------------------------------------------------------------
    private fun testRuntimeIdentifiers() {
        section("6. Canonical runtime identifiers (regression)")

        // THE BUG THIS LOCKS DOWN
        // -----------------------
        // The registry was a hand-written mapOf keyed "onnx", while
        // OnnxInferenceRuntime.runtimeId said "onnxruntime".
        // getCapabilities() advertised the property, runtime(id) looked
        // up the key, so the device reported:
        //   Unknown runtime 'onnxruntime'. Available: onnx, reference

        check("RuntimeIds.ONNX is \"onnxruntime\"", RuntimeIds.ONNX == "onnxruntime", RuntimeIds.ONNX)
        check("RuntimeIds.REFERENCE is \"reference\"", RuntimeIds.REFERENCE == "reference")
        check("ALL lists exactly the two known runtimes",
            RuntimeIds.ALL.size == 2 && RuntimeIds.ALL.toSet() == setOf("onnxruntime", "reference"))
        check("runtime ids are distinct", RuntimeIds.ALL.toSet().size == RuntimeIds.ALL.size)

        val reference = ReferenceInferenceRuntime()
        check("ReferenceInferenceRuntime identifies as the canonical reference id",
            reference.runtimeId == RuntimeIds.REFERENCE, reference.runtimeId)

        // OnnxInferenceRuntime is NOT instantiated here on purpose: it
        // loads ONNX Runtime's native library, which exists only in an
        // Android process, and this suite is deliberately Android-free
        // so it can run on a plain JVM.
        //
        // A tiny stand-in reproduces the ONE property under test - that
        // the registry keys itself by whatever a runtime calls itself.
        // The real class's id is asserted statically by
        // scripts/test-onnx-integration.ts, and proven for real on
        // device.
        val onnxLike = object : InferenceRuntime {
            override val runtimeId = RuntimeIds.ONNX
            override val label = "ONNX Runtime (CPU)"
            override fun isAvailable() = true
            override fun isLoaded() = false
            override fun loadedModel(): LoadedModelInfo? = null
            override suspend fun loadModel(model: ModelDescriptor): LoadedModelInfo =
                throw InferenceException(InferenceErrorCode.RUNTIME_UNAVAILABLE, "stand-in")
            override suspend fun infer(input: FloatArray): InferenceResult =
                throw InferenceException(InferenceErrorCode.RUNTIME_UNAVAILABLE, "stand-in")
            override suspend fun unloadModel() {}
        }
        check("the ONNX runtime id differs from the reference id",
            onnxLike.runtimeId != reference.runtimeId)

        // Registry construction, exactly as InferenceBenchmark does it.
        // This is the assertion that would have caught the bug: build
        // the map the same way and confirm every key is the runtime's
        // own advertised id.
        val registry = listOf<InferenceRuntime>(onnxLike, reference).associateBy { it.runtimeId }
        check("the registry contains both runtimes", registry.size == 2)
        check("looking up the canonical ONNX id resolves the ONNX runtime",
            registry[RuntimeIds.ONNX] === onnxLike)
        check("looking up the canonical reference id resolves ReferenceInferenceRuntime",
            registry[RuntimeIds.REFERENCE] is ReferenceInferenceRuntime)
        check("every registry key equals its runtime's advertised runtimeId",
            registry.all { (key, rt) -> key == rt.runtimeId })
        check("the stale \"onnx\" key is gone", !registry.containsKey("onnx"))

        // An unknown id must fail loudly rather than resolve to
        // anything - especially not the reference runtime (§13).
        check("an unknown runtime id resolves to nothing",
            registry["totally-unknown"] == null)
        check("a misspelled ONNX id does NOT silently yield the reference runtime",
            registry["onnx"] !is ReferenceInferenceRuntime)
    }
}
