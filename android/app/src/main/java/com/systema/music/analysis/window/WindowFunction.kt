package com.systema.music.analysis.window

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Window functions for spectral analysis.
 * 
 * Window functions reduce spectral leakage by tapering the edges of
 * the analysis window. Different windows have different trade-offs
 * between frequency resolution and amplitude accuracy.
 * 
 * All window functions are normalized so that the sum of squares is 1.0
 * (Parseval's theorem), which preserves the total energy of the signal.
 */
sealed class WindowFunction {
    abstract val name: String
    abstract fun apply(window: FloatArray)
    
    /**
     * Apply window function to a buffer and optionally normalize.
     * 
     * @param buffer The buffer to window
     * @param normalize If true, scale the window so sum of squares = 1.0
     */
    fun applyAndNormalize(buffer: FloatArray, normalize: Boolean = true) {
        apply(buffer)
        if (normalize) {
            normalizeEnergy(buffer)
        }
    }
    
    /**
     * Normalize buffer so that sum of squares = 1.0.
     * This preserves the total energy of the signal.
     */
    protected fun normalizeEnergy(buffer: FloatArray) {
        var sumSq = 0.0
        for (v in buffer) {
            sumSq += v.toDouble() * v.toDouble()
        }
        val scale = sqrt(sumSq).toFloat()
        if (scale > 0) {
            for (i in buffer.indices) {
                buffer[i] /= scale
            }
        }
    }
}

/**
 * Rectangular window (no window).
 * 
 * Properties:
 * - Main lobe width: 2π/N (narrowest)
 * - Side lobe level: -13 dB (poor)
 * - Scalloping loss: 3.92 dB
 * - 6 dB bandwidth: 0.89 bins
 * 
 * Use when: Maximum frequency resolution is needed and amplitude
 * accuracy is less important.
 */
object RectangularWindow : WindowFunction() {
    override val name: String = "rectangular"
    
    override fun apply(window: FloatArray) {
        // No-op: rectangular window is just the original signal
    }
}

/**
 * Hann (Hanning) window.
 * 
 * Formula: w(n) = 0.5 * (1 - cos(2πn/(N-1)))
 * 
 * Properties:
 * - Main lobe width: 4π/N
 * - Side lobe level: -32 dB (good)
 * - Scalloping loss: 1.42 dB
 * - 6 dB bandwidth: 1.44 bins
 * 
 * Use when: Good general-purpose window for most audio analysis.
 * This is the default recommendation for most applications.
 */
object HannWindow : WindowFunction() {
    override val name: String = "hann"
    
    override fun apply(window: FloatArray) {
        val n = window.size - 1
        if (n <= 0) return
        
        for (i in window.indices) {
            val phase = 2.0 * PI * i / n
            window[i] *= (0.5f * (1 - cos(phase)).toFloat())
        }
    }
}

/**
 * Hamming window.
 * 
 * Formula: w(n) = 0.54 - 0.46 * cos(2πn/(N-1))
 * 
 * Properties:
 * - Main lobe width: 4π/N
 * - Side lobe level: -43 dB (very good)
 * - Scalloping loss: 1.85 dB
 * - 6 dB bandwidth: 1.3 bins
 * 
 * Use when: Lower side lobes are more important than main lobe width.
 */
object HammingWindow : WindowFunction() {
    override val name: String = "hamming"
    
    override fun apply(window: FloatArray) {
        val n = window.size - 1
        if (n <= 0) return
        
        for (i in window.indices) {
            val phase = 2.0 * PI * i / n
            window[i] *= (0.54f - 0.46f * cos(phase).toFloat())
        }
    }
}

/**
 * Blackman window.
 * 
 * Formula: w(n) = 0.42 - 0.5 * cos(2πn/(N-1)) + 0.08 * cos(4πn/(N-1))
 * 
 * Properties:
 * - Main lobe width: 6π/N (widest)
 * - Side lobe level: -58 dB (excellent)
 * - Scalloping loss: 1.13 dB
 * - 6 dB bandwidth: 2.0 bins
 * 
 * Use when: Very low side lobes are critical and frequency resolution
 * can be sacrificed.
 */
object BlackmanWindow : WindowFunction() {
    override val name: String = "blackman"
    
    override fun apply(window: FloatArray) {
        val n = window.size - 1
        if (n <= 0) return
        
        for (i in window.indices) {
            val phase1 = 2.0 * PI * i / n
            val phase2 = 4.0 * PI * i / n
            window[i] *= (0.42f - 0.5f * cos(phase1).toFloat() + 0.08f * cos(phase2).toFloat())
        }
    }
}

/**
 * Blackman-Harris window.
 * 
 * Formula: w(n) = 0.35875 - 0.48829 * cos(2πn/(N-1)) + 0.14128 * cos(4πn/(N-1)) - 0.01168 * cos(6πn/(N-1))
 * 
 * Properties:
 * - Main lobe width: 8π/N (widest)
 * - Side lobe level: -92 dB (excellent)
 * - Scalloping loss: 1.78 dB
 * - 6 dB bandwidth: 2.7 bins
 * 
 * Use when: Extremely low side lobes are required.
 */
object BlackmanHarrisWindow : WindowFunction() {
    override val name: String = "blackman_harris"
    
    override fun apply(window: FloatArray) {
        val n = window.size - 1
        if (n <= 0) return
        
        for (i in window.indices) {
            val phase1 = 2.0 * PI * i / n
            val phase2 = 4.0 * PI * i / n
            val phase3 = 6.0 * PI * i / n
            window[i] *= (0.35875f - 
                0.48829f * cos(phase1).toFloat() +
                0.14128f * cos(phase2).toFloat() -
                0.01168f * cos(phase3).toFloat())
        }
    }
}

/**
 * Factory for creating window functions by name.
 */
object WindowFunctions {
    private val registry: Map<String, WindowFunction> = mapOf(
        "rectangular" to RectangularWindow,
        "hann" to HannWindow,
        "hanning" to HannWindow,  // Alias
        "hamming" to HammingWindow,
        "blackman" to BlackmanWindow,
        "blackman_harris" to BlackmanHarrisWindow,
    )
    
    /**
     * Get window function by name.
     * 
     * @param name Window function name (case-insensitive)
     * @return Window function, or HannWindow if name is unknown
     */
    fun get(name: String): WindowFunction {
        return registry[name.lowercase()] ?: HannWindow
    }
    
    /**
     * Get the default window function (Hann).
     */
    fun default(): WindowFunction = HannWindow
    
    /**
     * Apply a window function to a buffer.
     * 
     * @param buffer Buffer to window
     * @param windowFunction Window function to apply
     * @param normalize If true, normalize to preserve energy
     */
    fun apply(
        buffer: FloatArray,
        windowFunction: WindowFunction = default(),
        normalize: Boolean = true,
    ) {
        windowFunction.applyAndNormalize(buffer, normalize)
    }
}
