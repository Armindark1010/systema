// ============================================================
// SYSTEMA — Phase 14: run comparison and target evaluation
// ============================================================
// Decides when two benchmark runs may be placed side by side, and
// what — if anything — the numbers justify recommending.
//
// The rule that shapes this file (§12, §17)
// -----------------------------------------
// Comparing incompatible runs is worse than not comparing at all,
// because a table makes any two numbers look equivalent. So
// compatibility is computed first and reported loudly; an
// incompatible comparison is still displayed (the data is real) but
// carries explicit blockers explaining why the winner is meaningless.
//
// And §18: no invented composite score. Recommendations are made per
// category against a single, stated metric. There is no "SYSTEMA
// Score" weighting latency against memory by some arbitrary ratio,
// because that ratio would be fiction.
// ============================================================

import type {
  BenchmarkRun,
  BenchmarkTargets,
  TargetEvaluation,
  TargetVerdict,
} from './types'

export type CompatibilityLevel = 'COMPARABLE' | 'CAVEATED' | 'NOT_COMPARABLE'

export interface CompatibilityReport {
  level: CompatibilityLevel
  /** Differences that invalidate a direct comparison. */
  blockers: string[]
  /** Differences that colour it but do not invalidate it. */
  caveats: string[]
}

/**
 * Determines whether runs can be compared.
 *
 * Blockers are things that change what was measured: a different
 * dataset, different preprocessing, or desktop-vs-device. Caveats are
 * things worth knowing that do not invalidate the numbers.
 */
export function assessCompatibility(runs: BenchmarkRun[]): CompatibilityReport {
  const blockers: string[] = []
  const caveats: string[] = []

  if (runs.length < 2) {
    return { level: 'COMPARABLE', blockers, caveats }
  }

  const first = runs[0]!

  const datasets = new Set(runs.map(r => r.datasetId))
  if (datasets.size > 1) {
    blockers.push(
      `Different datasets (${[...datasets].join(', ')}). Latency depends directly on `
      + 'how much audio was processed, so these numbers are not comparable.',
    )
  }

  const environments = new Set(runs.map(r => r.environment))
  if (environments.size > 1) {
    blockers.push(
      `Mixed environments (${[...environments].join(', ')}). Desktop timings must never `
      + 'be read as device performance — the hardware differs by an order of magnitude.',
    )
  }

  const devices = new Set(runs.map(r => r.device.label))
  if (devices.size > 1 && environments.size === 1) {
    blockers.push(
      `Different devices (${[...devices].join(', ')}). Compare runs from one device.`,
    )
  }

  const preprocessingKeys = new Set(
    runs.map(r => JSON.stringify(r.reproducibility.preprocessing)),
  )
  if (preprocessingKeys.size > 1) {
    blockers.push(
      'Different preprocessing (sample rate, window length or aggregation). Each model '
      + 'consumed a different amount of audio per inference, so per-inference latency '
      + 'means different things across these runs.',
    )
  }

  const providers = new Set(runs.map(r => r.executionProvider))
  if (providers.size > 1) {
    caveats.push(
      `Different execution providers (${[...providers].join(', ')}). This is a valid `
      + 'comparison of providers, but not of models.',
    )
  }

  const repetitions = new Set(runs.map(r => r.reproducibility.measuredRuns))
  if (repetitions.size > 1) {
    caveats.push(
      'Different repetition counts. Runs with fewer repetitions have noisier medians.',
    )
  }

  const harnesses = new Set(runs.map(r => r.reproducibility.harnessVersion))
  if (harnesses.size > 1) {
    blockers.push(
      'Different harness versions. The measurement code itself changed between these runs.',
    )
  }

  if (runs.some(r => r.status === 'FAILED')) {
    caveats.push('At least one run failed outright and contributes no timings.')
  }
  if (runs.some(r => r.status === 'PARTIAL_SUCCESS')) {
    caveats.push(
      'At least one run is a partial success — its averages cover only the samples '
      + 'that succeeded.',
    )
  }

  if (runs.some(r => r.environment === 'SYNTHETIC') || first.environment === 'SYNTHETIC') {
    caveats.push('Synthetic harness runs validate the pipeline, not real model performance.')
  }

  const level: CompatibilityLevel = blockers.length > 0
    ? 'NOT_COMPARABLE'
    : caveats.length > 0 ? 'CAVEATED' : 'COMPARABLE'

  return { level, blockers, caveats }
}

