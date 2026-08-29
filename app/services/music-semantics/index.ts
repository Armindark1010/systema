/**
 * SYSTEMA — music semantic analysis, public surface (Phase 29).
 *
 * REPLACING THE MODEL
 * -------------------
 *   1. add `providers/newProvider.ts` implementing
 *      `MusicSemanticAnalysisProvider`
 *   2. register it in PROVIDERS below
 *   3. point DEFAULT_PROVIDER_ID at it
 *
 * Nothing else changes. The dataset layer, the Full Player sheet, the
 * evaluation metrics and `/dev/ai-dataset` all depend on the contracts
 * in types.ts and never on a provider.
 *
 * This mirrors `ai-similarity/index.ts` deliberately — same registry
 * shape, same injection seam — so there is one pattern to learn rather
 * than two.
 *
 * NO PRODUCTION MODEL IS SELECTED. Every provider here is experimental.
 */

import {
  JAMENDO_PROVIDER_ID,
  JamendoSemanticProvider,
  createJamendoProvider,
} from './providers/jamendoProvider'
import type { MusicSemanticAnalysisProvider } from './types'

export * from './types'
export {
  JAMENDO_PROVIDER_ID,
  JamendoSemanticProvider,
  buildHeadResult,
  createJamendoProvider,
  jamendoSupportedFields,
} from './providers/jamendoProvider'
export {
  ALL_TAXONOMIES,
  EMBEDDING_MODEL,
  GENRE_TAXONOMY,
  type HeadTaxonomy,
  MODEL_LICENSE,
  MOODTHEME_TAXONOMY,
  TOP50TAGS_TAXONOMY,
  VOICE_INSTRUMENTAL_TAXONOMY,
  usableTaxonomies,
  zipPredictions,
} from './providers/jamendoTaxonomy'
export {
  RUNTIME_NOT_READY_MESSAGE,
  RUNTIME_REQUIREMENTS,
  isRuntimeReady,
  outstandingRequirements,
} from './providers/semanticRuntime'

type ProviderFactory = () => MusicSemanticAnalysisProvider

const PROVIDERS: Record<string, ProviderFactory> = {
  [JAMENDO_PROVIDER_ID]: createJamendoProvider,
}

export const DEFAULT_SEMANTIC_PROVIDER_ID = JAMENDO_PROVIDER_ID

/**
 * Test/injection seam.
 *
 * Lets a suite substitute a fake provider without touching the
 * registry, which is how the provider-replacement tests work.
 */
let override: MusicSemanticAnalysisProvider | null = null

export function setSemanticProviderOverride(
  provider: MusicSemanticAnalysisProvider | null,
): void {
  override = provider
}

/**
 * Builds the active provider, or null when the id is unknown.
 *
 * Returns null rather than throwing so a caller can degrade to "no
 * semantic analysis" instead of crashing the player.
 */
export function createMusicSemanticProvider(
  id: string = DEFAULT_SEMANTIC_PROVIDER_ID,
): MusicSemanticAnalysisProvider | null {
  if (override) return override
  const factory = PROVIDERS[id]
  return factory ? factory() : null
}

export function availableSemanticProviderIds(): string[] {
  return Object.keys(PROVIDERS)
}
