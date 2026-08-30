/**
 * SYSTEMA — MTG-Jamendo / Discogs-EffNet semantic provider (Phase 29).
 *
 * THE ONLY FILE IN THIS LAYER THAT KNOWS WHICH MODEL IS USED.
 *
 * Everything above it depends on `MusicSemanticAnalysisProvider`.
 * Replacing the model means writing a sibling here and changing one
 * line in the registry.
 *
 * STATUS: EXPERIMENTAL, NOT SELECTED, NOT RUNNABLE YET.
 * The weights are not on the device and the mel front-end does not
 * exist. This provider therefore returns PROVIDER_NOT_READY for every
 * track. That is the correct behaviour — see semanticRuntime.ts.
 *
 * HOW IT WORKS WHEN IT DOES RUN
 * -----------------------------
 * One decode, one embedding pass, many heads:
 *
 *   audio -> mel -> discogs-effnet -> 1280-d -> [mood | genre | voice]
 *
 * The embedding dominates the cost, so it runs once and every head
 * reuses it. A head that fails does not fail the others; a partial
 * result with three of four heads is genuinely useful data, whereas
 * discarding everything because one head errored is not.
 *
 * LICENSING: CC BY-NC-SA 4.0 (non-commercial). Surfaced in status().
 */

import type {
  MusicSemanticAnalysisProvider,
  SemanticAnalysisOutcome,
  SemanticAnalysisResult,
  SemanticAudioInput,
  SemanticField,
  SemanticHeadResult,
  SemanticProviderStatus,
  UnsupportedSemanticField,
} from '../types'
import { rankPredictions } from '../types'
import {
  ALL_TAXONOMIES,
  EMBEDDING_MODEL,
  MODEL_LICENSE,
  type HeadTaxonomy,
  usableTaxonomies,
  zipPredictions,
} from './jamendoTaxonomy'
import {
  RUNTIME_NOT_READY_MESSAGE,
  isRuntimeReady,
  releaseRuntime,
  runEmbedding,
  runHead,
} from './semanticRuntime'

export const JAMENDO_PROVIDER_ID = 'mtg-jamendo-discogs-effnet'

export class JamendoSemanticProvider implements MusicSemanticAnalysisProvider {
  readonly id = JAMENDO_PROVIDER_ID

  async status(): Promise<SemanticProviderStatus> {
    const ready = isRuntimeReady()
    return {
      // The provider could exist here; whether it can RUN is `ready`.
      available: true,
      ready,
      model: EMBEDDING_MODEL.id,
      modelVersion: EMBEDDING_MODEL.version,
      supports: usableTaxonomies().map(t => t.field),
      detail: ready
        ? `${MODEL_LICENSE.spdx}. ${MODEL_LICENSE.note}`
        : RUNTIME_NOT_READY_MESSAGE,
    }
  }

