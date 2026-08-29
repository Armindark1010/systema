/**
 * SYSTEMA — semantic model runtime boundary (Phase 29).
 *
 * THE ONE PLACE THAT WOULD TALK TO NATIVE INFERENCE.
 *
 * WHY THIS FILE IS CURRENTLY EMPTY OF INFERENCE
 * ---------------------------------------------
 * The models cannot run yet, for reasons that are factual and
 * documented in docs/phase-29-semantic-model.md:
 *
 *   1. The weights are not on the device. They could not even be
 *      downloaded here — essentia.upf.edu returns HTTP 000 from this
 *      network, the same as huggingface.co.
 *   2. Three of the four heads are published only as TensorFlow frozen
 *      graphs and must be converted to ONNX off-device first.
 *   3. EffNet does not consume audio. It consumes [64, 128, 96] mel
 *      patches at 16 kHz, and that front-end does not exist natively
 *      yet. CLAP's mel front-end has different parameters and reusing
 *      it would produce confident nonsense.
 *
 * So `runEmbedding` reports PROVIDER_NOT_READY and nothing else.
 *
 * WHAT MUST NEVER BE ADDED HERE
 * -----------------------------
 * A `Math.random()` score. A zero vector standing in for a failed
 * inference. A hardcoded "example" prediction to make the UI look
 * populated. Any of those would flow into the dataset, get labelled by
 * a human, and be evaluated as if it were a real model output — which
 * is the one outcome that would make this entire phase worthless.
 *
 * A failure here is cheap and recoverable. A fabricated success is not.
 */

import type { SemanticAudioInput, SemanticFailureCode } from '../types'
import { EMBEDDING_MODEL } from './jamendoTaxonomy'

/** Raw output of one classifier head: a bare score array, in class order. */
export interface RawHeadOutput {
  head: string
  scores: number[]
}

export interface EmbeddingRunResult {
  /** 1280-d Discogs-EffNet embedding, mean-pooled over patches. */
  embedding: number[]
  sourceDurationSec: number | null
  processedDurationSec: number | null
  sampleRate: number
  decodeMs: number
  inferenceMs: number
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
    description: `Import ${EMBEDDING_MODEL.id}-${EMBEDDING_MODEL.version}.onnx `
      + '(published in ONNX; no conversion needed).',
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
      + 'producing [64, 128, 96] patches.',
    done: true,
  },
  {
    id: 'native-bridge',
    description: 'Expose the two-stage run (embedding then heads) through '
      + 'the existing InferenceRuntime and a Capacitor method.',
    done: false,
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
 * Would decode audio, build mel patches, and run the embedding model.
 *
 * Returns PROVIDER_NOT_READY until the requirements above are met.
 * There is no fallback path and there must never be one.
 */
export async function runEmbedding(
  _input: SemanticAudioInput,
): Promise<RuntimeOutcome<EmbeddingRunResult>> {
  if (!isRuntimeReady()) {
    return { ok: false, code: 'PROVIDER_NOT_READY', message: RUNTIME_NOT_READY_MESSAGE }
  }

  // Unreachable until the runtime lands. Deliberately a failure rather
  // than a stub value: an unimplemented path must not return data.
  return {
    ok: false,
    code: 'PROVIDER_NOT_READY',
    message: RUNTIME_NOT_READY_MESSAGE,
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
  // Nothing is ever loaded yet. Present so the provider's release()
  // contract is real rather than a comment promising a future call.
}
