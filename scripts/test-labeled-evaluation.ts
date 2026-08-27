/**
 * SYSTEMA — Phase 18 labelled evaluation: wiring audit + behavioural
 * simulation.
 *
 * TWO KINDS OF ASSERTION LIVE HERE
 * --------------------------------
 * Sections 1-12 read the source and check the wiring: that labels
 * cannot be inferred, that no cosine threshold exists, that the
 * incremental protocol is actually incremental, that Phase 16A/17 are
 * untouched.
 *
 * Sections 13-20 EXECUTE a model of the native loop. Static greps can
 * pass while the behaviour is still wrong, so the emission order,
 * cancellation, failure handling and memory checkpoints are simulated
 * and asserted.
 *
 * The similarity and separation ARITHMETIC is proven separately by
 * running it: LabeledPairTest.kt executes on a JVM via
 * scripts/run-inference-tests.sh.
 *
 * NOTHING HERE RUNS THE REAL MODEL, decodes audio, compiles the
 * Android app, or touches a device.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const exists = (p: string) => existsSync(resolve(ROOT, p))

/**
 * Blanks comments AND string literals.
 *
 * Several of these files discuss the forbidden patterns in prose so
 * nobody reintroduces them; that documentation must not fail a check
 * that is looking for real code.
 */
function stripComments(src: string): string {
  let s = src.replace(/"""[\s\S]*?"""/g, '""')
  s = s.replace(/"(\\.|[^"\\\n])*"/g, '""')
  s = s.replace(/'(\\.|[^'\\\n])*'/g, "''")
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  return s.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const LAB = 'android/app/src/main/java/com/systema/music/inference/LabeledQualityLab.kt'
const EVAL = 'android/app/src/main/java/com/systema/music/inference/LabeledPairEvaluation.kt'
const MEM = 'android/app/src/main/java/com/systema/music/inference/MemoryLifecycleAudit.kt'
const PROBE = 'android/app/src/main/java/com/systema/music/inference/MemoryProbe.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt'
const TEST = 'android/app/src/test/java/com/systema/music/inference/LabeledPairTest.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const TS_SERVICE = 'app/services/native/inferenceService.ts'
const PAGE = 'app/pages/dev/ai-benchmark/labeled.vue'
const FIXTURE = 'app/data/labeledPairs.ts'
const INDEX = 'app/pages/dev/ai-benchmark/index.vue'
const RUNNER = 'scripts/run-inference-tests.sh'
const AGG = 'android/app/src/main/java/com/systema/music/inference/FrameEmbeddingAggregator.kt'
const SIM = 'android/app/src/main/java/com/systema/music/inference/EmbeddingSimilarity.kt'
const P17LAB = 'android/app/src/main/java/com/systema/music/inference/EmbeddingQualityLab.kt'

console.log('Phase 18 — labelled evaluation & memory lifecycle')