// ---- Targets ----------------------------------------------------

/** Evaluates one run against the configurable reference targets (§29). */
export function evaluateTargets(
  run: BenchmarkRun,
  targets: BenchmarkTargets,
  modelSizeMb: number | null,
): TargetEvaluation[] {
  const rows: TargetEvaluation[] = []

  const lowerIsBetter = (
    metric: string,
    actual: number | null,
    limit: number,
    unit: string,
    confidenceKnown: boolean,
  ): TargetEvaluation => {
    let verdict: TargetVerdict = 'UNKNOWN'
    if (actual !== null && confidenceKnown) verdict = actual <= limit ? 'MEETS' : 'MISSES'
    return {
      metric,
      target: `<= ${limit} ${unit}`,
      actual: actual === null ? 'not measured' : `${actual.toFixed(2)} ${unit}`,
      verdict,
    }
  }

  rows.push(lowerIsBetter(
    'Median inference',
    run.performance.medianInferenceMs.value,
    targets.maxMedianInferenceMs,
    'ms',
    run.performance.medianInferenceMs.confidence === 'MEASURED',
  ))

  rows.push(lowerIsBetter(
    'Peak memory',
    run.memory.peakMb.value,
    targets.maxPeakMemoryMb,
    'MB',
    // Heap-only figures are ESTIMATED, so this stays UNKNOWN rather
    // than passing a target on a number we do not trust.
    run.memory.peakMb.confidence === 'MEASURED',
  ))

  rows.push(lowerIsBetter(
    'Model size',
    modelSizeMb,
    targets.maxModelSizeMb,
    'MB',
    modelSizeMb !== null,
  ))

  rows.push(lowerIsBetter(
    'Real-time factor',
    run.performance.realTimeFactor.value,
    targets.maxRealTimeFactor,
    'x',
    run.performance.realTimeFactor.confidence === 'MEASURED',
  ))

  rows.push({
    metric: 'Success rate',
    target: `>= ${(targets.minSuccessRate * 100).toFixed(0)} %`,
    actual: `${(run.reliability.successRate * 100).toFixed(1)} %`,
    verdict: run.reliability.successRate >= targets.minSuccessRate ? 'MEETS' : 'MISSES',
  })

  return rows
}

// ---- Recommendations --------------------------------------------

export type RecommendationCategory =
  | 'BEST_PERFORMANCE'
  | 'BEST_MEMORY'
  | 'BEST_QUALITY'
  | 'BALANCED'

export interface Recommendation {
  category: RecommendationCategory
  label: string
  runId: string | null
  modelId: string | null
  /** The single metric this recommendation is based on. Stated, always. */
  basis: string
  reason: string
}

/**
 * Produces per-category recommendations.
 *
 * Each is tied to ONE named metric so the reader can check the claim.
 * BALANCED is the only multi-metric category and it uses an explicitly
 * documented rank-sum — no hidden weights (§18).
 *
 * Crucially this only ever RECOMMENDS. Selecting a production model is
 * a separate, human, explicit action (§28).
 */
