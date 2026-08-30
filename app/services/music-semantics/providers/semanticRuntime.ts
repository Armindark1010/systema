/**
 * SYSTEMA — semantic model runtime boundary (Phase 29.x).
 *
 * THE ONE PLACE THAT TALKS TO NATIVE INFERENCE.
 *
 * WHAT NOW WORKS
 * --------------
 * `runEmbedding` calls the real thing: InferenceNative.effnetEmbedTrack
 * -> InferencePlugin -> EffnetDiscogsSession -> PcmDecoder (16 kHz) ->
 * EffnetDiscogsMelFrontEnd -> ONNX Runtime -> a real 1280-d vector.
 * There is no simulation anywhere on that path.
 *
 * WHAT STILL DOES NOT
 * -------------------
 * `runHead`. The classifier heads (genre, mood/theme, tags,
 * voice/instrumental) are published only as TensorFlow frozen graphs
 * and none has been converted or imported. So the heads report
 * PROVIDER_NOT_READY, and the embedding stands alone.
 *
 * An embedding with no heads is genuinely useful — it powers
 * similarity — and it is honest. A label list is not something that
 * can be derived from it without the trained weights.
 *
 * WHAT MUST NEVER BE ADDED HERE
 * -----------------------------
 * A `Math.random()` score. A zero vector standing in for a failed
 * inference. A hardcoded "example" prediction to make the UI look
 * populated. A silent fall back to CLAP, whose vectors are 512-d and
 * from a different space entirely. Any of those would flow into the
 * dataset, get labelled by a human, and be evaluated as if it were a
 * real model output — which is the one outcome that would make this
 * entire phase worthless.
 *
 * A failure here is cheap and recoverable. A fabricated success is not.
 */

import { Capacitor } from '@capacitor/core'
import {
  type EffnetStatus,
  InferenceNative,
  isEffnetErrorCode,
} from '../../native/inferencePlugin'
import type { SemanticAudioInput, SemanticFailureCode } from '../types'
import { EMBEDDING_MODEL } from './jamendoTaxonomy'

/** Raw output of one classifier head: a bare score array, in class order. */
export interface RawHeadOutput {
  head: string
  scores: number[]
}

export interface EmbeddingRunResult {
  /** 1280-d Discogs-EffNet embedding, mean-pooled over real patches. */
  embedding: number[]
  /**
   * Identity of the model that ACTUALLY produced this vector, read
   * back from native rather than assumed here. Persisted alongside the
   * embedding so a stored vector can never be misattributed, and so a
   * model change invalidates the cache.
   */
  modelId: string
  modelVersion: string | null
  sourceDurationSec: number | null
  processedDurationSec: number | null
  sampleRate: number
  decodeMs: number
  preprocessMs: number
  inferenceMs: number
  totalMs: number
  patchesProcessed: number
  /** Always true for this model. */
  experimental: boolean
}

export type RuntimeOutcome<T> =
  | { ok: true, value: T }
  | { ok: false, code: SemanticFailureCode, message: string }

/**
 * Why the runtime is unavailable, in words a user can act on.
 *
 * Deliberately specific. "Analysis failed" would send someone hunting
 * for a bug that is not there; the real state is that a documented
 * setup step has not been done.
 */
export const RUNTIME_NOT_READY_MESSAGE
  = 'The music semantic model is not installed on this device. The mel '
    + 'front-end is implemented, but the Discogs-EffNet embedding model '
    + 'has to be side-loaded and the classifier heads converted to ONNX '
    + 'first. See docs/phase-29-semantic-model.md.'

/**
 * Everything that must be true before inference can be attempted.
 *
 * Exported so the UI and tests can state the remaining work precisely
 * instead of a vague "not implemented".
 */
