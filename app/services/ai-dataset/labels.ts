/**
 * SYSTEMA — ground-truth label vocabulary (Phase 28).
 *
 * These are HUMAN labels. Nothing in this file is produced by CLAP, by
 * the DSP analyser, or by any heuristic. A value only ever appears in a
 * record because a person selected it in the labeling UI.
 *
 * That separation is the whole point of the dataset: if labels could be
 * derived from the measurements, training a classifier on them would
 * just be relearning the derivation. BPM must never become "energetic",
 * and an embedding must never become "fa".
 *
 * Extensibility
 * -------------
 * Genre is deliberately NOT a closed database enum. The vocabularies
 * here are the *suggested* values the UI offers; the storage layer
 * accepts any non-empty string so a new genre does not require a schema
 * migration. `isKnownGenre` exists to flag values outside the initial
 * set for review, not to reject them.
 */

// ---------------------------------------------------------------------
// Language — single value per track.
// ---------------------------------------------------------------------

export const LANGUAGE_VALUES = [
  'fa',
  'en',
  'ar',
  'tr',
  'other',
  'instrumental',
  'unknown',
] as const

export type LanguageLabel = (typeof LANGUAGE_VALUES)[number]

/** Display names. Kept out of the vocabulary so storage stays stable. */
export const LANGUAGE_DISPLAY: Record<LanguageLabel, string> = {
  fa: 'FA',
  en: 'EN',
  ar: 'AR',
  tr: 'TR',
  other: 'OTHER',
  instrumental: 'INSTRUMENTAL',
  unknown: 'UNKNOWN',
}

// ---------------------------------------------------------------------
// Genre — multi-label, open vocabulary.
// ---------------------------------------------------------------------

export const GENRE_SUGGESTIONS = [
  'pop',
  'rock',
  'hiphop',
  'rap',
  'electronic',
  'classical',
  'jazz',
  'blues',
  'folk',
  'traditional',
  'metal',
  'indie',
  'soundtrack',
  'other',
  'unknown',
] as const

export type GenreSuggestion = (typeof GENRE_SUGGESTIONS)[number]

/**
 * Whether a genre is one of the initial suggestions.
 *
 * A `false` result is NOT an error. It means the value came from
 * somewhere else and should be reviewed before training, which the
 * quality report surfaces.
 */
