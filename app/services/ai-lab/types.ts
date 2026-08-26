// ============================================================
// SYSTEMA — Phase 14: AI Model Lab type contracts
// ============================================================
// The vocabulary of the benchmarking laboratory.
//
// Phase 14 is RESEARCH, not production. Nothing here participates in
// the normal app: no semantic search, no recommendations, no library
// indexing. The single question this subsystem answers is "which
// candidate audio model, if any, is practical on the target device?"
//
// Design rule that shapes every type below
// ----------------------------------------
// A benchmark that cannot be reproduced is an anecdote. Every result
// therefore carries the full configuration that produced it — model
// version and checksum, runtime, execution provider, device, dataset,
// and the exact preprocessing. Two runs may only be compared directly
// when those match; when they do not, the comparison must say so
// rather than quietly presenting incomparable numbers side by side.
//
// Second rule: never invent a measurement. Every metric is tagged with
// how it was obtained (MEASURED / ESTIMATED / UNKNOWN / NOT_APPLICABLE)
// and every run records the evidence level of its environment
// (DESKTOP vs DEVICE). A desktop number must never be presentable as
// device performance.
// ============================================================

// ---- Evidence and provenance -----------------------------------

/**
 * How a number came to exist. Required on anything that could
 * otherwise be mistaken for a measurement.
 */
export type MetricConfidence = 'MEASURED' | 'ESTIMATED' | 'UNKNOWN' | 'NOT_APPLICABLE'

/**
 * Where a benchmark physically ran.
 *
 * SYNTHETIC is the harness self-test: a deterministic reference
 * "model" with no learned weights, used to prove the measurement
 * pipeline itself is correct. It is never a claim about a real model.
 */
export type BenchmarkEnvironment = 'SYNTHETIC' | 'DESKTOP' | 'DEVICE'

/** A number plus how much it can be trusted. */
export interface Metric {
  value: number | null
  confidence: MetricConfidence
  /** Why the value is absent or estimated. Shown in the UI verbatim. */
  note?: string
}

export function measured(value: number): Metric {
  return { value, confidence: 'MEASURED' }
}

export function unknown(note: string): Metric {
  return { value: null, confidence: 'UNKNOWN', note }
}

export function notApplicable(note: string): Metric {
  return { value: null, confidence: 'NOT_APPLICABLE', note }
}

// ---- Runtimes ---------------------------------------------------

/**
 * Inference runtime. Deliberately abstract: Phase 14 must not bind
 * SYSTEMA to one engine, and §9 forbids depending on vendor NPU APIs.
 */
export type RuntimeId = 'reference' | 'onnxruntime'

/**
 * Execution provider within a runtime.
 *
 * IMPORTANT (researched 2026-08): the target device (Poco X7 Pro) runs
 * a MediaTek Dimensity 8400 Ultra, so Qualcomm's QNN provider does not
 * apply to it at all. NNAPI is additionally deprecated as of Android
 * 15, which is the OS the device ships with. Both facts are recorded
 * here because they constrain what is even worth benchmarking.
 */
export type ExecutionProviderId = 'cpu' | 'nnapi' | 'gpu' | 'none'

export interface ExecutionProvider {
  id: ExecutionProviderId
  label: string
  /** False when the provider cannot be validated in this build. */
  available: boolean
  /** Why it is unavailable, or a caveat if it is. */
  note: string
}

// ---- Models -----------------------------------------------------

export type ModelFormat = 'onnx' | 'tflite' | 'none'
export type Quantization = 'fp32' | 'fp16' | 'int8' | 'none'

/** Whether the weights are actually present on this device. */
export type ModelAvailability =
  /** Weights present and loadable. */
  | 'AVAILABLE'
  /** Registered and described, but the file has not been side-loaded. */
  | 'NOT_INSTALLED'
  /** Has no weights by design (the reference harness model). */
  | 'SYNTHETIC'

