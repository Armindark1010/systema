// ============================================================
// SYSTEMA — Phase 14: controlled benchmark datasets
// ============================================================
// THE SAFETY BOUNDARY OF PHASE 14.
//
// A benchmark run can only ever see what is in a BenchmarkDataset, and
// a dataset only ever contains samples someone explicitly put there.
// There is no code path from here to "every track in the library" —
// that absence is the point, it is enforced by MAX_DATASET_SAMPLES
// below, and it is covered by a dedicated regression suite.
//
// Two kinds of dataset:
//
//   SYNTHETIC   deterministic generated signals. Runs anywhere,
//               including desktop and CI, and is fully reproducible.
//               The default.
//
//   DEVICE      a handful of real tracks the developer picks by hand
//               on the device. Never auto-populated, never derived
//               from a scan, capped hard.
// ============================================================

import type { BenchmarkDataset, BenchmarkSample } from './types'

/**
 * Hard ceiling on dataset size (§5: "5-20 tracks maximum").
 *
 * This is a real guard, not documentation: buildDeviceDataset()
 * truncates to it, so even a caller that passed the entire library
 * could not turn a benchmark into a library-wide sweep.
 */
export const MAX_DATASET_SAMPLES = 20

/** Sensible default so a run is meaningful without being long. */
export const DEFAULT_SAMPLE_COUNT = 8

export const SYNTHETIC_DATASET_ID = 'synthetic-v1'

/**
 * The built-in synthetic dataset.
 *
 * Twelve signals chosen to span the acoustic characteristics §5 asks
 * for. They are not music and are not described as such — they are
 * controlled inputs with known, deliberately different properties, so
 * a model that returns the same embedding for all of them is provably
 * broken.
 */
const SYNTHETIC_SAMPLES: readonly BenchmarkSample[] = Object.freeze([
  {
    sampleId: 'syn-dense-energetic',
    label: 'Dense / energetic',
    kind: 'synthetic',
    characteristics: ['dense', 'energetic', 'percussive', 'electronic-like'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-sparse-calm',
    label: 'Sparse / calm',
    kind: 'synthetic',
    characteristics: ['sparse', 'calm', 'acoustic-like'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-bass-heavy',
    label: 'Bass heavy',
    kind: 'synthetic',
    characteristics: ['bass-heavy', 'dense', 'energetic'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-bright',
    label: 'Bright / high spectrum',
    kind: 'synthetic',
    characteristics: ['bright', 'sparse'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-percussive',
    label: 'Percussive / rhythmic',
    kind: 'synthetic',
    characteristics: ['percussive', 'energetic', 'rock-like'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-noisy',
    label: 'Noisy / dense production',
    kind: 'synthetic',
    characteristics: ['noisy', 'dense'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-tonal-sustained',
    label: 'Tonal / sustained',
    kind: 'synthetic',
    characteristics: ['calm', 'sparse', 'classical-like'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-quiet',
    label: 'Very quiet',
    kind: 'synthetic',
    characteristics: ['quiet', 'sparse', 'calm'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-silence',
    label: 'Digital silence (edge case)',
    kind: 'synthetic',
    characteristics: ['silence'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-short',
    label: 'Ultra-short (edge case)',
    kind: 'synthetic',
    characteristics: ['sparse', 'calm'],
    durationSec: 0.4,
  },
  {
    sampleId: 'syn-dense-energetic-copy',
    label: 'Dense / energetic (duplicate)',
    kind: 'synthetic',
    // Same characteristics AND same generator seed source as the
    // first sample would collide, so this uses its own id but an
    // identical profile — the nearest-neighbour sanity check needs a
    // pair that *should* embed close together.
    characteristics: ['dense', 'energetic', 'percussive', 'electronic-like'],
    durationSec: 10,
  },
  {
    sampleId: 'syn-long',
    label: 'Longer excerpt (multi-window)',
    kind: 'synthetic',
    characteristics: ['dense', 'calm'],
    durationSec: 30,
  },
])

export function syntheticDataset(sampleCount = DEFAULT_SAMPLE_COUNT): BenchmarkDataset {
  const count = Math.max(1, Math.min(sampleCount, SYNTHETIC_SAMPLES.length))
  return {
    datasetId: `${SYNTHETIC_DATASET_ID}-${count}`,
    name: `Synthetic reference set (${count})`,
    description:
      'Deterministic generated signals with known, deliberately different acoustic '
      + 'properties. Reproducible on any machine, including CI. Not music — used to '
      + 'validate the measurement pipeline and to detect a model that cannot '
      + 'distinguish obviously different inputs.',
    samples: SYNTHETIC_SAMPLES.slice(0, count),
  }
}

/** The full synthetic set, including the edge cases. */
export function fullSyntheticDataset(): BenchmarkDataset {
  return syntheticDataset(SYNTHETIC_SAMPLES.length)
}

/**
 * Builds a dataset from tracks the developer explicitly selected.
 *
 * Note what this function does NOT do: it does not query the library,
 * does not scan, and does not accept a "select all" flag. It receives
 * an already-chosen list and caps it. Callers cannot widen it.
 */
export function buildDeviceDataset(
  tracks: Array<{ id: string, title: string, durationMs: number }>,
  label = 'Device selection',
): BenchmarkDataset {
  const limited = tracks.slice(0, MAX_DATASET_SAMPLES)

  const samples: BenchmarkSample[] = limited.map((track, index) => ({
    sampleId: `dev-${index}-${track.id}`,
    // Titles can be long and are user data; keep the label short and
    // never store a filesystem path (§24).
    label: track.title.slice(0, 40),
    kind: 'device-track',
    characteristics: ['real-audio'],
    durationSec: Math.max(0, Math.round(track.durationMs / 1000)),
    trackId: track.id,
  }))

  return {
    datasetId: `device-${limited.length}-${hashIds(limited.map(t => t.id))}`,
    name: `${label} (${limited.length})`,
    description:
      'Real tracks chosen by hand on the device. Never populated automatically, '
      + 'and capped at ' + MAX_DATASET_SAMPLES + ' samples.',
    samples,
  }
}

/** Short stable digest of the selection, so the dataset id is reproducible. */
function hashIds(ids: string[]): string {
  let hash = 2166136261
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(16).slice(0, 8)
}

/**
 * Dataset validation, enforced before any run starts.
 *
 * The size cap is checked here as well as at construction, because
 * this is the last gate before the runner and a future caller might
 * build a dataset object directly.
 */
export function validateDataset(dataset: BenchmarkDataset): string[] {
  const problems: string[] = []

  if (dataset.samples.length === 0) {
    problems.push('dataset is empty')
  }
  if (dataset.samples.length > MAX_DATASET_SAMPLES) {
    problems.push(
      `dataset has ${dataset.samples.length} samples, exceeding the hard cap of `
      + `${MAX_DATASET_SAMPLES}. Phase 14 must never benchmark the whole library.`,
    )
  }

  const seen = new Set<string>()
  for (const sample of dataset.samples) {
    if (seen.has(sample.sampleId)) problems.push(`duplicate sampleId: ${sample.sampleId}`)
    seen.add(sample.sampleId)
    if (sample.durationSec < 0) problems.push(`${sample.sampleId}: negative duration`)
  }

  return problems
}
