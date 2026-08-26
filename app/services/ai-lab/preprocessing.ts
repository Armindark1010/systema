// ============================================================
// SYSTEMA — Phase 14: deterministic benchmark preprocessing
// ============================================================
// Turns a benchmark sample into the fixed-size frames a model
// consumes, identically every time.
//
// Why determinism is the whole point (§6)
// ---------------------------------------
// If preprocessing varies between runs, every number downstream is
// noise: a model could look faster simply because it was handed less
// audio, or more consistent because it got the same window twice. So
// the synthetic generators here are seeded and reproducible, the
// framing is exact, and the configuration that was applied is recorded
// on every run for comparison.
//
// This module is intentionally free of Vue, Capacitor and Node APIs so
// it can run in the browser, on the device, and under a bare tsx test.
// ============================================================

import type { BenchmarkSample, PreprocessingConfig } from './types'

/**
 * A tiny deterministic PRNG (mulberry32).
 *
 * Math.random() would make every benchmark unreproducible, which
 * defeats §12. Seeded from the sample id so the same sample always
 * produces byte-identical audio.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of a string, so ids seed the PRNG. */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Synthesises deterministic audio with a requested character.
 *
 * These are NOT music and are not pretending to be. They are signals
 * with controlled, known properties — a tone complex, noise, a beat
 * pattern, silence — which is exactly what a harness self-test needs:
 * if two different signals produce identical embeddings, the model or
 * the pipeline is broken, and that is detectable without real music.
 */
export function synthesiseAudio(
  sample: BenchmarkSample,
  config: PreprocessingConfig,
): Float32Array {
  const total = Math.max(1, Math.round(config.sampleRate * sample.durationSec))
  const out = new Float32Array(total)
  const rand = seededRandom(hashString(sample.sampleId))
  const rate = config.sampleRate
  const tags = sample.characteristics

  const has = (t: string) => tags.includes(t)

  if (has('silence')) {
    return out // all zeros, deliberately
  }

  // Layered construction so different tags genuinely produce
  // different spectra rather than the same signal relabelled.
  const fundamental = has('bass-heavy') ? 55 : has('bright') ? 880 : 220
  const harmonics = has('dense') ? 8 : has('sparse') ? 2 : 4
  const noiseLevel = has('noisy') ? 0.35 : has('percussive') ? 0.2 : 0.02
  const bpm = has('energetic') ? 150 : has('calm') ? 70 : 110
  const samplesPerBeat = Math.max(1, Math.round((60 / bpm) * rate))

  for (let i = 0; i < total; i++) {
    const t = i / rate
    let value = 0

    for (let h = 1; h <= harmonics; h++) {
      // 1/h roll-off: a plausible harmonic series rather than a
      // flat, unnatural stack.
      value += Math.sin(2 * Math.PI * fundamental * h * t) / h
    }
    value /= harmonics

    if (noiseLevel > 0) value += (rand() * 2 - 1) * noiseLevel

    if (has('percussive') || has('energetic')) {
      // Exponentially decaying transient on each beat.
      const intoBeat = i % samplesPerBeat
      const decay = Math.exp(-intoBeat / (rate * 0.05))
      value += (rand() * 2 - 1) * decay * 0.6
    }

    if (has('quiet')) value *= 0.03

    out[i] = value
  }

  return normalise(out, config.normalization)
}

/** Applies the configured normalisation in place, returning the buffer. */
export function normalise(
  buffer: Float32Array,
  mode: PreprocessingConfig['normalization'],
): Float32Array {
  if (mode === 'none' || buffer.length === 0) return buffer

  if (mode === 'peak') {
    let peak = 0
    for (let i = 0; i < buffer.length; i++) {
      const v = Math.abs(buffer[i]!)
      if (v > peak) peak = v
    }
    // Guard: an all-zero buffer must stay all-zero, not become NaN.
    if (peak <= 0) return buffer
    const gain = 0.95 / peak
    for (let i = 0; i < buffer.length; i++) buffer[i] = buffer[i]! * gain
    return buffer
  }

  // RMS normalisation to a conventional -20 dBFS.
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!
  const rms = Math.sqrt(sum / buffer.length)
  if (rms <= 0) return buffer
  const gain = 0.1 / rms
  for (let i = 0; i < buffer.length; i++) buffer[i] = buffer[i]! * gain
  return buffer
}

/**
 * Splits audio into the fixed-size windows a model expects.
 *
 * A short final window is zero-padded rather than dropped, so a sample
 * shorter than one window still yields exactly one inference and the
 * sample count in a run is predictable.
 */
export function frameAudio(
  audio: Float32Array,
  config: PreprocessingConfig,
): Float32Array[] {
  const windowSize = Math.max(1, Math.round(config.windowSec * config.sampleRate))
  const overlapSize = Math.max(0, Math.round(config.overlapSec * config.sampleRate))
  const hop = Math.max(1, windowSize - overlapSize)

  const frames: Float32Array[] = []
  if (audio.length === 0) {
    frames.push(new Float32Array(windowSize))
    return frames
  }

  for (let start = 0; start < audio.length; start += hop) {
    const frame = new Float32Array(windowSize)
    const available = Math.min(windowSize, audio.length - start)
    frame.set(audio.subarray(start, start + available))
    frames.push(frame)
    // Stop once this window has consumed the tail.
    if (start + windowSize >= audio.length) break
  }
  return frames
}

/**
 * Reconciles a model's input contract with the benchmark's config.
 *
 * Returns the config actually applied plus a human-readable list of
 * differences. §6 forbids silently comparing models preprocessed
 * differently — this makes the difference explicit and storable.
 */
export function resolvePreprocessing(
  base: PreprocessingConfig,
  model: { inputSampleRate: number, inputChannels: number, inputDurationSec: number },
): { config: PreprocessingConfig, differences: string[] } {
  const differences: string[] = []

  if (model.inputSampleRate !== base.sampleRate) {
    differences.push(
      `sample rate ${base.sampleRate} Hz -> ${model.inputSampleRate} Hz (model requirement)`,
    )
  }
  if (model.inputDurationSec !== base.windowSec) {
    differences.push(
      `window ${base.windowSec}s -> ${model.inputDurationSec}s (model requirement)`,
    )
  }
  if (model.inputChannels !== base.channels) {
    differences.push(
      `channels ${base.channels} -> ${model.inputChannels} (model requirement)`,
    )
  }

  return {
    config: {
      ...base,
      sampleRate: model.inputSampleRate,
      channels: model.inputChannels,
      windowSec: model.inputDurationSec,
    },
    differences,
  }
}
