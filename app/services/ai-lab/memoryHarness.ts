/**
 * Phase 20 §5–§6 — memory investigation harness.
 *
 * This module defines the A–G test matrix, the attribution rules, and
 * the PASS / WARNING / BLOCKER / INCONCLUSIVE classifier. It computes
 * verdicts from REAL samples supplied by the native layer.
 *
 * It deliberately contains no fallback that manufactures a number. A
 * test with no measurement stays NOT_MEASURED forever. That is the
 * whole point: a memory verdict invented on a desktop would be worse
 * than no verdict at all, because it would look like evidence.
 *
 * The native side already exposes what is needed:
 *   - `MemorySample` (MemoryProbe.kt) separates totalPss / nativeHeap /
 *     javaHeap / javaUsed, which is what lets §6 distinguish allocator
 *     retention from an actual leak.
 *   - `runMemoryLifecycle` (InferenceBenchmark.kt) already performs
 *     repeated load -> infer -> unload cycles with a synthetic probe
 *     buffer, which covers tests E and F.
 */

export type MemoryTestId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type MemoryStatus =
  | 'PASS'
  | 'WARNING'
  | 'BLOCKER'
  | 'INCONCLUSIVE'
  | 'NOT_MEASURED'

/** Where retained memory is attributed. */
export type MemoryComponent =
  | 'MODEL_LOAD'
  | 'ORT_SESSION'
  | 'AUDIO_DECODE'
  | 'TENSOR_BUFFERS'
  | 'RESAMPLING'
  | 'PREPROCESSING'
  | 'AGGREGATION'
  | 'JNI_BUFFERS'
  | 'UNATTRIBUTED'

export interface MemoryTestSpec {
  id: MemoryTestId
  name: string
  /** Tracks decoded and embedded. 0 = no audio touched at all. */
  trackCount: number
  /** How many times the whole session is set up and torn down. */
  sessions: number
  /** Loads the model? */
  loadsModel: boolean
  /** Decodes real audio? */
  decodesAudio: boolean
  /** What this row is designed to isolate. */
  isolates: string
  /** Which components can legitimately explain retention in this row. */
  candidateComponents: MemoryComponent[]
}

/**
 * The A–G matrix.
 *
 * The design is subtractive: C minus G is decode+preprocess cost, G is
 * model+runtime cost alone, and F is whether either of them is
 * actually released. A single "run everything" test cannot separate
 * those, which is why the brief asks for seven rows and not one.
 */
export const MEMORY_TESTS: MemoryTestSpec[] = [
  {
    id: 'A',
    name: '1 track',
    trackCount: 1,
    sessions: 1,
    loadsModel: true,
    decodesAudio: true,
    isolates: 'Fixed cost of one end-to-end embedding.',
    candidateComponents: [
      'MODEL_LOAD', 'ORT_SESSION', 'AUDIO_DECODE', 'TENSOR_BUFFERS',
      'RESAMPLING', 'PREPROCESSING', 'AGGREGATION', 'JNI_BUFFERS',
    ],
  },
  {
    id: 'B',
    name: '5 tracks',
    trackCount: 5,
    sessions: 1,
    loadsModel: true,
    decodesAudio: true,
    isolates: 'Whether cost grows per track or is amortised.',
    candidateComponents: ['AUDIO_DECODE', 'TENSOR_BUFFERS', 'PREPROCESSING', 'JNI_BUFFERS'],
  },
  {
    id: 'C',
    name: '10 tracks',
    trackCount: 10,
    sessions: 1,
    loadsModel: true,
    decodesAudio: true,
    isolates: 'Linearity of per-track growth at mid scale.',
    candidateComponents: ['AUDIO_DECODE', 'TENSOR_BUFFERS', 'PREPROCESSING', 'JNI_BUFFERS'],
  },
  {
    id: 'D',
    name: '20 tracks',
    trackCount: 20,
    sessions: 1,
    loadsModel: true,
    decodesAudio: true,
    isolates: 'Full labelling-set scale — the configuration users hit.',
    candidateComponents: [
      'AUDIO_DECODE', 'TENSOR_BUFFERS', 'PREPROCESSING', 'AGGREGATION', 'JNI_BUFFERS',
    ],
  },
  {
    id: 'E',
    name: 'Repeated sessions (same size)',
    trackCount: 5,
    sessions: 5,
    loadsModel: true,
    decodesAudio: true,
    isolates:
      'Whether each run starts from the previous run\'s ceiling. This is '
      + 'the only row that can demonstrate an unbounded leak as opposed '
      + 'to a large one-off cost.',
    candidateComponents: ['ORT_SESSION', 'JNI_BUFFERS', 'TENSOR_BUFFERS', 'UNATTRIBUTED'],
  },
  {
    id: 'F',
    name: 'Model load/unload only (no audio)',
    trackCount: 0,
    sessions: 5,
    loadsModel: true,
    decodesAudio: false,
    isolates:
      'Model + ORT session cost with the entire audio path excluded. '
      + 'Covered by the existing runMemoryLifecycle, which uses a '
      + 'synthetic probe buffer rather than a decoded file.',
    candidateComponents: ['MODEL_LOAD', 'ORT_SESSION', 'JNI_BUFFERS'],
  },
  {
    id: 'G',
    name: 'Audio decode only (no model)',
    trackCount: 20,
    sessions: 1,
    loadsModel: false,
    decodesAudio: true,
    isolates:
      'Decode + resample + mel cost with inference excluded. Subtracting '
      + 'G from D is what attributes the remainder to the model.',
    candidateComponents: ['AUDIO_DECODE', 'RESAMPLING', 'PREPROCESSING'],
  },
]