export function buildRecommendations(runs: BenchmarkRun[]): Recommendation[] {
  const usable = runs.filter(
    r => r.status !== 'FAILED' && r.reliability.successfulSamples > 0,
  )

  const empty = (category: RecommendationCategory, label: string, basis: string) => ({
    category,
    label,
    runId: null,
    modelId: null,
    basis,
    reason: 'No run produced a usable measurement for this metric.',
  })

  const results: Recommendation[] = []

  // --- Performance: lowest median inference -------------------
  const byLatency = usable
    .filter(r => r.performance.medianInferenceMs.confidence === 'MEASURED')
    .sort((a, b) =>
      (a.performance.medianInferenceMs.value ?? Infinity)
      - (b.performance.medianInferenceMs.value ?? Infinity))
  results.push(byLatency[0]
    ? {
        category: 'BEST_PERFORMANCE',
        label: 'Best performance',
        runId: byLatency[0].id,
        modelId: byLatency[0].modelId,
        basis: 'Lowest median inference time',
        reason: `${byLatency[0].modelName} at `
          + `${byLatency[0].performance.medianInferenceMs.value!.toFixed(2)} ms median.`,
      }
    : empty('BEST_PERFORMANCE', 'Best performance', 'Lowest median inference time'))

  // --- Memory: lowest peak ------------------------------------
  const byMemory = usable
    .filter(r => r.memory.peakMb.value !== null)
    .sort((a, b) => (a.memory.peakMb.value ?? Infinity) - (b.memory.peakMb.value ?? Infinity))
  results.push(byMemory[0]
    ? {
        category: 'BEST_MEMORY',
        label: 'Lowest memory',
        runId: byMemory[0].id,
        modelId: byMemory[0].modelId,
        basis: 'Lowest peak memory',
        reason: `${byMemory[0].modelName} peaked at `
          + `${byMemory[0].memory.peakMb.value!.toFixed(1)} MB `
          + `(${byMemory[0].memory.peakMb.confidence.toLowerCase()}).`,
      }
    : empty('BEST_MEMORY', 'Lowest memory', 'Lowest peak memory'))

  // --- Quality: best discrimination ---------------------------
  // Lower mean pairwise similarity = the model separates different
  // inputs better. This is a proxy, and it is labelled as one.
  const byQuality = usable
    .filter(r => r.quality.meanPairwiseSimilarity.confidence === 'MEASURED')
    .sort((a, b) =>
      (a.quality.meanPairwiseSimilarity.value ?? Infinity)
      - (b.quality.meanPairwiseSimilarity.value ?? Infinity))
  results.push(byQuality[0]
    ? {
        category: 'BEST_QUALITY',
        label: 'Best separation',
        runId: byQuality[0].id,
        modelId: byQuality[0].modelId,
        basis: 'Lowest mean pairwise similarity (embedding separation proxy)',
        reason: `${byQuality[0].modelName} at `
          + `${byQuality[0].quality.meanPairwiseSimilarity.value!.toFixed(3)}. `
          + 'This measures separation, NOT accuracy — there is no ground truth here.',
      }
    : empty('BEST_QUALITY', 'Best separation', 'Embedding separation proxy'))

  // --- Balanced: documented rank sum --------------------------
  if (byLatency.length > 0 && byMemory.length > 0) {
    const rank = (list: BenchmarkRun[], id: string) => {
      const index = list.findIndex(r => r.id === id)
      return index === -1 ? list.length : index
    }
    const scored = usable
      .map(run => ({ run, score: rank(byLatency, run.id) + rank(byMemory, run.id) }))
      .sort((a, b) => a.score - b.score)
    const winner = scored[0]
    results.push(winner
      ? {
          category: 'BALANCED',
          label: 'Balanced',
          runId: winner.run.id,
          modelId: winner.run.modelId,
          basis: 'Sum of latency rank and memory rank (equal weight, no hidden scoring)',
          reason: `${winner.run.modelName} has the lowest combined rank `
            + `(${winner.score}). Equal weighting is a stated convention, not a `
            + 'derived optimum.',
        }
      : empty('BALANCED', 'Balanced', 'Rank sum'))
  } else {
    results.push(empty(
      'BALANCED',
      'Balanced',
      'Sum of latency rank and memory rank (equal weight, no hidden scoring)',
    ))
  }

  return results
}
