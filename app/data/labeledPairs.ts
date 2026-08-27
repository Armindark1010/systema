/**
 * Phase 18 — the human-labelled evaluation set.
 *
 * READ THIS BEFORE TRUSTING ANY NUMBER THIS FILE PRODUCES
 * ------------------------------------------------------
 * A label here is a HUMAN judgement about a pair of tracks. It must be
 * made before the cosine for that pair is looked at, and nothing in
 * the app may change it afterwards. That ordering is the entire basis
 * of the evaluation: if labels move to fit the measurement, the
 * measurement proves nothing.
 *
 * WHAT IS AND IS NOT PRE-FILLED
 * -----------------------------
 * Exactly ONE pair is pre-filled: the two copies of "maste Cheshmat",
 * which are the same recording and therefore SAME by the definition
 * below. That is a file-identity claim, not a musical judgement, and
 * it is stated here so it can be checked and removed.
 *
 * Every other pair starts UNLABELLED. They are deliberately NOT
 * guessed from artist, album, genre or filename: doing so would
 * measure how tidy the metadata is and then report it as a claim
 * about the embedding. Those are different things, and conflating
 * them is the specific failure this phase exists to avoid.
 *
 * So: with only the seeded pair, the evaluation has one SAME pair and
 * nothing else, and it will correctly report INSUFFICIENT_DATA. To get
 * a real result, a person labels pairs in the UI.
 */

export type PairLabel = 'SAME' | 'SIMILAR' | 'DIFFERENT'
export type LabelSource = 'HUMAN' | 'FIXTURE'

/** Label definitions, shown in the UI so the judgement stays consistent. */
export const LABEL_DEFINITIONS: Record<PairLabel, string> = {
  SAME:
    'The same recording — including a different file, bitrate or encode '
    + 'of it. Two rips of one song are SAME.',
  SIMILAR:
    'Different recordings you would accept as musically related for search '
    + 'or recommendation: style, mood, instrumentation, era, vocal '
    + 'character. No genre taxonomy required.',
  DIFFERENT:
    'Musically far enough apart that a recommender should normally rank '
    + 'them away from each other.',
}

export const LABEL_ORDER: PairLabel[] = ['SAME', 'SIMILAR', 'DIFFERENT']

/**
 * The 13 tracks from the Phase 17 run, in their original order.
 *
 * Index order matters: pair keys are "i:j" against this list, so
 * reordering it would silently repoint every existing label.
 */
export const PHASE_17_TRACKS: readonly string[] = [
  'maste Cheshmat [ GisoMusic.com ] — version A',
  'moien - kabe (dj imi x dj ali zeylloos remix)',
  'maste Cheshmat [ GisoMusic.com ] — version B',
  'To Make Eshghio Man',
  '01 Shame Mahtab',
  'Chakavak [ GisoMusic.com ]',
  'Sayyad',
  'Gharibe ~ Music-Fa.Com',
  'Gholab موزیکدل',
  'Ki Ashkato Pak Mikone [ GisoMusic.com ]',
  'Game Of Thrones ~ UpMusic',
  'Bi Taabi',
  'Gol Lale Abbasi موزیکدل',
] as const

/** Canonical key for a pair. Always low index first, so (i,j) == (j,i). */
export function pairKey(a: number, b: number): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`
}

/** Every distinct off-diagonal pair, in stable order. 13 tracks -> 78. */
export function allPairs(trackCount: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < trackCount; i++) {
    for (let j = i + 1; j < trackCount; j++) out.push([i, j])
  }
  return out
}

export interface SeededLabel {
  readonly key: string
  readonly label: PairLabel
  readonly source: LabelSource
  /** Why this pair is pre-filled. Displayed in the UI, not a comment. */
  readonly justification: string
}

/**
 * The ONLY pre-filled labels.
 *
 * Index 0 and index 2 are two copies of the same recording. Phase 17
 * measured cosine 1.00 between them — but note the direction: the
 * label rests on them being the same file content, which was known
 * before the run, NOT on the measurement agreeing.
 */
export const SEEDED_LABELS: readonly SeededLabel[] = [
  {
    key: '0:2',
    label: 'SAME',
    source: 'FIXTURE',
    justification:
      'Track 1 and track 3 are two copies of the recording "maste '
      + 'Cheshmat". Same song identity, different file/version — SAME by '
      + 'definition. This is a file-identity claim, not a musical '
      + 'judgement, and it was true before any cosine was computed.',
  },
] as const

/**
 * Builds the starting label map.
 *
 * Only the seeded entries appear. Every other pair is absent, and an
 * absent pair is UNLABELLED — it is not scored and contributes to no
 * statistic. There is no default label anywhere in this file.
 */
export function seededLabelMap(): Record<string, { label: PairLabel, source: LabelSource }> {
  const out: Record<string, { label: PairLabel, source: LabelSource }> = {}
  for (const s of SEEDED_LABELS) out[s.key] = { label: s.label, source: s.source }
  return out
}

/**
 * How many pairs each class needs before its statistics mean anything.
 * Mirrors LabeledPairEvaluation.MIN_CLASS_PAIRS in Kotlin.
 */
export const MIN_CLASS_PAIRS = 3

/**
 * Describes what is still missing before a verdict is possible.
 *
 * Deliberately blunt: the most likely outcome of a first run is
 * INSUFFICIENT_DATA, and the user should know that before waiting
 * several minutes rather than after.
 */
export function labellingReadiness(
  labels: Record<string, { label: PairLabel }>,
): { ready: boolean, counts: Record<PairLabel, number>, message: string } {
  const counts: Record<PairLabel, number> = { SAME: 0, SIMILAR: 0, DIFFERENT: 0 }
  for (const v of Object.values(labels)) counts[v.label]++

  const missing: string[] = []
  if (counts.SIMILAR < MIN_CLASS_PAIRS) {
    missing.push(`${MIN_CLASS_PAIRS - counts.SIMILAR} more SIMILAR`)
  }
  if (counts.DIFFERENT < MIN_CLASS_PAIRS) {
    missing.push(`${MIN_CLASS_PAIRS - counts.DIFFERENT} more DIFFERENT`)
  }

  if (missing.length === 0) {
    return {
      ready: true,
      counts,
      message:
        `${counts.SAME} SAME · ${counts.SIMILAR} SIMILAR · ${counts.DIFFERENT} DIFFERENT. `
        + 'Enough labelled pairs for a separation verdict.',
    }
  }

  return {
    ready: false,
    counts,
    message:
      `${counts.SAME} SAME · ${counts.SIMILAR} SIMILAR · ${counts.DIFFERENT} DIFFERENT. `
      + `The run will report INSUFFICIENT DATA: SIMILAR vs DIFFERENT is the `
      + `comparison that decides usefulness, and it needs ${missing.join(' and ')} `
      + `pair(s). You can still run it to collect cosines.`,
  }
}
