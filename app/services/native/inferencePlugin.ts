// ============================================================
// SYSTEMA — Inference plugin contract (Phase 15)
// ============================================================
// The typed surface of native model inference.
//
// WHAT IS DELIBERATELY ABSENT FROM THIS FILE
// ------------------------------------------
// The word "ONNX" appears here only as a runtime *id* string — a
// label the UI shows. There is no session type, no tensor type, no
// execution provider, no operator set, nothing importable from
// ai.onnxruntime. That is the §4 boundary: Kotlin owns ONNX Runtime,
// and the web layer is told only which runtimes exist and what they
// measured.
//
// If Phase 17 replaces ONNX Runtime with something else entirely,
// this file does not change. The runtime list simply reports
// different ids.
//
// NO FALLBACK, EVER (§13)
// -----------------------
// Every method here either returns a real measurement from a real
// model or rejects with a structured code. Nothing in this file
// invents an embedding, substitutes the reference runtime for a
// failed ONNX call, or returns a plausible-looking zero. A missing
// model is an error, not an empty result.
// ============================================================

import { registerPlugin, Capacitor } from '@capacitor/core'

/**
 * Structured failure codes, mirroring the Kotlin enum exactly.
 *
 * They are distinct because they need distinct responses: NOT_FOUND
 * means "side-load the file", LOAD_FAILED means "the file is corrupt
 * or unsupported", INFERENCE_FAILED means "it loaded but broke while
 * running". Collapsing them into one error would make every failure
 * look the same to whoever has to fix it.
 */
export type InferenceErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_LOAD_FAILED'
  | 'MODEL_INVALID'
  | 'MODEL_INFERENCE_FAILED'
  | 'MODEL_UNLOADED'
  | 'INPUT_SHAPE_MISMATCH'
  | 'RUNTIME_UNAVAILABLE'

/** Device conditions a measurement was taken under (Phase 14 §1). */
export interface InferenceEnvironment {
  deviceModel: string
  deviceManufacturer: string
  androidVersion: string
  apiLevel: number
  /**
   * Screen state during the run. Phase 14 measured a 2.32x slowdown
   * with the screen off on the same track, so runs taken in different
   * screen states must never be averaged together.
   */
  screenOn: boolean
  chargingState: boolean
  batteryLevel: number | null
  /** Coarse OS bucket, or UNAVAILABLE below API 29. Never a temperature. */
  thermalStatus: string
  timestamp: number
}

/**
 * Canonical runtime identifiers, mirroring Kotlin's `RuntimeIds`.
 *
 * These strings cross the Capacitor bridge, so the two languages must
 * agree exactly. `scripts/test-onnx-integration.ts` asserts that this
 * union and the Kotlin object list the same values.
 *
 * "onnxruntime" names the ENGINE. Note that 'onnx' is deliberately NOT
 * used here: it is already the `ModelFormat` token for the FILE format
 * (`app/services/ai-lab/types.ts`), and a runtime is not a format.
 */
export const RUNTIME_ONNX = 'onnxruntime'
export const RUNTIME_REFERENCE = 'reference'

export type RuntimeId = typeof RUNTIME_ONNX | typeof RUNTIME_REFERENCE

/** Every runtime the app knows about, for validation and tests. */
export const ALL_RUNTIME_IDS: readonly RuntimeId[] = [RUNTIME_ONNX, RUNTIME_REFERENCE]

export interface NativeRuntimeInfo {
  /** Canonical id — one of [ALL_RUNTIME_IDS]. */
  id: RuntimeId
  label: string
  /** Measured on this device, not assumed from the build config. */
  available: boolean
}

export interface NativeModelInfo {
  id: string
  name: string
  version: string
  sizeBytes: number
  /** 'test' is the bundled deterministic model; 'sideloaded' is a real .onnx. */
  kind: 'test' | 'sideloaded'
  installed: boolean
  inputFormat: string
}