export const RUNTIME_REQUIREMENTS: readonly {
  id: string
  description: string
  done: boolean
}[] = [
  {
    id: 'embedding-weights',
    description: `Import a Discogs-EffNet ONNX export (e.g. `
      + 'discogs-effnet-bsdynamic-1.onnx) through Model Import.',
    // Checked at RUNTIME, not here: whether the file is on THIS device
    // is a device fact, and a constant claiming it is present would be
    // a lie on every phone that has not imported it. isRuntimeReady()
    // treats this one as pending and effnetStatus() answers it.
    done: false,
  },
  {
    id: 'head-conversion',
    description: 'Convert the classifier heads from TensorFlow frozen '
      + 'graphs to ONNX with tf2onnx, off-device.',
    done: false,
  },
  {
    id: 'mel-frontend',
    // DONE. EffnetDiscogsMelFrontEnd.kt implements the MusiCNN front
    // end transcribed from Essentia's own source: 16 kHz, frame 512,
    // hop 256, 96 slaneyMel bands with unit_tri normalisation,
    // magnitude spectrum, log10(1 + 10000*m) compression, 128-frame
    // patches with hop 62, batch 64. It is NOT CLAP's front end, whose
    // parameters differ at every stage.
    description: 'Implement the 16 kHz / 96-mel / 128-frame front-end '
      + 'producing [batch, 128, 96] patches.',
    done: true,
  },
  {
    id: 'native-bridge',
    // DONE for the EMBEDDING stage: InferencePlugin.effnetEmbedTrack
    // -> EffnetDiscogsSession -> the shared InferenceRuntime -> ONNX.
    // The head stage is still absent, tracked by head-conversion.
    description: 'Expose the embedding run through the existing '
      + 'InferenceRuntime and a Capacitor method.',
    done: true,
  },
  {
    id: 'head-labels-top50tags',
    description: 'Retrieve the official 50 label strings for the tags '
      + 'head before enabling it. Scores without a verified label list '
      + 'cannot be interpreted.',
    done: false,
  },
] as const

/** True only when every requirement above is satisfied. */
export function isRuntimeReady(): boolean {
  return RUNTIME_REQUIREMENTS.every(r => r.done)
}

/** The requirements still outstanding, for display. */
export function outstandingRequirements(): string[] {
  return RUNTIME_REQUIREMENTS.filter(r => !r.done).map(r => r.description)
}

/**
 * Requirements that are decided by CODE rather than by the device.
 *
 * The embedding weights being present is a per-device fact, so it is
 * excluded here and answered by [embeddingReady] instead. Keeping the
 * two apart stops the UI from claiming "not implemented" when the real
 * state is "not imported on this phone" — different problem, different
 * fix.
 */
export function isRuntimeReadyForEmbedding(): boolean {
  return RUNTIME_REQUIREMENTS
    .filter(r => r.id !== 'embedding-weights')
    .filter(r => r.id !== 'head-conversion' && r.id !== 'head-labels-top50tags')
    .every(r => r.done)
}

/** Native status for the EffNet model, or null off-device. */
export async function embeddingStatus(): Promise<EffnetStatus | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await InferenceNative.effnetStatus()
  }
  catch {
    return null
  }
}

/**
 * Maps a native error code to this layer's vocabulary.
 *
 * The native codes are more specific than SemanticFailureCode, and the
 * message carries the detail, so nothing actionable is lost. What must
 * NOT happen is every failure arriving as a generic INFERENCE_FAILED:
 * "you have not imported the model" and "the model crashed" call for
 * completely different responses.
 */
function failureCodeFor(nativeCode: string | undefined): SemanticFailureCode {
  switch (nativeCode) {
    case 'MODEL_NOT_INSTALLED': return 'PROVIDER_NOT_READY'
    case 'MODEL_INCOMPATIBLE': return 'PROVIDER_NOT_READY'
    case 'PREPROCESSING_FAILED': return 'DECODE_FAILED'
    case 'INFERENCE_FAILED': return 'INFERENCE_FAILED'
    default: return 'INFERENCE_FAILED'
  }
}

/** Reads a Capacitor rejection's code without trusting its shape. */
function nativeCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function nativeMessageOf(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

/**
 * Checks a vector that crossed the native bridge before it is trusted.
 *
 * WHY THIS IS A SEPARATE, EXPORTED FUNCTION
 * -----------------------------------------
 * These four rules are the last thing standing between a corrupt
 * inference and a permanent row in the dataset, and they cannot be
 * exercised through runEmbedding off-device — there is no native
 * bridge in Node to return a bad vector. Inline, they were untestable,
 * and a mutation that disabled the all-zero guard went undetected.
 *
 * Pulled out, every rule is directly testable with a handcrafted
 * array, which is the only way to know the guards actually fire.
 */
export function validateEmbedding(
  embedding: unknown,
  declaredDimension: number,
): { ok: true } | { ok: false, code: SemanticFailureCode, message: string } {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return {
      ok: false,
      code: 'INVALID_OUTPUT',
      message: 'Native inference returned no embedding.',
    }
  }
  if (embedding.length !== declaredDimension) {
    return {
      ok: false,
      code: 'INVALID_OUTPUT',
      message: `Embedding length ${embedding.length} does not match the `
        + `reported dimension ${declaredDimension}.`,
    }
  }
  if (!embedding.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return {
      ok: false,
      code: 'INVALID_OUTPUT',
      message: 'The embedding contains non-finite values, so inference did '
        + 'not complete correctly.',
    }
  }
  // An all-zero vector is not a valid embedding; it is the signature of
  // a graph that ran on silence or on an uninitialised buffer. Cosine
  // similarity against it is 0/0, so it would poison every comparison.
  if (embedding.every(v => v === 0)) {
    return {
      ok: false,
      code: 'INVALID_OUTPUT',
      message: 'The embedding is all zeros, which indicates the model did '
        + 'not receive real audio.',
    }
  }
  return { ok: true }
}