/** One real measurement. All figures in MB, all from the device. */
export interface MemoryMeasurement {
  testId: MemoryTestId
  baselinePssMb: number
  peakPssMb: number
  postCleanupPssMb: number
  /** Native (malloc) heap, where ORT allocates. Optional but decisive. */
  baselineNativeHeapMb?: number
  postCleanupNativeHeapMb?: number
  /** Java/ART heap. Recorded to demonstrate the model is NOT there. */
  baselineJavaHeapMb?: number
  postCleanupJavaHeapMb?: number
  /** True only if a real run on real hardware produced this row. */
  deviceVerified: boolean
}

export interface MemoryTestResult {
  spec: MemoryTestSpec
  status: MemoryStatus
  baselinePssMb: number | null
  peakPssMb: number | null
  postCleanupPssMb: number | null
  retainedMb: number | null
  retainedPerTrackMb: number | null
  attribution: MemoryComponent[]
  /** Plain-language reason. Always populated, including when unmeasured. */
  note: string
}

/**
 * Retention thresholds, in MB.
 *
 * These are judgement calls and are stated openly rather than buried:
 * a few MB is allocator noise on any Android device, tens of MB is
 * worth a warning, and hundreds of MB retained after cleanup is not
 * survivable on a mid-range phone.
 */
export const RETAINED_PASS_MB = 8
export const RETAINED_WARNING_MB = 64

/**
 * Classifies ONE row.
 *
 * PSS alone cannot prove a leak. A high retained PSS is consistent
 * with (a) a genuine leak, (b) an allocator that has not returned
 * freed pages to the OS, and (c) file-backed pages of the model still
 * counted against the process. This function therefore only escalates
 * to BLOCKER when the native heap corroborates the PSS figure, and
 * otherwise says INCONCLUSIVE and explains what extra evidence would
 * settle it.
 */
export function classifyMeasurement(
  spec: MemoryTestSpec,
  m: MemoryMeasurement | undefined,
): MemoryTestResult {
  if (!m) {
    return {
      spec,
      status: 'NOT_MEASURED',
      baselinePssMb: null,
      peakPssMb: null,
      postCleanupPssMb: null,
      retainedMb: null,
      retainedPerTrackMb: null,
      attribution: [],
      note: 'NOT MEASURED — ENVIRONMENT BLOCKED. No device run supplied this row.',
    }
  }

  if (!m.deviceVerified) {
    return {
      spec,
      status: 'NOT_MEASURED',
      baselinePssMb: m.baselinePssMb,
      peakPssMb: m.peakPssMb,
      postCleanupPssMb: m.postCleanupPssMb,
      retainedMb: null,
      retainedPerTrackMb: null,
      attribution: [],
      note:
        'REJECTED — the row carries numbers but is not marked device-verified. '
        + 'Unverified figures are not promoted to a verdict.',
    }
  }

  const retained = m.postCleanupPssMb - m.baselinePssMb
  const perTrack = spec.trackCount > 0 ? retained / spec.trackCount : null

  const nativeRetained
    = m.postCleanupNativeHeapMb !== undefined && m.baselineNativeHeapMb !== undefined
      ? m.postCleanupNativeHeapMb - m.baselineNativeHeapMb
      : null

  let status: MemoryStatus
  let note: string

  if (retained <= RETAINED_PASS_MB) {
    status = 'PASS'
    note = `Retained ${retained.toFixed(1)} MB after cleanup — within allocator noise.`
  }
  else if (nativeRetained === null) {
    // Only PSS available. Say so instead of guessing.
    status = 'INCONCLUSIVE'
    note
      = `Retained ${retained.toFixed(1)} MB of PSS, but native-heap samples were not `
      + 'captured. PSS alone cannot separate allocator retention from a leak. '
      + 'Re-run capturing nativeHeapKb at baseline and after cleanup.'
  }
  else if (nativeRetained <= RETAINED_PASS_MB) {
    // PSS is up but malloc is not: the allocator is holding pages.
    status = 'WARNING'
    note
      = `Retained ${retained.toFixed(1)} MB of PSS while native heap returned to `
      + `${nativeRetained.toFixed(1)} MB. Consistent with allocator page retention, `
      + 'not with a leak. Memory is accounted for but not returned to the OS.'
  }
  else if (retained <= RETAINED_WARNING_MB) {
    status = 'WARNING'
    note
      = `Retained ${retained.toFixed(1)} MB PSS / ${nativeRetained.toFixed(1)} MB native. `
      + 'Real but bounded retention.'
  }
  else {
    status = 'BLOCKER'
    note
      = `Retained ${retained.toFixed(1)} MB PSS corroborated by `
      + `${nativeRetained.toFixed(1)} MB native heap. Native allocations are not being `
      + 'freed. This is a leak, not allocator behaviour.'
  }

  return {
    spec,
    status,
    baselinePssMb: m.baselinePssMb,
    peakPssMb: m.peakPssMb,
    postCleanupPssMb: m.postCleanupPssMb,
    retainedMb: retained,
    retainedPerTrackMb: perTrack,
    attribution: status === 'PASS' ? [] : spec.candidateComponents,
    note,
  }
}

