/**
 * SYSTEMA — MTG-Jamendo / Discogs-EffNet label taxonomies (Phase 29).
 *
 * EVERY LABEL HERE WAS COPIED FROM THE OFFICIAL MODEL METADATA.
 * Sources (read during Phase 29):
 *   · essentia.upf.edu/models/classification-heads/mtg_jamendo_moodtheme/
 *       mtg_jamendo_moodtheme-discogs-effnet-1.json
 *   · essentia.upf.edu/models/classification-heads/voice_instrumental/
 *       voice_instrumental-discogs-effnet-1.json
 *   · essentia.upf.edu/models.html  (genre class list)
 *
 * ORDER IS PART OF THE CONTRACT, NOT A STYLE CHOICE.
 * The model emits a bare float array. Index i of that array means
 * class i of this list and nothing else. Re-sorting these arrays
 * alphabetically, deduplicating them, or "tidying" them would silently
 * re-map every prediction — the model would keep working and every
 * label would be wrong. Do not touch the order.
 *
 * WHY THE LABELS ARE NOT TRANSLATED OR REMAPPED
 * ---------------------------------------------
 * The mood/theme vocabulary is not a clean emotion taxonomy: it mixes
 * moods (`sad`, `happy`), production themes (`advertising`,
 * `corporate`, `trailer`), settings (`christmas`, `summer`) and tempo
 * words (`fast`, `slow`). Collapsing that onto SYSTEMA's own six-value
 * mood list would destroy information and invent equivalences nobody
 * validated. The model's own labels are stored verbatim; any mapping to
 * human label vocabulary is a separate, documented, reviewable step.
 */

import type { SemanticActivation, SemanticField } from '../types'

export interface HeadTaxonomy {
  field: SemanticField
  /** Head model id, matching the published model file name. */
  head: string
  headVersion: string
  activation: SemanticActivation
  multiLabel: boolean
  /**
   * Class labels IN MODEL OUTPUT ORDER.
   *
   * Empty when the official list could not be retrieved — see
   * `labelsUnavailable`.
   */
  labels: readonly string[]
  /**
   * True when the official class list was not obtainable, so this head
   * must not be run. Guessing label names would attach real scores to
   * invented vocabulary, which is worse than having no head at all.
   */
  labelsUnavailable?: true
  /** Published evaluation figures, for honest UI display. */
  metrics: Readonly<Record<string, number>> | null
}

/**
 * Mood and theme — the primary target of this phase.
 *
 * 56 classes, independent sigmoids, so several may be high at once.
 *
 * PUBLISHED TEST PR-AUC IS 0.14 (ROC-AUC 0.76). That is well above
 * chance for 56-way multi-label, and still weak. Expect individual
 * predictions to be wrong often. The number is surfaced in the UI
 * rather than hidden, because a user comparing a prediction against
 * their own judgement deserves to know the model's own scorecard.
 */
export const MOODTHEME_TAXONOMY: HeadTaxonomy = {
  field: 'mood',
  head: 'mtg_jamendo_moodtheme-discogs-effnet',
  headVersion: '1',
  activation: 'sigmoid',
  multiLabel: true,
  metrics: { testPrAuc: 0.14, testRocAuc: 0.76 },
  labels: [
    'action', 'adventure', 'advertising', 'background', 'ballad', 'calm',
    'children', 'christmas', 'commercial', 'cool', 'corporate', 'dark',
    'deep', 'documentary', 'drama', 'dramatic', 'dream', 'emotional',
    'energetic', 'epic', 'fast', 'film', 'fun', 'funny', 'game', 'groovy',
    'happy', 'heavy', 'holiday', 'hopeful', 'inspiring', 'love',
    'meditative', 'melancholic', 'melodic', 'motivational', 'movie',
    'nature', 'party', 'positive', 'powerful', 'relaxing', 'retro',
    'romantic', 'sad', 'sexy', 'slow', 'soft', 'soundscape', 'space',
    'sport', 'summer', 'trailer', 'travel', 'upbeat', 'uplifting',
  ],
} as const

/**
 * Voice / instrumental.
 *
 * SOFTMAX over two mutually exclusive classes, unlike every other head
 * here. INDEX 0 IS `instrumental`, INDEX 1 IS `voice` — that is the
 * published order and reversing it would invert every prediction while
 * looking perfectly plausible.
 *
 * Reported 5-fold CV normalised accuracy 0.96, but on a small in-house
 * set of 1000 excerpts.
 */
export const VOICE_INSTRUMENTAL_TAXONOMY: HeadTaxonomy = {
  field: 'vocalInstrumental',
  head: 'voice_instrumental-discogs-effnet',
  headVersion: '2',
  activation: 'softmax',
  multiLabel: false,
  metrics: { crossValAccuracy: 0.96 },
  labels: ['instrumental', 'voice'],
} as const

