/**
 * SYSTEMA — CLAP embedding provider (Phase 22).
 *
 * THE ONLY FILE IN THE PIPELINE THAT KNOWS CLAP EXISTS.
 *
 * Everything above it — the similarity engine, the pipeline, the store,
 * the evaluation code — depends on `AudioEmbeddingProvider` and not on
 * this file. Replacing the model means adding a sibling here and
 * pointing the registry at it. Nothing else moves.
 *
 * STATUS: EXPERIMENTAL, NOT SELECTED.
 * The 190-pair labelled benchmark gave AUC 0.7720, best F1 0.604 at
 * cosine 0.65, best accuracy 0.833 against a 0.763 majority baseline,
 * and 83.3% SIMILAR/DIFFERENT overlap. That is enough signal to keep
 * collecting data and nowhere near enough to commit to. This provider
 * reports `experimental: true` and nothing here selects a threshold.
 *
 * WHERE INFERENCE ACTUALLY RUNS
 * -----------------------------
 * Not here. Inference is native Android: `ClapSession` ->
 * `ClapAudioEmbeddingModel` -> `OnnxInferenceRuntime`, reached through
 * the existing Capacitor bridge. This file is a thin adapter that maps
 * the bridge's payload onto the model-agnostic contract. It deliberately
 * adds no inference logic of its own, because a second implementation
 * of the preprocessing contract is a second thing to get wrong.
 */

import {
  type ClapSingleTrackResult,
  type ClapStatus,
} from '../../native/inferencePlugin'
import {
  CLAP_DEFAULT_DURATION_SEC,
  getClapStatus,
  clapTestOneTrack,
} from '../../native/inferenceService'
import {
  type AudioEmbeddingProvider,
  type AudioInput,
  type EmbeddingResult,
  type ProviderStatus,
} from '../types'

/**
 * Reported when the loaded model exposes no version of its own.
 *
 * NOT a made-up version string. The real identity comes from the
 * loaded model's metadata (its registered id and content hash); this
 * constant only marks the case where the device has told us nothing,
 * so a reader can tell "unknown" from a genuine version.
 */
export const UNKNOWN_VERSION = 'unknown'

/** The provider's stable id. Matches the model family, not a file name. */
export const CLAP_PROVIDER_ID = 'clap'

export interface ClapProviderOptions {
  /**
   * Seconds of audio to embed per track. Defaults to the existing
   * bridge default rather than a new number invented here.
   */
  durationSec?: number
  /**
   * Release the native session after each embed. Defaults to FALSE for
   * the pipeline: a pair comparison needs two embeddings from the SAME
   * loaded model, and releasing between them would reload the graph and
   * make the two vectors incomparable in the worst possible way — they
   * would still produce a plausible-looking cosine.
   */
  releaseAfter?: boolean
}

/** Dependencies, injectable so the provider is testable without a device. */
export interface ClapProviderDeps {
  status: () => Promise<ClapStatus>
  embedTrack: (options: {
    trackId: string
    uri: string
    releaseAfter?: boolean
    durationSec?: number
    includeVector?: boolean
  }) => Promise<ClapSingleTrackResult>
}

const defaultDeps: ClapProviderDeps = {
  status: getClapStatus,
  embedTrack: clapTestOneTrack,
}

/**
 * Derives a version string from what the device actually reports.
 *
 * Uses the model's own identity — its registered id plus a short prefix
 * of the content hash the importer computed. Two different files can
 * never collide, and nothing is invented: if the device reports no
 * metadata, this returns UNKNOWN_VERSION rather than guessing.
 */
export function deriveVersion(status: ClapStatus | null): string {
  const meta = status?.metadata
  if (!meta) return UNKNOWN_VERSION
  const sha = typeof meta.sha256 === 'string' ? meta.sha256.trim() : ''
  const id = typeof meta.id === 'string' ? meta.id.trim() : ''
  if (sha.length >= 12) return `${id || CLAP_PROVIDER_ID}@${sha.slice(0, 12)}`
  if (id) return id
  return UNKNOWN_VERSION
}

export class ClapProvider implements AudioEmbeddingProvider {
  readonly id = CLAP_PROVIDER_ID

  /**
   * Cached from the last status() call. Starts as unknown rather than
   * as a plausible-looking default.
   */
  private cachedVersion = UNKNOWN_VERSION

  constructor(
    private readonly options: ClapProviderOptions = {},
    private readonly deps: ClapProviderDeps = defaultDeps,
  ) {}

  get version(): string {
    return this.cachedVersion
  }

