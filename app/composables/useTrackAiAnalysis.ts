/**
 * SYSTEMA — experimental AI analysis for the Full Player (Phase 22.1).
 *
 * The boundary between the player UI and the model-agnostic similarity
 * infrastructure. The Full Player talks to this; it never imports a
 * provider, a session, or anything that knows what CLAP is.
 *
 * State is keyed by trackId, mirroring `useAudioAnalysis`, so a result
 * can only ever be read back for the track it was produced for. That
 * is what makes "analyse A, skip to B" safe: B simply has no entry.
 */

import { reactive } from 'vue'

import {
  type TrackAnalysisFailure,
  type TrackAnalysisResult,
  analyseTrack,
} from '~/services/ai-similarity/analysis'
import { createPipeline, createProvider } from '~/services/ai-similarity/index'
import type { AudioInput } from '~/services/ai-similarity/types'

export type AiAnalysisState = 'idle' | 'analyzing' | 'done' | 'failed'

// Module-level, matching useAudioAnalysis: state survives closing and
// reopening the player, and every consumer sees the same maps.
const states = reactive(new Map<string, AiAnalysisState>())
const results = reactive(new Map<string, TrackAnalysisResult>())
const failures = reactive(new Map<string, TrackAnalysisFailure>())

/**
 * Tracks with a request in flight.
 *
 * The guard against double-submission. A plain boolean would be wrong:
 * two different tracks may legitimately be analysing at once, but the
 * SAME track must never be submitted twice.
 */
const inFlight = new Set<string>()

/** Resets everything. Test seam only. */
export function __resetAiAnalysis(): void {
  states.clear()
  results.clear()
  failures.clear()
  inFlight.clear()
}

export function useTrackAiAnalysis() {
  function stateFor(trackId: string | null | undefined): AiAnalysisState {
    if (!trackId) return 'idle'
    return states.get(trackId) ?? 'idle'
  }

  function resultFor(trackId: string | null | undefined): TrackAnalysisResult | null {
    if (!trackId) return null
    return results.get(trackId) ?? null
  }

  function failureFor(trackId: string | null | undefined): TrackAnalysisFailure | null {
    if (!trackId) return null
    return failures.get(trackId) ?? null
  }

  function isAnalyzing(trackId: string | null | undefined): boolean {
    return Boolean(trackId) && inFlight.has(trackId as string)
  }

  /**
   * Runs an experimental AI analysis for one track.
   *
   * @param track the track on screen, with its existing id and URI.
   *   No new audio-loading mechanism: the URI the player already has
   *   is what the provider receives.
   * @param reference optional second track. Supplying one produces a
   *   real cosine; omitting one produces an embedding only, and the
   *   result says so rather than inventing a score.
   */
  async function analyze(
    track: AudioInput | null | undefined,
    reference?: AudioInput | null,
  ): Promise<void> {
    if (!track?.trackId) return

    const id = track.trackId
    // One request per track at a time. Pressing the button again while
    // it runs is a no-op rather than a second inference.
    if (inFlight.has(id)) return

    const provider = createProvider()
    if (!provider) {
      states.set(id, 'failed')
      failures.set(id, {
        ok: false,
        trackId: id,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No embedding provider is configured on this build.',
        model: '',
        modelVersion: '',
        experimental: true,
        createdAt: new Date().toISOString(),
      })
      return
    }

    inFlight.add(id)
    states.set(id, 'analyzing')
    failures.delete(id)

    try {
      const outcome = await analyseTrack(provider, track, {
        reference: reference ?? null,
        pipeline: reference ? createPipeline() : null,
      })

      // Stored under the analysed track's own id. Even if the user has
      // since skipped to another song, this cannot surface there: the
      // player reads by the CURRENT track id, which has no entry.
      if (outcome.ok) {
        results.set(id, outcome)
        states.set(id, 'done')
      } else {
        failures.set(id, outcome)
        states.set(id, 'failed')
      }
    } catch (e) {
      // analyseTrack is contracted not to throw; this is belt and
      // braces so a bridge surprise cannot leave the button spinning.
      failures.set(id, {
        ok: false,
        trackId: id,
        code: 'INFERENCE_FAILED',
        message: (e as Error)?.message ?? 'The analysis failed unexpectedly.',
        model: provider.id,
        modelVersion: provider.version,
        experimental: true,
        createdAt: new Date().toISOString(),
      })
      states.set(id, 'failed')
    } finally {
      inFlight.delete(id)
    }
  }

  /** Clears one track's result, so it can be re-analysed. */
  function reset(trackId: string | null | undefined): void {
    if (!trackId) return
    states.delete(trackId)
    results.delete(trackId)
    failures.delete(trackId)
  }

  return { analyze, stateFor, resultFor, failureFor, isAnalyzing, reset }
}
