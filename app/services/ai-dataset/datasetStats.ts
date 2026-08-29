/**
 * SYSTEMA — dataset statistics (Phase 28).
 *
 * Aggregates for spotting class imbalance BEFORE anyone trains on this
 * data. A set that is 90% 'fa' and 4 tracks of everything else will
 * produce a classifier that looks accurate and has learned nothing;
 * these counts are how that gets noticed early.
 *
 * Distributions count only what a human actually assigned. Absent
 * labels are reported as a separate `unlabelled` figure rather than
 * being bucketed into 'unknown', so the gap stays visible.
 */

import type { DatasetRecord } from './datasetRecord'
import { assessRecord } from './datasetRecord'
import type { QualityIssue } from './datasetRecord'
import { hasAnyLabel } from './labels'

export interface Distribution {
  /** value → count, descending. */
  counts: Record<string, number>
  /** Rows with no value for this field. */
  unlabelled: number
  /** Distinct values present. */
  classes: number
  /** Largest class ÷ smallest present class. High = imbalance. */
  imbalanceRatio: number | null
}

export interface DatasetOverview {
  totalRecords: number
  analysedRecords: number
  failedRecords: number
  labelledRecords: number
  unlabelledRecords: number
  embeddingCount: number
  supersededRecords: number
  distinctTracks: number
  averageCompleteness: number
  modelDistribution: Record<string, number>
  issueCounts: Record<string, number>
}

function distribution(values: (string[] | string | null)[]): Distribution {
  const counts: Record<string, number> = {}
  let unlabelled = 0

  for (const v of values) {
    if (v === null || (Array.isArray(v) && v.length === 0)) {
      unlabelled++
      continue
    }
    const list = Array.isArray(v) ? v : [v]
    for (const item of list) counts[item] = (counts[item] ?? 0) + 1
  }

  const present = Object.values(counts)
  const sorted = Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]),
  )

  return {
    counts: sorted,
    unlabelled,
    classes: present.length,
    imbalanceRatio: present.length > 1
      ? Math.round((Math.max(...present) / Math.min(...present)) * 100) / 100
      : null,
  }
}

export function buildOverview(
  records: DatasetRecord[],
  currentModelVersion?: string,
): DatasetOverview {
  const issueCounts: Record<string, number> = {}
  const modelDistribution: Record<string, number> = {}
  let completenessSum = 0
  let embeddingCount = 0
  let labelled = 0
  let failed = 0
  let superseded = 0

  const tracks = new Set<string>()

  for (const r of records) {
    tracks.add(r.track.trackId)
    if (r.status === 'FAILED') failed++
    if (r.supersededAt) superseded++
    if (r.embedding && r.embedding.vector.length > 0) embeddingCount++
    if (hasAnyLabel(r.groundTruth)) labelled++

    if (r.embedding) {
      const key = `${r.embedding.model}@${r.embedding.modelVersion}`
      modelDistribution[key] = (modelDistribution[key] ?? 0) + 1
    }

    const report = assessRecord(r, currentModelVersion)
    completenessSum += report.completeness
    for (const issue of report.issues) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
    }
  }

  return {
    totalRecords: records.length,
    analysedRecords: records.filter(r => r.status === 'COMPLETED').length,
    failedRecords: failed,
    labelledRecords: labelled,
    unlabelledRecords: records.length - labelled,
    embeddingCount,
    supersededRecords: superseded,
    distinctTracks: tracks.size,
    averageCompleteness: records.length
      ? Math.round(completenessSum / records.length)
      : 0,
    modelDistribution: Object.fromEntries(
      Object.entries(modelDistribution).sort((a, b) => b[1] - a[1]),
    ),
    issueCounts,
  }
}

export interface LabelDistributions {
  language: Distribution
  genre: Distribution
  mood: Distribution
  vocal: Distribution
  energy: Distribution
  context: Distribution
}

export function buildLabelDistributions(records: DatasetRecord[]): LabelDistributions {
  return {
    language: distribution(records.map(r => r.groundTruth.language)),
    genre: distribution(records.map(r => r.groundTruth.genres)),
    mood: distribution(records.map(r => r.groundTruth.moods)),
    vocal: distribution(records.map(r => r.groundTruth.vocal)),
    energy: distribution(records.map(r => r.groundTruth.energy)),
    context: distribution(records.map(r => r.groundTruth.contexts)),
  }
}

/** Rows sharing a trackId across DIFFERENT model builds. */
export function findDuplicateTracks(records: DatasetRecord[]): string[] {
  const byTrack = new Map<string, number>()
  for (const r of records) {
    byTrack.set(r.track.trackId, (byTrack.get(r.track.trackId) ?? 0) + 1)
  }
  return [...byTrack.entries()].filter(([, n]) => n > 1).map(([id]) => id)
}

export type { QualityIssue }