/**
 * Decodes audio, builds mel patches, and runs the embedding model.
 *
 * REAL INFERENCE. Every number in the result comes from ONNX Runtime
 * executing the imported graph on this track's audio.
 *
 * There is no fallback path and there must never be one: on any
 * failure this returns a code, never a vector.
 */
export async function runEmbedding(
  input: SemanticAudioInput,
): Promise<RuntimeOutcome<EmbeddingRunResult>> {
  if (!Capacitor.isNativePlatform()) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Semantic inference runs natively on Android. There is no '
        + 'browser implementation, and a simulated one would produce '
        + 'numbers indistinguishable from real output.',
    }
  }

  if (!input.uri) {
    return {
      ok: false,
      code: 'NO_AUDIO_SOURCE',
      message: 'This track has no playable URI, so there is nothing to analyse.',
    }
  }

  if (!isRuntimeReadyForEmbedding()) {
    return { ok: false, code: 'PROVIDER_NOT_READY', message: RUNTIME_NOT_READY_MESSAGE }
  }

  try {
    const result = await InferenceNative.effnetEmbedTrack({
      trackId: input.trackId,
      uri: input.uri,
      includeVector: true,
    })

    // TRUST NOTHING ABOUT THE SHAPE.
    //
    // The vector crosses a JSON bridge. If it arrived empty, wrong-
    // length, or with a non-finite value, storing it would put a
    // corrupt row in the dataset that looks exactly like a valid one.
    // Better to fail here where the cause is still visible.
    const embedding = result.embedding
    const valid = validateEmbedding(embedding, result.embeddingDimension)
    if (!valid.ok) return { ok: false, code: valid.code, message: valid.message }

    return {
      ok: true,
      value: {
        embedding: embedding as number[],
        modelId: result.modelId,
        modelVersion: result.modelVersion ?? null,
        sourceDurationSec: result.sourceDurationSec ?? null,
        processedDurationSec: result.processedDurationSec ?? null,
        sampleRate: result.sampleRate,
        decodeMs: result.decodeMs,
        preprocessMs: result.preprocessMs,
        inferenceMs: result.inferenceMs,
        totalMs: result.totalMs,
        patchesProcessed: result.patchesProcessed,
        experimental: true,
      },
    }
  }
  catch (error) {
    const code = nativeCodeOf(error)
    return {
      ok: false,
      code: failureCodeFor(code),
      message: nativeMessageOf(error, 'Semantic inference failed.')
        + (isEffnetErrorCode(code) ? ` (${code})` : ''),
    }
  }
}

/**
 * Would run one classifier head over an embedding.
 *
 * Heads are cheap (a 1280 -> 512 -> N MLP); the expensive part is the
 * embedding, which is why the provider runs it once and fans out.
 */
export async function runHead(
  _head: string,
  _embedding: readonly number[],
): Promise<RuntimeOutcome<RawHeadOutput>> {
  if (!isRuntimeReady()) {
    return { ok: false, code: 'PROVIDER_NOT_READY', message: RUNTIME_NOT_READY_MESSAGE }
  }

  return {
    ok: false,
    code: 'PROVIDER_NOT_READY',
    message: RUNTIME_NOT_READY_MESSAGE,
  }
}

/** Releases native resources. Safe when nothing is loaded. */
export async function releaseRuntime(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await InferenceNative.effnetRelease()
  }
  catch {
    // Releasing is best-effort: the session may never have loaded, and
    // a failure to unload must not surface as an analysis error.
  }
}