/**
 * A candidate model, described independently of any runtime.
 *
 * Everything here is metadata the registry knows *before* the model is
 * ever loaded, which is what lets the dashboard list and compare
 * candidates on a device where none of the weights are installed.
 *
 * Sizes are the published/expected sizes and are labelled as such —
 * `sizeMb` is a claim from the model's source, not something SYSTEMA
 * measured. The measured on-disk size is recorded per benchmark run.
 */
export interface ModelDefinition {
  modelId: string
  modelName: string
  version: string
  /** Upstream project or paper, for traceability. */
  source: string
  sourceUrl: string
  license: string
  modelFormat: ModelFormat
  /** Published size in MB. Verified against the file at load time. */
  sizeMb: number
  sizeConfidence: MetricConfidence
  /** Expected SHA-256 of the weights, when known. */
  checksum: string | null
  inputSampleRate: number
  inputChannels: number
  /** Seconds of audio the model consumes per inference. */
  inputDurationSec: number
  embeddingDimension: number
  runtime: RuntimeId
  quantization: Quantization
  availability: ModelAvailability
  /** Honest, sourced summary of why this candidate is interesting. */
  rationale: string
  /** Known limitations. Never empty for a real candidate. */
  limitations: string[]
}

// ---- Preprocessing ----------------------------------------------

/**
 * Deterministic preprocessing configuration.
 *
 * §6 requires that models receive equivalent input and that any
 * difference is documented rather than silent. Each model declares
 * what it needs; the runner records exactly what was applied, so a
 * comparison can detect when two runs preprocessed differently.
 */
export interface PreprocessingConfig {
  sampleRate: number
  channels: number
  /** Seconds per inference window. */
  windowSec: number
  /** Seconds of overlap between consecutive windows. */
  overlapSec: number
  normalization: 'none' | 'peak' | 'rms'
  /** How per-window embeddings become one track embedding. */
  aggregation: 'mean' | 'max' | 'first'
}

/** Stable identity of a preprocessing config, for comparability. */
export function preprocessingKey(p: PreprocessingConfig): string {
  return [
    p.sampleRate, p.channels, p.windowSec, p.overlapSec,
    p.normalization, p.aggregation,
  ].join('/')
}

// ---- Dataset ----------------------------------------------------

export type SampleKind = 'synthetic' | 'device-track'

/**
 * One benchmark sample.
 *
 * A device-track sample stores only a track id and a short label —
 * never a filesystem path and never audio bytes (§11, §20, §24).
 */
export interface BenchmarkSample {
  sampleId: string
  label: string
  kind: SampleKind
  /** Musical/acoustic character, for coverage reporting. */
  characteristics: string[]
  durationSec: number
  /** Set only for device-track samples. */
  trackId?: string
}

export interface BenchmarkDataset {
  datasetId: string
  name: string
  description: string
  samples: BenchmarkSample[]
}

// ---- Results ----------------------------------------------------

export type SampleStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'UNSUPPORTED_INPUT'
  | 'RUNTIME_ERROR'
  | 'OUT_OF_MEMORY'

/** Per-sample outcome. Kept small: no embeddings, no audio. */
export interface SampleResult {
  sampleId: string
  status: SampleStatus
  inferenceMs: number | null
  /** Audio seconds processed, for the real-time factor. */
  audioSec: number
  errorCode?: string
  errorMessage?: string
  /** Summary statistics of the embedding, never the embedding itself. */
  embeddingStats?: EmbeddingStats
}

/**
 * Cheap sanity statistics over one embedding.
 *
 * Storing the full vector for every sample would bloat the store for
 * no benefit at this stage; these catch the failure modes that matter
 * (all-zero output, NaN, exploding magnitude).
 */
export interface EmbeddingStats {
  dimension: number
  l2Norm: number
  mean: number
  min: number
  max: number
  /** True when any component is NaN or Infinity — a hard failure. */
  hasNonFinite: boolean
}

/** Overall verdict for a run. PARTIAL_SUCCESS is a first-class result. */
export type RunStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'

