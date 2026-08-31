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
import type { PluginListenerHandle } from '@capacitor/core'

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
  /** SHA-256 of the promoted file (§1). Empty when the import failed. */
  sha256?: string
  /** Epoch millis the file was registered (§1). */
  importedAt?: number
  errorCode?: InferenceErrorCode | null
  message?: string
}

// -------------------------------------------------------------------
// CLAP subsystem (Phase 21)
// -------------------------------------------------------------------

/** Pre-flight memory admission decision (§4). */
export interface ClapMemoryGuard {
  allowed: boolean
  availableMb: number
  totalMb: number
  systemLowMemory: boolean
  estimatedRequiredMb: number
  javaHeapLimitMb: number
  javaHeapUsedMb: number
  reasonCode:
    | 'STARTED'
    | 'MEMORY_UNREADABLE'
    | 'SYSTEM_LOW_MEMORY'
    | 'BELOW_ABSOLUTE_FLOOR'
    | 'INSUFFICIENT_MEMORY'
  explanation: string
  headroomMb: number
  modelResidentFactor: number
  /** States plainly that the estimate is a heuristic, not a measurement. */
  caveat: string
}

export interface ClapModelMetadata {
  id: string
  name: string
  family: string
  architecture: string
  format: string
  sampleRate: number
  inputType: string
  /** -1 until a real forward pass proves it. Never assumed. */
  embeddingDimension: number
  sizeBytes: number
  sha256: string
  /** IMPORTED / VALIDATED / DEVICE_TESTED. Never PRODUCTION (§10). */
  status: string
  runtimeId: string
  supportsText: boolean
  notes: string
  inputNames: string[]
  outputNames: string[]
  /** How the input format was derived from the graph. */
  architectureNote?: string
}

/**
 * What the imported ONNX graph actually expects, derived from its own
 * signatures rather than assumed from the model's name (§1, §2).
 */
export interface ClapGraphContract {
  inputName: string
  inputShape: number[]
  inputType: string
  outputName: string
  outputShape: number[]
  /** WAVEFORM = the graph computes its own mel. LOG_MEL = we compute it. */
  inputKind: 'WAVEFORM' | 'LOG_MEL' | 'UNKNOWN'
  /** Samples per window for WAVEFORM models; -1 otherwise. */
  waveformSamples: number
  melBins: number
  melFrames: number
  embeddingDimension: number
  /** Plain-language explanation of how the format was determined. */
  rationale: string
  concreteInputShape?: number[]
}

export interface ClapValidationCheck {
  name: string
  passed: boolean
  detail: string
}

export interface ClapValidationReport {
  ok: boolean
  embeddingDimension: number
  failureCode: string
  failureMessage: string
  checks: ClapValidationCheck[]
}

export interface ClapStatus {
  loaded: boolean
  modelId: string
  validated: boolean
  multiTrackUnlocked: boolean
  lastSingleTrackId: string
  status: 'IDLE' | 'LOADED' | 'VALIDATED' | 'DEVICE_TESTED'
  /** Always false. Production selection is a separate human decision. */
  productionSelected: boolean
  productionNote: string
  metadata?: ClapModelMetadata
}

export interface ClapLoadResult {
  loadMs: number
  sizeBytes: number
  memoryGuard: ClapMemoryGuard
  metadata: ClapModelMetadata
  inputNames: string[]
  outputNames: string[]
  /** Present once the graph has been read. */
  graphContract?: ClapGraphContract
}

/** Result of the ONE-TRACK test (§5). */
export interface ClapSingleTrackResult {
  trackId: string
  /**
   * The embedding itself, present only when the caller passed
   * `includeVector` AND the output passed its validity checks
   * (Phase 22). Absent means "not requested or not valid" — never
   * treat a missing vector as a zero vector.
   */
  vector?: number[]
  dimension: number
  preNormL2: number
  l2NormAfterNormalisation: number
  outputFinite: boolean
  outputNormalised: boolean
  outputValid: boolean
  windowsProcessed: number
  /** Seconds of audio actually EMBEDDED (windows overlap 50%). */
  processedDurationSec: number
  /** The file's full duration, or -1 when the container omits it. */
  sourceDurationSec: number
  /** True when the whole track was streamed. */
  fullTrack: boolean
  /** What the caller asked for; -1 for full track. */
  requestedDurationSec: number
  windowLengthSec: number
  windowStrideSec: number
  /** Explains the relationship between window count and coverage. */
  coverageNote: string
  /** The rate the model actually saw, i.e. what we decoded to. */
  audioSampleRate: number
  /** The file's own rate, before the decoder resampled it. */
  sourceSampleRate: number
  audioSamples: number
  audioDurationSec: number
  decodeMs: number
  preprocessingMs: number
  inferenceMs: number
  totalProcessingMs: number
  memoryBeforeKb: number
  memoryPeakKb: number
  memoryAfterKb: number
  retainedKb: number
  nativeBeforeKb: number
  nativeAfterKb: number
  sessionReleased: boolean
  releaseError: string
  multiTrackUnlocked: boolean
  retentionCaveat: string
}

