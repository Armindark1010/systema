package com.systema.music.analysis.dsp

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 *
 * Scope is deliberately narrow: real-valued input, power-of-two sizes,
 * magnitude spectrum out. That is all the analyser needs, and it keeps
 * this file small enough to verify by eye against a reference.
 *
 * Allocation policy
 * -----------------
 * Every buffer is allocated once, in the constructor, and reused for
 * the lifetime of the instance. A three-minute track at 22050 Hz with
 * hop 1024 is ~3900 windows; allocating per window would mean ~3900
 * short-lived float arrays and a GC pause in the middle of analysis.
 * [magnitudes] is exposed directly and is overwritten on every call —
 * callers consume it before the next [forward].
 *
 * Twiddle factors are precomputed once. They depend only on the
 * transform size, so recomputing sin/cos per window would be pure
 * waste.
 */
class Fft(val size: Int) {

    init {
        require(size > 0 && (size and (size - 1)) == 0) {
            "FFT size must be a power of two, was $size"
        }
    }

    private val real = FloatArray(size)
    private val imag = FloatArray(size)

    /**
     * Magnitude spectrum, valid up to and including Nyquist.
     * Length is size/2 + 1; bin i is centred at i * sampleRate / size.
     */
    val magnitudes = FloatArray(size / 2 + 1)

    private val cosTable = FloatArray(size / 2)
    private val sinTable = FloatArray(size / 2)
    private val bitReversal = IntArray(size)

    init {
        for (i in 0 until size / 2) {
            val angle = -2.0 * Math.PI * i / size
            cosTable[i] = Math.cos(angle).toFloat()
            sinTable[i] = Math.sin(angle).toFloat()
        }

        val bits = Integer.numberOfTrailingZeros(size)
        for (i in 0 until size) {
            bitReversal[i] = Integer.reverse(i) ushr (32 - bits)
        }
    }

    /**
     * Transforms [input] and fills [magnitudes].
     *
     * [input] must be at least [size] long and is not modified, so the
     * caller's windowed frame stays intact for time-domain features.
     */
    fun forward(input: FloatArray) {
        require(input.size >= size) { "input shorter than FFT size" }

        // Load in bit-reversed order so the butterflies below can run
        // in place without a separate permutation pass.
        for (i in 0 until size) {
            real[i] = input[bitReversal[i]]
            imag[i] = 0f
        }

        var half = 1
        while (half < size) {
            val step = size / (half * 2)
            var i = 0
            while (i < size) {
                var j = i
                var twiddle = 0
                while (j < i + half) {
                    val c = cosTable[twiddle]
                    val s = sinTable[twiddle]
                    val k = j + half

                    val tr = real[k] * c - imag[k] * s
                    val ti = real[k] * s + imag[k] * c

                    real[k] = real[j] - tr
                    imag[k] = imag[j] - ti
                    real[j] += tr
                    imag[j] += ti

                    j++
                    twiddle += step
                }
                i += half * 2
            }
            half *= 2
        }

        for (i in magnitudes.indices) {
            val re = real[i]
            val im = imag[i]
            magnitudes[i] = Math.sqrt((re * re + im * im).toDouble()).toFloat()
        }
    }
}
