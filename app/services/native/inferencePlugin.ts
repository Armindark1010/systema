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
  /**
   * The model loads, but SYSTEMA does not know what it consumes.
   * Distinct from INPUT_SHAPE_MISMATCH: that means the input was
   * built wrongly, this means "correct" has not been defined yet.
   */
  | 'PREPROCESSING_UNAVAILABLE'

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
  /**
   * 'test' is the bundled deterministic model, 'sideloaded' arrived by
   * adb, 'imported' came through the in-app file picker. All three are
   * consumed by the same runtime; the distinction is provenance only.
   */
  kind: 'test' | 'sideloaded' | 'imported'
  installed: boolean
  inputFormat: string
  /**
   * Whether this model may be benchmarked against real audio.
   * UNKNOWN is the default for anything imported, and the audio path
   * refuses it until a contract is declared.
   */
  preprocessingStatus?: PreprocessingStatus
  sampleRate?: number | null
  embeddingDimension?: number | null
  contract?: ModelContract | null
}

/**
 * How much SYSTEMA knows about a model's preprocessing.
 *
 * There is deliberately no "PROBABLY". Either the contract is
 * established and a benchmark is meaningful, or it is not and the
 * benchmark must refuse.
 */
export type PreprocessingStatus = 'VERIFIED' | 'UNKNOWN' | 'BLOCKED'

/** Where a piece of contract information came from. */
export type ContractSource = 'GRAPH' | 'DEVELOPER_DECLARED'

/** One graph input or output, as the ONNX file declares it. */
export interface TensorSignature {
  name: string
  /** -1 marks a dynamic dimension, exactly as ONNX Runtime reports it. */
  shape: number[]
  type: string
  elementCount: number | null
}

/**
 * What SYSTEMA knows about an imported model.
 *
 * Split by provenance on purpose: shapes and types are read from the
 * graph and are facts, while sampleRate and inputFormat cannot be
 * read from an ONNX file and are null until a developer declares
 * them. `declaredBy` records which, so a report can never present an
 * assertion as a verified measurement.
 */
export interface ModelContract {
  modelId: string
  inputName: string | null
  inputShape: number[]
  inputType: string
  outputName: string | null
  outputShape: number[]
  /** Trailing output dimension from the graph; null when dynamic. */
  embeddingDimension: number | null
  /** Null until declared: not present in an ONNX graph. */
  sampleRate: number | null
  inputFormat: string | null
  preprocessingStatus: PreprocessingStatus
  declaredBy: ContractSource
}

/**
 * Outcome of one in-app model import.
 *
 * `cancelled` is a first-class, non-error outcome: dismissing the
 * system file picker is a normal thing to do and must not surface as
 * a failure.
 */
export interface ImportResult {
  imported: boolean
  cancelled: boolean
  ok?: boolean
  fileName?: string
  modelId?: string | null
  sizeBytes?: number
  /** VALID_ONNX_MODEL only when ONNX Runtime actually built a session. */
  validation?: 'VALID_ONNX_MODEL' | 'REJECTED'
  runtimeLabel?: string | null
  inputs?: TensorSignature[]
  outputs?: TensorSignature[]
  contract?: ModelContract | null
  loadMs?: number | null
  errorCode?: InferenceErrorCode | null
  message?: string
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
  /** Distribution of the warm runs. A mean alone hides the tail. */
  warmStats?: LatencyStats
  iterations: number
  input: number[]
  output: number[]
  outputShape: number[]
  /** True when repeated identical input produced identical output. */
  deterministic: boolean
  environment: InferenceEnvironment
}

/**
 * Spread of a set of latency samples.
 *
 * Reported instead of a bare mean because on a phone the mean is the
 * least informative number available: one thermal stall skews it, and
 * a lucky run flatters it. p95 is nearest-rank, so with few samples it
 * is coarse - `count` is included so nobody quotes a p95 taken from
 * five runs as if it were stable.
 */
export interface LatencyStats {
  count: number
  minMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  meanMs: number
}

/** One load -> infer -> unload cycle of the memory lifecycle test. */
export interface MemoryCycle {
  iteration: number
  /** -1 anywhere means UNKNOWN, never zero. */
  afterLoadKb: number
  afterInferenceKb: number
  afterUnloadKb: number
  loadMs: number
  inferenceMs: number
}

/**
 * Verdict on the post-unload memory series.
 *
 * There is deliberately no NO_LEAK value. A test can show memory
 * returning to baseline across the cycles it ran; it cannot prove the
 * absence of a leak. STABLE is the strongest honest claim.
 */
export type MemoryTrend = 'STABLE' | 'GROWING' | 'INCONCLUSIVE'

/** Result of the native memory lifecycle test (§8). */
export interface MemoryLifecycleReport {
  runtimeId: RuntimeId
  modelId: string
  modelSizeBytes: number
  iterations: number
  baseline: MemorySample
  cycles: MemoryCycle[]
  finalSample: MemorySample
  /** Highest observed PSS above baseline: the true resident cost. */
  peakDeltaKb: number
  /** Where PSS settled relative to baseline once everything unloaded. */
  netDeltaKb: number
  trend: MemoryTrend
  environment: InferenceEnvironment
  caveat: string
}

