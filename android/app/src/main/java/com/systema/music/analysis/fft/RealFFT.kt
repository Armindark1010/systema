package com.systema.music.analysis.fft

import kotlin.math.cos
import kotlin.math.sin

/**
 * Lightweight real-valued FFT implementation using the Cooley-Tukey algorithm.
 * 
 * This is optimized for audio analysis use cases:
 * - Operates on bounded windows (typical audio analysis uses 1024-4096 samples)
 * - Minimizes allocations by reusing buffers
 * - Supports only power-of-2 sizes (required by Cooley-Tukey)
 * - Computes only the first half of the spectrum (real input symmetry)
 * 
 * For a window of size N, this computes N/2 + 1 complex frequency bins.
 * 
 * Thread safety: This class is NOT thread-safe. Each thread should have
 * its own instance, or synchronization must be provided externally.
 */
class RealFFT(
    /** FFT size must be a power of 2. */
    val size: Int,
) {
    private val halfSize: Int = size / 2
    private val log2Size: Int
    
    // Pre-computed twiddle factors (complex roots of unity)
    private val twiddleReal: FloatArray
    private val twiddleImag: FloatArray
    
    // Bit-reversal permutation table
    private val bitReverse: IntArray
    
    // Working buffers to avoid allocations
    private val inputReal: FloatArray = FloatArray(size)
    private val inputImag: FloatArray = FloatArray(size)
    
    init {
        require(size > 0 && (size and (size - 1)) == 0) { 
            "FFT size must be a power of 2: $size" 
        }
        
        // Calculate log2 of size
        log2Size = when (size) {
            2 -> 1
            4 -> 2
            8 -> 3
            16 -> 4
            32 -> 5
            64 -> 6
            128 -> 7
            256 -> 8
            512 -> 9
            1024 -> 10
            2048 -> 11
            4096 -> 12
            8192 -> 13
            16384 -> 14
            else -> {
                var log2 = 0
                var n = size
                while (n > 1) {
                    log2++
                    n /= 2
                }
                log2
            }
        }
        
        // Pre-compute twiddle factors
        twiddleReal = FloatArray(halfSize)
        twiddleImag = FloatArray(halfSize)
        val angleIncrement = 2.0 * Math.PI / size
        for (k in 0 until halfSize) {
            val angle = -k * angleIncrement
            twiddleReal[k] = cos(angle).toFloat()
            twiddleImag[k] = sin(angle).toFloat()
        }
        
        // Pre-compute bit-reversal permutation
        bitReverse = IntArray(size)
        for (i in 0 until size) {
            bitReverse[i] = reverseBits(i, log2Size)
        }
    }
    
    /**
     * Compute FFT of real-valued input.
     * 
     * @param input Real-valued input samples. Must have length >= size.
     *              Only the first `size` samples are used.
     * @param outputMagnitude Pre-allocated array for magnitude output.
     *                        Must have length >= size/2 + 1.
     * @param outputPhase Pre-allocated array for phase output (in radians).
     *                    Must have length >= size/2 + 1.
     *                    Can be null if phase is not needed.
     */
    fun forward(
        input: FloatArray,
        outputMagnitude: FloatArray,
        outputPhase: FloatArray? = null,
    ) {
        require(input.size >= size) { "Input too small: ${input.size} < $size" }
        require(outputMagnitude.size >= halfSize + 1) { 
            "Magnitude output too small: ${outputMagnitude.size} < ${halfSize + 1}" 
        }
        if (outputPhase != null) {
            require(outputPhase.size >= halfSize + 1) { 
                "Phase output too small: ${outputPhase.size} < ${halfSize + 1}" 
            }
        }
        
        // Copy and bit-reverse the input
        for (i in 0 until size) {
            val rev = bitReverse[i]
            if (i < rev) {
                inputReal[i] = input[rev]
                inputImag[i] = 0f
            } else {
                inputReal[i] = input[i]
                inputImag[i] = 0f
            }
        }
        
        // Cooley-Tukey FFT
        var m = 2
        while (m <= size) {
            val m2 = m / 2
            val twiddleStep = size / m
            
            for (k in 0 until size step m) {
                for (j in 0 until m2) {
                    val twIdx = j * twiddleStep
                    val twReal = twiddleReal[twIdx]
                    val twImag = twiddleImag[twIdx]
                    
                    val i1 = k + j
                    val i2 = k + j + m2
                    
                    val aReal = inputReal[i1]
                    val aImag = inputImag[i1]
                    val bReal = inputReal[i2]
                    val bImag = inputImag[i2]
                    
                    // Butterfly operation
                    val tReal = twReal * bReal - twImag * bImag
                    val tImag = twReal * bImag + twImag * bReal
                    
                    inputReal[i2] = aReal - tReal
                    inputImag[i2] = aImag - tImag
                    inputReal[i1] = aReal + tReal
                    inputImag[i1] = aImag + tImag
                }
            }
            m *= 2
        }
        
        // Extract magnitude and phase from first half + DC + Nyquist
        // For real input, output is symmetric: bins [0, N/2] are unique
        for (k in 0..halfSize) {
            val real = inputReal[k]
            val imag = inputImag[k]
            outputMagnitude[k] = sqrt(real * real + imag * imag)
            if (outputPhase != null) {
                outputPhase[k] = atan2(imag.toDouble(), real.toDouble()).toFloat()
            }
        }
    }
    
    /**
     * Compute FFT and return only magnitude spectrum.
     * 
     * This is a convenience method that allocates output arrays internally.
     * For repeated calls, prefer the forward() method with pre-allocated buffers.
     */
    fun forwardMagnitude(input: FloatArray): FloatArray {
        val magnitude = FloatArray(halfSize + 1)
        forward(input, magnitude, null)
        return magnitude
    }
    
    /**
     * Get the frequency for a given bin index.
     * 
     * @param binIndex Index in the output spectrum (0 to size/2)
     * @param sampleRate Sample rate in Hz
     * @return Frequency in Hz
     */
    fun binToFrequency(binIndex: Int, sampleRate: Int): Float {
        require(binIndex >= 0 && binIndex <= halfSize) { 
            "Bin index out of range: $binIndex" 
        }
        return (binIndex.toFloat() * sampleRate) / size
    }
    
    /**
     * Get the bin index for a given frequency.
     * 
     * @param frequency Frequency in Hz
     * @param sampleRate Sample rate in Hz
     * @return Bin index (0 to size/2)
     */
    fun frequencyToBin(frequency: Float, sampleRate: Int): Int {
        val bin = (frequency * size) / sampleRate
        return bin.coerceIn(0f, halfSize.toFloat()).toInt()
    }
    
    /**
     * Reverse bits for bit-reversal permutation.
     */
    private fun reverseBits(index: Int, numBits: Int): Int {
        var reversed = 0
        var i = index
        for (bit in 0 until numBits) {
            reversed = (reversed shl 1) or (i and 1)
            i = i ushr 1
        }
        return reversed
    }
    
    companion object {
        /**
         * Create an FFT instance for a specific size.
         * 
         * @param size FFT size, must be a power of 2
         * @return FFT instance
         */
        fun create(size: Int): RealFFT {
            return RealFFT(size)
        }
        
        /**
         * Find the next power of 2 >= the given size.
         */
        fun nextPowerOf2(size: Int): Int {
            var n = 1
            while (n < size) {
                n *= 2
            }
            return n
        }
    }
}
