/**
 * SYSTEMA — single-track AI analysis for the Full Player (Phase 24).
 *
 * The boundary between the player UI and the analysis infrastructure.
 * The Full Player talks to this; it never imports a provider, a
 * session, or anything that knows what CLAP is.
 *
 * State is keyed by trackId, mirroring `useAudioAnalysis`, so a result
 * can only ever be read back for the track it was produced for. That
 * is what makes "analyse A, skip to B" safe: B simply has no entry.
 *
 * Analysis is SINGLE-TRACK. No reference track, no cosine. Similarity
 * consumes these embeddings later; it is not needed to produce one.
 */

import { reactive } from 'vue'

import { createProvider } from '~/services/ai-similarity/index'
import { createMusicSemanticProvider } from '~/services/music-semantics'
import {
  cachedSemanticFor,
  cachedSemanticForTrack,
  persistSemanticToDataset,
  toStoredSemantic,
} from '~/services/ai-dataset/semanticBridge'
import { isSameSemanticBuild, type SemanticAnalysis } from '~/services/ai-dataset/semanticRecord'
import type {
  TrackAnalysisFailureRecord,
  TrackAnalysisRecord,
} from '~/services/ai-similarity/trackAnalysis'
import { analyseSingleTrack } from '~/services/ai-similarity/trackAnalysisService'
import { ANALYZER_VERSION, persistAnalysisToDataset } from '~/services/ai-dataset/datasetBridge'
import { loadAnalysis } from '~/services/ai-similarity/trackAnalysisStore'
import type { AudioInput } from '~/services/ai-similarity/types'
import { getAnalysis } from '~/services/native/audioAnalysisService'

export type AiAnalysisState = 'idle' | 'analyzing' | 'done' | 'failed'

// Module-level, matching useAudioAnalysis: state survives closing and
// reopening the player, and every consumer sees the same maps.
const states = reactive(new Map<string, AiAnalysisState>())
const results = reactive(new Map<string, TrackAnalysisRecord>())
const failures = reactive(new Map<string, TrackAnalysisFailureRecord>())
/** Non-fatal save problems, e.g. storage full. */
const saveWarnings = reactive(new Map<string, string>())
/** Tracks whose displayed result came from storage rather than a run. */
const cacheHits = reactive(new Set<string>())

/** Phase 29 semantic predictions, keyed by track id. */
const semantics = reactive(new Map<string, SemanticAnalysis>())
/** Why semantic analysis is unavailable for a track. Shown, not hidden. */
const semanticNotes = reactive(new Map<string, string>())
/** True when the semantic result came from the database, not a fresh run. */
const semanticCacheHits = reactive(new Set<string>())

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
  semantics.clear()
  semanticNotes.clear()
  semanticCacheHits.clear()
  states.clear()
  results.clear()
  failures.clear()
  saveWarnings.clear()
  cacheHits.clear()
  inFlight.clear()
}

/**
 * Reads stored Phase 13 DSP features for a track.
 *
 * READ-ONLY. This never starts a DSP run: the DSP analyser is the
 * user's to trigger, and silently analysing in the background is
 * exactly the behaviour the project forbids. When nothing is stored
 * the analysis simply has no DSP section.
 */
async function readStoredDsp(trackId: string) {
  // getAnalysis already returns null when the plugin is unavailable.
  try {
    const a = await getAnalysis(trackId)
    if (!a) return null
    return {
      bpm: a.bpm,
      bpmConfidence: a.bpmConfidence,
      loudnessDbfs: a.loudnessDbfs,
      dynamicRangeDb: a.dynamicRangeDb,
      rms: a.rms,
      spectralCentroid: a.spectralCentroid,
      zeroCrossingRate: a.zeroCrossingRate,
      silenceRatio: a.silenceRatio,
    }
  } catch {
    return null
  }
}