export function isKnownGenre(value: string): boolean {
  return (GENRE_SUGGESTIONS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------
// Mood — controlled multi-label.
// ---------------------------------------------------------------------

export const MOOD_VALUES = [
  'happy',
  'sad',
  'calm',
  'energetic',
  'melancholic',
  'romantic',
  'angry',
  'dark',
  'uplifting',
  'nostalgic',
  'neutral',
  'unknown',
] as const

export type MoodLabel = (typeof MOOD_VALUES)[number]

// ---------------------------------------------------------------------
// Vocal — single value.
// ---------------------------------------------------------------------

export const VOCAL_VALUES = ['vocal', 'instrumental', 'mixed', 'unknown'] as const
export type VocalLabel = (typeof VOCAL_VALUES)[number]

// ---------------------------------------------------------------------
// Energy — single value, PERCEIVED, not measured.
// ---------------------------------------------------------------------

/**
 * Perceived energy as judged by a human listener.
 *
 * Deliberately NOT computed from RMS, loudness or BPM. A quiet track
 * can feel intense and a loud one can feel flat; if this were derived
 * from amplitude it would be a second copy of `loudnessDbfs` wearing a
 * different name, and useless as a training target.
 */
export const ENERGY_VALUES = ['very_low', 'low', 'medium', 'high', 'very_high', 'unknown'] as const
export type EnergyLabel = (typeof ENERGY_VALUES)[number]

export const ENERGY_DISPLAY: Record<EnergyLabel, string> = {
  very_low: 'VERY LOW',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  very_high: 'VERY HIGH',
  unknown: 'UNKNOWN',
}

// ---------------------------------------------------------------------
// Context suitability — multi-label.
// ---------------------------------------------------------------------

export const CONTEXT_VALUES = [
  'driving',
  'workout',
  'study',
  'relaxing',
  'party',
  'sleep',
  'focus',
  'walking',
  'unknown',
] as const

export type ContextLabel = (typeof CONTEXT_VALUES)[number]

// ---------------------------------------------------------------------
// The label set
// ---------------------------------------------------------------------

/**
 * One track's manually assigned ground truth.
 *
 * `source` is fixed to 'human' by the type system. There is no
 * 'model' or 'inferred' variant, because a predicted value must never
 * be storable in this structure — a future classifier's output belongs
 * in a separate predictions table so the two can never be confused
 * when building a training set.
 */
export interface GroundTruthLabels {
  language: LanguageLabel | null
  genres: string[]
  moods: MoodLabel[]
  vocal: VocalLabel | null
  energy: EnergyLabel | null
  contexts: ContextLabel[]

  /** Always 'human'. Present so exports are self-describing. */
  source: 'human'
  /** Free-text reviewer note. */
  notes: string | null
  /** ISO timestamp of the last manual edit. */
  labelledAt: string | null
  /** Bumped on every manual save; lets later edits win deterministically. */
  revision: number
}

/** An empty label set: everything unknown, nothing invented. */
export function emptyLabels(): GroundTruthLabels {
  return {
    language: null,
    genres: [],
    moods: [],
    vocal: null,
    energy: null,
    contexts: [],
    source: 'human',
    notes: null,
    labelledAt: null,
    revision: 0,
  }
}

/** True when a human has supplied at least one label. */
export function hasAnyLabel(l: GroundTruthLabels | null | undefined): boolean {
  if (!l) return false
  return (
    (l.language !== null && l.language !== 'unknown')
    || l.genres.length > 0
    || l.moods.length > 0
    || (l.vocal !== null && l.vocal !== 'unknown')
    || (l.energy !== null && l.energy !== 'unknown')
    || l.contexts.length > 0
  )
}

const LANG_SET = new Set<string>(LANGUAGE_VALUES)
const MOOD_SET = new Set<string>(MOOD_VALUES)
const VOCAL_SET = new Set<string>(VOCAL_VALUES)
const ENERGY_SET = new Set<string>(ENERGY_VALUES)
const CONTEXT_SET = new Set<string>(CONTEXT_VALUES)

function cleanList(input: unknown, allowed: Set<string> | null): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const v = raw.trim().toLowerCase()
    if (!v) continue
    if (allowed && !allowed.has(v)) continue
    if (!out.includes(v)) out.push(v)
  }
  return out
}

/**
 * Coerces untrusted input into a valid label set.
 *
 * Used on the storage boundary. Unrecognised values are DROPPED rather
 * than coerced to a neighbour: silently turning a typo into 'happy'
 * would fabricate a label, which is the one thing this must not do.
 */
export function sanitiseLabels(input: unknown): GroundTruthLabels {
  const base = emptyLabels()
  if (!input || typeof input !== 'object') return base
  const o = input as Record<string, unknown>

  const lang = typeof o.language === 'string' ? o.language.trim().toLowerCase() : null
  if (lang && LANG_SET.has(lang)) base.language = lang as LanguageLabel

  // Genres use an OPEN vocabulary — no allow-list filtering.
  base.genres = cleanList(o.genres, null)
  base.moods = cleanList(o.moods, MOOD_SET) as MoodLabel[]

  const vocal = typeof o.vocal === 'string' ? o.vocal.trim().toLowerCase() : null
  if (vocal && VOCAL_SET.has(vocal)) base.vocal = vocal as VocalLabel

  const energy = typeof o.energy === 'string' ? o.energy.trim().toLowerCase() : null
  if (energy && ENERGY_SET.has(energy)) base.energy = energy as EnergyLabel

  base.contexts = cleanList(o.contexts, CONTEXT_SET) as ContextLabel[]

  base.notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null
  base.labelledAt = typeof o.labelledAt === 'string' ? o.labelledAt : null
  base.revision = typeof o.revision === 'number' && Number.isFinite(o.revision) && o.revision >= 0
    ? Math.floor(o.revision)
    : 0

  return base
}

/** Structural comparison, used to drive the unsaved/saved/modified badge. */
export function labelsEqual(a: GroundTruthLabels, b: GroundTruthLabels): boolean {
  const sameList = (x: string[], y: string[]) =>
    x.length === y.length && [...x].sort().every((v, i) => v === [...y].sort()[i])

  return (
    a.language === b.language
    && a.vocal === b.vocal
    && a.energy === b.energy
    && a.notes === b.notes
    && sameList(a.genres, b.genres)
    && sameList(a.moods, b.moods)
    && sameList(a.contexts, b.contexts)
  )
}
