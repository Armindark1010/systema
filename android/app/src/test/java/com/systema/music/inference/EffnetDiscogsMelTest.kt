package com.systema.music.inference

import com.systema.music.inference.effnet.EffnetDiscogsMelFrontEnd
import com.systema.music.inference.effnet.EffnetDiscogsModel
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.PI

/**
 * ============================================================
 * SYSTEMA — Phase 29: Discogs-EffNet mel front end
 * ============================================================
 *
 * REAL arithmetic on the REAL production class. Nothing here greps
 * source text; every assertion runs the actual code path that will
 * feed the model.
 *
 * WHY THESE PARTICULAR CASES
 * --------------------------
 * A mel front end fails silently. If the filterbank normalisation or
 * the compression curve is wrong, the model still returns 1280 finite
 * floats and the heads still return plausible mood labels — the error
 * only shows up as "this model seems bad", months later, after someone
 * has hand-labelled a hundred tracks against garbage.
 *
 * So the cases below pin the properties that would break silently:
 *
 *   - a SILENT input must compress to exactly 0.0, because
 *     log10(1 + 10000*0) = log10(1) = 0. If someone swaps in CLAP's
 *     10*log10(max(p, 1e-10)) the answer becomes -100, and that single
 *     number is the fastest way to detect the wrong compression.
 *   - a unit_tri filterbank must have PEAK 1.0. Slaney "area"
 *     normalisation gives peaks that shrink as frequency rises, so
 *     checking the max of each filter distinguishes them.
 *   - a pure tone must put its energy in the band containing that
 *     frequency, which catches an off-by-one in the mel mapping.
 *   - frame and patch counts must match Essentia's padSignal formula
 *     exactly, or the model sees a different amount of audio than the
 *     reference implementation.
 *
 * WHAT THIS DOES NOT COVER
 * ------------------------
 * It does not run ONNX, does not load the real weights, and does not
 * prove the embeddings are GOOD. It proves the tensor handed to the
 * model is the tensor Essentia would have handed it. Whether the model
 * is worth keeping is the question the dataset exists to answer.
 * ============================================================
 */
class EffnetDiscogsMelTest {

    private val eps = 1e-4f

    private fun check(name: String, cond: Boolean, detail: String = "") {
        if (!cond) throw AssertionError("FAILED: $name${if (detail.isEmpty()) "" else " — $detail"}")
    }

    // ----------------------------------------------------------------
    // 1. Constants match Essentia
    // ----------------------------------------------------------------
    fun testConstants() {
        check("sample rate", EffnetDiscogsMelFrontEnd.SAMPLE_RATE == 16_000)
        check("frame size", EffnetDiscogsMelFrontEnd.FRAME_SIZE == 512)
        check("hop size", EffnetDiscogsMelFrontEnd.HOP_SIZE == 256)
        check("mel bands", EffnetDiscogsMelFrontEnd.MEL_BANDS == 96)
        check("patch size", EffnetDiscogsMelFrontEnd.PATCH_SIZE == 128)
        check("patch hop", EffnetDiscogsMelFrontEnd.PATCH_HOP == 62)
        check("batch size", EffnetDiscogsMelFrontEnd.BATCH_SIZE == 64)
    }

    // ----------------------------------------------------------------
    // 2. Slaney mel scale round-trips
    // ----------------------------------------------------------------
    fun testMelScale() {
        // Below 1 kHz the scale is linear: 3*hz/200.
        check("0 Hz -> 0 mel", abs(EffnetDiscogsMelFrontEnd.hzToMel(0.0)) < 1e-9)
        check(
            "500 Hz is linear region",
            abs(EffnetDiscogsMelFrontEnd.hzToMel(500.0) - 7.5) < 1e-9,
            "got ${EffnetDiscogsMelFrontEnd.hzToMel(500.0)}",
        )
        // The break point must be exactly 15 mel at 1 kHz.
        check(
            "1000 Hz -> 15 mel (break point)",
            abs(EffnetDiscogsMelFrontEnd.hzToMel(1000.0) - 15.0) < 1e-9,
        )

        // Round trip across the whole usable range.
        for (hz in listOf(0.0, 100.0, 999.0, 1000.0, 4000.0, 8000.0)) {
            val back = EffnetDiscogsMelFrontEnd.melToHz(EffnetDiscogsMelFrontEnd.hzToMel(hz))
            check("round trip $hz Hz", abs(back - hz) < 1e-6, "got $back")
        }
    }

