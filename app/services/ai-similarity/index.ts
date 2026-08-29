/**
 * SYSTEMA — AI similarity pipeline (Phase 22), public surface.
 *
 * REPLACING THE MODEL
 * -------------------
 * Everything outside `providers/` is model-agnostic. To replace CLAP:
 *
 *   1. add `providers/newModelProvider.ts` implementing
 *      `AudioEmbeddingProvider`
 *   2. register it in PROVIDERS below
 *   3. point `DEFAULT_PROVIDER_ID` at it
 *
 * The similarity engine, the pipeline, the store, the recorder and the
 * evaluation code are untouched by that change. That is the whole
 * reason the layering exists: the 190-pair benchmark says CLAP has
 * signal (AUC 0.7720) but is not good enough to commit to, so being
 * able to swap it cheaply is a requirement, not a nicety.
 */

import { ClapProvider, CLAP_PROVIDER_ID } from './providers/clapProvider'
import { SimilarityPipeline } from './pipeline'
import { cosineEngine } from './similarity'
import type { AudioEmbeddingProvider } from './types'

export * from './types'
export {
  type SimilarityEngine,
  SimilarityError,
  type SimilarityErrorCode,
  clampCosine,
  cosine,
  cosineEngine,
  isUnitLength,
  magnitude,
} from './similarity'
export {
  type ComparePairOptions,
  type ExperimentalClassification,
  SimilarityPipeline,
  classify,
} from './pipeline'
export {
  CLAP_PROVIDER_ID,
  ClapProvider,
  UNKNOWN_VERSION,
  createClapProvider,
  deriveVersion,
} from './providers/clapProvider'
export {
  MAX_OBSERVATIONS,
  SIMILARITY_OBSERVATIONS_KEY,
  SIMILARITY_SCHEMA_VERSION,
  type SimilarityObservation,
  attachGroundTruth,
  canonicalPairId,
  clearObservations,
  createMemoryAdapter,
  loadObservations,
  recordObservation,
  resetStorageAdapter,
  saveObservations,
  setStorageAdapter,
  toAnalysablePairs,
} from './store'
export {
  type RecordOptions,
  type RecordedComparison,
  compareAndRecord,
  isSimilarityDebugEnabled,
  setSimilarityDebug,
} from './recorder'

/** Every provider the app can construct. Add new models here. */
export const PROVIDERS: Record<string, () => AudioEmbeddingProvider> = {
  [CLAP_PROVIDER_ID]: () => new ClapProvider(),
}

/**
 * The provider currently under evaluation.
 *
 * NOT a production selection. No model has been approved; this only
 * says which experimental provider the lab UI reaches for by default.
 */
export const DEFAULT_PROVIDER_ID = CLAP_PROVIDER_ID

/** Constructs a provider by id, or null when the id is unknown. */
export function createProvider(id: string = DEFAULT_PROVIDER_ID): AudioEmbeddingProvider | null {
  const factory = PROVIDERS[id]
  return factory ? factory() : null
}

/** Constructs the pipeline for a provider id. */
export function createPipeline(id: string = DEFAULT_PROVIDER_ID): SimilarityPipeline | null {
  const provider = createProvider(id)
  return provider ? new SimilarityPipeline(provider, cosineEngine) : null
}