  async status(): Promise<ProviderStatus> {
    try {
      const s = await this.deps.status()
      this.cachedVersion = deriveVersion(s)
      // "Loaded" is not "ready". An unvalidated graph must never see
      // real audio, and saying so plainly is the difference between a
      // clear error and a mysterious one.
      const ready = Boolean(s.loaded && s.validated)
      let reason: string | undefined
      if (!s.loaded) reason = 'No CLAP session is loaded. Load the model in the CLAP lab first.'
      else if (!s.validated) reason = 'The loaded graph has not passed validation yet.'

      return {
        id: this.id,
        version: this.cachedVersion,
        available: true,
        ready,
        reason,
        dimension: s.metadata?.embeddingDimension ?? -1,
        experimental: true,
      }
    } catch (e) {
      return {
        id: this.id,
        version: this.cachedVersion,
        available: false,
        ready: false,
        reason: (e as Error)?.message ?? 'The inference plugin is unavailable.',
        dimension: -1,
        experimental: true,
      }
    }
  }

  /**
   * Embeds one track.
   *
   * Never throws and never fabricates. Every failure path returns an
   * explained result, and no path substitutes a zero vector: a zero
   * vector has a defined cosine against everything, so it would enter
   * the dataset looking like a real measurement.
   */
  async embed(audio: AudioInput): Promise<EmbeddingResult> {
    if (!audio || !audio.trackId) {
      return {
        ok: false,
        code: 'MISSING_AUDIO',
        message: 'No track was supplied, or it had no id.',
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }
    if (!audio.uri || !audio.uri.trim()) {
      return {
        ok: false,
        code: 'NO_AUDIO_SOURCE',
        message: `Track "${audio.trackId}" has no playable URI. Mock catalogue `
          + 'entries have no audio, so there is nothing to embed.',
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }

    // Refuse early with a readable reason rather than letting the
    // bridge fail with a lower-level one.
    const st = await this.status()
    if (!st.available || !st.ready) {
      return {
        ok: false,
        code: st.available ? 'PROVIDER_NOT_READY' : 'PROVIDER_UNAVAILABLE',
        message: st.reason ?? 'The CLAP provider is not ready.',
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }

    let result: ClapSingleTrackResult
    try {
      result = await this.deps.embedTrack({
        trackId: audio.trackId,
        uri: audio.uri,
        // Keep the session for the next track in the pair.
        releaseAfter: this.options.releaseAfter ?? false,
        durationSec: this.options.durationSec ?? CLAP_DEFAULT_DURATION_SEC,
        includeVector: true,
      })
    } catch (e) {
      return {
        ok: false,
        code: 'INFERENCE_FAILED',
        message: (e as Error)?.message ?? 'CLAP inference failed.',
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }

    // The native side only attaches a vector when the output passed its
    // validity checks. A missing one is a failure, not an empty result.
    const raw = result.vector
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        ok: false,
        code: 'INVALID_EMBEDDING',
        message: `CLAP returned no usable embedding for "${audio.trackId}" `
          + `(outputValid=${String(result.outputValid)}, dimension=${result.dimension}). `
          + 'Refusing to substitute a zero vector.',
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }
    if (!raw.every(v => typeof v === 'number' && Number.isFinite(v))) {
      return {
        ok: false,
        code: 'INVALID_EMBEDDING',
        message: `CLAP returned a vector containing non-finite values for "${audio.trackId}".`,
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }
    if (result.dimension > 0 && raw.length !== result.dimension) {
      return {
        ok: false,
        code: 'INVALID_EMBEDDING',
        message: `CLAP reported dimension ${result.dimension} but returned `
          + `${raw.length} values for "${audio.trackId}".`,
        model: this.id,
        modelVersion: this.cachedVersion,
      }
    }

    return {
      ok: true,
      embedding: {
        model: this.id,
        modelVersion: this.cachedVersion,
        vector: Float32Array.from(raw),
        dimension: raw.length,
        // The native path L2-normalises and asserts the norm before
        // returning; `outputNormalised` is that check's own answer
        // rather than an assumption made here.
        normalised: Boolean(result.outputNormalised),
        inferenceMs: Number(result.inferenceMs) || 0,
        detail: {
          windowsProcessed: result.windowsProcessed,
          processedDurationSec: result.processedDurationSec,
          audioSampleRate: result.audioSampleRate,
          preNormL2: result.preNormL2,
          decodeMs: result.decodeMs,
        },
      },
    }
  }
}

/** Convenience factory. */
export function createClapProvider(
  options: ClapProviderOptions = {},
  deps?: ClapProviderDeps,
): ClapProvider {
  return new ClapProvider(options, deps)
}