export function useTrackAiAnalysis() {
  function stateFor(trackId: string | null | undefined): AiAnalysisState {
    if (!trackId) return 'idle'
    return states.get(trackId) ?? 'idle'
  }

  function resultFor(trackId: string | null | undefined): TrackAnalysisRecord | null {
    if (!trackId) return null
    return results.get(trackId) ?? null
  }

  function failureFor(trackId: string | null | undefined): TrackAnalysisFailureRecord | null {
    if (!trackId) return null
    return failures.get(trackId) ?? null
  }

  function saveWarningFor(trackId: string | null | undefined): string | null {
    if (!trackId) return null
    return saveWarnings.get(trackId) ?? null
  }

  function wasFromCache(trackId: string | null | undefined): boolean {
    return Boolean(trackId) && cacheHits.has(trackId as string)
  }

  function isAnalyzing(trackId: string | null | undefined): boolean {
    return Boolean(trackId) && inFlight.has(trackId as string)
  }

  /**
   * Shows a previously stored analysis without running anything.
   *
   * Called when the sheet opens or the track changes, so a track
   * analysed yesterday displays instantly instead of looking unanalysed
   * and inviting a pointless re-run.
   */
  function hydrate(trackId: string | null | undefined): void {
    if (!trackId) return
    if (inFlight.has(trackId)) return

    const stored = loadAnalysis(trackId)
    if (!results.has(trackId) && stored) {
      results.set(trackId, stored)
      states.set(trackId, 'done')
      cacheHits.add(trackId)
    }
    void hydrateSemantic(trackId, stored?.model ?? results.get(trackId)?.model)
  }

  async function hydrateSemantic(
    trackId: string,
    embeddingModel?: { id: string, version: string },
  ): Promise<void> {
    if (semantics.has(trackId)) return
    try {
      const fromTrack = await cachedSemanticForTrack(trackId)
      if (fromTrack) {
        semantics.set(trackId, fromTrack)
        semanticCacheHits.add(trackId)
        return
      }
      if (!embeddingModel) return
      const cached = await cachedSemanticFor(
        trackId,
        embeddingModel.id,
        embeddingModel.version,
        ANALYZER_VERSION,
        embeddingModel.id,
        embeddingModel.version,
      )
      if (cached) {
        semantics.set(trackId, cached)
        semanticCacheHits.add(trackId)
      }
    }
    catch {
      // Absence is fine; the sheet stays on the embedding result.
    }
  }

  /**
   * Runs a single-track analysis.
   *
   * @param track the track on screen, with the id and URI the player
   *   already holds. No new audio-loading mechanism.
   * @param force re-run even when a valid stored analysis exists.
   */
  async function analyze(
    track: AudioInput | null | undefined,
    force = false,
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
        trackId: id,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No embedding provider is configured on this build.',
        model: { id: '', version: '' },
        failedAt: new Date().toISOString(),
      })
      return
    }

    inFlight.add(id)
    states.set(id, 'analyzing')
    failures.delete(id)
    saveWarnings.delete(id)

    try {
      // Read the DSP result once and reuse it, so the dataset row and
      // the sheet cannot disagree about what was measured.
      let dspFeatures: Awaited<ReturnType<typeof readStoredDsp>> = null
      const outcome = await analyseSingleTrack(provider, track, {
        force,
        dsp: async (trackId: string) => {
          dspFeatures = await readStoredDsp(trackId)
          return dspFeatures
        },
      })

      // Stored under the analysed track's own id. Even if the user has
      // since skipped to another song, this cannot surface there: the
      // player reads by the CURRENT track id.
      if (outcome.ok) {
        results.set(id, outcome.record)
        states.set(id, 'done')
        if (outcome.fromCache) cacheHits.add(id)
        else cacheHits.delete(id)
        if (outcome.saveError) saveWarnings.set(id, outcome.saveError)

        // Collect into the persistent dataset. Only for a fresh run:
        // a cache hit already has its row, and rewriting it would
        // churn updatedAt for no new data.
        if (!outcome.fromCache) {
          const stored = await persistAnalysisToDataset(outcome.record, track, dspFeatures)
          if (!stored.ok && stored.error) saveWarnings.set(id, stored.error)
        }

        // Phase 29: semantic classification, in the same Analyze press.
        // Runs AFTER the embedding row exists, because predictions are
        // written onto that row. Wrapped so that a semantic failure —
        // the expected state until the models are installed — never
        // affects the embedding result the user is already looking at.
        await runSemantic(id, track, outcome.record.model, force, dspFeatures)
      } else {
        failures.set(id, outcome.failure)
        states.set(id, 'failed')
      }
    } catch (e) {
      // analyseSingleTrack is contracted not to throw; this is belt and
      // braces so a bridge surprise cannot leave the button spinning.
      failures.set(id, {
        trackId: id,
        code: 'ANALYSIS_FAILED',
        message: (e as Error)?.message ?? 'The analysis failed unexpectedly.',
        model: { id: provider.id, version: provider.version },
        failedAt: new Date().toISOString(),
      })
      states.set(id, 'failed')
    } finally {
      inFlight.delete(id)
    }
  }

  /**
   * Runs semantic classification for one track.
   *
   * Cache policy, per the phase brief:
   *   · same model + version  -> reuse the stored prediction
   *   · RE-RUN (force)        -> bypass the cache
   *   · model version changed -> stored result is not reused
   *
   * The cache is the dataset row itself, not a second store, so there
   * is nothing that can disagree with the database.
   *
   * Never throws and never sets a failure state: semantic analysis is
   * additive. When it cannot run, the sheet says so and the embedding
   * result stands on its own.
   */
  async function runSemantic(
    id: string,
    track: AudioInput,
    embeddingModel: { id: string, version: string },
    force: boolean,
    dsp: Awaited<ReturnType<typeof readStoredDsp>> = null,
  ): Promise<void> {
    semanticNotes.delete(id)
    semanticCacheHits.delete(id)

    const provider = createMusicSemanticProvider()
    if (!provider) {
      semanticNotes.set(id, 'No semantic model provider is configured on this build.')
      return
    }

    try {
      const status = await provider.status()

      if (!force && status.model && status.modelVersion) {
        const cached = await cachedSemanticFor(
          id,
          embeddingModel.id,
          embeddingModel.version,
          ANALYZER_VERSION,
          status.model,
          status.modelVersion,
        ) ?? await cachedSemanticForTrack(id)
        if (cached && isSameSemanticBuild(cached, status.model, status.modelVersion)) {
          semantics.set(id, cached)
          semanticCacheHits.add(id)
          return
        }
      }

      if (!status.ready) {
        semantics.delete(id)
        semanticNotes.set(id, status.detail ?? 'The semantic model is not ready.')
        return
      }

      const outcome = await provider.analyze({
        trackId: id,
        uri: track.uri,
        title: track.title,
      })

      if (!outcome.ok) {
        semantics.delete(id)
        semanticNotes.set(id, outcome.message)
        return
      }

      semantics.set(id, toStoredSemantic(outcome.result))

      const vec = outcome.result.embedding
      if (vec && vec.length === 1280) {
        const existing = results.get(id)
        const next: TrackAnalysisRecord = existing
          ? {
              ...existing,
              model: {
                id: outcome.result.model,
                version: outcome.result.modelVersion,
                experimental: true,
              },
              embedding: {
                vector: [...vec],
                dimension: 1280,
                normalised: existing.embedding.normalised,
                preNormL2: existing.embedding.preNormL2,
              },
            }
          : {
              trackId: id,
              model: {
                id: outcome.result.model,
                version: outcome.result.modelVersion,
                experimental: true,
              },
              embedding: {
                vector: [...vec],
                dimension: 1280,
                normalised: true,
                preNormL2: null,
              },
              audio: {
                durationSec: outcome.result.sourceDurationSec,
                processedDurationSec: outcome.result.processedDurationSec,
                sourceSampleRate: outcome.result.sampleRate,
                modelSampleRate: outcome.result.sampleRate,
                windowsProcessed: outcome.result.styleFrameCount ?? null,
              },
              dsp,
              timings: {
                decodeMs: outcome.result.decodeMs,
                inferenceMs: outcome.result.inferenceMs,
                totalMs: outcome.result.inferenceMs,
              },
              analyzedAt: outcome.result.analyzedAt,
              unsupported: [],
              groundTruth: null,
            }
        results.set(id, next)
        const persistedEmb = await persistAnalysisToDataset(next, track, dsp)
        if (!persistedEmb.ok && persistedEmb.error) semanticNotes.set(id, persistedEmb.error)
      }

      const stored = await persistSemanticToDataset(
        outcome.result,
        outcome.result.model,
        outcome.result.modelVersion,
        ANALYZER_VERSION,
      )

      if (!stored.ok && stored.error) semanticNotes.set(id, stored.error)
    } catch (e) {
      semantics.delete(id)
      semanticNotes.set(id, (e as Error)?.message ?? 'Semantic analysis failed.')
    }
  }

  /** Clears one track's in-memory state so it can be re-analysed. */
  function reset(trackId: string | null | undefined): void {
    if (!trackId) return
    states.delete(trackId)
    results.delete(trackId)
    failures.delete(trackId)
    saveWarnings.delete(trackId)
    cacheHits.delete(trackId)
    semantics.delete(trackId)
    semanticNotes.delete(trackId)
    semanticCacheHits.delete(trackId)
  }

  function semanticFor(trackId: string | null | undefined): SemanticAnalysis | null {
    return trackId ? semantics.get(trackId) ?? null : null
  }

  /** Why semantics are unavailable for this track, or null. */
  function semanticNoteFor(trackId: string | null | undefined): string | null {
    return trackId ? semanticNotes.get(trackId) ?? null : null
  }

  function semanticFromCache(trackId: string | null | undefined): boolean {
    return trackId ? semanticCacheHits.has(trackId) : false
  }

  return {
    semanticFor,
    semanticNoteFor,
    semanticFromCache,
    analyze,
    hydrate,
    stateFor,
    resultFor,
    failureFor,
    saveWarningFor,
    wasFromCache,
    isAnalyzing,
    reset,
  }
}