// ------------------------------------------------------------
section('1. The pieces exist')
// ------------------------------------------------------------
for (const p of [LAB, EVAL, MEM, PLUGIN, TEST, TS_PLUGIN, TS_SERVICE, PAGE, FIXTURE, RUNNER]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const lab = read(LAB)
const labCode = stripComments(lab)
const evalSrc = read(EVAL)
const evalCode = stripComments(evalSrc)
const mem = read(MEM)
const memCode = stripComments(mem)
const plugin = read(PLUGIN)
const pluginCode = stripComments(plugin)
const tsPlugin = read(TS_PLUGIN)
const tsService = read(TS_SERVICE)
const tsServiceCode = stripComments(tsService)
const page = read(PAGE)
const pageCode = stripComments(page)
const fixture = read(FIXTURE)
const fixtureCode = stripComments(fixture)
const runner = read(RUNNER)

// ------------------------------------------------------------
section('2. Labels are independent of cosine (Part 1, Part 11.1)')
// ------------------------------------------------------------

// The single most important property of this phase. If a label can be
// derived from a measurement, the evaluation is circular and every
// number it produces is worthless.
ok('there is no infer/derive/guess function for labels',
  !/fun\s+(infer|derive|guess|autoLabel|labelFor)\s*\(/i.test(evalCode))
ok('the lab never assigns a label from a score',
  !/label\s*=\s*if\s*\(\s*cosine/.test(labCode)
  && !/label\s*=\s*when\s*\{[\s\S]{0,200}cosine/.test(labCode))

// A parse failure must not become a label. Defaulting to DIFFERENT
// would manufacture negatives, and negatives are exactly what the
// separation statistic is measured against.
ok('an unparseable label returns null, not a default class',
  /else\s*->\s*null/.test(evalCode))
ok('PairLabel.parse has no DIFFERENT fallback',
  !/else\s*->\s*DIFFERENT/.test(evalCode))

// Grouping must key on the label, never on the value being grouped.
ok('classStatistics groups by the human label',
  /results\.filter\s*\{\s*it\.label\s*==\s*label\s*\}/.test(evalCode))
ok('classStatistics maps to the cosine only as the VALUE',
  /\.map\s*\{\s*it\.cosine\s*\}/.test(evalCode))

// The plugin rejects rather than defaults.
ok('the bridge rejects an unrecognised label instead of defaulting',
  /parsed\s*==\s*null/.test(pluginCode) && /call\.reject/.test(pluginCode))

// The fixture must not manufacture labels from metadata.
ok('the fixture derives nothing from artist/genre/album',
  !/artist|genre|album/i.test(fixtureCode.replace(/artistId|albumId|genreId/g, '')))
ok('the fixture seeds exactly one pair',
  (fixture.match(/key:\s*'\d+:\d+'/g) ?? []).length === 1)
ok('the seeded pair is the duplicate recording 0:2',
  /key:\s*'0:2'/.test(fixture))
ok('the seed is labelled SAME', /label:\s*'SAME'/.test(fixture))
ok('the seed carries a written justification',
  /justification:/.test(fixture))
ok('the seed is marked FIXTURE, not HUMAN',
  /source:\s*'FIXTURE'/.test(fixture))

// ------------------------------------------------------------
section('3. The three labels exist and are the only ones (Part 11.2)')
// ------------------------------------------------------------
ok('Kotlin defines SAME', /^\s{4}SAME,/m.test(evalSrc))
ok('Kotlin defines SIMILAR', /^\s{4}SIMILAR,/m.test(evalSrc))
ok('Kotlin defines DIFFERENT', /^\s{4}DIFFERENT,/m.test(evalSrc))
ok('TypeScript mirrors the same three',
  /PairLabel\s*=\s*'SAME'\s*\|\s*'SIMILAR'\s*\|\s*'DIFFERENT'/.test(tsPlugin))
ok('the fixture mirrors them too',
  /LABEL_ORDER[\s\S]{0,80}'SAME'[\s\S]{0,40}'SIMILAR'[\s\S]{0,40}'DIFFERENT'/.test(fixture))
ok('every label has a written definition in the UI data',
  /LABEL_DEFINITIONS/.test(fixture)
  && /SAME:/.test(fixture) && /SIMILAR:/.test(fixture) && /DIFFERENT:/.test(fixture))

// ------------------------------------------------------------
section('4. No invented cosine threshold (Part 4, Part 12)')
// ------------------------------------------------------------

// The classic mistake: `if (cosine > 0.7) similar`. Any such constant
// makes the evaluation circular.
const thresholdPattern = /cosine\s*[<>]=?\s*0\.\d+|score\s*[<>]=?\s*0\.[5-9]/
ok('the lab holds no hardcoded cosine cutoff',
  !thresholdPattern.test(labCode))
ok('the evaluator holds no hardcoded cosine cutoff',
  !thresholdPattern.test(evalCode))
ok('the page holds no hardcoded cosine cutoff',
  !thresholdPattern.test(pageCode))

// The per-pair reference must be MEASURED, not a constant.
ok('the reference is the measured DIFFERENT median',
  /fun referenceMedian/.test(evalCode)
  && /PairLabel\.DIFFERENT/.test(evalCode)
  && /\.median/.test(evalCode))
ok('with too few DIFFERENT pairs there is no reference at all',
  /diff\.size\s*<\s*MIN_REFERENCE_PAIRS/.test(evalCode))
ok('and the outcome is then NOT_SCORED',
  /reference\.isNaN\(\)[\s\S]{0,80}PairOutcome\.NOT_SCORED/.test(evalCode))

// Separation is a RANK statistic — no cutoff anywhere in it.
ok('separation uses AUC / Mann-Whitney', /fun auc\(/.test(evalCode))
ok('AUC ranks the combined sample', /combined\.sortBy/.test(evalCode))
ok('ties take the average rank rather than list order',
  /avg\s*=\s*\(i\s*\+\s*j\s*\+\s*2\)\s*\/\s*2\.0/.test(evalCode))
ok('an empty class yields NaN, never 0.5',
  /higher\.isEmpty\(\)\s*\|\|\s*lower\.isEmpty\(\)[\s\S]{0,40}Double\.NaN/.test(evalCode))

// The AUC decision points are on a rank statistic, not on cosine, and
// they must be named constants so they can be argued with.
ok('AUC decision points are declared constants',
  /const val AUC_CLEAR/.test(evalCode) && /const val AUC_PARTIAL/.test(evalCode))
ok('the verdict compares AUC, not cosine',
  /headline\.auc\s*>=\s*AUC_CLEAR/.test(evalCode))

// ------------------------------------------------------------
section('5. The four verdicts, and no "good"/"bad" (Part 5)')
// ------------------------------------------------------------
for (const v of ['CLEAR_SEPARATION', 'PARTIAL_SEPARATION', 'HEAVY_OVERLAP', 'INSUFFICIENT_DATA']) {
  ok(`${v} is defined in Kotlin`, new RegExp(`\\b${v}\\b`).test(evalSrc))
  ok(`${v} is mirrored in TypeScript`, new RegExp(`'${v}'`).test(tsPlugin))
}
ok('there is no GOOD verdict', !/\bGOOD\b/.test(evalCode))
ok('there is no BAD verdict', !/\bBAD_/.test(evalCode))
ok('there is no PASS/FAIL grade on the model',
  !/modelQuality|isGoodModel|qualityScore/.test(evalCode))
ok('every verdict carries a rationale',
  /val rationale: String/.test(evalCode))
ok('the rationale names the numbers it used',
  /append\(fmt\(headline\.auc\)\)/.test(evalCode))

// SIMILAR vs DIFFERENT must be the headline: SAME vs DIFFERENT is
// near-duplicate detection and would pass trivially.
ok('the headline comparison is SIMILAR vs DIFFERENT',
  /higher\s*==\s*PairLabel\.SIMILAR\s*&&\s*it\.lower\s*==\s*PairLabel\.DIFFERENT/
    .test(evalCode))

// ------------------------------------------------------------
section('6. All three comparisons are reported (Part 5)')
// ------------------------------------------------------------
ok('SAME vs DIFFERENT is computed',
  /compare\(PairLabel\.SAME,\s*same,\s*PairLabel\.DIFFERENT,\s*different\)/.test(evalCode))
ok('SIMILAR vs DIFFERENT is computed',
  /compare\(PairLabel\.SIMILAR,\s*similar,\s*PairLabel\.DIFFERENT,\s*different\)/.test(evalCode))
ok('SAME vs SIMILAR is computed',
  /compare\(PairLabel\.SAME,\s*same,\s*PairLabel\.SIMILAR,\s*similar\)/.test(evalCode))
ok('overlap is reported as an interval width',
  /rangeOverlap/.test(evalCode))
ok('overlap is also reported as a pair count',
  /overlappingPairs/.test(evalCode))
ok('and as a fraction', /overlapFraction/.test(evalCode))

// ------------------------------------------------------------
section('7. Per-class statistics (Part 4)')
// ------------------------------------------------------------
for (const field of ['pairCount', 'mean', 'median', 'min', 'max', 'stdDev', 'p25', 'p75']) {
  ok(`SimilarityStats carries ${field}`, new RegExp(`val ${field}`).test(read(SIM)))
}
ok('a too-small class is flagged rather than characterised',
  /insufficient\s*=\s*scores\.size\s*<\s*MIN_CLASS_PAIRS/.test(evalCode))
ok('MIN_CLASS_PAIRS is a declared constant',
  /const val MIN_CLASS_PAIRS/.test(evalCode))
ok('the UI marks a too-small class in words',
  /TOO FEW PAIRS/.test(tsService))

// ------------------------------------------------------------
section('8. Diagonal exclusion (Part 6, Part 11.5)')
// ------------------------------------------------------------
const simCode = stripComments(read(SIM))
ok('pairwise walks the strict upper triangle',
  /for\s*\(j in i \+ 1 until/.test(simCode))
ok('so i == j never enters the matrix',
  !/for\s*\(j in i until/.test(simCode))
ok('the lab reuses pairwise rather than rebuilding the matrix',
  /EmbeddingSimilarity\.pairwise/.test(labCode))
ok('orderedLabelledPairs also skips the diagonal',
  /for\s*\(j in i \+ 1 until trackCount\)/.test(labCode))
ok('the fixture enumerates pairs the same way',
  /for\s*\(let j = i \+ 1;/.test(fixtureCode))

// ------------------------------------------------------------
section('9. Incremental emission (Part 3, CRITICAL UX)')
// ------------------------------------------------------------
ok('a per-track event exists',
  /const val EVENT_TRACK_COMPLETED = "labeledEvalTrackCompleted"/.test(lab))
ok('a per-PAIR event exists',
  /const val EVENT_PAIR_COMPLETED = "labeledEvalPairCompleted"/.test(lab))
ok('a memory event exists',
  /const val EVENT_MEMORY = "labeledEvalMemory"/.test(lab))

// The emit must be INSIDE the loops, not after them.
{
  const trackLoop = labCode.indexOf('for ((index, track) in tracks.withIndex())')
  const trackEmit = labCode.indexOf('EVENT_TRACK_COMPLETED', trackLoop)
  const finallyAt = labCode.indexOf('} finally {', trackLoop)
  ok('the track emit is inside the track loop',
    trackLoop > 0 && trackEmit > trackLoop && trackEmit < finallyAt,
    `loop=${trackLoop} emit=${trackEmit} finally=${finallyAt}`)
}
{
  const pairLoop = labCode.indexOf('for ((position, key) in ordered.withIndex())')
  const pairEmit = labCode.indexOf('emitPair(', pairLoop)
  ok('the pair emit is inside the pair loop',
    pairLoop > 0 && pairEmit > pairLoop, `loop=${pairLoop} emit=${pairEmit}`)
}

// Live statistics must be recomputed per pair, not only at the end.
ok('class stats are recomputed on every pair',
  /LabeledPairEvaluation\.classStatistics\(soFar\)/.test(labCode))
ok('the verdict is recomputed on every pair',
  /LabeledPairEvaluation\.analyse\(soFar\)/.test(labCode))

// The bridge must not hold the promise for the whole run.
ok('the plugin resolves as soon as the run is accepted',
  /put\("started", true\)/.test(plugin))
ok('the run itself is launched on a coroutine scope',
  /scope\.launch/.test(pluginCode))

// The page must render on each event, not buffer.
ok('the page appends each track row as it arrives',
  /rows\.value\s*=\s*\[\.\.\.rows\.value,\s*e\.row\]/.test(pageCode))
ok('the page appends each pair as it arrives',
  /pairs\.value\s*=\s*\[\.\.\.pairs\.value,\s*e\.pair\]/.test(pageCode))
ok('the page does not wait for onFinished to show pairs',
  pageCode.indexOf('onPairCompleted') < pageCode.indexOf('onFinished'))

// ------------------------------------------------------------
section('10. Pair progress reporting (Part 3, Part 11.4)')
// ------------------------------------------------------------
ok('the pair event carries a 1-based position',
  /put\("position", result\.position\)/.test(plugin) || /put\("position", result\.position\)/.test(lab))
ok('the pair event carries the total',
  /put\("totalPairs", total\)/.test(lab))
ok('the pair event carries a scored count',
  /put\("scoredCount", soFar\.size\)/.test(lab))
ok('the track event carries position and total',
  /put\("position", index \+ 1\)/.test(lab) && /put\("totalTracks", tracks\.size\)/.test(lab))
ok('elapsed time is reported',
  /put\("elapsedMs"/.test(lab))
ok('the page renders a pair progress counter',
  /pairPosition/.test(pageCode) && /pairTotal/.test(pageCode))
ok('the page renders a progress bar',
  /renderProgressBar/.test(pageCode))
ok('the page shows which stage is running',
  /EMBEDDING TRACKS/.test(page) && /SCORING PAIRS/.test(page))

// ------------------------------------------------------------
section('11. Memory lifecycle wiring (Part 7, Part 11.10)')
// ------------------------------------------------------------
const checkpoints = [
  'BEFORE_MODEL_LOAD', 'AFTER_MODEL_LOAD', 'AFTER_TRACK_1', 'AFTER_TRACK_5',
  'AFTER_TRACK_10', 'AFTER_ALL_TRACKS', 'AFTER_SESSION_CLEANUP', 'AFTER_IDLE',
]
for (const c of checkpoints) {
  ok(`checkpoint ${c} is defined`, new RegExp(`\\b${c}\\b`).test(mem))
  ok(`checkpoint ${c} is mirrored in TypeScript`, new RegExp(`'${c}'`).test(tsPlugin))
}
ok('the lab records the pre-load baseline',
  /MemoryCheckpoint\.BEFORE_MODEL_LOAD/.test(labCode))
ok('the lab records straight after model load',
  /MemoryCheckpoint\.AFTER_MODEL_LOAD/.test(labCode))
ok('the lab records after cleanup',
  /MemoryCheckpoint\.AFTER_SESSION_CLEANUP/.test(labCode))
ok('the lab records after an idle period',
  /MemoryCheckpoint\.AFTER_IDLE/.test(labCode))
ok('track checkpoints are chosen by position',
  /checkpointForPosition/.test(labCode) && /checkpointForPosition/.test(memCode))

// The three memory kinds must be separated — a Java-heap reading
// would show almost nothing while a native model was resident.
ok('total PSS is captured', /totalPssKb/.test(read(PROBE)))
ok('native heap is captured separately', /nativeHeapKb/.test(read(PROBE)))
ok('Java heap is captured separately', /javaHeapKb/.test(read(PROBE)))
ok('deltas are computed against the baseline',
  /deltaTotalKb/.test(memCode) && /deltaNativeKb/.test(memCode))
ok('a running peak is tracked', /runningPeakKb/.test(memCode))

// Honesty requirements.
ok('there is no LEAK verdict', !/\bLEAK\b/.test(memCode.replace(/MemoryAttribution/g, '')))
ok('UNKNOWN is a real outcome', /UNKNOWN/.test(memCode))
ok('unavailable counters propagate as null, not as a delta',
  /if\s*\(now\s*<\s*0\s*\|\|\s*base\s*<\s*0\)\s*null/.test(memCode))
ok('a caveat is attached to every report', /val caveat: String/.test(memCode))
ok('the caveat says elevated memory is not itself a leak',
  // Collapse the Kotlin string concatenation before matching: the
  // sentence spans a `" +\n "` join in the source.
  /NOT by itself a leak/i.test(mem.replace(/"\s*\+\s*\n\s*"/g, '')))
ok('a noise floor prevents calling noise "retention"',
  /const val NOISE_FLOOR_KB/.test(memCode))
ok('the UI shows UNKNOWN rather than 0.0 MB for missing counters',
  /return 'UNKNOWN'/.test(tsService))

// ------------------------------------------------------------
section('12. Phase 16A / 17 untouched (Part 10, Part 11.11, 11.12)')
// ------------------------------------------------------------
const agg = read(AGG)
ok('MEAN is still the default aggregation strategy',
  /strategy: AggregationStrategy = AggregationStrategy\.MEAN/.test(agg))
ok('the aggregator still L2-normalises by default',
  /normalise: Boolean = true/.test(agg))
ok('the new lab calls the aggregator rather than reimplementing pooling',
  /FrameEmbeddingAggregator\.aggregate/.test(labCode))
ok('the new lab does not define its own pooling',
  !/fun\s+(meanPool|pool|aggregate)\s*\(/.test(labCode))
ok('the new lab does not define its own cosine',
  !/fun\s+cosine\s*\(/.test(labCode))
ok('the new lab reuses EmbeddingSimilarity.cosine',
  /EmbeddingSimilarity\.cosine/.test(labCode))

// output_1 only — never the class scores.
ok('the embedding comes from embeddingFrames',
  /result\.embeddingFrames/.test(labCode))
ok('there is no fallback to result.output',
  !/embeddingFrames\s*\?:\s*result\.output/.test(labCode)
  && !/\?\:\s*result\.output/.test(labCode))
ok('a missing embedding is a failure, not a substitution',
  /EMBEDDING_UNAVAILABLE/.test(lab))
ok('an unresolved shape is a distinct failure',
  /EMBEDDING_SHAPE_INVALID/.test(lab))
ok('a degenerate vector is rejected', /DEGENERATE_EMBEDDING/.test(lab))
ok('a non-unit vector is rejected rather than renormalised',
  /NOT_UNIT_LENGTH/.test(lab))
ok('the norm tolerance is shared, not redefined',
  /EmbeddingSimilarity\.NORM_TOLERANCE/.test(labCode))

// The Phase 17 lab must still exist and still be reachable.
ok('the Phase 17 lab file is still present', exists(P17LAB))
ok('Phase 17 still has its own four events',
  /qualityEvalStarted/.test(read(P17LAB)) && /qualityEvalFinished/.test(read(P17LAB)))
ok('the Phase 17 page is still routed from the index',
  /ai-benchmark\/quality/.test(read(INDEX)))
ok('the Phase 18 page is routed from the index',
  /ai-benchmark\/labeled/.test(read(INDEX)))
ok('Phase 18 did not rename the Phase 17 plugin methods',
  /fun runQualityEvaluation/.test(plugin) && /fun runLabeledEvaluation/.test(plugin))

// Scope guards.
ok('no library-wide scan', !/scanLibrary|indexLibrary|getAllTracks/.test(labCode))
ok('no background indexing', !/WorkManager|JobScheduler/.test(labCode))
ok('no semantic search', !/semanticSearch|textToAudio|embedText/.test(labCode))
ok('no production model selection',
  !/setProductionModel|selectProductionModel|productionModel/.test(labCode))
ok('the track cap is inherited from Phase 17',
  /MAX_TRACKS = EmbeddingQualityLab\.MAX_TRACKS/.test(labCode))

// Timing boundaries must stay separate and comparable.
//
// Either put() or putNumeric() satisfies this: what matters is that
// the key is emitted under its own name, not which writer emits it.
// putNumeric is the NaN-safe variant added for the white-screen fix
// (see EvaluationJson.kt) and changes no finite value.
for (const t of ['decodeMs', 'preprocessingMs', 'inferenceMs', 'tensorMs', 'aggregationMs', 'totalMs']) {
  ok(`${t} is recorded separately`, new RegExp(`put(Numeric)?\\("${t}"`).test(lab))
}
ok('totalMs keeps the Phase 16A/17 boundary (no aggregation folded in)',
  /val totalMs = decodeMs \+ prepared\.preparationMs \+ result\.inferenceMs \+ result\.tensorMs/
    .test(labCode))
ok('quality-evaluation wall clock is reported separately',
  /put(Numeric)?\("pairStageMs"/.test(lab) && /put(Numeric)?\("embedStageMs"/.test(lab))
ok('energy is declared not measured, never estimated',
  /put\("energyMeasured", false\)/.test(lab))

// ============================================================
// BEHAVIOURAL SIMULATION
// ============================================================
// Everything above reads source. Everything below runs a model of the
// native loop, because a grep can pass while the behaviour is wrong.

type Label = 'SAME' | 'SIMILAR' | 'DIFFERENT'
interface SimPair {
  position: number
  i: number
  j: number
  label: Label
  cosine: number
  outcome: 'CONSISTENT' | 'INCONSISTENT' | 'NOT_SCORED'
}
interface Emission { kind: string, payload: Record<string, unknown> }

const MIN_REF = 3

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 === 1 ? s[n >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2
}

function referenceMedian(done: SimPair[]): number {
  const diff = done.filter(p => p.label === 'DIFFERENT').map(p => p.cosine)
  return diff.length < MIN_REF ? Number.NaN : median(diff)
}

function outcomeFor(label: Label, cosine: number, ref: number) {
  if (Number.isNaN(ref) || Number.isNaN(cosine)) return 'NOT_SCORED' as const
  if (label === 'DIFFERENT') return cosine <= ref ? 'CONSISTENT' as const : 'INCONSISTENT' as const
  return cosine > ref ? 'CONSISTENT' as const : 'INCONSISTENT' as const
}

/** Models the native run: embed each track, then score each labelled pair. */
function simulate(opts: {
  trackCount: number
  failing?: Set<number>
  labels: Map<string, Label>
  cosines: Map<string, number>
  cancelAfterTracks?: number
  cancelAfterPairs?: number
}): { emissions: Emission[], pairs: SimPair[], embedded: number[] } {
  const emissions: Emission[] = []
  const embedded: number[] = []
  const failing = opts.failing ?? new Set<number>()
  let cancelled = false

  emissions.push({ kind: 'memory', payload: { checkpoint: 'BEFORE_MODEL_LOAD' } })
  emissions.push({ kind: 'memory', payload: { checkpoint: 'AFTER_MODEL_LOAD' } })
  emissions.push({ kind: 'started', payload: { totalTracks: opts.trackCount } })

  // ---- Stage 1 ----
  for (let idx = 0; idx < opts.trackCount; idx++) {
    if (opts.cancelAfterTracks !== undefined && idx >= opts.cancelAfterTracks) {
      cancelled = true
      break
    }
    const okRow = !failing.has(idx)
    if (okRow) embedded.push(idx)
    emissions.push({
      kind: 'track',
      payload: { index: idx, position: idx + 1, ok: okRow, totalTracks: opts.trackCount },
    })
    const pos = idx + 1
    if (pos === 1 || pos === 5 || pos === 10 || pos === opts.trackCount) {
      emissions.push({ kind: 'memory', payload: { checkpoint: `AFTER_TRACK_${pos}` } })
    }
  }

  emissions.push({ kind: 'memory', payload: { checkpoint: 'AFTER_SESSION_CLEANUP' } })

  // ---- Stage 2 ----
  const pairs: SimPair[] = []
  if (!cancelled) {
    const ordered: Array<[number, number]> = []
    for (let i = 0; i < opts.trackCount; i++) {
      for (let j = i + 1; j < opts.trackCount; j++) {
        if (opts.labels.has(`${i}:${j}`)) ordered.push([i, j])
      }
    }
    for (let p = 0; p < ordered.length; p++) {
      if (opts.cancelAfterPairs !== undefined && p >= opts.cancelAfterPairs) {
        cancelled = true
        break
      }
      const [i, j] = ordered[p]!
      const label = opts.labels.get(`${i}:${j}`)!
      const bothOk = embedded.includes(i) && embedded.includes(j)
      const cosine = bothOk ? (opts.cosines.get(`${i}:${j}`) ?? 0.5) : Number.NaN
      const ref = referenceMedian(pairs)
      const rec: SimPair = {
        position: p + 1,
        i,
        j,
        label,
        cosine,
        outcome: bothOk ? outcomeFor(label, cosine, ref) : 'NOT_SCORED',
      }
      if (bothOk) pairs.push(rec)
      emissions.push({
        kind: 'pair',
        payload: {
          position: p + 1,
          totalPairs: ordered.length,
          scoredCount: pairs.length,
          skipped: !bothOk,
          label,
          cosine,
          outcome: rec.outcome,
        },
      })
    }
  }

  emissions.push({ kind: 'memory', payload: { checkpoint: 'AFTER_IDLE' } })
  emissions.push({ kind: 'finished', payload: { cancelled } })
  return { emissions, pairs, embedded }
}

// ------------------------------------------------------------
section('13. Simulated: results arrive one at a time')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>()
  const cosines = new Map<string, number>()
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      labels.set(`${i}:${j}`, i === 0 && j === 2 ? 'SAME' : (j - i) % 3 === 0 ? 'SIMILAR' : 'DIFFERENT')
      cosines.set(`${i}:${j}`, i === 0 && j === 2 ? 1.0 : 0.5 + ((i * 7 + j) % 40) / 100)
    }
  }
  const { emissions } = simulate({ trackCount: 13, labels, cosines })

  const trackEmits = emissions.filter(e => e.kind === 'track')
  const pairEmits = emissions.filter(e => e.kind === 'pair')
  ok('13 tracks produce 13 track emissions', trackEmits.length === 13, `${trackEmits.length}`)
  ok('78 labelled pairs produce 78 pair emissions', pairEmits.length === 78, `${pairEmits.length}`)

  const finishedAt = emissions.findIndex(e => e.kind === 'finished')
  ok('every track emission precedes the finish',
    trackEmits.every(e => emissions.indexOf(e) < finishedAt))
  ok('every pair emission precedes the finish',
    pairEmits.every(e => emissions.indexOf(e) < finishedAt))

  // The real requirement: pair N is emitted before pair N+1 is computed.
  ok('pair positions are strictly increasing',
    pairEmits.every((e, k) => e.payload.position === k + 1))
  ok('track positions are strictly increasing',
    trackEmits.every((e, k) => e.payload.position === k + 1))
  ok('the total is reported on every pair emission',
    pairEmits.every(e => e.payload.totalPairs === 78))

  // If everything were buffered, all emissions would sit at the end.
  const firstPair = emissions.findIndex(e => e.kind === 'pair')
  ok('the first pair lands well before the end',
    firstPair < finishedAt - 70, `first=${firstPair} finish=${finishedAt}`)
}

// ------------------------------------------------------------
section('14. Simulated: the reference is data-derived and moves')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>([
    ['0:1', 'DIFFERENT'], ['0:2', 'DIFFERENT'], ['0:3', 'DIFFERENT'],
    ['1:2', 'SIMILAR'], ['1:3', 'SIMILAR'],
  ])
  const cosines = new Map<string, number>([
    ['0:1', 0.30], ['0:2', 0.40], ['0:3', 0.50],
    ['1:2', 0.90], ['1:3', 0.10],
  ])
  const { emissions } = simulate({ trackCount: 4, labels, cosines })
  const pairEmits = emissions.filter(e => e.kind === 'pair')

  // The first DIFFERENT pairs cannot be scored: no reference yet.
  ok('pair 1 is NOT_SCORED (no reference yet)',
    pairEmits[0]!.payload.outcome === 'NOT_SCORED')
  ok('pair 2 is NOT_SCORED (still below the minimum)',
    pairEmits[1]!.payload.outcome === 'NOT_SCORED')
  ok('pair 3 is NOT_SCORED (the 3rd DIFFERENT is not yet recorded when scored)',
    pairEmits[2]!.payload.outcome === 'NOT_SCORED')

  // With three DIFFERENT pairs recorded, median{0.3,0.4,0.5} = 0.4.
  ok('pair 4 (SIMILAR 0.90 > 0.40) is CONSISTENT',
    pairEmits[3]!.payload.outcome === 'CONSISTENT', String(pairEmits[3]!.payload.outcome))
  ok('pair 5 (SIMILAR 0.10 < 0.40) is INCONSISTENT',
    pairEmits[4]!.payload.outcome === 'INCONSISTENT', String(pairEmits[4]!.payload.outcome))
}

// ------------------------------------------------------------
section('15. Simulated: a failed track does not abort the batch')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>([
    ['0:1', 'SIMILAR'], ['0:2', 'DIFFERENT'], ['1:2', 'DIFFERENT'],
  ])
  const cosines = new Map<string, number>([['0:1', 0.8], ['0:2', 0.3], ['1:2', 0.4]])
  const { emissions, embedded } = simulate({
    trackCount: 3, failing: new Set([1]), labels, cosines,
  })

  ok('all 3 tracks still emit despite one failing',
    emissions.filter(e => e.kind === 'track').length === 3)
  ok('the failed track is marked not-ok',
    emissions.filter(e => e.kind === 'track')[1]!.payload.ok === false)
  ok('only the successful tracks are embedded',
    embedded.length === 2 && !embedded.includes(1))
  ok('the run still reaches the finish', emissions.some(e => e.kind === 'finished'))

  const pairEmits = emissions.filter(e => e.kind === 'pair')
  ok('every labelled pair still emits', pairEmits.length === 3)
  const skipped = pairEmits.filter(e => e.payload.skipped === true)
  ok('pairs touching the failed track are skipped, not invented', skipped.length === 2)
  ok('a skipped pair carries NaN, never a substituted score',
    skipped.every(e => Number.isNaN(e.payload.cosine as number)))
  ok('a skipped pair is NOT_SCORED',
    skipped.every(e => e.payload.outcome === 'NOT_SCORED'))
}

// ------------------------------------------------------------
section('16. Simulated: cancellation preserves completed work')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>()
  const cosines = new Map<string, number>()
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      labels.set(`${i}:${j}`, 'DIFFERENT')
      cosines.set(`${i}:${j}`, 0.5)
    }
  }
  const stoppedEarly = simulate({ trackCount: 13, labels, cosines, cancelAfterTracks: 7 })
  ok('stopping after 7 tracks keeps exactly 7',
    stoppedEarly.emissions.filter(e => e.kind === 'track').length === 7)
  ok('the 7 completed embeddings are retained',
    stoppedEarly.embedded.length === 7)
  ok('the report still fires', stoppedEarly.emissions.some(e => e.kind === 'finished'))
  ok('and it is marked cancelled',
    stoppedEarly.emissions.find(e => e.kind === 'finished')!.payload.cancelled === true)
  ok('post-cleanup memory is still sampled after a cancel',
    stoppedEarly.emissions.some(e =>
      e.kind === 'memory' && e.payload.checkpoint === 'AFTER_SESSION_CLEANUP'))
  ok('the idle sample is still taken after a cancel',
    stoppedEarly.emissions.some(e =>
      e.kind === 'memory' && e.payload.checkpoint === 'AFTER_IDLE'))

  const midPairs = simulate({ trackCount: 13, labels, cosines, cancelAfterPairs: 20 })
  ok('stopping mid-pairs keeps the 20 already scored',
    midPairs.emissions.filter(e => e.kind === 'pair').length === 20)
  ok('all 13 tracks still completed before the pair stage',
    midPairs.embedded.length === 13)
  ok('a mid-pair cancel is still reported as cancelled',
    midPairs.emissions.find(e => e.kind === 'finished')!.payload.cancelled === true)
}

// ------------------------------------------------------------
section('17. Simulated: memory checkpoints fire in order')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>([['0:1', 'DIFFERENT']])
  const cosines = new Map<string, number>([['0:1', 0.5]])
  const { emissions } = simulate({ trackCount: 13, labels, cosines })
  const seen = emissions
    .filter(e => e.kind === 'memory')
    .map(e => e.payload.checkpoint as string)

  ok('the baseline is the very first memory sample',
    seen[0] === 'BEFORE_MODEL_LOAD', seen[0])
  ok('the post-load sample comes second', seen[1] === 'AFTER_MODEL_LOAD', seen[1])
  ok('the idle sample is last', seen[seen.length - 1] === 'AFTER_IDLE')
  ok('cleanup is sampled before idle',
    seen.indexOf('AFTER_SESSION_CLEANUP') < seen.indexOf('AFTER_IDLE'))
  for (const c of ['AFTER_TRACK_1', 'AFTER_TRACK_5', 'AFTER_TRACK_10']) {
    ok(`${c} was sampled`, seen.includes(c))
  }
  ok('the final-track checkpoint fired', seen.includes('AFTER_TRACK_13'))
  ok('the baseline precedes every track checkpoint',
    seen.indexOf('BEFORE_MODEL_LOAD') < seen.indexOf('AFTER_TRACK_1'))
  ok('all 8 checkpoint kinds are present', new Set(seen).size === 8, `${new Set(seen).size}`)
}

// ------------------------------------------------------------
section('18. Simulated: the 1240 MB observation is attributable')
// ------------------------------------------------------------
{
  // Reproduces the reported figures: 109.4 MB -> 1240.4 MB.
  const NOISE = 8 * 1024
  function attribute(baseKb: number, finalKb: number, nativeDelta: number | null,
    javaDelta: number | null, hadCleanup: boolean) {
    const net = finalKb - baseKb
    if (net <= NOISE) return 'RELEASED'
    if (nativeDelta === null || javaDelta === null) return 'UNKNOWN'
    const share = nativeDelta / net
    if (share >= 0.60) return hadCleanup ? 'NATIVE_RETAINED_AFTER_CLEANUP' : 'NATIVE_HEAP'
    if (javaDelta > net / 2) return 'JAVA_HEAP'
    return 'UNKNOWN'
  }

  const base = Math.round(109.4 * 1024)
  const peak = Math.round(1240.4 * 1024)

  ok('memory returning to baseline reads as RELEASED',
    attribute(base, base + 1024, 100, 900, true) === 'RELEASED')
  ok('mostly-native retention after cleanup is named as such',
    attribute(base, peak, peak - base - 1000, 1000, true)
    === 'NATIVE_RETAINED_AFTER_CLEANUP')
  ok('mostly-native retention without a cleanup sample is NATIVE_HEAP',
    attribute(base, peak, peak - base - 1000, 1000, false) === 'NATIVE_HEAP')
  ok('mostly-Java retention is named JAVA_HEAP',
    attribute(base, peak, 1000, peak - base - 1000, true) === 'JAVA_HEAP')
  ok('missing counters give UNKNOWN, never a guess',
    attribute(base, peak, null, null, true) === 'UNKNOWN')
  ok('unattributable growth gives UNKNOWN',
    attribute(base, peak, 1000, 1000, true) === 'UNKNOWN')

  // The noise floor must not swallow the real observation.
  ok('the 1131 MB swing is far above the noise floor',
    peak - base > NOISE * 100, `${((peak - base) / 1024).toFixed(0)} MB`)
}

// ------------------------------------------------------------
section('19. Simulated: repeatability (Part 8)')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>()
  const cosines = new Map<string, number>()
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      labels.set(`${i}:${j}`, (i + j) % 2 === 0 ? 'SIMILAR' : 'DIFFERENT')
      cosines.set(`${i}:${j}`, 0.4 + ((i * 3 + j) % 50) / 100)
    }
  }
  const a = simulate({ trackCount: 6, labels, cosines })
  const b = simulate({ trackCount: 6, labels, cosines })

  ok('two identical runs produce the same pair count',
    a.pairs.length === b.pairs.length)
  ok('two identical runs produce identical cosines',
    a.pairs.every((p, k) => p.cosine === b.pairs[k]!.cosine))
  ok('two identical runs produce identical outcomes',
    a.pairs.every((p, k) => p.outcome === b.pairs[k]!.outcome))
  ok('two identical runs walk pairs in the same order',
    a.pairs.every((p, k) => p.i === b.pairs[k]!.i && p.j === b.pairs[k]!.j))

  // Ordering must be deterministic, not map-iteration dependent —
  // otherwise the incremental reference median could differ per run.
  ok('pair order is sorted by (i, j)',
    a.pairs.every((p, k) => k === 0
      || p.i > a.pairs[k - 1]!.i
      || (p.i === a.pairs[k - 1]!.i && p.j > a.pairs[k - 1]!.j)))
}

// ------------------------------------------------------------
section('20. Simulated: statistics use only labelled, scored pairs')
// ------------------------------------------------------------
{
  const labels = new Map<string, Label>([['0:1', 'SIMILAR'], ['0:2', 'DIFFERENT']])
  const cosines = new Map<string, number>([
    ['0:1', 0.9], ['0:2', 0.2], ['1:2', 0.7],
  ])
  const { emissions, pairs } = simulate({ trackCount: 3, labels, cosines })

  ok('an unlabelled pair is never scored', pairs.length === 2)
  ok('and never emitted', emissions.filter(e => e.kind === 'pair').length === 2)
  ok('the unlabelled 1:2 pair is absent',
    !pairs.some(p => p.i === 1 && p.j === 2))

  // The diagonal must never appear.
  ok('no self-pair is ever produced', pairs.every(p => p.i !== p.j))

  // Class membership comes from the label, never from the value.
  const similar = pairs.filter(p => p.label === 'SIMILAR')
  const different = pairs.filter(p => p.label === 'DIFFERENT')
  ok('the high-cosine pair sits in SIMILAR because it was LABELLED so',
    similar.length === 1 && similar[0]!.cosine === 0.9)
  ok('the low-cosine pair sits in DIFFERENT because it was LABELLED so',
    different.length === 1 && different[0]!.cosine === 0.2)
}

// ------------------------------------------------------------
section('21. Runner wiring')
// ------------------------------------------------------------
ok('the runner compiles LabeledPairTest',
  /LabeledPairTest\.kt/.test(runner))
ok('the runner executes it',
  /com\.systema\.music\.inference\.LabeledPairTest/.test(runner))
ok('a failing labelled suite fails the runner',
  /Labelled pair suite FAILED/.test(runner))
ok('the Phase 17 similarity suite is still wired',
  /SimilarityTest\.kt/.test(runner))
ok('the Phase 16A aggregation suite is still wired',
  /AggregationTest/.test(runner))

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
if (failures.length > 0) console.log(`  failing: ${failures.join(', ')}`)
console.log(`
SCOPE OF THIS SUITE
-------------------
Static wiring audit plus a behavioural simulation of the two-stage
incremental protocol. The separation ARITHMETIC (AUC, class statistics,
overlap) is proven separately by executing it: LabeledPairTest.kt runs
on a JVM via scripts/run-inference-tests.sh.

Neither suite runs the real yamnet.onnx, decodes audio, compiles the
Android app, or touches a device. NO CONCLUSION ABOUT EMBEDDING QUALITY
IS AVAILABLE FROM THESE TESTS — that needs a device run with human
labels, which has not been performed.
`)

process.exit(failed > 0 ? 1 : 0)
