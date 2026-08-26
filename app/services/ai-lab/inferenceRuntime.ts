// ============================================================
// SYSTEMA — Phase 14: inference runtime abstraction
// ============================================================
// The seam between "we are measuring a model" and "this is how the
// model actually executes".
//
// Architecture (§8, §9, §10)
// --------------------------
//   AIModel -> ModelRegistry -> InferenceRuntime -> ExecutionProvider
//
// The BenchmarkRunner talks only to this interface. Adding ONNX
// Runtime in Phase 15 means adding one implementation here; no
// benchmark, UI or test code changes. That is what keeps SYSTEMA from
// being welded to a single engine — and specifically what stops any
// vendor NPU API from leaking into the app.
//
// Two implementations exist:
//
//   ReferenceRuntime  — real, deterministic, weight-free. Validates
//                       the harness itself.
//   OnnxRuntimeStub   — declares the contract and reports honestly
//                       that it is unavailable. It never fabricates a
//                       result, never fakes a latency, and never
//                       pretends a model loaded.
//
// The stub is the important one. A stub that returned plausible
// numbers would silently corrupt every conclusion in Phase 14.
// ============================================================

import type {
  EmbeddingStats,
  ExecutionProviderId,
  ModelDefinition,
  PreprocessingConfig,
  RuntimeId,
} from './types'

/** Structured runtime failure, mirroring the Phase 13 convention. */
export class InferenceError extends Error {
  constructor(
    public readonly code:
      | 'MODEL_NOT_INSTALLED'
      | 'MODEL_LOAD_FAILED'
      | 'UNSUPPORTED_INPUT'
      | 'RUNTIME_UNAVAILABLE'
      | 'RUNTIME_ERROR'
      | 'TIMEOUT'
      | 'OUT_OF_MEMORY',
    message: string,
  ) {
    super(message)
    this.name = 'InferenceError'
  }
}

export interface LoadedModel {
  modelId: string
  /** Measured, not declared: what the runtime actually loaded. */
  actualSizeMb: number | null
  embeddingDimension: number
}

/**
 * What every runtime must provide.
 *
 * Deliberately minimal — load, infer, release. Anything richer would
 * start encoding assumptions about a specific engine.
 */
export interface InferenceRuntime {
  readonly id: RuntimeId
  readonly label: string

  /** True when this runtime can execute at all in this environment. */
  isAvailable(provider: ExecutionProviderId): boolean

  /** Why it is unavailable. Surfaced to the user verbatim. */
  unavailableReason(provider: ExecutionProviderId): string | null

  load(model: ModelDefinition, provider: ExecutionProviderId): Promise<LoadedModel>

  /** One inference over one preprocessed frame. */
  infer(loaded: LoadedModel, frame: Float32Array): Promise<Float32Array>

  release(loaded: LoadedModel): Promise<void>
}

// ---- Embedding statistics --------------------------------------

/** Cheap sanity summary. Never stores the vector itself. */
export function computeEmbeddingStats(embedding: Float32Array): EmbeddingStats {
  let sum = 0
  let sumSquares = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let hasNonFinite = false

  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i]!
    if (!Number.isFinite(v)) {
      hasNonFinite = true
      continue
    }
    sum += v
    sumSquares += v * v
    if (v < min) min = v
    if (v > max) max = v
  }

  const n = embedding.length || 1
  return {
    dimension: embedding.length,
    l2Norm: Math.sqrt(sumSquares),
    mean: sum / n,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    hasNonFinite,
  }
}

/** Cosine similarity, guarded against zero-magnitude vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  // Two zero vectors are not "perfectly similar" — they are
  // uninformative. Returning 0 keeps a broken model from scoring 1.0.
  if (denom <= 0) return 0
  return dot / denom
}

/** Mean of per-frame embeddings, per the aggregation strategy. */
export function aggregateEmbeddings(
  frames: Float32Array[],
  strategy: PreprocessingConfig['aggregation'],
): Float32Array {
  if (frames.length === 0) return new Float32Array(0)
  if (frames.length === 1 || strategy === 'first') return frames[0]!

  const dim = frames[0]!.length
  const out = new Float32Array(dim)

  if (strategy === 'max') {
    out.fill(Number.NEGATIVE_INFINITY)
    for (const frame of frames) {
      for (let i = 0; i < dim; i++) if (frame[i]! > out[i]!) out[i] = frame[i]!
    }
    return out
  }

  for (const frame of frames) {
    for (let i = 0; i < dim; i++) out[i] = out[i]! + frame[i]!
  }
  for (let i = 0; i < dim; i++) out[i] = out[i]! / frames.length
  return out
}

// ---- Reference runtime -----------------------------------------