/** Genre — 87 classes, multi-label sigmoid. */
export const GENRE_TAXONOMY: HeadTaxonomy = {
  field: 'genre',
  head: 'mtg_jamendo_genre-discogs-effnet',
  headVersion: '1',
  activation: 'sigmoid',
  multiLabel: true,
  metrics: null,
  labels: [
    '60s', '70s', '80s', '90s', 'acidjazz', 'alternative', 'alternativerock',
    'ambient', 'atmospheric', 'blues', 'bluesrock', 'bossanova', 'breakbeat',
    'celtic', 'chanson', 'chillout', 'choir', 'classical', 'classicrock',
    'club', 'contemporary', 'country', 'dance', 'darkambient', 'darkwave',
    'deephouse', 'disco', 'downtempo', 'drumnbass', 'dub', 'dubstep',
    'easylistening', 'edm', 'electronic', 'electronica', 'electropop',
    'ethno', 'eurodance', 'experimental', 'folk', 'funk', 'fusion', 'groove',
    'grunge', 'hard', 'hardrock', 'hiphop', 'house', 'idm', 'improvisation',
    'indie', 'industrial', 'instrumentalpop', 'instrumentalrock', 'jazz',
    'jazzfusion', 'latin', 'lounge', 'medieval', 'metal', 'minimal', 'newage',
    'newwave', 'orchestral', 'pop', 'popfolk', 'poprock', 'postrock',
    'progressive', 'psychedelic', 'punkrock', 'rap', 'reggae', 'rnb', 'rock',
    'rocknroll', 'singersongwriter', 'soul', 'soundtrack', 'swing',
    'symphonic', 'synthpop', 'techno', 'trance', 'triphop', 'world',
    'worldfusion',
  ],
} as const

/**
 * Top-50 tags — DECLARED BUT DELIBERATELY UNUSABLE.
 *
 * The head exists and has 50 classes, but its official class list could
 * not be retrieved in this environment. Fifty plausible tag strings
 * would be easy to write and would be fabricated vocabulary attached to
 * real scores — indistinguishable from correct output in the UI and
 * poisonous to any later evaluation.
 *
 * So it stays empty and flagged. The provider refuses to run it.
 */
export const TOP50TAGS_TAXONOMY: HeadTaxonomy = {
  field: 'tags',
  head: 'mtg_jamendo_top50tags-discogs-effnet',
  headVersion: '1',
  activation: 'sigmoid',
  multiLabel: true,
  metrics: null,
  labels: [],
  labelsUnavailable: true,
} as const

/**
 * The shared embedding model every head above consumes.
 *
 * Heads take a 1280-d vector, NOT audio. This is the only component
 * that touches the waveform.
 */
export const EMBEDDING_MODEL = {
  id: 'discogs-effnet-bs64',
  version: '1',
  /** Mono, 16 kHz. Not 44.1 kHz, and not CLAP's 48 kHz. */
  sampleRate: 16000,
  /** [batch, frames, melBands] — the model's declared input shape. */
  inputShape: [64, 128, 96] as const,
  batchSize: 64,
  melBands: 96,
  patchFrames: 128,
  embeddingDim: 1280,
  /** ONNX is published for this model; the heads must be converted. */
  onnxPublished: true,
} as const

export const ALL_TAXONOMIES: readonly HeadTaxonomy[] = [
  MOODTHEME_TAXONOMY,
  GENRE_TAXONOMY,
  VOICE_INSTRUMENTAL_TAXONOMY,
  TOP50TAGS_TAXONOMY,
] as const

/** Heads that have a usable label list. */
export function usableTaxonomies(): HeadTaxonomy[] {
  return ALL_TAXONOMIES.filter(t => !t.labelsUnavailable && t.labels.length > 0)
}

/**
 * Licensing, carried in code rather than only in docs.
 *
 * CC BY-NC-SA 4.0 means these weights cannot ship in a commercial
 * closed-source product. Fine for personal and research use, which is
 * what this phase is. MTG offer a commercial licence on request.
 */
export const MODEL_LICENSE = {
  spdx: 'CC-BY-NC-SA-4.0',
  commercialUseAllowed: false,
  attribution: 'Music Technology Group, Universitat Pompeu Fabra',
  note: 'MTG models are CC BY-NC-SA 4.0; a proprietary licence is '
    + 'available from MTG on request. Non-commercial research use only.',
} as const

/**
 * Zips a raw model output array onto its label list.
 *
 * Returns null on ANY length mismatch. That is the whole reason this
 * function exists: silently zipping 56 scores onto 87 labels would
 * produce real numbers with wrong names, which no downstream check
 * could detect.
 */
export function zipPredictions(
  taxonomy: HeadTaxonomy,
  raw: readonly number[],
): { label: string, score: number }[] | null {
  if (taxonomy.labelsUnavailable) return null
  if (taxonomy.labels.length === 0) return null
  if (raw.length !== taxonomy.labels.length) return null
  if (!raw.every(Number.isFinite)) return null

  return taxonomy.labels.map((label, i) => ({ label, score: raw[i] as number }))
}
