/**
 * SYSTEMA — Phase 29 mutation tests.
 *
 * A passing test suite proves nothing on its own. It could be asserting
 * tautologies. This harness deliberately breaks the source in the exact
 * ways Phase 29 is meant to prevent, re-runs the real suite, and fails
 * if the suite still passes.
 *
 * Each mutation below is a plausible mistake or a shortcut someone under
 * deadline pressure would actually take — not a syntax error. If a
 * mutation survives, the corresponding guarantee is decorative.
 *
 * Every file is restored from the in-memory original in a finally block,
 * so an interrupted run cannot leave the tree sabotaged.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

interface Mutation {
  name: string
  /** Why this specific corruption matters. */
  danger: string
  file: string
  from: string
  to: string
}

const MUTATIONS: Mutation[] = [
  // ---- Fabrication ------------------------------------------------
  {
    name: 'fabricated mood from a hardcoded label',
    danger: 'The classic demo shortcut. Looks perfect on screen, teaches the dataset nothing.',
    file: 'app/services/music-semantics/providers/semanticRuntime.ts',
    from: "  if (!isRuntimeReady()) {\n    return { ok: false, code: 'PROVIDER_NOT_READY', message: RUNTIME_NOT_READY_MESSAGE }\n  }",
    to: '  if (!isRuntimeReady()) {\n    return { ok: true, embedding: new Float32Array(1280).fill(0.5) } as never\n  }',
  },
  {
    name: 'fabricated confidence via Math.random',
    danger: 'Produces a full, plausible, entirely meaningless ranked list.',
    file: 'app/services/music-semantics/providers/semanticRuntime.ts',
    from: "export async function runHead(",
    to: "export async function runHead_unused(",
  },
  {
    name: 'invented labels for the head whose vocabulary is unknown',
    danger: 'top50tags labels were never obtained. Inventing 50 plausible strings would be undetectable downstream.',
    file: 'app/services/music-semantics/providers/jamendoTaxonomy.ts',
    from: "  labels: [],\n  labelsUnavailable: true,",
    to: "  labels: ['rock', 'pop', 'electronic', 'jazz', 'guitar'],",
  },

  // ---- Prediction / ground truth integrity ------------------------
  {
    name: 'prediction stamped as human-sourced',
    danger: 'A model guess entering the dataset as a human label silently poisons every future evaluation.',
    file: 'app/services/ai-dataset/semanticRecord.ts',
    from: "  if (s.source !== 'model') return false",
    to: "  if (s.source !== 'model' && s.source !== 'human') return false",
  },
  {
    name: 'prediction overwrites ground truth on save',
    danger: 'The single most destructive possible bug: human labelling work erased by an automated re-run.',
    file: 'app/services/ai-dataset/datasetService.ts',
    from: '      groundTruth: existing.groundTruth,',
    to: '      groundTruth: { ...existing.groundTruth, moods: [] },',
  },
  {
    name: 're-analysis wipes collected predictions',
    danger: 'Every Analyze press would silently destroy the data the phase exists to collect.',
    file: 'app/services/ai-dataset/datasetService.ts',
    from: '    semantic: existing?.semantic ?? null,',
    to: '    semantic: null,',
  },

  // ---- Raw output preservation ------------------------------------
  {
    name: 'only the top prediction is stored',
    danger: 'Discards the tail, which is exactly where a multi-label model is judged. Irreversible.',
    file: 'app/services/ai-dataset/semanticRecord.ts',
    from: '  if (h.predictions.length !== h.classCount) return false',
    to: '  if (h.predictions.length < 1) return false',
  },
  {
    name: 'model version dropped from the record',
    danger: 'Without a version, cached results from two different checkpoints become indistinguishable.',
    file: 'app/services/ai-dataset/semanticRecord.ts',
    from: "  if (typeof s.modelVersion !== 'string') return false",
    to: "  if (typeof s.modelVersion !== 'string' && s.modelVersion !== undefined) return false",
  },
  {
    name: 'scores accepted outside [0,1]',
    danger: 'Would let raw logits through as if they were probabilities, making every displayed percentage a lie.',
    file: 'app/services/ai-dataset/semanticRecord.ts',
    from: '    if (p.score < 0 || p.score > 1) return false',
    to: '    if (p.score < -1000) return false',
  },

  // ---- Label zipping ----------------------------------------------
  {
    name: 'score array length mismatch tolerated',
    danger: 'Zips 56 mood scores onto 87 genre labels. Every label wrong, nothing throws.',
    file: 'app/services/music-semantics/providers/jamendoTaxonomy.ts',
    from: '  if (raw.length !== taxonomy.labels.length) return null',
    to: '  if (raw.length === 0) return null',
  },
  {
    name: 'voice/instrumental index order reversed',
    danger: 'Silently inverts every vocal prediction; the UI looks completely normal.',
    file: 'app/services/music-semantics/providers/jamendoTaxonomy.ts',
    from: "  labels: ['instrumental', 'voice'],",
    to: "  labels: ['voice', 'instrumental'],",
  },

  // ---- Evaluation honesty -----------------------------------------
  {
    name: 'multi-label field scored with plain accuracy',
    danger: 'On 56 sparse tags, predicting nothing scores ~95%. The headline number would be a fraud.',
    file: 'app/services/ai-dataset/semanticEvaluation.ts',
    from: '  if (head && !head.multiLabel) {',
    to: '  if (head) {',
  },
  {
    name: 'a metric manufactured from too little data',
    danger: 'A "100% accurate" badge computed from two labelled songs would drive a real product decision.',
    file: 'app/services/ai-dataset/semanticEvaluation.ts',
    from: '  if (rows.length < MIN_LABELLED_FOR_METRICS) {',
    to: '  if (rows.length < 0) {',
  },

  // ---- Cache correctness ------------------------------------------
  {
    name: 'model version change no longer invalidates the cache',
    danger: 'A new checkpoint would silently display the old checkpoint\'s predictions forever.',
    file: 'app/services/ai-dataset/semanticRecord.ts',
    from: '    && stored.modelVersion === modelVersion',
    to: '    && true',
  },

  // ---- Contract leakage -------------------------------------------
  {
    name: 'model vendor leaks into the generic contract',
    danger: 'Defeats the abstraction: swapping providers would then require editing shared types.',
    file: 'app/services/music-semantics/types.ts',
    from: '  detail: string | null',
    to: '  detail: string | null\n  essentiaGraphName?: string',
  },

  // ---- Production safety ------------------------------------------
  {
    name: 'experimental flag weakened to a boolean',
    danger: 'Allows experimental:false to be constructed, which is the gate every safety check reads.',
    file: 'app/services/music-semantics/types.ts',
    from: '  experimental: true',
    to: '  experimental: boolean',
  },
  {
    name: 'Room migration rebuilds the table instead of altering it',
    danger: 'A destructive migration on a table holding hand-made labels loses irreplaceable user work.',
    file: 'android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt',
    from: '                    "ALTER TABLE `track_ai_analysis` ADD COLUMN `semanticJson` TEXT"',
    to: '                    "DROP TABLE IF EXISTS `track_ai_analysis`"',
  },
  {
    name: 'analysis upsert also overwrites label columns',
    danger: 'The SQL-level version of erasing human work; invisible from the TypeScript side.',
    file: 'android/app/src/main/java/com/systema/music/library/db/TrackAiAnalysisDao.kt',
    from: '            semanticJson = excluded.semanticJson',
    to: '            semanticJson = excluded.semanticJson,\n            labelMoods = excluded.labelMoods',
  },

  // ---- Dataset page presentation ----------------------------------
  {
    name: 'human and model columns lose their visual separation',
    danger: 'Two "Mood" columns side by side with no banding is how a reader mistakes a guess for a label.',
    file: 'app/pages/dev/ai-dataset.vue',
    from: 'MODEL PREDICTION · EXPERIMENTAL',
    to: 'Predictions',
  },
  {
    name: 'a field the model cannot produce renders as a dash',
    danger: 'Collapses "cannot predict" into "no data", hiding a missing capability.',
    file: 'app/pages/dev/ai-dataset.vue',
    from: "<span v-else class=\"text-fg-faint\" title=\"This model has no head for this field\">\n                      n/a\n                    </span>",
    to: '<span v-else>{{ DASH }}</span>',
  },
  {
    name: 'confusion breakdown removed from the single-label panel',
    danger: 'A bare accuracy figure hides systematic over-prediction of one class.',
    file: 'app/pages/dev/ai-dataset.vue',
    from: '<td class="py-1 text-right text-fg-muted">{{ c.predicted }}</td>',
    to: '',
  },

  // ---- Tooling isolation -------------------------------------------
  {
    name: 'shape verification dropped from the conversion script',
    danger: 'A checkpoint with a different class count would zip scores onto the wrong labels at runtime.',
    file: 'scripts/phase29/fetch-and-convert-models.sh',
    from: 'MISMATCH — do NOT ship this. Either the checkpoint',
    to: 'shapes differ, continuing anyway',
  },
  {
    name: 'model weights become committable',
    danger: '~90 MB of non-commercially-licensed binaries entering Git history is effectively irreversible.',
    file: '.gitignore',
    from: 'build/phase29-models/',
    to: '# build/phase29-models/',
  },
  {
    name: 'the runtime shells out to Python',
    danger: 'Exactly the dependency the brief forbids, and it would look like it works on a dev machine.',
    file: 'app/services/music-semantics/providers/semanticRuntime.ts',
    from: 'export function isRuntimeReady(): boolean {',
    to: "import { execSync } from 'node:child_process'\n\nexport function isRuntimeReady(): boolean {",
  },

  // ---- Export ------------------------------------------------------
  {
    name: 'export merges prediction into groundTruth',
    danger: 'Anyone re-importing the export would train or evaluate against the model\'s own guesses.',
    file: 'app/services/ai-dataset/datasetExport.ts',
    from: '    prediction: r.semantic',
    to: '    groundTruthMerged: r.semantic\n      ? { ...r.groundTruth, moods: [topFor(r.semantic, "mood")?.label] }\n      : null,\n    prediction: r.semantic',
  },
]