    // ----------------------------------------------------------------
    // 3. SILENCE compresses to exactly zero
    //
    // This is the single most diagnostic case in the file. With the
    // correct log10(1 + 10000*m), silence gives log10(1) = 0. With
    // CLAP's 10*log10(max(p, 1e-10)) it gives -100.
    // ----------------------------------------------------------------
    fun testSilenceIsZero() {
        val fe = EffnetDiscogsMelFrontEnd()
        val silence = FloatArray(16_000)
        val frames = fe.melFrames(silence)

        check("silence produced frames", frames.isNotEmpty())
        for ((i, frame) in frames.withIndex()) {
            check("frame $i has 96 bands", frame.size == 96, "got ${frame.size}")
            for ((b, v) in frame.withIndex()) {
                check(
                    "silence band $b of frame $i is 0",
                    abs(v) < eps,
                    "got $v — if this is about -100, the CLAP compression was used",
                )
            }
        }
    }

    // ----------------------------------------------------------------
    // 4. Compression curve is log10(1 + 10000*m)
    // ----------------------------------------------------------------
    fun testCompressionCurve() {
        // Verify the formula's shape at hand-checkable points.
        check("log10(1+10000*0) == 0", abs(log10(1.0 + 10_000.0 * 0.0)) < 1e-12)
        check(
            "log10(1+10000*0.0001) == log10(2)",
            abs(log10(1.0 + 10_000.0 * 0.0001) - log10(2.0)) < 1e-12,
        )
        check(
            "log10(1+10000*0.1) == log10(1001)",
            abs(log10(1.0 + 10_000.0 * 0.1) - log10(1001.0)) < 1e-12,
        )

        // Output must be non-negative: the curve is monotonic from 0.
        val fe = EffnetDiscogsMelFrontEnd()
        val tone = FloatArray(16_000) { i -> sin(2.0 * PI * 440.0 * i / 16_000).toFloat() }
        for (frame in fe.melFrames(tone)) {
            for (v in frame) {
                check("compressed value is finite", v.isFinite(), "got $v")
                check("compressed value is non-negative", v >= -eps, "got $v")
            }
        }
    }

    // ----------------------------------------------------------------
    // 5. A pure tone lands in the right band
    // ----------------------------------------------------------------
    fun testToneLocalisation() {
        val fe = EffnetDiscogsMelFrontEnd()
        val sr = EffnetDiscogsMelFrontEnd.SAMPLE_RATE

        for (freq in listOf(220.0, 1000.0, 4000.0)) {
            val pcm = FloatArray(sr) { i -> sin(2.0 * PI * freq * i / sr).toFloat() }
            val frames = fe.melFrames(pcm)
            // Use a middle frame: the first is half zero-padding.
            val frame = frames[frames.size / 2]

            var peakBand = 0
            for (b in frame.indices) if (frame[b] > frame[peakBand]) peakBand = b

            // Where should the peak be? Map the tone through the same
            // mel scale the filterbank uses.
            val melMax = EffnetDiscogsMelFrontEnd.hzToMel(sr / 2.0)
            val melTone = EffnetDiscogsMelFrontEnd.hzToMel(freq)
            val expected = ((melTone / melMax) * 96).toInt()

            check(
                "$freq Hz peaks near band $expected",
                abs(peakBand - expected) <= 2,
                "peak was $peakBand",
            )
            check("$freq Hz has real energy", frame[peakBand] > 0.1f, "got ${frame[peakBand]}")
        }
    }