  async analyze(input: SemanticAudioInput): Promise<SemanticAnalysisOutcome> {
    const modelIdentity = {
      model: EMBEDDING_MODEL.id,
      modelVersion: EMBEDDING_MODEL.version,
    }

    if (!input?.trackId) {
      return {
        ok: false,
        code: 'MISSING_AUDIO',
        message: 'No track was supplied for analysis.',
        ...modelIdentity,
      }
    }

    // Mock catalogue entries have no real audio. Analysing them would
    // mean inventing input, so they are refused explicitly.
    if (!input.uri) {
      return {
        ok: false,
        code: 'NO_AUDIO_SOURCE',
        message: 'This track has no playable audio file to analyse.',
        ...modelIdentity,
      }
    }

    const started = Date.now()

    // Stage one: the expensive part.
    const embedded = await runEmbedding(input)
    if (!embedded.ok) {
      return { ok: false, code: embedded.code, message: embedded.message, ...modelIdentity }
    }

    if (embedded.value.embedding.length !== EMBEDDING_MODEL.embeddingDim) {
      // A wrong-length embedding means the wrong model file, or a
      // re-export with a different output node. Refuse it rather than
      // feeding it to heads that will happily produce numbers.
      return {
        ok: false,
        code: 'INVALID_OUTPUT',
        message: 'The embedding model returned an unexpected output size.',
        ...modelIdentity,
      }
    }

    // Stage two: every usable head, over the one embedding.
    const heads: SemanticHeadResult[] = []
    const unsupported: UnsupportedSemanticField[] = []

    for (const taxonomy of ALL_TAXONOMIES) {
      if (taxonomy.labelsUnavailable || taxonomy.labels.length === 0) {
        unsupported.push({
          field: taxonomy.field,
          reason: `The official class list for ${taxonomy.head} could not be `
            + 'obtained, so its scores cannot be labelled. Running it would '
            + 'attach real numbers to invented label names.',
        })
        continue
      }

      const out = await runHead(taxonomy.head, embedded.value.embedding)
      if (!out.ok) {
        // One head failing must not discard the others.
        unsupported.push({
          field: taxonomy.field,
          reason: out.message,
        })
        continue
      }

      const head = buildHeadResult(taxonomy, out.value.scores)
      if (!head) {
        unsupported.push({
          field: taxonomy.field,
          reason: `${taxonomy.head} returned ${out.value.scores.length} scores `
            + `but its taxonomy declares ${taxonomy.labels.length} classes. `
            + 'The model file and the label list disagree.',
        })
        continue
      }

      heads.push(head)
    }

    // AN EMBEDDING WITH NO HEADS IS A SUCCESS, NOT A FAILURE.
    //
    // This was previously an error, on the assumption that labels were
    // the point. In Phase 29.x they are not: no classifier head has
    // been converted or imported, so `heads` is legitimately empty
    // while the backbone produced a real 1280-d vector at real cost.
    //
    // Reporting that as INFERENCE_FAILED would throw away the only
    // genuine model output the project has, and would tell the user
    // something is broken when nothing is. The embedding is the
    // result; the missing labels are already itemised in `unsupported`
    // with the reason for each.
    //
    // There is deliberately no "nothing was produced" guard here: the
    // embedding length was already checked against
    // EMBEDDING_MODEL.embeddingDim above, and TypeScript narrows it to
    // exactly 1280 at this point. An extra `length === 0` test would
    // be unreachable code that reads like a real safety net.

    // IDENTITY COMES FROM THE MODEL THAT ACTUALLY RAN.
    //
    // modelIdentity above is the compile-time expectation, used for
    // error paths where nothing ran. Once inference has happened, the
    // native layer has reported which file produced this vector, and
    // THAT is what gets stored — otherwise importing a different
    // export would keep writing the old identity and the cache would
    // never invalidate.
    const result: SemanticAnalysisResult = {
      trackId: input.trackId,
      model: embedded.value.modelId || modelIdentity.model,
      modelVersion: embedded.value.modelVersion || modelIdentity.modelVersion,
      heads,
      unsupported,
      embedding: embedded.value.embedding,
      embeddingDim: embedded.value.embedding.length,
      sourceDurationSec: embedded.value.sourceDurationSec,
      processedDurationSec: embedded.value.processedDurationSec,
      sampleRate: embedded.value.sampleRate,
      decodeMs: embedded.value.decodeMs,
      inferenceMs: Date.now() - started,
      analyzedAt: new Date().toISOString(),
      experimental: true,
    }

    return { ok: true, result }
  }

  async release(): Promise<void> {
    await releaseRuntime()
  }
}

/**
 * Turns a raw score array into a labelled, ranked head result.
 *
 * Returns null when the array length does not match the taxonomy —
 * the check that stops 56 scores being zipped onto 87 labels.
 */
export function buildHeadResult(
  taxonomy: HeadTaxonomy,
  scores: readonly number[],
): SemanticHeadResult | null {
  const zipped = zipPredictions(taxonomy, scores)
  if (!zipped) return null

  return {
    field: taxonomy.field,
    head: taxonomy.head,
    headVersion: taxonomy.headVersion,
    activation: taxonomy.activation,
    multiLabel: taxonomy.multiLabel,
    classCount: taxonomy.labels.length,
    // COMPLETE ranked output. Never sliced: evaluation needs the tail.
    predictions: rankPredictions(zipped),
  }
}

/** Fields this provider would produce once the runtime exists. */
export function jamendoSupportedFields(): SemanticField[] {
  return usableTaxonomies().map(t => t.field)
}

export function createJamendoProvider(): MusicSemanticAnalysisProvider {
  return new JamendoSemanticProvider()
}
