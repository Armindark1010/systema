package com.systema.music.analysis

import org.junit.Test

/**
 * Gradle entry point for the Phase 13 DSP suites.
 *
 * The suites themselves are plain Kotlin objects with `main` methods
 * (see DspTest, ResampleTest, PipelineIntegrationTest) so they can run
 * under a bare kotlinc + java toolchain — useful in a sandbox or any
 * environment without the Android SDK. This wrapper exposes exactly
 * the same checks to `./gradlew testDebugUnitTest`, so CI runs them
 * too and a DSP regression fails the Android build.
 *
 * Each suite throws AssertionError on failure, which JUnit reports.
 * They print their own per-assertion output to stdout.
 */
class AudioDspJUnitTest {

    @Test
    fun dspPrimitivesProduceCorrectValues() {
        DspTest.main(emptyArray())
    }

    @Test
    fun resamplingIsSeamlessAcrossBufferBoundaries() {
        ResampleTest.main(emptyArray())
    }

    @Test
    fun pcmToAnalysisResultPipelineWorks() {
        PipelineIntegrationTest.main(emptyArray())
    }

    /**
     * Degenerate input must never produce NaN, Infinity, or an
     * impossible value — silence, single samples, DC, empty spectra,
     * extreme amplitudes, invalid configuration.
     */
    @Test
    fun degenerateAudioNeverProducesNaNOrInfinity() {
        NumericalSafetyTest.main(emptyArray())
    }

    /**
     * The batch worker's decision table: one bad file must not abort
     * the queue, cancellation is a partial success rather than a
     * failure, and the counters add up.
     */
    @Test
    fun batchPolicyIsolatesFailuresAndHonoursCancellation() {
        BatchPolicyTest.main(emptyArray())
    }
}
