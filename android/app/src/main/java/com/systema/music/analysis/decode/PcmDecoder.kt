package com.systema.music.analysis.decode

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.util.Log
import kotlin.coroutines.cancellation.CancellationException
import com.systema.music.analysis.AudioAnalysisException
import com.systema.music.analysis.dsp.AudioAnalysisConfig
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

/**
 * Decodes a content:// audio URI into mono float PCM, progressively.
 *
 * Why MediaExtractor + MediaCodec rather than ExoPlayer
 * -----------------------------------------------------
 * The Media3 player owns playback and must keep owning it. Routing
 * analysis through ExoPlayer would mean either sharing the playback
 * instance (which would fight over the queue, the session and the
 * audio focus) or constructing a second one (a second player, which
 * the phase spec forbids). MediaExtractor/MediaCodec is the platform's
 * own decode-only path: no audio output, no focus, no session, no
 * player. It handles every codec the device supports, which by
 * definition covers everything the library can contain.
 *
 * It also costs no new dependency — both classes are in the Android
 * framework.
 *
 * Memory
 * ------
 * The decoder never materialises the whole track. It emits into a
 * fixed [emitBuffer] and hands each chunk to the consumer, which
 * folds it into running statistics and lets it go. Peak usage is the
 * codec's own buffers plus this one array, regardless of whether the
 * file is 30 seconds or 30 minutes.
 *
 * Conversion pipeline per chunk:
 *   codec output (16-bit PCM, N channels, source rate)
 *     -> float -1..1
 *     -> mono downmix (mean of channels)
 *     -> linear-interpolated resample to the target rate
 *     -> consumer
 */