export interface ClapReleaseResult {
  released: boolean
  error: string
  memoryBeforeKb: number
  memoryAfterKb: number
  retainedKb: number
  nativeBeforeKb: number
  nativeAfterKb: number
}

export interface ClapMemoryCheck {
  sample: MemorySampleData
  guard: ClapMemoryGuard
  sessionLoaded: boolean
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

/**
 * How per-frame embeddings are collapsed into one track vector.
 *
 * MEAN is the default BASELINE. That is a starting point, not a
 * finding — no evaluation has compared these on real music.
 */
export type AggregationStrategy = 'MEAN' | 'MEAN_STD'

export type Normalisation = 'L2' | 'NONE'

/**
 * One track-level embedding.
 *
 * The provenance fields are load-bearing: two vectors can only be
 * compared if they share a strategy and a normalisation, and
 * `degenerate` marks the ones that must not be compared at all.
 */
export interface TrackEmbedding {
  /** Width of the vector. For MEAN_STD this is 2x the input width. */
  dimension: number
  inputFrameCount: number
  inputDimension: number
  strategy: AggregationStrategy
  normalisation: Normalisation
  /** L2 norm BEFORE normalising. Zero means a degenerate input. */
  preNormL2: number
  /**
   * True when the pooled vector had zero magnitude. Such a vector is
   * all zeros rather than NaN, and cosine against it is undefined —
   * not "zero similarity".
   */
  degenerate: boolean
  aggregationMs: number
  /** Self-check that the unit-length property actually holds. */
  unitLength: boolean
  /** First few components, for eyeballing. Not the full vector. */
  preview: string
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
  /**
   * Pooling + normalisation cost. NOT included in `totalMs`.
   *
   * Deliberately outside the total so figures from runs before
   * aggregation existed remain directly comparable.
   */
  aggregationMs?: number
  trackEmbedding?: TrackEmbedding
  /** Why no track embedding exists. Present only on failure. */
  aggregationError?: string
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
  /** Which pooling produced the track embeddings in this run. */
  aggregationStrategy?: AggregationStrategy
}

// ============================================================
// Phase 17 — Embedding Quality Lab
// ============================================================

/**
 * A number that native could not represent.
 *
 * Android's org.json cannot hold NaN or Infinity, so the bridge sends
 * JSON null for them (see EvaluationJson.kt putNumeric). `null` here
 * means "measured, and the answer is not a number" - an empty label
 * class, or a pair whose track failed to embed. It is NOT missing
 * data and it is NOT zero.
 *
 * Typed honestly so the compiler forces every read site to handle it;
 * an unhandled one used to reach `.toFixed()` and blank the page.
 */
export type MaybeNumber = number | null

/** Descriptive statistics over pairwise cosine similarities. */
export interface SimilarityStats {
  /** Number of DISTINCT pairs, i.e. N(N-1)/2. Excludes the diagonal. */
  pairCount: number
  mean: MaybeNumber
  median: MaybeNumber
  min: MaybeNumber
  max: MaybeNumber
  range: MaybeNumber
  stdDev: MaybeNumber
  p25: MaybeNumber
  p75: MaybeNumber
  /** Fixed 10 buckets spanning [-1, 1]. Never auto-scaled to the data. */
  histogram: number[]
  histogramBuckets: number
}

/** One track's evaluation result. */
export interface TrackEvaluation {
  index: number
  trackId: string
  ok: boolean
  /** Width of the track vector. 1024 for YAMNet under MEAN. */
  dimension?: number
  /** Measured L2 norm of the final vector. Should be ~1. */
  norm?: number
  /** Norm BEFORE normalising. Zero means a degenerate input. */
  preNormL2?: number
  /** N in the [N, D] frame-embedding tensor. */
  frameCount?: number
  /** D in the [N, D] frame-embedding tensor. */
  frameDimension?: number
  decodeMs?: number
  preprocessingMs?: number
  inferenceMs?: number
  tensorMs?: number
  aggregationMs?: number
  totalMs?: number
  audioDurationMs?: number
  rtf?: number
  sourceSampleRate?: number
  sourceChannels?: number
  outputContract?: OutputContractReport
  /**
   * Closest already-completed track. ABSENT for the first track:
   * with nothing to compare against there is no nearest neighbour,
   * and a placeholder score would be fabricated evidence.
   */
  nearestTrackId?: string
  nearestScore?: number
  farthestTrackId?: string
  farthestScore?: number
  /** False when this was the first embedding of the run. */
  hasComparison: boolean
  comparedAgainst: number
  errorCode?: string
  errorMessage?: string
  /** First few components. Not the full vector. */
  preview?: string
}

/** Live similarity matrix over the tracks completed so far. */
export interface SimilarityMatrix {
  trackIds: string[]
  rows: number[][]
  size: number
}

// ==================== PHASE 18: LABELLED EVALUATION ====================

/** Human judgement about a PAIR. Never derived from a measurement. */
export type PairLabel = 'SAME' | 'SIMILAR' | 'DIFFERENT'

/** Where a label came from. Shown next to every result. */
export type LabelSource = 'HUMAN' | 'FIXTURE'

/**
 * Per-pair reading aid — NOT a threshold verdict.
 *
 * CONSISTENT/INCONSISTENT are decided against the MEASURED median of
 * the DIFFERENT-labelled pairs in the same run, which moves as data
 * arrives. NOT_SCORED is the honest default before enough DIFFERENT
 * pairs exist.
 */
export type PairOutcome = 'CONSISTENT' | 'INCONSISTENT' | 'NOT_SCORED'

/** The phase's conclusion. No "good" and no "bad". */
export type SeparationVerdict =
  | 'CLEAR_SEPARATION'
  | 'PARTIAL_SEPARATION'
  | 'HEAVY_OVERLAP'
  | 'INSUFFICIENT_DATA'

/** Where retained memory appears to live. There is deliberately no LEAK. */
export type MemoryAttribution =
  | 'JAVA_HEAP'
  | 'NATIVE_HEAP'
  | 'NATIVE_RETAINED_AFTER_CLEANUP'
  | 'RELEASED'
  | 'UNKNOWN'

export type MemoryCheckpointName =
  | 'BEFORE_MODEL_LOAD'
  | 'AFTER_MODEL_LOAD'
  | 'AFTER_TRACK_1'
  | 'AFTER_TRACK_5'
  | 'AFTER_TRACK_10'
  | 'AFTER_ALL_TRACKS'
  | 'AFTER_SESSION_CLEANUP'
  | 'AFTER_IDLE'

export interface MemorySampleData {
  totalPssKb: number
  nativeHeapKb: number
  javaHeapKb: number
  javaUsedKb: number
  timestamp: number
}

export interface MemoryCheckpointSample {
  checkpoint: MemoryCheckpointName
  sample: MemorySampleData
  deltaTotalKb: number
  deltaNativeKb?: number
  deltaJavaKb?: number
  runningPeakKb: number
  elapsedMs: MaybeNumber
}

export interface MemoryLifecycleAuditReport {
  baselineKb: number
  peakKb: number
  finalKb: number
  peakDeltaKb: number
  netDeltaKb: number
  peakNativeShare?: MaybeNumber
  retainedNativeShare?: MaybeNumber
  attribution: MemoryAttribution
  rationale: string
  caveat: string
  checkpoints: MemoryCheckpointSample[]
}

export interface LabeledPairResult {
  position: number
  indexA: number
  indexB: number
  trackIdA: string
  trackIdB: string
  /** The human's judgement, fixed before the cosine existed. */
  label: PairLabel
  source: LabelSource
  /** null when the pair could not be scored (a track failed to embed). */
  cosine: MaybeNumber
  outcome: PairOutcome
  /** The measured value `outcome` was decided against; null when none existed yet. */
  referenceValue?: MaybeNumber
}

export interface ClassStats {
  label: PairLabel
  /** True when the class has too few pairs for its spread to mean anything. */
  insufficient: boolean
  stats: SimilarityStats
}

export interface ClassSeparation {
  higher: PairLabel
  lower: PairLabel
  countHigher: number
  countLower: number
  /** Rank-based (Mann-Whitney). 0.5 = no separation. null = unmeasured. */
  auc: MaybeNumber
  meanGap: MaybeNumber
  rangeOverlap: MaybeNumber
  overlappingPairs: number
  overlapFraction: MaybeNumber
  insufficient: boolean
}

export interface SeparationAnalysis {
  verdict: SeparationVerdict
  rationale: string
  comparisons: ClassSeparation[]
}

export interface TrackEmbeddingRow {
  index: number
  trackId: string
  ok: boolean
  dimension: number
  frameCount: number
  frameDimension: number
  l2Norm: MaybeNumber
  preNormL2: MaybeNumber
  decodeMs: MaybeNumber
  preprocessingMs: MaybeNumber
  inferenceMs: MaybeNumber
  tensorMs: MaybeNumber
  aggregationMs: MaybeNumber
  totalMs: MaybeNumber
  audioDurationSec: MaybeNumber
  rtf: MaybeNumber
  errorCode?: string
  errorMessage?: string
}

export interface LabeledEvalStartedEvent {
  totalTracks: number
  totalLabelledPairs: number
  modelId: string
  runtimeId: RuntimeId
  aggregationStrategy: AggregationStrategy
  coldLoadMs: number
}

export interface LabeledEvalTrackCompletedEvent {
  index: number
  position: number
  totalTracks: number
  elapsedMs: number
  row: TrackEmbeddingRow
  successCount: number
  failureCount: number
}

/** Emitted after EVERY pair, with live statistics recomputed each time. */
export interface LabeledEvalPairCompletedEvent {
  pair: LabeledPairResult
  position: number
  totalPairs: number
  scoredCount: number
  skipped: boolean
  elapsedMs: number
  classStats: ClassStats[]
  separation: SeparationAnalysis
}

export interface LabeledEvaluationReport {
  modelId: string
  runtimeId: RuntimeId
  aggregationStrategy: AggregationStrategy
  requestedTracks: number
  successCount: number
  failureCount: number
  labelledPairsRequested: number
  scoredPairCount: number
  cancelled: boolean
  embedStageMs: number
  pairStageMs: number
  totalElapsedMs: number
  medianDecodeMs: number
  medianPreprocessingMs: number
  medianInferenceMs: number
  medianTensorMs: number
  medianAggregationMs: number
  medianTotalMs: number
  medianRtf: number
  rows: TrackEmbeddingRow[]
  pairResults: LabeledPairResult[]
  classStats: ClassStats[]
  separation: SeparationAnalysis
  memory: MemoryLifecycleAuditReport
  overallStats?: SimilarityStats
  matrix: { trackIds: string[], pairs: Array<{ i: number, j: number, score: number }> }
  /** Always false. Stated, never estimated. */
  energyMeasured: boolean
  energyNote: string
  /** Present only when the run failed before producing a report. */
  failed?: boolean
  errorCode?: string
  errorMessage?: string
}

export interface QualityEvalStartedEvent {
  totalTracks: number
  modelId: string
  runtimeId: RuntimeId
  aggregationStrategy: AggregationStrategy
  coldLoadMs: number
  labelled: boolean
}

export interface QualityEvalTrackStartedEvent {
  index: number
  /** 1-based, for "[7/20]" style display. */
  position: number
  totalTracks: number
  trackId: string
  elapsedMs: number
}

export interface QualityEvalTrackCompletedEvent {
  index: number
  position: number
  totalTracks: number
  elapsedMs: number
  evaluation: TrackEvaluation
  completedCount: number
  successCount: number
  failureCount: number
  /** Recomputed after every track, never only at the end. */
  matrix: SimilarityMatrix
  stats?: SimilarityStats
  memoryPssKb: number
}

export interface EvaluationReport {
  modelId: string
  runtimeId: RuntimeId
  aggregationStrategy: AggregationStrategy
  requestedCount: number
  completedCount: number
  successCount: number
  failureCount: number
  remainingCount: number
  cancelled: boolean
  totalElapsedMs: number
  evaluations: TrackEvaluation[]
  trackIdsWithEmbeddings: string[]
  stats?: SimilarityStats
  /** Present only when the developer supplied labels for this run. */
  groupedStats?: Record<string, SimilarityStats>
  labelled: boolean
  medianDecodeMs?: number
  medianInferenceMs?: number
  medianAggregationMs?: number
  medianTotalMs?: number
  medianRtf?: number
  memoryBeforeKb: number
  memoryPeakKb: number
  memoryAfterKb: number
  memoryDeltaKb: number
  /**
   * Always false today. Android exposes no per-process energy
   * accounting trustworthy over a short foreground run, and an
   * estimate presented as a measurement would be worse than nothing.
   */
  energyMeasured: boolean
  energyNote: string
  environment: InferenceEnvironment
  /**
   * A constant: 'INSUFFICIENT EVIDENCE'. No threshold on cosine
   * statistics is defensible without labelled ground truth, so the
   * lab reports geometry and refuses to grade it.
   */
  qualityConclusion: string
  qualityNote: string
  /** Set when the run itself failed to start. */
  failed?: boolean
  errorCode?: string
  errorMessage?: string
}


/**
 * PHASE 29 — DISCOGS-EFFNET (EXPERIMENTAL SEMANTIC EMBEDDING)
 *
 * A SEPARATE surface from the clap* methods, not an extension of them.
 * The two models have different front ends, sample rates and output
 * widths; the only thing worse than neither working would be a CLAP
 * vector stored under an EffNet identity.
 */
export interface EffnetStatus {
  available: boolean
  runtime: string
  /** Whether an EffNet export is present in model storage. */
  installed: boolean
  /** Derived from the installed file name, never invented. */
  modelId: string | null
  modelFile: string | null
  modelVersion: string | null
  loaded: boolean
  embeddingDimension: number
  sampleRate: number
  melBands: number
  experimental: boolean
  /** This model emits a vector. */
  producesEmbedding: boolean
  producesLabels: boolean
  producesDiscogsStyles?: boolean
  styleClassCount?: number
  notice: string
  errorCode?: string
  detail?: string
}

export interface EffnetLoadResult {
  modelId: string
  modelVersion: string | null
  loadMs: number
  sizeBytes: number
  inputNames: string
  outputNames: string
  /** Dynamic, Fixed(n) or Unknown, read from the graph. */
  batchMode: string
  experimental: boolean
}

export interface EffnetEmbedResult {
  trackId: string
  modelId: string
  modelVersion: string | null
  embeddingDimension: number
  patchesProcessed: number
  patchesAvailable: number
  sampleRate: number
  sourceDurationSec: number
  processedDurationSec: number
  decodeMs: number
  preprocessMs: number
  inferenceMs: number
  totalMs: number
  experimental: boolean
  producesLabels: boolean
  frontEnd: string | null
  /** The real vector. Absent when includeVector was false. */
  embedding?: number[]
  /** Mean-pooled 400 Discogs style activations. Absent if the graph has no 400-wide output. */
  styleActivations?: number[]
  styleClassCount?: number
  styleAggregation?: 'mean'
  styleTaxonomy?: string
  styleFrameCount?: number
  styleOutputName?: string
}

/**
 * The four situations the web layer must tell apart.
 *
 * Each has a different remedy, which is the entire reason they are
 * separate: import the model, import a DIFFERENT model, fix the audio,
 * or report a runtime bug.
 */
export type EffnetErrorCode =
  | 'MODEL_NOT_INSTALLED'
  | 'MODEL_INCOMPATIBLE'
  | 'PREPROCESSING_FAILED'
  | 'INFERENCE_FAILED'

export const EFFNET_ERROR_CODES: readonly EffnetErrorCode[] = [
  'MODEL_NOT_INSTALLED',
  'MODEL_INCOMPATIBLE',
  'PREPROCESSING_FAILED',
  'INFERENCE_FAILED',
]

export function isEffnetErrorCode(value: unknown): value is EffnetErrorCode {
  return typeof value === 'string'
    && (EFFNET_ERROR_CODES as readonly string[]).includes(value)
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
    /** Defaults to MEAN. An unknown value is rejected, not defaulted. */
    aggregationStrategy?: AggregationStrategy
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

  // ---- CLAP subsystem (Phase 21) ----
  //
  // Every one of these is triggered by an explicit user action. None
  // is called on startup, on navigation, or after import.

  /** Reads lifecycle state. Never starts anything. */
  getClapStatus(): Promise<ClapStatus>
  /** Pre-flight memory check (§4). Safe before any model is loaded. */
  clapMemoryCheck(options: { modelId?: string }): Promise<ClapMemoryCheck>
  /** Creates the single session, after the memory guard permits it. */
  clapLoadModel(options: { modelId: string, runtimeId?: RuntimeId }): Promise<ClapLoadResult>
  /** Dry validation on a synthetic probe, before any real audio (§2). */
  clapValidateModel(): Promise<ClapValidationReport>
  /**
   * The FIRST SAFE TEST: exactly ONE manually chosen track (§5).
   * Takes a single trackId/uri, so it cannot be handed a list.
   */
  clapTestOneTrack(options: {
    trackId: string
    uri: string
    releaseAfter?: boolean
    /** Seconds to embed. 0 = the whole track, streamed. */
    durationSec?: number
    /**
     * Return the embedding itself (Phase 22). Defaults to false, so the
     * lab's existing payload is unchanged.
     */
    includeVector?: boolean
  }): Promise<ClapSingleTrackResult>
  /** Releases the session and reports retained memory. */
  clapRelease(): Promise<ClapReleaseResult>
  /** Phase 29: is an EffNet export installed and what can it do? */
  effnetStatus(): Promise<EffnetStatus>
  /** Loads the installed export. Rejects MODEL_NOT_INSTALLED if absent. */
  effnetLoadModel(): Promise<EffnetLoadResult>
  /** Embeds ONE named track. Never auto-selects. */
  effnetEmbedTrack(options: {
    trackId: string
    uri: string
    /** Seconds to analyse; 0 = whole track. Defaults to 120. */
    durationSec?: number
    includeVector?: boolean
  }): Promise<EffnetEmbedResult>
  /** Releases the EffNet session. Safe when nothing is loaded. */
  effnetRelease(): Promise<{ released: boolean }>
  /** Records what an imported model consumes. Stamped as declared. */
  declareModelContract(options: {
    modelId: string
    sampleRate?: number
    inputFormat: string
  }): Promise<ModelContract>
  deleteImportedModel(options: { modelId: string }): Promise<{ deleted: boolean }>
  getEnvironment(): Promise<InferenceEnvironment>

  /**
   * Starts an incremental embedding-quality evaluation (Phase 17).
   *
   * Resolves as soon as the run is ACCEPTED — every result arrives
   * as an event. A twenty-track run takes minutes, so holding the
   * promise open would leave the UI blank until the very end.
   */
  runQualityEvaluation(options: {
    runtimeId: RuntimeId
    modelId: string
    /**
     * Explicitly chosen tracks. `label` is optional and, when given,
     * is a claim the developer is making — it is never derived from
     * artist or genre metadata.
     */
    tracks: Array<{ trackId: string, uri: string, label?: string }>
    aggregationStrategy?: AggregationStrategy
  }): Promise<{ started: boolean, totalTracks: number, labelled: boolean }>

  /** Requests a stop. Completed results are kept, never discarded. */
  stopQualityEvaluation(): Promise<{ stopping: boolean, running: boolean }>

  getQualityEvaluationStatus(): Promise<{ running: boolean, maxTracks: number }>

  /**
   * Starts a labelled evaluation (Phase 18).
   *
   * Resolves as soon as the run is ACCEPTED. Tracks are embedded one
   * at a time, then every labelled pair is scored one at a time, each
   * emitting its own event.
   *
   * `pairLabels` is keyed "i:j" (i < j, indices into `tracks`). The
   * labels are human judgements supplied by the caller; nothing
   * native derives, alters or defaults them.
   */
  runLabeledEvaluation(options: {
    runtimeId: RuntimeId
    modelId: string
    tracks: Array<{ trackId: string, uri: string }>
    pairLabels: Record<string, { label: PairLabel, source?: LabelSource }>
    aggregationStrategy?: AggregationStrategy
  }): Promise<{ started: boolean, totalTracks: number, labelledPairs: number }>

  /** Requests a stop. Completed results are kept. */
  stopLabeledEvaluation(): Promise<{ stopping: boolean, running: boolean }>

  getLabeledEvaluationStatus(): Promise<{ running: boolean, maxTracks: number }>

  addListener(
    eventName: 'labeledEvalStarted',
    handler: (event: LabeledEvalStartedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'labeledEvalTrackCompleted',
    handler: (event: LabeledEvalTrackCompletedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'labeledEvalPairCompleted',
    handler: (event: LabeledEvalPairCompletedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'labeledEvalMemory',
    handler: (event: MemoryCheckpointSample) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'labeledEvalFinished',
    handler: (event: LabeledEvaluationReport) => void,
  ): Promise<PluginListenerHandle>

  addListener(
    eventName: 'qualityEvalStarted',
    handler: (event: QualityEvalStartedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'qualityEvalTrackStarted',
    handler: (event: QualityEvalTrackStartedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'qualityEvalTrackCompleted',
    handler: (event: QualityEvalTrackCompletedEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'qualityEvalFinished',
    handler: (event: EvaluationReport) => void,
  ): Promise<PluginListenerHandle>
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