export interface InferenceCapabilities {
  runtimes: NativeRuntimeInfo[]
  models: NativeModelInfo[]
  /** Native hard cap on a benchmark batch. */
  maxTracks: number
  /** Where to adb push a model on this device. */
  sideloadPath: string
  environment: InferenceEnvironment
}

/** Result of the deterministic integration test (§8). */
export interface TestModelResult {
  runtimeId: RuntimeId
  runtimeLabel: string
  modelId: string
  modelSizeBytes: number
  /** Cost of opening the session. Measured once, never per track (§12). */
  coldLoadMs: number
  /** Includes lazy native warm-up, so it is reported separately. */
  firstInferenceMs: number
  /** Mean of runs after the first. Null when only one run happened. */
  warmInferenceMs?: number
  iterations: number
  input: number[]
  output: number[]
  outputShape: number[]
  /** True when repeated identical input produced identical output. */
  deterministic: boolean
  environment: InferenceEnvironment
}

/** Per-track timings from a real-audio run (§11). */
export interface TrackMeasurement {
  trackId: string
  ok: boolean
  decodeMs?: number
  dspMs?: number
  preprocessingMs?: number
  /** The model itself: session run only, nothing else. */
  inferenceMs?: number
  /** Tensor marshalling, kept out of inferenceMs so it stays honest. */
  tensorMs?: number
  totalMs?: number
  audioDurationMs?: number
  rtf?: number
  outputDimension?: number
  /** First few output values, for sanity-checking. Not the embedding. */
  outputPreview?: number[]
  sourceSampleRate?: number
  sourceChannels?: number
  errorCode?: InferenceErrorCode | 'DECODE_FAILED'
  errorMessage?: string
}

export interface RealAudioResult {
  runtimeId: RuntimeId
  runtimeLabel: string
  modelId: string
  modelVersion: string
  modelSizeBytes: number
  /** Paid once for the whole batch, not per track. */
  coldLoadMs: number
  measurements: TrackMeasurement[]
  environment: InferenceEnvironment
}

export interface InferencePlugin {
  getCapabilities(): Promise<InferenceCapabilities>
  runTestModel(options: {
    runtimeId: RuntimeId
    input?: number[]
    iterations?: number
  }): Promise<TestModelResult>
  /**
   * Tracks are REQUIRED and explicit. There is no "all" option and no
   * default, by design: nothing in SYSTEMA may start a library-wide
   * inference run (§13).
   */
  runRealAudio(options: {
    runtimeId: RuntimeId
    modelId: string
    tracks: Array<{ trackId: string, uri: string }>
  }): Promise<RealAudioResult>
  getEnvironment(): Promise<InferenceEnvironment>
}

export const InferenceNative = registerPlugin<InferencePlugin>('Inference')

/** True only when the real native plugin is present. */
export function isInferenceAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Inference')
}

/**
 * The deterministic test model's contract, stated once.
 *
 * output = (input * 2 + 1)^2, so [1,2,3,4] -> [9,25,49,81].
 *
 * These constants are the assertion the whole ONNX integration is
 * checked against: the Python generator, the Kotlin test and the UI
 * all compare against the same four numbers. If real inference is not
 * happening, they cannot appear.
 */
export const TEST_MODEL_INPUT = [1, 2, 3, 4] as const
export const TEST_MODEL_EXPECTED_OUTPUT = [9, 25, 49, 81] as const
export const TEST_MODEL_ID = 'systema-test-model'

/** Applies the reference transform, for verifying arbitrary input. */
export function expectedTestOutput(input: readonly number[]): number[] {
  return input.map((x) => {
    const shifted = x * 2 + 1
    return shifted * shifted
  })
}

/**
 * Compares actual output to expectation within float tolerance.
 *
 * float32 arithmetic will not always be bit-exact against JavaScript's
 * float64, so an exact comparison would produce false failures. The
 * tolerance is tight enough that a genuinely wrong result still fails.
 */
export function matchesExpected(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-4,
): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((v, i) => Math.abs(v - (expected[i] as number)) <= tolerance)
}