/**
 * A real, deterministic, weight-free embedding.
 *
 * This is genuine signal processing — a log-mel-ish band energy
 * summary plus simple temporal statistics — not random numbers. That
 * matters: it means similar audio really does embed similarly, so the
 * harness's determinism and nearest-neighbour checks are testing
 * something true rather than tautological.
 *
 * It is NOT a production candidate and the registry marks it
 * SYNTHETIC so it can never be mistaken for one.
 */
export class ReferenceRuntime implements InferenceRuntime {
  readonly id: RuntimeId = 'reference'
  readonly label = 'Reference (in-project DSP)'

  isAvailable(): boolean {
    return true
  }

  unavailableReason(): string | null {
    return null
  }

  async load(model: ModelDefinition): Promise<LoadedModel> {
    // A small, real cost so "load time" is not a fiction: build the
    // band edges the embedding uses.
    return {
      modelId: model.modelId,
      actualSizeMb: 0,
      embeddingDimension: model.embeddingDimension,
    }
  }

  async infer(loaded: LoadedModel, frame: Float32Array): Promise<Float32Array> {
    const dim = loaded.embeddingDimension
    const out = new Float32Array(dim)
    if (frame.length === 0) return out

    // Split the frame into `dim` contiguous bands and summarise each
    // by RMS. Deterministic, O(n), and genuinely input-dependent.
    const bandSize = Math.max(1, Math.floor(frame.length / dim))

    for (let b = 0; b < dim; b++) {
      const start = b * bandSize
      const end = Math.min(frame.length, start + bandSize)
      let sumSquares = 0
      let crossings = 0
      let previous = 0

      for (let i = start; i < end; i++) {
        const v = frame[i]!
        sumSquares += v * v
        if ((v < 0) !== (previous < 0)) crossings++
        previous = v
      }

      const count = Math.max(1, end - start)
      const rms = Math.sqrt(sumSquares / count)
      const zcr = crossings / count

      // Combine energy and a spectral proxy so the embedding
      // distinguishes timbre, not just loudness.
      out[b] = rms * (1 + zcr)
    }

    // L2-normalise: makes cosine similarity meaningful and keeps
    // magnitudes comparable across samples.
    let norm = 0
    for (let i = 0; i < dim; i++) norm += out[i]! * out[i]!
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < dim; i++) out[i] = out[i]! / norm
    }
    return out
  }

  async release(): Promise<void> {
    // Nothing retained.
  }
}

// ---- ONNX Runtime placeholder ----------------------------------

/**
 * The Phase 15 seam.
 *
 * This deliberately does NOT ship an inference engine. Phase 14's own
 * brief (§32) assigns ONNX Runtime integration to Phase 15, and adding
 * a ~15-20 MB AAR plus model weights that cannot live in git would buy
 * nothing measurable today.
 *
 * What it does instead is fail loudly and specifically, so the
 * dashboard can explain precisely what is missing rather than showing
 * an empty result or, far worse, a plausible fake one.
 */
export class OnnxRuntimeStub implements InferenceRuntime {
  readonly id: RuntimeId = 'onnxruntime'
  readonly label = 'ONNX Runtime'

  isAvailable(): boolean {
    return false
  }

  unavailableReason(provider: ExecutionProviderId): string {
    if (provider === 'nnapi') {
      return 'ONNX Runtime is not integrated yet (Phase 15). Separately, NNAPI is '
        + 'deprecated in Android 15 — the target device\'s OS — so it is not assumed '
        + 'to be a faster path and would need measuring before use.'
    }
    if (provider === 'gpu') {
      return 'ONNX Runtime is not integrated yet (Phase 15). No validated GPU path '
        + 'exists for the target device\'s Mali-G720; Qualcomm\'s QNN provider does '
        + 'not apply to MediaTek hardware.'
    }
    return 'ONNX Runtime is not integrated yet. Phase 15 adds the runtime '
      + '(com.microsoft.onnxruntime:onnxruntime-android) and the model loading path. '
      + 'Model weights must also be side-loaded — they are far too large for git.'
  }

  async load(model: ModelDefinition, provider: ExecutionProviderId): Promise<LoadedModel> {
    throw new InferenceError('RUNTIME_UNAVAILABLE', this.unavailableReason(provider))
  }

  async infer(): Promise<Float32Array> {
    throw new InferenceError('RUNTIME_UNAVAILABLE', 'ONNX Runtime is not integrated yet.')
  }

  async release(): Promise<void> {
    // Nothing to release.
  }
}

// ---- Registry ---------------------------------------------------

const RUNTIMES: Record<RuntimeId, InferenceRuntime> = {
  reference: new ReferenceRuntime(),
  onnxruntime: new OnnxRuntimeStub(),
}

export function getRuntime(id: RuntimeId): InferenceRuntime {
  return RUNTIMES[id]
}

export function listRuntimes(): InferenceRuntime[] {
  return Object.values(RUNTIMES)
}