class PcmDecoder(
    private val context: Context,
    private val config: AudioAnalysisConfig,
) {

    /** Metadata discovered while decoding. */
    data class SourceInfo(
        val sourceSampleRate: Int,
        val channels: Int,
        val durationUs: Long,
        val mime: String,
    )

    /**
     * Receives mono PCM at [AudioAnalysisConfig.targetSampleRate].
     * The array is REUSED between calls — consume it before returning.
     */
    fun interface PcmSink {
        fun onPcm(samples: FloatArray, count: Int)
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
        /** ~0.37 s of mono audio at 22050 Hz. Small, but not chatty. */
        const val EMIT_CAPACITY = 8192
    }

    /**
     * Decodes [uri], pushing PCM into [sink].
     *
     * @param shouldCancel polled between buffers so a cancelled Worker
     *   stops promptly instead of decoding a whole track first.
     */
    /**
     * Reads the container's format WITHOUT decoding any audio.
     *
     * Needed because a cancelled decode never returns its SourceInfo,
     * and a bounded benchmark cancels on purpose the moment it has
     * enough audio. Opening the extractor, reading the track format
     * and closing it again is cheap — no codec is ever started.
     */
    fun probe(uri: Uri): SourceInfo {
        val extractor = MediaExtractor()
        try {
            openSource(extractor, uri)
            val trackIndex = selectAudioTrack(extractor)
            val format = extractor.getTrackFormat(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
            val sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val durationUs =
                if (format.containsKey(MediaFormat.KEY_DURATION)) {
                    format.getLong(MediaFormat.KEY_DURATION)
                } else {
                    0L
                }
            return SourceInfo(sourceRate, channels, durationUs, mime)
        } finally {
            runCatching { extractor.release() }
        }
    }

    fun decode(uri: Uri, sink: PcmSink, shouldCancel: () -> Boolean = { false }): SourceInfo {
        val extractor = MediaExtractor()

        try {
            openSource(extractor, uri)

            val trackIndex = selectAudioTrack(extractor)
            if (trackIndex < 0) {
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
                    "The file contains no decodable audio track.",
                )
            }

            val format = extractor.getTrackFormat(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME)
                ?: throw AudioAnalysisException(
                    AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
                    "The audio track has no MIME type.",
                )

            val sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val durationUs =
                if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION)
                else 0L

            if (sourceRate <= 0 || channels <= 0) {
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.INVALID_PCM,
                    "The audio track reports an impossible format.",
                )
            }

            extractor.selectTrack(trackIndex)

            val codec = try {
                MediaCodec.createDecoderByType(mime)
            } catch (e: CancellationException) {
                // Cancellation is never "no decoder available".
                throw e
            } catch (e: Exception) {
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
                    "No decoder available for $mime on this device.",
                    e,
                )
            }

            // ASK FOR 16-BIT PCM EXPLICITLY.
            //
            // The decode loop reads the output as 16-bit shorts. Most
            // decoders emit that by default, but lossless/high-res
            // paths (FLAC, WAV, ALAC, and some AAC decoders on newer
            // devices) can emit 32-bit FLOAT or 24/32-bit PCM instead.
            // Reading float samples as shorts does not throw a clean
            // error, so state the requirement rather than hoping.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                format.setInteger(
                    MediaFormat.KEY_PCM_ENCODING,
                    AudioFormat.ENCODING_PCM_16BIT,
                )
            }

            try {
                codec.configure(format, null, null, 0)
                codec.start()
                runDecodeLoop(codec, extractor, sink, sourceRate, channels, shouldCancel)
            } catch (e: AudioAnalysisException) {
                throw e
            } catch (e: CancellationException) {
                // CANCELLATION IS NOT A DECODER FAULT.
                //
                // CancellationException is an Exception, so the generic
                // catch below used to swallow it and relabel it
                // DECODER_ERROR. That is what turned a deliberate,
                // successful early stop into
                // "The decoder failed while reading this file".
                //
                // It is rethrown unchanged so structured concurrency
                // keeps working: swallowing a cancellation would also
                // leave the parent coroutine believing the child was
                // still running.
                throw e
            } catch (e: OutOfMemoryError) {
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.OUT_OF_MEMORY,
                    "Ran out of memory while decoding.",
                )
            } catch (e: Exception) {
                // Name the real exception. "The decoder failed" alone
                // is unactionable: it cannot distinguish a codec fault
                // from an unexpected PCM encoding or a truncated file.
                // The cause was always attached but never surfaced,
                // which is why the device report carried no detail.
                Log.w(
                    "CLAP",
                    "[DECODE_FAILURE] mime=$mime rate=$sourceRate ch=$channels " +
                        "exception=${e.javaClass.name}",
                    e,
                )
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.DECODER_ERROR,
                    "The decoder failed while reading this file " +
                        "(${mime}, ${sourceRate} Hz, ${channels}ch): " +
                        "${e.javaClass.simpleName}: ${e.message}",
                    e,
                )
            } finally {
                runCatching { codec.stop() }
                runCatching { codec.release() }
            }

            return SourceInfo(sourceRate, channels, durationUs, mime)
        } finally {
            runCatching { extractor.release() }
        }
    }

    private fun openSource(extractor: MediaExtractor, uri: Uri) {
        try {
            // ContentResolver, not a filesystem path: MediaStore URIs
            // are the only thing the library layer deals in, and on
            // modern Android the underlying files are frequently not
            // directly readable.
            context.contentResolver.openFileDescriptor(uri, "r").use { pfd ->
                if (pfd == null) {
                    throw AudioAnalysisException(
                        AudioAnalysisException.Code.INVALID_URI,
                        "The audio file could not be opened.",
                    )
                }
                extractor.setDataSource(pfd.fileDescriptor)
            }
        } catch (e: AudioAnalysisException) {
            throw e
        } catch (e: CancellationException) {
            // Cancellation must never be reported as an unreadable file.
            throw e
        } catch (e: SecurityException) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.INVALID_URI,
                "Permission denied for this audio file.",
                e,
            )
        } catch (e: Exception) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.INVALID_URI,
                "The audio file could not be read.",
                e,
            )
        }
    }

    private fun selectAudioTrack(extractor: MediaExtractor): Int {
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) return i
        }
        return -1
    }

    private fun runDecodeLoop(
        codec: MediaCodec,
        extractor: MediaExtractor,
        sink: PcmSink,
        sourceRate: Int,
        channels: Int,
        shouldCancel: () -> Boolean,
    ) {
        val info = MediaCodec.BufferInfo()
        val emitBuffer = FloatArray(EMIT_CAPACITY)
        var emitCount = 0

        // Resampling state, carried across chunks so the phase is
        // continuous at buffer boundaries.
        val ratio = sourceRate.toDouble() / config.targetSampleRate
        var resamplePosition = 0.0

        // Scratch for the mono downmix of one codec buffer. Grown only
        // if a codec hands us an unusually large buffer.
        var monoScratch = FloatArray(4096)

        // The codec's ACTUAL sample encoding. Requested as 16-bit at
        // configure() time, but a decoder may still report something
        // else, and INFO_OUTPUT_FORMAT_CHANGED is where it says so.
        var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT

        var inputDone = false
        var outputDone = false
        var decodedFrames = 0L
        val maxFrames = if (config.maxAnalysisDurationMs > 0) {
            config.maxAnalysisDurationMs * sourceRate / 1000
        } else {
            Long.MAX_VALUE
        }

        while (!outputDone) {
            if (shouldCancel()) {
                throw AudioAnalysisException(
                    AudioAnalysisException.Code.CANCELLED,
                    "Analysis was cancelled.",
                )
            }

            if (!inputDone) {
                val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    val inputBuffer = codec.getInputBuffer(inputIndex)
                    val sampleSize =
                        if (inputBuffer == null) -1 else extractor.readSampleData(inputBuffer, 0)

                    if (sampleSize < 0 || decodedFrames >= maxFrames) {
                        codec.queueInputBuffer(
                            inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                        )
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(
                            inputIndex, 0, sampleSize, extractor.sampleTime, 0,
                        )
                        extractor.advance()
                    }
                }
            }

            val outputIndex = codec.dequeueOutputBuffer(info, TIMEOUT_US)
            when {
                outputIndex >= 0 -> {
                    val outputBuffer = codec.getOutputBuffer(outputIndex)

                    if (info.size > 0 && outputBuffer != null) {
                        outputBuffer.position(info.offset)
                        outputBuffer.limit(info.offset + info.size)

                        val ordered = outputBuffer.order(ByteOrder.nativeOrder())

                        // Downmix to mono, honouring the encoding the
                        // codec actually produced. Float PCM is already
                        // in [-1,1]; 16-bit needs the /32768 scale.
                        val frameCount: Int
                        if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
                            val floats = ordered.asFloatBuffer()
                            frameCount = floats.remaining() / channels
                            if (frameCount > monoScratch.size) {
                                monoScratch = FloatArray(frameCount)
                            }
                            for (f in 0 until frameCount) {
                                var sum = 0f
                                for (c in 0 until channels) {
                                    sum += floats.get(f * channels + c)
                                }
                                monoScratch[f] = sum / channels
                            }
                        } else {
                            val shorts = ordered.asShortBuffer()
                            frameCount = shorts.remaining() / channels
                            if (frameCount > monoScratch.size) {
                                monoScratch = FloatArray(frameCount)
                            }
                            for (f in 0 until frameCount) {
                                var sum = 0f
                                for (c in 0 until channels) {
                                    sum += shorts.get(f * channels + c) / 32768f
                                }
                                monoScratch[f] = sum / channels
                            }
                        }
                        decodedFrames += frameCount

                        // Resample and emit in bounded chunks.
                        //
                        // Linear interpolation between neighbouring
                        // source frames. Good enough here: we are
                        // downsampling to measure statistics, not to
                        // reproduce audio, and the features of
                        // interest live far below the new Nyquist.
                        var readIndex = resamplePosition
                        while (readIndex < frameCount) {
                            val i0 = readIndex.toInt()
                            val frac = (readIndex - i0).toFloat()

                            // resamplePosition is always >= 0, so i0
                            // indexes into THIS buffer and the pair to
                            // interpolate is always local. The carried
                            // fraction is what keeps the seam smooth.
                            val a = monoScratch[i0]
                            val b = if (i0 + 1 < frameCount) monoScratch[i0 + 1] else monoScratch[frameCount - 1]

                            emitBuffer[emitCount++] = a + (b - a) * frac

                            if (emitCount == EMIT_CAPACITY) {
                                sink.onPcm(emitBuffer, emitCount)
                                emitCount = 0
                            }
                            readIndex += ratio
                        }
                        // Carry the fractional remainder into the next
                        // buffer so no drift accumulates across a long
                        // file.
                        resamplePosition = readIndex - frameCount
                    }

                    codec.releaseOutputBuffer(outputIndex, false)

                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        outputDone = true
                    }
                }

                outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    // Some decoders only report the real format here.
                    // Read the PCM encoding rather than assuming: a
                    // FLOAT-emitting decoder read as 16-bit shorts
                    // produces noise or a buffer fault, not a clean
                    // error, so the assumption has to be checked.
                    val outFormat = codec.outputFormat
                    pcmEncoding = if (
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                        outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)
                    ) {
                        outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    } else {
                        AudioFormat.ENCODING_PCM_16BIT
                    }
                    if (
                        pcmEncoding != AudioFormat.ENCODING_PCM_16BIT &&
                        pcmEncoding != AudioFormat.ENCODING_PCM_FLOAT
                    ) {
                        throw AudioAnalysisException(
                            AudioAnalysisException.Code.UNSUPPORTED_FORMAT,
                            "This file decodes to an unsupported PCM " +
                                "encoding ($pcmEncoding). Only 16-bit and " +
                                "float PCM are handled.",
                        )
                    }
                }
            }
        }

        if (emitCount > 0) sink.onPcm(emitBuffer, emitCount)

        if (decodedFrames == 0L) {
            throw AudioAnalysisException(
                AudioAnalysisException.Code.EMPTY_AUDIO,
                "The file decoded to no audio.",
            )
        }
    }
}