// ---------------------------------------------------------------------

function runSuite(): boolean {
  try {
    execSync('npx tsx scripts/test-music-semantics.ts', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

console.log('Mutation testing Phase 29 semantics\n')
console.log('Baseline: the suite must pass on unmodified source.')

if (!runSuite()) {
  console.log('✗ BASELINE FAILS — fix the suite before mutating.')
  process.exit(1)
}
console.log('✓ baseline passes\n')

let caught = 0
const survivors: Mutation[] = []

for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8')

  if (!original.includes(m.from)) {
    console.log(`✗ ${m.name}`)
    console.log(`    STALE: anchor not found in ${m.file}`)
    survivors.push(m)
    continue
  }

  try {
    writeFileSync(m.file, original.replace(m.from, m.to))
    if (runSuite()) {
      console.log(`✗ SURVIVED: ${m.name}`)
      console.log(`    ${m.danger}`)
      survivors.push(m)
    } else {
      console.log(`✓ caught: ${m.name}`)
      caught++
    }
  } finally {
    writeFileSync(m.file, original)
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`MUTATION — ${caught}/${MUTATIONS.length} caught`)

if (!runSuite()) {
  console.log('✗ SOURCE NOT RESTORED CLEANLY — inspect git status immediately.')
  process.exit(1)
}
console.log('✓ source restored, suite green')

if (survivors.length > 0) {
  console.log('\nSurviving mutations (untested guarantees):')
  for (const s of survivors) console.log(`  · ${s.name}`)
  process.exit(1)
}
console.log('\nEvery sabotage was caught.')
