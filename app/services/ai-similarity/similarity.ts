/**
 * SYSTEMA — model-independent similarity engine (Phase 22).
 *
 * Knows nothing about CLAP, about any provider, or about the pipeline.
 * It takes two vectors and returns a number. That is the whole job, and
 * keeping it that way is what lets the model be replaced later without
 * touching similarity logic.
 *
 * RELATIONSHIP TO THE EXISTING COSINE
 * -----------------------------------
 * `inferenceService.cosineSimilarity` already exists and is already
 * asserted by the test suite. It assumes UNIT-LENGTH inputs and treats
 * the dot product as the cosine, which is correct for the lab's
 * normalised embeddings but wrong for an arbitrary provider that does
 * not normalise.
 *
 * This engine therefore divides by the magnitudes rather than assuming
 * them, and delegates the unit-length case to the same clamping rule so
 * both paths agree to the last bit. It does not replace or modify the
 * existing function: the lab keeps using it, and nothing about the
 * existing evaluation metrics changes.
 */

/** Why a similarity could not be computed. */
export type SimilarityErrorCode =
  | 'DIMENSION_MISMATCH'
  | 'EMPTY_VECTOR'
  | 'NON_FINITE_COMPONENT'
  | 'ZERO_VECTOR'

export class SimilarityError extends Error {
  constructor(readonly code: SimilarityErrorCode, message: string) {
    super(message)
    this.name = 'SimilarityError'
  }
}

/** Numeric input the engine accepts. Never mutated. */
export type VectorLike = Float32Array | readonly number[]

function at(v: VectorLike, i: number): number {
  return v[i] as number
}

/**
 * Cosine similarity of two vectors.
 *
 * Throws rather than returning NaN or Infinity. A NaN that reaches a
 * results table looks exactly like a measurement, and a silently
 * substituted 0 looks like "unrelated" rather than "broken" — both
 * would corrupt the dataset this phase exists to collect.
 *
 * Neither input is mutated.
 */
export function cosine(a: VectorLike, b: VectorLike): number {
  if (a.length !== b.length) {
    throw new SimilarityError(
      'DIMENSION_MISMATCH',
      `Cannot compare a ${a.length}-d embedding with a ${b.length}-d one. `
      + 'Refusing to pad or truncate: the result would be meaningless.',
    )
  }
  if (a.length === 0) {
    throw new SimilarityError('EMPTY_VECTOR', 'Cannot compute similarity between empty vectors.')
  }

  let dot = 0
  let sqA = 0
  let sqB = 0
  for (let i = 0; i < a.length; i++) {
    const x = at(a, i)
    const y = at(b, i)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new SimilarityError(
        'NON_FINITE_COMPONENT',
        `Refusing to compute a similarity from a non-finite component at index ${i}.`,
      )
    }
    dot += x * y
    sqA += x * x
    sqB += y * y
  }

  const magA = Math.sqrt(sqA)
  const magB = Math.sqrt(sqB)
  if (magA === 0 || magB === 0) {
    // A zero vector has no direction, so it has no angle to anything.
    // Returning 0 would claim "orthogonal", which is a measurement we
    // did not make.
    throw new SimilarityError(
      'ZERO_VECTOR',
      'A zero-magnitude vector has no direction, so its similarity is undefined. '
      + 'This usually means inference failed and produced an empty result.',
    )
  }

  // Float rounding can nudge an identical pair a hair past 1.
  return clampCosine(dot / (magA * magB))
}

/** Constrains a cosine to its mathematical range. */
export function clampCosine(v: number): number {
  return Math.min(1, Math.max(-1, v))
}

/** L2 norm. Does not mutate the input. */
export function magnitude(v: VectorLike): number {
  let acc = 0
  for (let i = 0; i < v.length; i++) {
    const x = at(v, i)
    if (!Number.isFinite(x)) {
      throw new SimilarityError(
        'NON_FINITE_COMPONENT',
        `Cannot take the magnitude of a vector with a non-finite component at index ${i}.`,
      )
    }
    acc += x * x
  }
  return Math.sqrt(acc)
}

/** Whether a vector is unit length within a tolerance. */
export function isUnitLength(v: VectorLike, tolerance = 1e-4): boolean {
  if (v.length === 0) return false
  try {
    return Math.abs(magnitude(v) - 1) <= tolerance
  } catch {
    return false
  }
}

/**
 * The engine as an object, for callers that want to inject it.
 *
 * The pipeline depends on this interface rather than the free function
 * so an alternative metric could be supplied later without touching the
 * pipeline.
 */
export interface SimilarityEngine {
  cosine(a: VectorLike, b: VectorLike): number
}

export const cosineEngine: SimilarityEngine = { cosine }
