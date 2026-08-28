/**
 * A LINE-FOR-LINE PORT of ClapMelFrontEnd.kt, used only to prove the
 * algorithm numerically against librosa in an environment with no JVM.
 *
 * This is NOT the shipped implementation and is never imported by the
 * app. It exists so the Kotlin front end's arithmetic can be checked
 * against the reference library CLAP actually uses, rather than being
 * asserted by eye in a code review.
 *
 * If this file and ClapMelFrontEnd.kt ever disagree, the Kotlin is
 * authoritative and this port is wrong — scripts/test-clap-infra.ts
 * pins the constants in both so they cannot drift apart silently.
 */

const MIN_LOG_HZ = 1000.0
const MIN_LOG_MEL = 15.0
const LOG_STEP = 0.06875177742094912

export function hzToMel(hz: number): number {
  const fSp = 200.0 / 3.0
  return hz < MIN_LOG_HZ ? hz / fSp : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP
}

export function melToHz(mel: number): number {
  const fSp = 200.0 / 3.0
  return mel < MIN_LOG_MEL ? mel * fSp : MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))
}

/** Mirrors analysis/dsp/Fft.kt: radix-2, magnitudes up to Nyquist. */
export class Fft {
  readonly magnitudes: Float32Array
  private real: Float32Array
  private imag: Float32Array
  private cosTable: Float32Array
  private sinTable: Float32Array
  private bitReversal: Int32Array

  constructor(readonly size: number) {
    if (size <= 0 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.real = new Float32Array(size)
    this.imag = new Float32Array(size)
    this.magnitudes = new Float32Array(size / 2 + 1)
    this.cosTable = new Float32Array(size / 2)
    this.sinTable = new Float32Array(size / 2)
    this.bitReversal = new Int32Array(size)
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2.0 * Math.PI * i) / size
      this.cosTable[i] = Math.fround(Math.cos(angle))
      this.sinTable[i] = Math.fround(Math.sin(angle))
    }
    const bits = 31 - Math.clz32(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.bitReversal[i] = r
    }
  }

  forward(input: Float32Array) {
    const { size, real, imag, cosTable, sinTable, bitReversal, magnitudes } = this
    for (let i = 0; i < size; i++) {
      real[i] = input[bitReversal[i]]!
      imag[i] = 0
    }
    let half = 1
    while (half < size) {
      const step = size / (half * 2)
      for (let i = 0; i < size; i += half * 2) {
        let k = 0
        for (let j = i; j < i + half; j++) {
          const c = cosTable[k]!, s = sinTable[k]!
          const jh = j + half
          const tr = real[jh]! * c - imag[jh]! * s
          const ti = real[jh]! * s + imag[jh]! * c
          real[jh] = real[j]! - tr
          imag[jh] = imag[j]! - ti
          real[j] = real[j]! + tr
          imag[j] = imag[j]! + ti
          k += step
        }
      }
      half *= 2
    }
    for (let i = 0; i < magnitudes.length; i++) {
      magnitudes[i] = Math.fround(Math.hypot(real[i]!, imag[i]!))
    }
  }
}

export interface MelConfig {
  sampleRate: number
  nFft: number
  hopSize: number
  melBins: number
  fMin: number
  fMax: number
}

export const CLAP_HTSAT_TINY: MelConfig = {
  sampleRate: 48000,
  nFft: 1024,
  hopSize: 480,
  melBins: 64,
  fMin: 50,
  fMax: 14000,
}

export const AMIN = 1e-10

export function buildSlaneyMelFilters(cfg: MelConfig): Float32Array[] {
  const spectrumBins = cfg.nFft / 2 + 1
  const melLo = hzToMel(cfg.fMin)
  const melHi = hzToMel(cfg.fMax)
  const hzPoints = new Float64Array(cfg.melBins + 2)
  for (let i = 0; i < cfg.melBins + 2; i++) {
    hzPoints[i] = melToHz(melLo + ((melHi - melLo) * i) / (cfg.melBins + 1))
  }
  const fftFreqs = new Float64Array(spectrumBins)
  for (let i = 0; i < spectrumBins; i++) fftFreqs[i] = (i * cfg.sampleRate) / cfg.nFft

  const filters: Float32Array[] = []
  for (let m = 0; m < cfg.melBins; m++) {
    const row = new Float32Array(spectrumBins)
    const lower = hzPoints[m]!, centre = hzPoints[m + 1]!, upper = hzPoints[m + 2]!
    const enorm = 2.0 / (upper - lower)
    for (let k = 0; k < spectrumBins; k++) {
      const f = fftFreqs[k]!
      let ramp = 0
      if (f >= lower && f <= upper) {
        ramp = f <= centre
          ? (centre > lower ? (f - lower) / (centre - lower) : 0)
          : (upper > centre ? (upper - f) / (upper - centre) : 0)
      }
      if (ramp > 0) row[k] = Math.fround(ramp * enorm)
    }
    filters.push(row)
  }
  return filters
}

function reflectSample(pcm: Float32Array, index: number): number {
  if (pcm.length === 0) return 0
  if (pcm.length === 1) return pcm[0]!
  const period = 2 * (pcm.length - 1)
  let i = index % period
  if (i < 0) i += period
  if (i >= pcm.length) i = period - i
  return pcm[i]!
}

export function logMel(pcm: Float32Array, cfg: MelConfig = CLAP_HTSAT_TINY): Float32Array[] {
  const fft = new Fft(cfg.nFft)
  const spectrumBins = cfg.nFft / 2 + 1
  const window = new Float32Array(cfg.nFft)
  for (let i = 0; i < cfg.nFft; i++) {
    window[i] = Math.fround(0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / cfg.nFft))
  }
  const filters = buildSlaneyMelFilters(cfg)
  const frames = Math.floor(pcm.length / cfg.hopSize) + 1
  const out: Float32Array[] = []
  for (let m = 0; m < cfg.melBins; m++) out.push(new Float32Array(frames))

  const frame = new Float32Array(cfg.nFft)
  const power = new Float32Array(spectrumBins)
  const half = cfg.nFft / 2

  for (let t = 0; t < frames; t++) {
    const start = t * cfg.hopSize - half
    for (let i = 0; i < cfg.nFft; i++) {
      frame[i] = Math.fround(reflectSample(pcm, start + i) * window[i]!)
    }
    fft.forward(frame)
    for (let k = 0; k < spectrumBins; k++) {
      const mag = fft.magnitudes[k]!
      power[k] = Math.fround(mag * mag)
    }
    for (let m = 0; m < cfg.melBins; m++) {
      const filt = filters[m]!
      let acc = 0
      for (let k = 0; k < spectrumBins; k++) {
        const w = filt[k]!
        if (w !== 0) acc = Math.fround(acc + w * power[k]!)
      }
      out[m]![t] = Math.fround(10.0 * Math.log10(Math.max(acc, AMIN)))
    }
  }
  return out
}
