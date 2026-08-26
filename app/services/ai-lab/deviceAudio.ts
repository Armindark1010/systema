// ============================================================
// SYSTEMA — Phase 14: real device audio for benchmarking
// ============================================================
// The bridge between "a track the user picked" and a measurement
// that is actually about that track.
//
// The bug this module exists to fix
// ---------------------------------
// The runner synthesised audio for EVERY sample, including
// `device-track` ones. So selecting real music produced real-looking
// numbers that had nothing to do with the selected music — the worst
// possible failure mode, because it is invisible. A benchmark that
// silently measures the wrong thing is more dangerous than one that
// refuses to run.
//
// What can honestly be measured on-device today
// ---------------------------------------------
// Phase 14 has no ONNX runtime and no model weights, so there is no
// neural inference to time. What DOES exist is the Phase 13 native
// pipeline, which really does decode real audio with MediaCodec and
// really does run DSP over it. That gives three honest measurements
// per track:
//
//   decodeTimeMs  — MediaCodec decode cost, real I/O and real codec
//   dspTimeMs     — the analysis itself
//   realTimeFactor— cost relative to the audio's duration
//
// Decode cost is the part that matters most for planning: ANY future
// on-device model must pay it before it can see a single sample. If
// decoding a 4-minute track already costs 800 ms, that is a floor no
// model can go below, and it is worth knowing before choosing one.
//
// What this module deliberately does NOT do
// -----------------------------------------
// It does not pretend the DSP timing is model inference. It does not
// fabricate an embedding for a real track. The runner labels these
// runs distinctly so nobody can confuse "we decoded your music" with
// "we ran a neural model on your music".
// ============================================================

import { analyzeTrack, toAnalysisError } from '~/services/native/audioAnalysisService'
import { isAudioAnalysisAvailable } from '~/services/native/audioAnalysisPlugin'
import type { AudioAnalysis } from '~/services/native/audioAnalysisPlugin'

/** One real-audio measurement, straight from the native pipeline. */
export interface DeviceAudioMeasurement {
  trackId: string
  /** MediaCodec decode cost. The floor under any future model. */
  decodeMs: number
  /** DSP cost over the decoded PCM. */
  dspMs: number
  totalMs: number
  /** Seconds of audio actually analysed (capped by the 5-minute window). */
  audioSec: number
  /** Source channel count, before the mono downmix. */
  channels: number
  /** Rate the DSP ran at, after downsampling. */
  sampleRate: number
  realTimeFactor: number | null
  /** Spectral character, useful for sanity-checking coverage. */
  spectralCentroid: number | null
  bpm: number | null
  loudnessDbfs: number | null
}

export class DeviceAudioError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DeviceAudioError'
  }
}

/** True when real audio can actually be decoded here. */
export function canMeasureRealAudio(): boolean {
  return isAudioAnalysisAvailable()
}

/**
 * Decodes and analyses one real track, returning genuine timings.
 *
 * `force` is deliberately true by default: a cached result would
 * return in microseconds and report a decode cost that never
 * happened, which is exactly the kind of fake number this phase
 * exists to avoid.
 */
export async function measureRealTrack(
  trackId: string,
  force = true,
): Promise<DeviceAudioMeasurement> {
  if (!canMeasureRealAudio()) {
    throw new DeviceAudioError(
      'NO_DECODER',
      'There is no audio decoder in the browser. Real-audio benchmarking '
      + 'requires the Android build.',
    )
  }

  let analysis: AudioAnalysis | null
  try {
    analysis = await analyzeTrack(trackId, { force })
  } catch (error) {
    const mapped = toAnalysisError(error)
    throw new DeviceAudioError(mapped.code ?? 'ANALYSIS_FAILED', mapped.message)
  }

  // The service returns null rather than throwing when there is no
  // native analyser. Treated as a hard error here: returning zeros
  // would be indistinguishable from an instantaneous decode.
  if (!analysis) {
    throw new DeviceAudioError(
      'NO_DECODER',
      'The native analyser returned nothing. Real-audio measurement is only '
      + 'possible on the Android build.',
    )
  }

  return {
    trackId,
    decodeMs: analysis.decodeTimeMs,
    dspMs: analysis.dspTimeMs,
    totalMs: analysis.totalAnalysisTimeMs,
    audioSec: analysis.durationMs / 1000,
    channels: analysis.channels,
    sampleRate: analysis.sampleRate,
    realTimeFactor: analysis.realTimeFactor,
    spectralCentroid: analysis.spectralCentroid,
    bpm: analysis.bpm,
    loudnessDbfs: analysis.loudnessDbfs,
  }
}
