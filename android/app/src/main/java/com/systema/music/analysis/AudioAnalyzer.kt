package com.systema.music.analysis

import android.content.Context
import android.net.Uri
import android.util.Log
import com.systema.music.analysis.decoder.AudioDecoder
import com.systema.music.analysis.fft.RealFFT
import com.systema.music.analysis.window.WindowFunctions
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Main audio analyzer for Phase 13.
 * 
 * This class performs real DSP analysis on audio files, extracting features
 * like RMS, spectral centroid, BPM, etc. It uses bounded buffers and
 * incremental processing to handle large audio files efficiently.
 * 
 * The analyzer is designed to:
 * - Work with content URIs from MediaStore
 * - Process audio incrementally without loading entire files into memory
 * - Support cancellation
 * - Provide accurate, reproducible results
 * 
 * Thread safety: This class is NOT thread-safe. Each thread should
 * create its own analyzer instance.
 */
class AudioAnalyzer(
    private val context: Context,
    private val config: AudioAnalysisConfig = DEFAULT_ANALYSIS_CONFIG,
) {
    
    companion object {
        private const val TAG = "AudioAnalyzer"
        
        /** Current analyzer version. Increment when algorithms change. */
        const val ANALYZER_VERSION = 1
        
        /** Minimum samples required for BPM estimation. */
        private const val MIN_SAMPLES_FOR_BPM = 44100 * 2 // 2 seconds
        
        /** Number of BPM candidates to consider. */
        private const val BPM_CANDIDATE_COUNT = 5
        
        /** BPM range for candidate search (40-200 BPM). */
        private const val BPM_MIN = 40f
        private const val BPM_MAX = 200f
        
        /** Sample rate for BPM analysis (downsampled for efficiency). */
        private const val BPM_SAMPLE_RATE = 22050
    }
    
    private val decoder: AudioDecoder by lazy { AudioDecoder(context, config) }
    
    /**
     * Analyze an audio file and return the results.
     * 
     * @param uri Content URI of the audio file
     * @param songId ID of the song (for database storage)
     * @return AudioAnalysisResult with all computed features
     * @throws AudioAnalysisException if analysis fails
     */
    fun analyze(uri: Uri, songId: String): AudioAnalysisResult {
        val startTime = System.currentTimeMillis()
        
        Log.d(TAG, "Starting analysis for $songId")
        
        // Decode audio
        val decodeStart = System.currentTimeMillis()
        val decodeResult = decoder.decodeToPcm(uri, config.maxSamplesToAnalyze)
        val decodeTime = System.currentTimeMillis() - decodeStart
        
        Log.d(TAG, "Decoded ${decodeResult.sampleCount} samples in ${decodeTime}ms")
        
        // Check for minimum samples
        if (decodeResult.sampleCount < config.minSamplesForAnalysis) {
            return AudioAnalysisResult(
                songId = songId,
                durationMs = decodeResult.durationMs,
                sampleRate = decodeResult.sampleRate,
                channels = decodeResult.channels,
                analyzedSampleCount = decodeResult.sampleCount,
                rms = null,
                peak = null,
                dynamicRangeDb = null,
                silenceRatio = null,
                spectralCentroid = null,
                spectralBandwidth = null,
                spectralRolloff = null,
                zeroCrossingRate = null,
                bpm = null,
                bpmConfidence = null,
                loudnessDb = null,
                decodeTimeMs = decodeTime,
                dspTimeMs = 0,
                totalAnalysisTimeMs = decodeTime,
                realTimeFactor = 0f,
                analyzerVersion = ANALYZER_VERSION,
                analyzedAt = System.currentTimeMillis(),
                errorCode = AnalysisErrorCode.EMPTY_AUDIO.codeName,
                errorMessage = "Insufficient audio samples for analysis",
            )
        }
        
        // DSP processing
        val dspStart = System.currentTimeMillis()
        
        // Work with the decoded PCM
        val pcm = decodeResult.pcm
        val actualSampleRate = decodeResult.sampleRate
        
        // Calculate features
        val (rms, peak, dynamicRangeDb, silenceRatio) = computeAmplitudeFeatures(pcm)
        
        // Compute spectral features using windowed FFT
        val (spectralCentroid, spectralBandwidth, spectralRolloff, zeroCrossingRate) = 
            computeSpectralFeatures(pcm, actualSampleRate)
        
        // Compute BPM
        val (bpm, bpmConfidence) = computeBpm(pcm, actualSampleRate)
        
        // Compute loudness
        val loudnessDb = computeLoudness(rms)
        
        val dspTime = System.currentTimeMillis() - dspStart
        val totalTime = System.currentTimeMillis() - startTime
        
        val realTimeFactor = if (decodeResult.durationMs > 0) {
            totalTime.toFloat() / decodeResult.durationMs
        } else {
            0f
        }
        
        Log.d(TAG, "Analysis complete for $songId: RTF=$realTimeFactor")
        
        return AudioAnalysisResult(
            songId = songId,
            durationMs = decodeResult.durationMs,
            sampleRate = actualSampleRate,
            channels = decodeResult.channels,
            analyzedSampleCount = decodeResult.sampleCount,
            rms = rms,
            peak = peak,
            dynamicRangeDb = dynamicRangeDb,
            silenceRatio = silenceRatio,
            spectralCentroid = spectralCentroid,
            spectralBandwidth = spectralBandwidth,
            spectralRolloff = spectralRolloff,
            zeroCrossingRate = zeroCrossingRate,
            bpm = bpm,
            bpmConfidence = bpmConfidence,
            loudnessDb = loudnessDb,
            decodeTimeMs = decodeTime,
            dspTimeMs = dspTime,
            totalAnalysisTimeMs = totalTime,
            realTimeFactor = realTimeFactor,
            analyzerVersion = ANALYZER_VERSION,
            analyzedAt = System.currentTimeMillis(),
        )
    }
    
    /**
     * Compute amplitude-based features (RMS, peak, dynamic range, silence ratio).
     */
    private fun computeAmplitudeFeatures(pcm: FloatArray): AmplitudeFeatures {
        var sumSq = 0.0
        var peakAbs = 0.0f
        var silentSamples = 0
        
        val silenceThresholdLinear = dbToLinear(config.silenceThresholdDb)
        
        for (sample in pcm) {
            val absSample = abs(sample)
            sumSq += absSample.toDouble() * absSample.toDouble()
            peakAbs = max(peakAbs, absSample)
            
            // Check if this sample is silent (below threshold)
            if (absSample < silenceThresholdLinear) {
                silentSamples++
            }
        }
        
        val sampleCount = pcm.size.toDouble()
        val rms = sqrt(sumSq / sampleCount).toFloat()
        
        // Dynamic range: difference between peak and RMS in dB
        val peakDb = linearToDb(peakAbs)
        val rmsDb = linearToDb(rms)
        val dynamicRangeDb = if (rms > 0) peakDb - rmsDb else 0f
        
        // Silence ratio
        val silenceRatio = silentSamples.toFloat() / pcm.size
        
        return AmplitudeFeatures(rms, peakAbs, dynamicRangeDb, silenceRatio)
    }
    
    /**
     * Compute spectral features using windowed FFT analysis.
     */
    private fun computeSpectralFeatures(
        pcm: FloatArray,
        sampleRate: Int,
    ): SpectralFeatures {
        val fftSize = config.fftSize
        val windowSize = config.windowSize
        val hopSize = config.hopSize
        
        // Create FFT instance
        val fft = RealFFT.create(fftSize)
        
        // Pre-allocate buffers
        val windowBuffer = FloatArray(windowSize)
        val magnitudeBuffer = FloatArray(fftSize / 2 + 1)
        
        // Aggregators for spectral features
        var totalCentroid = 0.0
        var totalBandwidth = 0.0
        var totalRolloff = 0.0
        var totalZcr = 0.0
        var windowCount = 0
        
        // Pre-compute window function
        val windowFunction = WindowFunctions.default()
        
        // Process in windows
        var pos = 0
        while (pos + windowSize <= pcm.size) {
            // Extract window
            System.arraycopy(pcm, pos, windowBuffer, 0, windowSize)
            
            // Apply window function
            windowFunction.apply(windowBuffer, normalize = false)
            
            // Compute FFT
            fft.forward(windowBuffer, magnitudeBuffer)
            
            // Compute spectral features for this window
            val features = computeWindowSpectralFeatures(
                magnitudeBuffer,
                fftSize,
                sampleRate,
                windowBuffer
            )
            
            totalCentroid += features.centroid
            totalBandwidth += features.bandwidth
            totalRolloff += features.rolloff
            totalZcr += features.zeroCrossingRate
            windowCount++
            
            pos += hopSize
        }
        
        // Average features across all windows
        val avgCentroid = if (windowCount > 0) (totalCentroid / windowCount).toFloat() else null
        val avgBandwidth = if (windowCount > 0) (totalBandwidth / windowCount).toFloat() else null
        val avgRolloff = if (windowCount > 0) (totalRolloff / windowCount).toFloat() else null
        val avgZcr = if (windowCount > 0) (totalZcr / windowCount).toFloat() else null
        
        return SpectralFeatures(
            spectralCentroid = avgCentroid,
            spectralBandwidth = avgBandwidth,
            spectralRolloff = avgRolloff,
            zeroCrossingRate = avgZcr,
        )
    }
    
    /**
     * Compute spectral features for a single window.
     */
    private fun computeWindowSpectralFeatures(
        magnitude: FloatArray,
        fftSize: Int,
        sampleRate: Int,
        pcmWindow: FloatArray,
    ): WindowSpectralFeatures {
        val binCount = magnitude.size
        val nyquist = sampleRate / 2.0
        
        // Compute spectral centroid
        var weightedSum = 0.0
        var totalMagnitude = 0.0
        
        for (bin in 0 until binCount) {
            val freq = fft.binToFrequency(bin, sampleRate).toDouble()
            val mag = magnitude[bin].toDouble()
            weightedSum += freq * mag * mag
            totalMagnitude += mag * mag
        }
        
        val centroid = if (totalMagnitude > 0) {
            sqrt(weightedSum / totalMagnitude).toFloat()
        } else {
            0f
        }
        
        // Compute spectral bandwidth
        var varianceSum = 0.0
        for (bin in 0 until binCount) {
            val freq = fft.binToFrequency(bin, sampleRate).toDouble()
            val mag = magnitude[bin].toDouble()
            val diff = freq - centroid
            varianceSum += (diff * diff) * mag * mag
        }
        
        val bandwidth = if (totalMagnitude > 0) {
            sqrt(varianceSum / totalMagnitude).toFloat()
        } else {
            0f
        }
        
        // Compute spectral rolloff (85%)
        var cumulativeEnergy = 0.0
        val targetEnergy = totalMagnitude * 0.85
        var rolloffBin = binCount - 1
        
        for (bin in 0 until binCount) {
            val mag = magnitude[bin].toDouble()
            cumulativeEnergy += mag * mag
            if (cumulativeEnergy >= targetEnergy) {
                rolloffBin = bin
                break
            }
        }
        
        val rolloff = fft.binToFrequency(rolloffBin, sampleRate)
        
        // Compute zero-crossing rate
        var zeroCrossings = 0
        for (i in 1 until pcmWindow.size) {
            if ((pcmWindow[i - 1] < 0 && pcmWindow[i] >= 0) || 
                (pcmWindow[i - 1] >= 0 && pcmWindow[i] < 0)) {
                zeroCrossings++
            }
        }
        
        // Normalize to crossings per second
        val zcr = (zeroCrossings.toFloat() * sampleRate) / pcmWindow.size
        
        return WindowSpectralFeatures(
            centroid = centroid,
            bandwidth = bandwidth,
            rolloff = rolloff,
            zeroCrossingRate = zcr,
        )
    }
    
    /**
     * Compute BPM using onset detection and autocorrelation.
     * 
     * Algorithm:
     * 1. Compute the spectral flux (onset strength) for each window
     * 2. Use autocorrelation to find periodic patterns in the onset strength
     * 3. Convert the lag to BPM
     * 4. Handle half/double tempo ambiguity
     */
    private fun computeBpm(
        pcm: FloatArray,
        sampleRate: Int,
    ): BpmResult {
        val minSamples = MIN_SAMPLES_FOR_BPM
        if (pcm.size < minSamples) {
            return BpmResult(null, null)
        }
        
        // Downsample if needed for efficiency
        val analysisSampleRate = BPM_SAMPLE_RATE
        val downsampleFactor = sampleRate / analysisSampleRate
        
        val analysisPcm = if (downsampleFactor > 1) {
            downsample(pcm, downsampleFactor)
        } else {
            pcm
        }
        
        // Window parameters for BPM analysis
        val windowSize = 1024
        val hopSize = 512
        
        // Compute spectral flux (onset strength)
        val onsetStrength = computeOnsetStrength(analysisPcm, analysisSampleRate, windowSize, hopSize)
        
        if (onsetStrength.size < 10) {
            return BpmResult(null, null)
        }
        
        // Use autocorrelation to find tempo
        val (bpm, confidence) = autocorrelationBpm(onsetStrength, analysisSampleRate, hopSize)
        
        return BpmResult(bpm, confidence)
    }
    
    /**
     * Downsample audio by averaging.
     */
    private fun downsample(pcm: FloatArray, factor: Int): FloatArray {
        if (factor <= 1) return pcm
        
        val newSize = (pcm.size + factor - 1) / factor
        val result = FloatArray(newSize)
        
        for (i in 0 until newSize) {
            val start = i * factor
            val end = min(start + factor, pcm.size)
            var sum = 0.0f
            for (j in start until end) {
                sum += pcm[j]
            }
            result[i] = sum / (end - start)
        }
        
        return result
    }
    
    /**
     * Compute onset strength using spectral flux.
     * 
     * Spectral flux measures the change in spectral energy between
     * consecutive windows, which correlates with percussive onsets.
     */
    private fun computeOnsetStrength(
        pcm: FloatArray,
        sampleRate: Int,
        windowSize: Int,
        hopSize: Int,
    ): FloatArray {
        val fftSize = RealFFT.nextPowerOf2(windowSize)
        val fft = RealFFT.create(fftSize)
        
        val windowBuffer = FloatArray(windowSize)
        val prevMagnitude = FloatArray(fftSize / 2 + 1)
        val currMagnitude = FloatArray(fftSize / 2 + 1)
        
        val onsetStrength = mutableListOf<Float>()
        
        var pos = 0
        var firstWindow = true
        
        while (pos + windowSize <= pcm.size) {
            // Extract window
            System.arraycopy(pcm, pos, windowBuffer, 0, windowSize)
            
            // Apply window function
            WindowFunctions.apply(windowBuffer, normalize = false)
            
            // Compute FFT
            fft.forward(windowBuffer, currMagnitude)
            
            if (!firstWindow) {
                // Compute spectral flux
                var flux = 0.0f
                for (i in currMagnitude.indices) {
                    val diff = currMagnitude[i] - prevMagnitude[i]
                    flux += max(0f, diff) // Only positive changes (onsets)
                }
                onsetStrength.add(flux)
            } else {
                firstWindow = false
            }
            
            // Swap buffers
            System.arraycopy(currMagnitude, 0, prevMagnitude, 0, currMagnitude.size)
            
            pos += hopSize
        }
        
        return onsetStrength.toFloatArray()
    }
    
    /**
     * Estimate BPM using autocorrelation of onset strength.
     * 
     * Autocorrelation finds the lag that maximizes the correlation of
     * the onset strength signal with itself. This lag corresponds to
     * the tempo period.
     */
    private fun autocorrelationBpm(
        onsetStrength: FloatArray,
        sampleRate: Int,
        hopSize: Int,
    ): BpmResult {
        val onsetSize = onsetStrength.size
        
        // The maximum lag to check (corresponds to minimum BPM)
        val maxLag = (sampleRate * 60 / BPM_MIN).toInt() / hopSize
        val minLag = (sampleRate * 60 / BPM_MAX).toInt() / hopSize
        
        val maxCheckLag = min(maxLag, onsetSize / 2)
        val minCheckLag = max(1, minLag)
        
        // Compute autocorrelation
        val autocorr = FloatArray(maxCheckLag + 1)
        
        for (lag in minCheckLag..maxCheckLag) {
            var sum = 0.0f
            for (i in 0 until onsetSize - lag) {
                sum += onsetStrength[i] * onsetStrength[i + lag]
            }
            autocorr[lag] = sum
        }
        
        // Find the lag with maximum autocorrelation
        var maxAutocorr = 0f
        var bestLag = 0
        
        for (lag in minCheckLag..maxCheckLag) {
            if (autocorr[lag] > maxAutocorr) {
                maxAutocorr = autocorr[lag]
                bestLag = lag
            }
        }
        
        if (bestLag == 0 || maxAutocorr <= 0) {
            return BpmResult(null, null)
        }
        
        // Convert lag to BPM
        // lag is in hop units, each hop is hopSize samples
        val periodSamples = bestLag.toFloat() * hopSize
        val periodSeconds = periodSamples / sampleRate
        val bpm = 60f / periodSeconds
        
        // Handle half/double tempo ambiguity
        // Check if half or double tempo has higher autocorrelation
        val candidates = mutableListOf(Pair(bpm, maxAutocorr))
        
        // Check half tempo
        val halfLag = (bestLag * 2).coerceAtMost(maxCheckLag)
        if (halfLag >= minCheckLag) {
            candidates.add(Pair(bpm * 2f, autocorr[halfLag]))
        }
        
        // Check double tempo
        val doubleLag = (bestLag / 2).coerceAtLeast(minCheckLag)
        if (doubleLag <= maxCheckLag) {
            candidates.add(Pair(bpm * 0.5f, autocorr[doubleLag]))
        }
        
        // Sort by autocorrelation (confidence)
        candidates.sortByDescending { it.second }
        
        val bestCandidate = candidates.first()
        val bestBpm = bestCandidate.first
        
        // Normalize confidence to 0-1 range
        val confidence = if (maxAutocorr > 0) {
            // Normalize by the autocorrelation at lag=0 (maximum possible)
            // We approximate it as the sum of squares
            var maxPossible = 0.0f
            for (v in onsetStrength) {
                maxPossible += v * v
            }
            (bestCandidate.second / maxPossible).coerceIn(0f, 1f)
        } else {
            0f
        }
        
        // Only return BPM if confidence is above threshold
        val confidenceThreshold = 0.15f
        if (confidence < confidenceThreshold) {
            return BpmResult(null, confidence)
        }
        
        // Clamp BPM to reasonable range
        val clampedBpm = bestBpm.coerceIn(BPM_MIN, BPM_MAX)
        
        return BpmResult(clampedBpm, confidence)
    }
    
    /**
     * Compute loudness from RMS.
     * 
     * This is a simple RMS-derived loudness in dBFS (decibels relative
     * to full scale). This is NOT LUFS.
     * 
     * LUFS requires K-weighting (a specific frequency-dependent filter)
     * and integration over time with specific time constants. We do not
     * implement that here.
     * 
     * The result is in dBFS where 0 dBFS = full scale (maximum possible).
     * Typical values: -20 to -60 dBFS for normal audio.
     */
    private fun computeLoudness(rms: Float?): Float? {
        if (rms == null || rms <= 0) return null
        return linearToDb(rms)
    }
    
    /**
     * Convert linear amplitude to decibels.
     */
    private fun linearToDb(linear: Float): Float {
        if (linear <= 0) return Float.NEGATIVE_INFINITY
        return (20 * log10(linear.toDouble())).toFloat()
    }
    
    /**
     * Convert decibels to linear amplitude.
     */
    private fun dbToLinear(db: Float): Float {
        if (db <= Float.NEGATIVE_INFINITY) return 0f
        return 10f.pow(db / 20f)
    }
    
    // Result data classes
    private data class AmplitudeFeatures(
        val rms: Float,
        val peak: Float,
        val dynamicRangeDb: Float,
        val silenceRatio: Float,
    )
    
    private data class SpectralFeatures(
        val spectralCentroid: Float?,
        val spectralBandwidth: Float?,
        val spectralRolloff: Float?,
        val zeroCrossingRate: Float?,
    )
    
    private data class WindowSpectralFeatures(
        val centroid: Float,
        val bandwidth: Float,
        val rolloff: Float,
        val zeroCrossingRate: Float,
    )
    
    private data class BpmResult(
        val bpm: Float?,
        val confidence: Float?,
    )
}
