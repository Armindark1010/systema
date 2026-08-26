// ============================================================
// SYSTEMA — Inference service (Phase 15)
// ============================================================
// The web layer's only entry point to native inference.
//
// Its job is to make failure LOUD. Every function here either returns
// a real native measurement or throws a typed error. There is no
// browser simulation, no cached last-good result, and above all no
// fallback from ONNX to the reference runtime: if the developer asked
// for ONNX and ONNX is unavailable, they are told so, because a
// silently-substituted runtime would make every number in the
// benchmark lab a lie (§13).
// ============================================================

import {
  InferenceNative,
  isInferenceAvailable,
  type InferenceCapabilities,
  type InferenceEnvironment,
  type InferenceErrorCode,
  type RealAudioResult,
  type TestModelResult,
} from './inferencePlugin'

/** Mirrors the Phase 13 error convention so the UI handles both alike. */
export class InferenceServiceError extends Error {
  constructor(
    public readonly code: InferenceErrorCode | 'PLUGIN_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'InferenceServiceError'
  }
}

/** Hard cap, duplicated from Kotlin so the UI can enforce it early. */
export const MAX_BENCHMARK_TRACKS = 20

function requirePlugin(): void {
  if (!isInferenceAvailable()) {
    throw new InferenceServiceError(
      'PLUGIN_UNAVAILABLE',
      'Native inference is not available. This runs on the Android build only — ' +
        'there is no browser implementation, and inventing one would produce ' +
        'measurements that mean nothing.',
    )
  }
}

/** Converts a Capacitor rejection into a typed error, preserving the code. */
function toServiceError(e: unknown): InferenceServiceError {
  const err = e as { code?: string, message?: string }
  const code = (err?.code ?? 'MODEL_INFERENCE_FAILED') as InferenceErrorCode
  return new InferenceServiceError(code, err?.message ?? 'Inference failed.')
}

export async function getCapabilities(): Promise<InferenceCapabilities> {
  requirePlugin()
  try {
    return await InferenceNative.getCapabilities()
  } catch (e) {
    throw toServiceError(e)
  }
}

export async function getEnvironment(): Promise<InferenceEnvironment> {
  requirePlugin()
  try {
    return await InferenceNative.getEnvironment()
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Runs the deterministic test model (§8).
 *
 * @param iterations repeated runs, to separate cold load from warm
 *   inference and to prove the runtime holds no state between calls
 */
export async function runTestModel(options: {
  runtimeId: string
  input?: number[]
  iterations?: number
}): Promise<TestModelResult> {
  requirePlugin()
  try {
    return await InferenceNative.runTestModel(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Benchmarks explicitly selected tracks.
 *
 * The cap is checked here as well as natively. Two independent gates,
 * because this is the one guarantee that stops a benchmark from
 * becoming a library-wide scan.
 */
export async function runRealAudio(options: {
  runtimeId: string
  modelId: string
  tracks: Array<{ trackId: string, uri: string }>
}): Promise<RealAudioResult> {
  requirePlugin()

  if (options.tracks.length === 0) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      'Select at least one track. The benchmark never chooses tracks for you.',
    )
  }
  if (options.tracks.length > MAX_BENCHMARK_TRACKS) {
    throw new InferenceServiceError(
      'INPUT_SHAPE_MISMATCH',
      `At most ${MAX_BENCHMARK_TRACKS} tracks can be benchmarked at once.`,
    )
  }

  try {
    return await InferenceNative.runRealAudio(options)
  } catch (e) {
    throw toServiceError(e)
  }
}

/**
 * Formats an environment for display next to a result.
 *
 * Screen state leads because it is the single largest confound
 * measured so far: on the Poco X7 Pro the same track took 2.32x
 * longer with the screen off.
 */
export function describeEnvironment(env: InferenceEnvironment): string {
  const parts = [
    env.screenOn ? 'screen ON' : 'screen OFF',
    env.chargingState ? 'charging' : 'on battery',
  ]
  if (env.batteryLevel !== null) parts.push(`${env.batteryLevel}%`)
  if (env.thermalStatus !== 'UNAVAILABLE') parts.push(`thermal ${env.thermalStatus}`)
  return parts.join(' · ')
}