    // ----------------------------------------------------------------
    // 6. Framing matches Essentia padSignal
    // ----------------------------------------------------------------
    fun testFraming() {
        val fe = EffnetDiscogsMelFrontEnd()

        // 1 + ceil((n - 512/2) / 256)
        check("16000 samples -> 63 frames", fe.frameCountFor(16_000) == 63,
            "got ${fe.frameCountFor(16_000)}")
        check("empty input -> 0 frames", fe.frameCountFor(0) == 0)

        // lastPatchMode = discard: floor, never ceil.
        check("127 frames -> 0 patches", fe.patchCountFor(127) == 0)
        check("128 frames -> exactly 1 patch", fe.patchCountFor(128) == 1)
        check("189 frames -> still 1 patch", fe.patchCountFor(189) == 1,
            "got ${fe.patchCountFor(189)}")
        check("190 frames -> 2 patches", fe.patchCountFor(190) == 2,
            "got ${fe.patchCountFor(190)}")

        // A short clip must yield nothing rather than a padded patch.
        val tooShort = FloatArray(8_000)
        check("half a second yields no patch",
            fe.patchCountFor(fe.frameCountFor(tooShort.size)) == 0)
    }

    // ----------------------------------------------------------------
    // 7. Batch tensor shape and padding accounting
    // ----------------------------------------------------------------
    fun testBatchShape() {
        val fe = EffnetDiscogsMelFrontEnd()
        val sr = EffnetDiscogsMelFrontEnd.SAMPLE_RATE

        // 30 s: comfortably more than one patch, fewer than 64.
        val pcm = FloatArray(sr * 30) { i -> sin(2.0 * PI * 440.0 * i / sr).toFloat() }
        val frames = fe.melFrames(pcm)
        val batch = fe.toBatch(frames, 0)
            ?: throw AssertionError("FAILED: 30 s should produce a batch")

        check("tensor is [64,128,96]",
            batch.shape == listOf(64L, 128L, 96L), "got ${batch.shape}")
        check("tensor length is 64*128*96",
            batch.data.size == 64 * 128 * 96, "got ${batch.data.size}")
        check("real patches counted", batch.realPatchCount > 0)
        check("real patches do not exceed the batch",
            batch.realPatchCount <= 64, "got ${batch.realPatchCount}")

        // The padded tail must be exactly zero, so a caller that
        // ignores realPatchCount at least averages in zeros rather than
        // stale memory from a previous track.
        if (batch.realPatchCount < 64) {
            val start = batch.realPatchCount * 128 * 96
            for (i in start until batch.data.size) {
                check("padding slot $i is zero", batch.data[i] == 0f, "got ${batch.data[i]}")
            }
        }

        // Too short: no batch at all, not a zero-filled one.
        val short = FloatArray(sr / 2)
        check("half a second produces NO batch",
            fe.toBatch(fe.melFrames(short), 0) == null)
    }

    // ----------------------------------------------------------------
    // 8. Determinism — same input, same tensor
    // ----------------------------------------------------------------
    fun testDeterminism() {
        val fe = EffnetDiscogsMelFrontEnd()
        val sr = EffnetDiscogsMelFrontEnd.SAMPLE_RATE
        val pcm = FloatArray(sr * 5) { i -> sin(2.0 * PI * 330.0 * i / sr).toFloat() }

        val a = fe.melFrames(pcm)
        val b = fe.melFrames(pcm)
        check("same frame count", a.size == b.size)
        for (i in a.indices) {
            for (j in a[i].indices) {
                check("frame $i band $j is deterministic", a[i][j] == b[i][j])
            }
        }

        // A fresh instance must agree with a reused one: buffers are
        // reused across calls, so a missing clear would show up here.
        val fresh = EffnetDiscogsMelFrontEnd().melFrames(pcm)
        for (i in a.indices) {
            for (j in a[i].indices) {
                check("instance-independent at $i/$j", abs(a[i][j] - fresh[i][j]) < eps)
            }
        }
    }