export interface MemorySample {
  /**
   * Total proportional set size. The headline figure, because ONNX
   * Runtime allocates natively - the Java heap would show almost
   * nothing while a large model was resident.
   */
  totalPssKb: number
  nativeHeapKb: number
  javaHeapKb: number
  javaUsedKb: number
  timestamp: number
}

/**
 * A candidate model's PUBLISHED specification.
 *
 * Not a measurement. Every value comes from the model's paper or
 * repository; the timing and memory fields are null because no
 * candidate has been executed on the device.
 */
export interface CandidateSpec {
  candidateId: string
  displayName: string
  architecture: string
  embeddingDimension: number | null
  license: string
  commercialUse: 'PERMITTED' | 'RESTRICTED' | 'UNKNOWN'
  inputSampleRate: number
  inputChannels: number
  inputRepresentation: string
  melBands: number | null
  status: 'RUNNABLE' | 'BLOCKED_LICENSE' | 'BLOCKED_PREPROCESSING' | 'BLOCKED_NO_ONNX'
  statusReason: string
  approximateSizeMb: number | null
  officialOnnxExport: 'AVAILABLE' | 'COMMUNITY_ONLY' | 'REQUIRES_CONVERSION' | 'UNKNOWN'
  coldLoadMs: number | null
  warmInferenceMs: number | null
  peakMemoryKb: number | null
  deviceVerified: boolean
}

export interface CandidateMatrix {
  candidates: CandidateSpec[]
  /** Always false until a candidate actually runs on hardware. */
  measured: boolean
  note: string
}

/**
 * What a tensor appears to be, judged from its resolved shape.
 *
 * These describe what the tensor LOOKS like; none asserts an
 * architecture. UNKNOWN is a first-class outcome, never a shrug that
 * defaults to "embedding".
 */
export type OutputRole =
  | 'CLASS_SCORES'
  | 'FRAME_EMBEDDINGS'
  | 'SINGLE_EMBEDDING'
  | 'LOG_MEL_SPECTROGRAM'
  | 'UNKNOWN'

export interface DescribedOutput {
  index: number
  name: string
  /** RESOLVED shape for this run, so dynamic dims are real numbers. */
  shape: number[]
  type: string
  elementCount: number | null
  role: OutputRole
  meaning: string
  /** True for the one output the runtime actually read. */
  selected: boolean
}

/**
 * The full output contract of one inference.
 *
 * Exists because "out dim 208921" was displayed with no way to tell
 * that it was a flattened class-score tensor rather than an
 * embedding. Every field here is derived from shapes the session
 * returned.
 */
export interface OutputContractReport {
  outputs: DescribedOutput[]
  selectedIndex: number
  selectedName: string | null
  selectedRole: OutputRole
  embeddingOutputIndex: number | null
  embeddingOutputName: string | null
  /** Resolved leading dimension of the framed output. */
  frameCount: number | null
  /** Width of ONE frame's embedding, not the flattened total. */
  embeddingDimension: number | null
  rawOutputElements: number
  currentOutputDimension: number
  /** True only when the selected output really is a single vector. */
  isSingleEmbeddingVector: boolean
  explanation: string
  /** True when frames must be pooled to get a track-level vector. */
  aggregationRequired: boolean
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
  /**
   * Flattened element count of the output that was READ.
   *
   * NOT an embedding dimension. For a framed model this scales with
   * track length: the YAMNet audit found it reporting 401 frames x
   * 521 AudioSet classes = 208921. Label it "raw output elements" in
   * any UI, and use `outputContract` to say what it means.
   */
  outputDimension?: number
  outputContract?: OutputContractReport
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
  /**
   * Repeated load -> infer -> unload cycles with memory sampled at
   * each boundary. Manual only: it is never triggered by startup,
   * navigation or any automatic path (§13).
   */
  runMemoryLifecycle(options: {
    runtimeId: RuntimeId
    modelId: string
    iterations?: number
    inferencesPerCycle?: number
  }): Promise<MemoryLifecycleReport>
  getCandidates(): Promise<CandidateMatrix>
  /**
   * Opens the Android system file picker for ONE .onnx file, copies
   * it into the existing private model directory, and validates it by
   * genuinely loading it through the existing ONNX runtime.
   *
   * Takes no arguments by design: there is no path parameter, no
   * directory, and no bulk mode. Only the single file the user taps
   * can be imported.
   */
  pickAndImportModel(): Promise<ImportResult>
  /** Records what an imported model consumes. Stamped as declared. */
  declareModelContract(options: {
    modelId: string
    sampleRate?: number
    inputFormat: string
  }): Promise<ModelContract>
  deleteImportedModel(options: { modelId: string }): Promise<{ deleted: boolean }>
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
