/**
 * SYSTEMA — Discogs-400 style contract for Discogs-EffNet.
 *
 * SOURCE OF TRUTH: the official Essentia metadata JSON
 *   essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.json
 * bundled here as `discogs-effnet-style-contract.json`.
 *
 * Index i of the 400-wide STYLE_ACTIVATIONS tensor is classes[i].
 * Do not sort, dedupe, or invent labels.
 */

import contractJson from './discogs-effnet-style-contract.json'

export const DISCOGS_STYLE_CONTRACT_VERSION = 1 as const
export const DISCOGS_STYLE_TAXONOMY = 'Discogs-400' as const
export const DISCOGS_STYLE_AGGREGATION = 'mean' as const
export const DISCOGS_STYLE_DIM = 400 as const
export const DISCOGS_EMBEDDING_DIM = 1280 as const

export interface DiscogsStyleContract {
  modelId: string
  modelFamily: string
  modelVersion: string
  contractVersion: number
  output: 'STYLE_ACTIVATIONS'
  dimension: number
  taxonomy: string
  activation: 'sigmoid'
  multiLabel: boolean
  aggregation: 'mean'
  labels: readonly string[]
}

export const DISCOGS_STYLE_CONTRACT: DiscogsStyleContract = {
  modelId: contractJson.modelId,
  modelFamily: contractJson.modelFamily,
  modelVersion: contractJson.modelVersion,
  contractVersion: contractJson.contractVersion,
  output: 'STYLE_ACTIVATIONS',
  dimension: contractJson.dimension,
  taxonomy: contractJson.taxonomy,
  activation: 'sigmoid',
  multiLabel: true,
  aggregation: 'mean',
  labels: contractJson.labels as readonly string[],
}

export const DISCOGS_400_LABELS: readonly string[] = DISCOGS_STYLE_CONTRACT.labels

export function assertDiscogs400Vocabulary(): void {
  if (DISCOGS_400_LABELS.length !== DISCOGS_STYLE_DIM) {
    throw new Error(
      `Discogs-400 contract has ${DISCOGS_400_LABELS.length} labels, expected ${DISCOGS_STYLE_DIM}.`,
    )
  }
}

/** Split an official `Parent---Style` string. Never invents a parent. */
export function splitDiscogsLabel(raw: string): {
  raw: string
  parentGenre: string | null
  style: string
} {
  const sep = '---'
  const i = raw.indexOf(sep)
  if (i <= 0) return { raw, parentGenre: null, style: raw }
  return {
    raw,
    parentGenre: raw.slice(0, i),
    style: raw.slice(i + sep.length),
  }
}

export function meanPoolFrames(flat: readonly number[], frames: number, dim: number): number[] | null {
  if (frames <= 0 || dim <= 0) return null
  if (flat.length !== frames * dim) return null
  const out = new Array<number>(dim).fill(0)
  for (let f = 0; f < frames; f++) {
    const base = f * dim
    for (let d = 0; d < dim; d++) out[d] += flat[base + d] as number
  }
  for (let d = 0; d < dim; d++) out[d] /= frames
  return out
}

export function topKStyles(
  scores: readonly number[],
  k: number,
  labels: readonly string[] = DISCOGS_400_LABELS,
): { styleId: number, label: string, score: number }[] {
  if (scores.length !== labels.length) return []
  const ranked = scores.map((score, styleId) => ({
    styleId,
    label: labels[styleId] as string,
    score,
  }))
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, Math.max(0, k))
}

export function zipDiscogsStyles(
  scores: readonly number[],
): { label: string, score: number }[] | null {
  if (scores.length !== DISCOGS_400_LABELS.length) return null
  if (!scores.every(s => typeof s === 'number' && Number.isFinite(s))) return null
  return DISCOGS_400_LABELS.map((label, i) => ({ label, score: scores[i] as number }))
}
