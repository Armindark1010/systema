// ============================================================
// useAudioAnalysis — the REAL on-device DSP, in the UI
// ============================================================
// This is the frontend surface of the Phase 13 native analyser. It is
// deliberately NOT `useTrackAnalysis`, which is the old mock companion
// state (mood / genres / themes) invented in the prototype era.
//
// Rules this module exists to enforce:
//
//   1. NOTHING HERE IS INVENTED. Every number rendered from this
//      composable came out of the Kotlin analyser. In the browser
//      there is no decoder, so the state is `unavailable` and the UI
//      says so instead of showing placeholder values.
//
//   2. ONE SHARED CACHE. The maps below are module-scoped, so the
//      player sheet and the AI panel observe the same analysis for the
//      same track. Analysing from one place updates the other.
//
//   3. COMPLETION IS REPORTED ONLY WHEN IT HAPPENED. The success toast
//      fires on a resolved native result and nowhere else — not on a
//      request being sent, not on the browser's null short-circuit.
//
// The analyser never touches Media3. Running an analysis while music
// is playing is safe by construction: it opens its own MediaExtractor
// on a background thread and shares nothing with the player.
// ============================================================

import {
  analyzeTrack as analyzeTrackNative,
  getAnalysis,
  getAnalysisStatus,
  getAnalysisSummary,
  toAnalysisError,
  type AudioAnalysisFailure,
} from '~/services/native/audioAnalysisService'
import { isAudioAnalysisAvailable } from '~/services/native/audioAnalysisPlugin'
import type { AudioAnalysis, AudioAnalysisSummary } from '~/services/native/audioAnalysisPlugin'

/**
 * Lifecycle of one track from the UI's point of view.
 *
 * `unavailable` is a first-class state rather than an error: on the
 * web build it is the correct, permanent answer.
 */
export type AudioAnalysisState =
  | 'unavailable'
  | 'unknown'
  | 'not-analyzed'
  | 'analyzing'
  | 'analyzed'
  | 'failed'

// ---- Shared state ---------------------------------------------
// Plain reactive Maps: a track id keys into each. Module scope is
// intentional — see rule 2 above.

const results = reactive(new Map<string, AudioAnalysis>())
const states = reactive(new Map<string, AudioAnalysisState>())
const failures = reactive(new Map<string, AudioAnalysisFailure>())
const summary = ref<AudioAnalysisSummary | null>(null)

/** Ids whose stored status has already been fetched, to avoid refetching. */
const hydrated = new Set<string>()

export function useAudioAnalysis() {
  const toast = useToast()

  /** True only when the Kotlin analyser is actually reachable. */
  const available = computed(() => isAudioAnalysisAvailable())

  function stateFor(trackId: string | null | undefined): AudioAnalysisState {
    if (!trackId) return 'unknown'
    if (!isAudioAnalysisAvailable()) return 'unavailable'
    return states.get(trackId) ?? 'unknown'
  }

  function resultFor(trackId: string | null | undefined): AudioAnalysis | null {
    if (!trackId) return null
    return results.get(trackId) ?? null
  }

  function failureFor(trackId: string | null | undefined): AudioAnalysisFailure | null {
    if (!trackId) return null
    return failures.get(trackId) ?? null
  }

  /**
   * Reads what the database already knows about a track.
   *
   * Called when a sheet opens or the current track changes, so the UI
   * can open straight into the result of a previous analysis instead
   * of pretending the track has never been seen.
   */
  async function hydrate(trackId: string | null | undefined, force = false) {
    if (!trackId || !isAudioAnalysisAvailable()) return
    if (!force && hydrated.has(trackId)) return
    hydrated.add(trackId)

    // Never clobber a run that is happening right now.
    if (states.get(trackId) === 'analyzing') return

    try {
      const stored = await getAnalysis(trackId)
      if (stored) {
        results.set(trackId, stored)
        failures.delete(trackId)
        states.set(trackId, 'analyzed')
        return
      }

      // No stored result: ask why. A FAILED row is meaningfully
      // different from a track nobody has analysed yet.
      const status = await getAnalysisStatus(trackId)
      if (status?.status === 'FAILED') {
        states.set(trackId, 'failed')
        if (status.errorCode) {
          failures.set(trackId, {
            code: status.errorCode,
            message: 'A previous analysis of this track failed.',
          })
        }
        return
      }

      states.set(trackId, 'not-analyzed')
    } catch (error) {
      // Reading state must never look like an analysis failure; the
      // track simply stays unknown and the user can still press
      // ANALYSE.
      states.set(trackId, 'not-analyzed')
      void error
    }
  }

  async function refreshSummary() {
    if (!isAudioAnalysisAvailable()) {
      summary.value = null
      return
    }
    try {
      summary.value = await getAnalysisSummary()
    } catch {
      summary.value = null
    }
  }

  /**
   * Runs a real analysis and reports the outcome honestly.
   *
   * @param force re-run even when a current-version result is stored.
   * @returns the analysis, or null when there is no native analyser.
   */
  async function analyze(
    trackId: string | null | undefined,
    options: { force?: boolean, title?: string } = {},
  ): Promise<AudioAnalysis | null> {
    if (!trackId) return null

    if (!isAudioAnalysisAvailable()) {
      toast.add({
        title: 'Analyser unavailable',
        description: 'On-device analysis needs the Android build — there is no decoder in a browser.',
        icon: 'lucide:info',
        color: 'neutral',
      })
      return null
    }

    // One run at a time per track.
    if (states.get(trackId) === 'analyzing') return null

    states.set(trackId, 'analyzing')
    failures.delete(trackId)

    try {
      const analysis = await analyzeTrackNative(trackId, { force: options.force ?? false })

      if (!analysis) {
        // Should be unreachable given the guard above; treated as
        // "no analyser" rather than as a completed analysis.
        states.set(trackId, 'unavailable')
        return null
      }

      results.set(trackId, analysis)
      hydrated.add(trackId)
      states.set(trackId, 'analyzed')

      // COMPLETION TOAST. This line is reached only when the native
      // analyser resolved with a real result.
      toast.add({
        title: 'Analysis complete',
        description: completionSummary(analysis, options.title),
        icon: 'lucide:activity',
        color: 'success',
      })

      // Counters moved; keep any open summary panel truthful.
      void refreshSummary()

      return analysis
    } catch (error) {
      const failure = toAnalysisError(error)
      failures.set(trackId, failure)
      states.set(trackId, 'failed')

      toast.add({
        title: 'Analysis failed',
        description: `${failure.code} — ${failure.message}`,
        icon: 'lucide:alert-circle',
        color: 'error',
      })

      void refreshSummary()
      return null
    }
  }

  return {
    available,
    summary: readonly(summary),
    stateFor,
    resultFor,
    failureFor,
    hydrate,
    analyze,
    refreshSummary,
  }
}

/**
 * One line describing what was measured, for the completion toast.
 *
 * Reports the tempo only when the analyser was confident enough to
 * give one — "undetermined" is a real outcome and is not dressed up as
 * a number.
 */
function completionSummary(analysis: AudioAnalysis, title?: string): string {
  const seconds = Math.max(0, Math.round(analysis.totalAnalysisTimeMs / 100) / 10)
  const tempo = analysis.bpm === null
    ? 'tempo undetermined'
    : `${analysis.bpm.toFixed(0)} BPM`
  const name = title ? `${title} — ` : ''
  return `${name}${tempo}, measured in ${seconds.toFixed(1)}s`
}