/**
 * Attributes retention across components by SUBTRACTION between rows,
 * which is the only honest way to do it without a native allocator
 * profiler.
 *
 * Returns null for any component whose defining rows were not measured
 * rather than distributing an unexplained remainder, because spreading
 * an unknown across named components invents precision.
 */
export function attributeRetention(results: MemoryTestResult[]): {
  modelAndRuntimeMb: number | null
  audioPathMb: number | null
  perTrackMb: number | null
  unattributedMb: number | null
  note: string
} {
  const by = (id: MemoryTestId) => results.find(r => r.spec.id === id)
  const d = by('D')
  const f = by('F')
  const g = by('G')

  const full = d?.retainedMb ?? null
  const modelOnly = f?.retainedMb ?? null
  const audioOnly = g?.retainedMb ?? null

  const notes: string[] = []
  if (full === null) notes.push('Test D (20 tracks) not measured.')
  if (modelOnly === null) notes.push('Test F (model only) not measured.')
  if (audioOnly === null) notes.push('Test G (audio only) not measured.')

  const unattributed
    = full !== null && modelOnly !== null && audioOnly !== null
      ? full - modelOnly - audioOnly
      : null

  const perTrack
    = audioOnly !== null && g && g.spec.trackCount > 0
      ? audioOnly / g.spec.trackCount
      : null

  if (unattributed !== null && Math.abs(unattributed) > RETAINED_WARNING_MB) {
    notes.push(
      `${unattributed.toFixed(1)} MB is not explained by the model path or the audio `
      + 'path alone. Likely aggregation buffers or JNI copies held across the run.',
    )
  }

  return {
    modelAndRuntimeMb: modelOnly,
    audioPathMb: audioOnly,
    perTrackMb: perTrack,
    unattributedMb: unattributed,
    note: notes.length ? notes.join(' ') : 'All subtraction rows measured.',
  }
}

/**
 * Overall §6 verdict. The worst row wins, and an unmeasured matrix is
 * never reported as healthy.
 */
export function classifyMemoryRun(results: MemoryTestResult[]): {
  status: MemoryStatus
  note: string
} {
  if (results.length === 0 || results.every(r => r.status === 'NOT_MEASURED')) {
    return {
      status: 'NOT_MEASURED',
      note:
        'NOT MEASURED — ENVIRONMENT BLOCKED. No test in the A–G matrix produced a '
        + 'device-verified measurement.',
    }
  }

  const measured = results.filter(r => r.status !== 'NOT_MEASURED')
  const missing = results.filter(r => r.status === 'NOT_MEASURED')

  const worst: MemoryStatus = results.some(r => r.status === 'BLOCKER')
    ? 'BLOCKER'
    : results.some(r => r.status === 'INCONCLUSIVE')
      ? 'INCONCLUSIVE'
      : results.some(r => r.status === 'WARNING')
        ? 'WARNING'
        : 'PASS'

  // A partial matrix cannot yield a clean pass: F and G are exactly the
  // rows that would attribute the cost.
  if (worst === 'PASS' && missing.length > 0) {
    return {
      status: 'INCONCLUSIVE',
      note:
        `${measured.length} of ${results.length} tests passed, but `
        + `${missing.map(r => r.spec.id).join(', ')} were not measured. `
        + 'Attribution requires the full matrix.',
    }
  }

  return {
    status: worst,
    note:
      `${measured.length} of ${results.length} tests measured. `
      + `Worst observed status: ${worst}.`,
  }
}

/** Builds the full A–G result table from whatever real rows exist. */
export function runHarness(measurements: MemoryMeasurement[] = []): {
  results: MemoryTestResult[]
  attribution: ReturnType<typeof attributeRetention>
  verdict: ReturnType<typeof classifyMemoryRun>
} {
  const results = MEMORY_TESTS.map(spec =>
    classifyMeasurement(spec, measurements.find(m => m.testId === spec.id)),
  )
  return {
    results,
    attribution: attributeRetention(results),
    verdict: classifyMemoryRun(results),
  }
}