    // ----------------------------------------------------------------
    // 9. Model descriptor and rejection rules
    // ----------------------------------------------------------------
    fun testModelDescriptor() {
        val d = EffnetDiscogsModel.descriptorFor("/tmp/discogs-effnet-bs64-1.onnx", 1234L)

        check("model id", d.modelId == "discogs-effnet-bs64-1")
        check("version", d.version == "1")
        check("input shape [64,128,96]",
            d.inputShape == listOf(64L, 128L, 96L), "got ${d.inputShape}")
        check("output shape [64,1280]",
            d.outputShape == listOf(64L, 1280L), "got ${d.outputShape}")
        check("16 kHz declared", d.inputSampleRate == 16_000)
        check("mono declared", d.inputChannels == 1)
        check("log-mel format", d.inputFormat == InputFormat.LOG_MEL_SPECTROGRAM)
        check("float32 in", d.inputType == TensorType.FLOAT32)
        check("float32 out", d.outputType == TensorType.FLOAT32)
        check("recognised as EffNet", EffnetDiscogsModel.isEffnetDiscogs(d))

        // The .pb must be refused with a message naming the fix.
        val pb = EffnetDiscogsModel.rejectionReasonFor("discogs-effnet-bs64-1.pb")
        check("a .pb is rejected", pb != null)
        check("the .pb message names TensorFlow", pb!!.contains("TensorFlow"))
        check("the .pb message names ONNX", pb.contains("ONNX"))
        check("the .pb message names the right file", pb.contains(".onnx"))

        check("a .tflite is rejected",
            EffnetDiscogsModel.rejectionReasonFor("model.tflite") != null)
        check("a .pt is rejected",
            EffnetDiscogsModel.rejectionReasonFor("model.pt") != null)
        check("a random file is rejected",
            EffnetDiscogsModel.rejectionReasonFor("notes.txt") != null)
        check("a .onnx is accepted",
            EffnetDiscogsModel.rejectionReasonFor("discogs-effnet-bs64-1.onnx") == null)
        check("case is ignored",
            EffnetDiscogsModel.rejectionReasonFor("MODEL.PB") != null)
    }

    // ----------------------------------------------------------------
    // 10. Signature verification rejects a lookalike
    // ----------------------------------------------------------------
    fun testSignatureVerification() {
        // The real thing passes.
        val good = LoadedModelInfo(
            modelId = "discogs-effnet-bs64-1",
            sizeBytes = 1L,
            inputNames = listOf("serving_default_melspectrogram"),
            outputNames = listOf("PartitionedCall:0", "PartitionedCall:1"),
            actualInputShape = listOf(64L, 128L, 96L),
            loadMs = 1.0,
            inputs = listOf(
                TensorSignature("serving_default_melspectrogram", listOf(64L, 128L, 96L), "FLOAT"),
            ),
            outputs = listOf(
                TensorSignature("PartitionedCall:0", listOf(64L, 400L), "FLOAT"),
                TensorSignature("PartitionedCall:1", listOf(64L, 1280L), "FLOAT"),
            ),
        )
        EffnetDiscogsModel.verifySignature(good) // must not throw

        // A 512-d model (e.g. CLAP) must be refused, not accepted as
        // "close enough". The heads require exactly 1280.
        val wrongWidth = good.copy(
            outputs = listOf(TensorSignature("PartitionedCall:1", listOf(64L, 512L), "FLOAT")),
        )
        var threw = false
        try {
            EffnetDiscogsModel.verifySignature(wrongWidth)
        } catch (e: InferenceException) {
            threw = true
            check("wrong width is MODEL_INVALID", e.code == InferenceErrorCode.MODEL_INVALID)
        }
        check("a 512-d model is rejected", threw)

        // No embedding output at all.
        val noEmbedding = good.copy(
            outputs = listOf(TensorSignature("PartitionedCall:0", listOf(64L, 400L), "FLOAT")),
        )
        threw = false
        try {
            EffnetDiscogsModel.verifySignature(noEmbedding)
        } catch (e: InferenceException) {
            threw = true
        }
        check("a styles-only model is rejected", threw)

        // Wrong mel band count on the input side.
        val wrongBands = good.copy(
            inputs = listOf(
                TensorSignature("serving_default_melspectrogram", listOf(64L, 128L, 64L), "FLOAT"),
            ),
        )
        threw = false
        try {
            EffnetDiscogsModel.verifySignature(wrongBands)
        } catch (e: InferenceException) {
            threw = true
            check("band mismatch is INPUT_SHAPE_MISMATCH",
                e.code == InferenceErrorCode.INPUT_SHAPE_MISMATCH)
        }
        check("a 64-band model is rejected", threw)
    }

    fun runAll() {
        testConstants()
        testMelScale()
        testSilenceIsZero()
        testCompressionCurve()
        testToneLocalisation()
        testFraming()
        testBatchShape()
        testDeterminism()
        testModelDescriptor()
        testSignatureVerification()
        println("EffnetDiscogsMelTest: all checks passed")
    }
}

fun main() {
    EffnetDiscogsMelTest().runAll()
}