export interface DeviceInfo {
  label: string
  platform: 'android' | 'web'
  cpuArchitecture: string
  osVersion: string
  totalRamMb: Metric
  isTargetDevice: boolean
}

export interface MemoryMetrics {
  baselineMb: Metric
  peakMb: Metric
  deltaMb: Metric
}

export interface PerformanceMetrics {
  modelLoadMs: Metric
  warmupMs: Metric
  averageInferenceMs: Metric
  medianInferenceMs: Metric
  p95InferenceMs: Metric
  /** Inferences per second, derived from the median. */
  throughputPerSec: Metric
  totalAudioSec: number
  /** Processing time / audio duration. < 1 is faster than real time. */
  realTimeFactor: Metric
}

export interface ReliabilityMetrics {
  successfulSamples: number
  failedSamples: number
  errorCount: number
  timeoutCount: number
  /** 0..1. */
  successRate: number
}

/**
 * Embedding quality signals.
 *
 * Deliberately NOT called "accuracy": there is no ground-truth
 * dataset here, and §7 forbids inventing one. These are consistency
 * and sanity checks, which is all that is honestly measurable.
 */
export interface QualityMetrics {
  /** Cosine similarity of two runs over identical input. 1.0 = stable. */
  determinism: Metric
  /** Mean pairwise cosine similarity across different samples. */
  meanPairwiseSimilarity: Metric
  /**
   * Whether near-identical inputs embed closer than unrelated ones.
   * Null when the dataset has no suitable pair.
   */
  nearestNeighbourSane: boolean | null
  notes: string[]
}

/**
 * Everything needed to reproduce a run (§12).
 *
 * Two runs are directly comparable only when their reproducibility
 * keys agree on dataset, preprocessing and provider.
 */
export interface ReproducibilityInfo {
  modelId: string
  modelVersion: string
  modelChecksum: string | null
  runtime: RuntimeId
  executionProvider: ExecutionProviderId
  datasetId: string
  preprocessing: PreprocessingConfig
  appVersion: string
  harnessVersion: number
  warmupRuns: number
  measuredRuns: number
}

export interface BenchmarkRun {
  id: string
  timestamp: number
  environment: BenchmarkEnvironment
  status: RunStatus
  modelId: string
  modelName: string
  modelVersion: string
  device: DeviceInfo
  runtime: RuntimeId
  executionProvider: ExecutionProviderId
  datasetId: string
  sampleCount: number
  performance: PerformanceMetrics
  memory: MemoryMetrics
  cpuUsage: Metric
  reliability: ReliabilityMetrics
  quality: QualityMetrics
  samples: SampleResult[]
  reproducibility: ReproducibilityInfo
  /** Free-text caveats surfaced prominently in the UI. */
  warnings: string[]
}

// ---- Targets ----------------------------------------------------

/**
 * Reference targets for discussion (§29).
 *
 * Explicitly NOT hard requirements — they are configurable and exist
 * so the dashboard can say "meets / misses" rather than leaving the
 * reader to eyeball raw numbers. The defaults are conservative
 * starting points for a mid-range phone, not measured thresholds.
 */
export interface BenchmarkTargets {
  maxMedianInferenceMs: number
  maxPeakMemoryMb: number
  maxModelSizeMb: number
  maxRealTimeFactor: number
  minSuccessRate: number
}

export const DEFAULT_TARGETS: BenchmarkTargets = {
  maxMedianInferenceMs: 500,
  maxPeakMemoryMb: 350,
  maxModelSizeMb: 200,
  maxRealTimeFactor: 0.5,
  minSuccessRate: 0.95,
}

export type TargetVerdict = 'MEETS' | 'MISSES' | 'UNKNOWN'

export interface TargetEvaluation {
  metric: string
  target: string
  actual: string
  verdict: TargetVerdict
}

/** Bumped whenever a change would alter measured numbers. */
export const HARNESS_VERSION = 1
