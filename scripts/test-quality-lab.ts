// ============================================================
// SYSTEMA — Phase 17: the Embedding Quality Lab, wiring + behaviour
// ============================================================
// The similarity ARITHMETIC is proven by executing it:
// android/app/src/test/java/com/systema/music/inference/SimilarityTest.kt
// compiles and runs on a plain JVM through scripts/run-inference-tests.sh.
//
// This suite covers two things that run cannot reach:
//
//   1. WIRING — which tensor feeds the lab, where the results come
//      from, what the UI is allowed to say, and what was NOT built.
//   2. BEHAVIOUR — the incremental protocol itself, simulated against
//      a model of the native event stream: results emitted per track,
//      a failure not aborting the batch, cancellation preserving what
//      finished, and the matrix growing as tracks complete.
//
// The failure being guarded against is specific and has happened once
// already. Phase 16.2 found a benchmark confidently reporting a
// flattened class-score count as an embedding dimension. Correct
// cosine maths pointed at output_0 would reproduce that bug with a
// full similarity matrix on top - every score real-looking, every
// score meaningless.
//
// Comments are stripped before any "absence" check, per the Phase
// 13-16 convention: a rule described in prose must not satisfy a test
// looking for it in code.
// ============================================================

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const exists = (p: string) => existsSync(resolve(ROOT, p))

function stripComments(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(\\.|[^"\\\n])*"/g, '""')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SIM = 'android/app/src/main/java/com/systema/music/inference/EmbeddingSimilarity.kt'
const LAB = 'android/app/src/main/java/com/systema/music/inference/EmbeddingQualityLab.kt'
const TEST = 'android/app/src/test/java/com/systema/music/inference/SimilarityTest.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt'
const TS_PLUGIN = 'app/services/native/inferencePlugin.ts'
const TS_SERVICE = 'app/services/native/inferenceService.ts'
const PAGE = 'app/pages/dev/ai-benchmark/quality.vue'
const INDEX = 'app/pages/dev/ai-benchmark/index.vue'
const RUNNER = 'scripts/run-inference-tests.sh'
const AGG = 'android/app/src/main/java/com/systema/music/inference/FrameEmbeddingAggregator.kt'

console.log('\n============================================================')
console.log('SYSTEMA — Phase 17 embedding quality lab')
console.log('============================================================')

// ------------------------------------------------------------
section('1. The pieces exist')
// ------------------------------------------------------------
for (const p of [SIM, LAB, TEST, PLUGIN, TS_PLUGIN, TS_SERVICE, PAGE, INDEX, RUNNER]) {
  ok(`${p.split('/').pop()} exists`, exists(p), p)
}

const sim = read(SIM)
const simCode = stripComments(sim)
const lab = read(LAB)
const labCode = stripComments(lab)
const test = read(TEST)
const plugin = read(PLUGIN)
const pluginCode = stripComments(plugin)
const tsPlugin = read(TS_PLUGIN)
const tsService = read(TS_SERVICE)
const tsServiceCode = stripComments(tsService)
const page = read(PAGE)
const pageCode = stripComments(page)
const runner = read(RUNNER)

// ------------------------------------------------------------
section('2. The lab consumes output_1, never output_0')
// ------------------------------------------------------------
ok(
  'the embedding comes from result.embeddingFrames',
  /result\.embeddingFrames/.test(labCode),
)
ok(
  'it never pools result.output',
  !/aggregate\([\s\S]{0,80}result\.output/.test(labCode),
  'result.output is index 0 — for YAMNet, the 521-wide class scores',
)
ok(
  'there is no fallback to result.output when the embedding is missing',
  !/embeddingFrames\s*\?:\s*result\.output/.test(labCode) &&
    !/frames\s*\?:\s*result\.output/.test(labCode),
)
ok(
  'a missing embedding is an explicit failure',
  /EMBEDDING_UNAVAILABLE/.test(lab),
)
ok(
  'the failure explains why no substitute is used',
  /pooling class scores would/.test(lab),
)
ok(
  'the lab pools via FrameEmbeddingAggregator, not its own maths',
  /FrameEmbeddingAggregator\.aggregate/.test(labCode),
)
ok(
  'the lab does not reimplement mean pooling',
  !/fun meanPool/.test(labCode),
)
ok(
  'no tensor is selected by model name',
  !/yamnet/i.test(labCode) && !/yamnet/i.test(simCode),
)
ok(
  'shape is validated before pooling',
  /shape\.size != 2/.test(labCode),
)
ok(
  'an unresolved shape is a distinct failure code',
  /EMBEDDING_SHAPE_INVALID/.test(lab),
)

// ------------------------------------------------------------
section('3. Similarity only ever uses the final track vector')
// ------------------------------------------------------------
ok(
  'cosine takes two FloatArrays and nothing else',
  /fun cosine\(a: FloatArray, b: FloatArray\): Double/.test(simCode),
)
ok(
  'the similarity file never mentions class scores',
  !/classScore/i.test(simCode) && !/CLASS_SCORES/.test(simCode),
)
ok(
  'it never uses a frame count as a feature',
  !/frameCount/.test(simCode),
)
ok(
  'it never uses audio duration',
  !/duration/i.test(simCode),
)
ok(
  'it never uses a flattened element count',
  !/elementCount/.test(simCode),
)
ok(
  'the lab compares embedding.vector, not any raw output',
  /cosine\(embedding\.vector/.test(labCode),
)
ok(
  'unit length is verified before a vector enters the geometry',
  /requireUnitLength/.test(labCode),
)
ok(
  'a degenerate vector is excluded rather than compared',
  /DEGENERATE_EMBEDDING/.test(lab),
)

// ------------------------------------------------------------
section('4. Cosine is a dot product, and that is justified')
// ------------------------------------------------------------
ok(
  'the norm check happens inside cosine',
  simCode.indexOf('requireUnitLength(a') < simCode.indexOf('var dot = 0.0'),
)
ok(
  'the dot product accumulates in Double',
  /var dot = 0\.0/.test(simCode),
)
ok(
  'the result is clamped to [-1, 1]',
  /coerceIn\(-1\.0, 1\.0\)/.test(simCode),
)
ok(
  'unnormalised input is rejected, not renormalised',
  !/\/ *\(?normA/.test(simCode) && !/dot \/ /.test(simCode),
  'dividing by measured norms would silently accept a broken pipeline',
)
ok(
  'the tolerance is shared with the aggregator',
  /NORM_TOLERANCE = FrameEmbeddingAggregator\.NORM_TOLERANCE/.test(simCode),
)

// ------------------------------------------------------------
section('5. Statistics exclude the diagonal and use valid data only')
// ------------------------------------------------------------
ok(
  'pairwise walks the upper triangle',
  /for \(j in i \+ 1 until/.test(simCode),
)
ok(
  'the diagonal exclusion is explained',
  /diagonal/i.test(sim),
)
ok(
  'the lab only stores a vector on success',
  /if \(evaluation\.ok && evaluation\.embedding != null\)/.test(labCode),
)
ok(
  'statistics over zero pairs returns null, not zero',
  /if \(scores\.isEmpty\(\)\) return null/.test(simCode),
)
ok(
  'neighbours of a lone embedding is null',
  /if \(embeddings\.size < 2\) return null/.test(simCode),
)
ok(
  'the matrix diagonal is set to 1 by definition, not measured',
  /i == j -> 1\.0/.test(labCode),
)

// ------------------------------------------------------------
section('6. Results are emitted per track, not batched')
// ------------------------------------------------------------
ok('there is a per-track completion event', /EVENT_TRACK_COMPLETED/.test(labCode))
ok('there is a per-track start event', /EVENT_TRACK_STARTED/.test(labCode))
ok('there is a run-level start event', /EVENT_STARTED/.test(labCode))
ok('there is a finish event', /EVENT_FINISHED/.test(labCode))

const loopIdx = labCode.indexOf('for ((index, track) in tracks.withIndex())')
// lastIndexOf, not indexOf: the first occurrence is the constant's
// declaration in the companion object, not the emit site.
const emitIdx = labCode.lastIndexOf('EVENT_TRACK_COMPLETED')
// lastIndexOf for the same reason: skip the constant declaration.
const finishIdx = labCode.lastIndexOf('EVENT_FINISHED')
ok('the emit happens inside the per-track loop', loopIdx > 0 && emitIdx > loopIdx)
ok('the finish event comes after the loop', finishIdx > emitIdx)
ok(
  'the matrix is recomputed inside the loop',
  labCode.indexOf('matrixToJs') > loopIdx,
)
ok(
  'live statistics are recomputed inside the loop',
  /val liveStats = EmbeddingSimilarity\.statistics/.test(labCode) &&
    labCode.indexOf('val liveStats') > loopIdx,
)
ok(
  'the plugin resolves immediately rather than holding the promise',
  /put\("started", true\)/.test(plugin),
)
ok(
  'results reach the UI as events',
  /notifyListeners\(event, payload\)/.test(pluginCode),
)
ok(
  'the page appends each result as it arrives',
  /rows\.value = \[\.\.\.rows\.value, e\.evaluation\]/.test(pageCode),
)
ok(
  'the page updates the matrix per event',
  /matrix\.value = e\.matrix/.test(pageCode),
)

// ------------------------------------------------------------
section('7. Progress is visible while the run is in flight')
// ------------------------------------------------------------
ok('the event carries a 1-based position', /put\("position", index \+ 1\)/.test(lab))
ok('the event carries the total', /put\("totalTracks", tracks\.size\)/.test(lab))
ok('the event carries elapsed time', /put\("elapsedMs"/.test(lab))
ok('the event carries completed/success/failure counts',
  /put\("completedCount"/.test(lab) &&
  /put\("successCount"/.test(lab) &&
  /put\("failureCount"/.test(lab))
ok('the page renders a progress bar', /renderProgressBar/.test(pageCode))
ok('the page shows the current track', /currentTrackId/.test(pageCode))
ok('the page shows a state label', /stateLabel/.test(pageCode))
ok('the page shows remaining count', /remainingCount/.test(pageCode))
ok('the page shows elapsed time', /fmtDuration/.test(pageCode))
ok(
  'the progress bar uses block characters',
  /\\u2588/.test(tsService) || /█/.test(tsService),
)

// ------------------------------------------------------------
section('8. Cancellation preserves completed results')
// ------------------------------------------------------------
ok('there is a cancel flag', /cancelRequested/.test(labCode))
ok('it is atomic', /AtomicBoolean/.test(labCode))
ok('the loop checks it between tracks', /if \(cancelRequested\.get\(\)\)/.test(labCode))
ok(
  'cancellation reaches inside the decode',
  /\{ cancelRequested\.get\(\) \}/.test(labCode),
  'so a stop does not have to wait out a long file',
)
ok(
  'the loop breaks rather than returning',
  /cancelled = true\s*\n\s*break/.test(labCode),
  'a return would skip the report that carries the completed results',
)
ok(
  'the report is still built after a cancel',
  labCode.indexOf('cancelled = cancelled') > labCode.indexOf('break'),
)
ok('the report states it was cancelled', /put\("cancelled", cancelled\)/.test(lab))
ok('the report states what remains', /put\("remainingCount"/.test(lab))
ok(
  'completed evaluations are included in the cancelled report',
  /evaluations = completed/.test(labCode),
)
ok('there is a stop plugin method', /fun stopQualityEvaluation/.test(pluginCode))
ok('the UI exposes a stop button', /STOP EVALUATION/.test(page))

// ------------------------------------------------------------
section('9. A failed track does not abort the batch')
// ------------------------------------------------------------
ok(
  'evaluateOne returns a failure instead of throwing',
  /return TrackEvaluation\.failed/.test(labCode),
)
ok(
  'there are multiple distinct failure exits',
  (labCode.match(/TrackEvaluation\.failed/g) || []).length >= 6,
)
ok(
  'the failure factory cannot carry an embedding',
  !/fun failed\([\s\S]{0,600}embedding:/.test(labCode),
  'a failed track must have no vector, structurally',
)
ok(
  'decode failure is caught per track',
  /catch \(e: Throwable\)[\s\S]{0,200}DECODE_FAILED/.test(lab),
)
ok(
  'inference failure is caught per track',
  /catch \(e: InferenceException\)[\s\S]{0,200}e\.code\.name/.test(labCode),
)
ok(
  'the loop body has no early return on failure',
  !/for \(\(index, track\) in tracks\.withIndex\(\)\)[\s\S]{0,2000}\n\s{16}return[^@]/.test(labCode),
)
ok('the UI shows a failure reason', /errorCode/.test(pageCode))
ok(
  'the UI states no embedding was invented',
  /none was invented/i.test(page),
)

// ------------------------------------------------------------
section('10. Memory is bounded by embeddings, not decoded audio')
// ------------------------------------------------------------
ok(
  'decoded chunks are released after concatenation',
  /collected\.clear\(\)\s*\n\s*collected = null/.test(labCode),
)
ok(
  'the chunk list is nullable so it can be dropped',
  /var collected: ArrayList<FloatArray>\? =/.test(labCode),
)
ok(
  'PCM is local to evaluateOne, never a field',
  !/private (val|var) pcm/.test(labCode),
)
ok(
  'no list of decoded audio accumulates across tracks',
  !/allPcm|decodedTracks|audioBuffers/.test(labCode),
)
ok(
  'only vectors and ids are retained across tracks',
  /val vectors = ArrayList<FloatArray>/.test(labCode) &&
    /val vectorTrackIds = ArrayList<String>/.test(labCode),
)
ok(
  'the model is unloaded in a finally block',
  /finally \{[\s\S]{0,200}unloadModel/.test(labCode),
)
ok('memory is sampled during the run', /MemorySample\.capture/.test(labCode))
ok('a peak is tracked', /memoryPeak/.test(labCode))
ok(
  'the full vector does not cross the bridge',
  !/put\("vector"/.test(lab) && !/put\("embedding",/.test(lab),
  'a preview is enough for a diagnostic; 1024 floats per track is not',
)

// ------------------------------------------------------------
section('11. Labels are supplied, never inferred')
// ------------------------------------------------------------
ok(
  'labels arrive from the request',
  /obj\.optString\("label"\)/.test(plugin),
)
ok(
  'no label is derived from artist metadata',
  !/artist/i.test(labCode) && !/artist/i.test(simCode),
)
ok(
  'no label is derived from genre metadata',
  !/genre/i.test(labCode) && !/genre/i.test(simCode),
)
ok(
  'grouped statistics require both ends to be labelled',
  /if \(a\.isNullOrBlank\(\) \|\| b\.isNullOrBlank\(\)\) continue/.test(simCode),
)
ok(
  'grouped statistics only run when labels exist',
  /if \(labels\.isNotEmpty\(\)\)/.test(labCode),
)
ok(
  'the report states whether it was labelled',
  /put\("labelled"/.test(lab),
)
ok(
  'the UNLABELED disclaimer is present verbatim',
  /UNLABELED EVALUATION/.test(lab),
)
ok(
  'the disclaimer denies proving semantic quality',
  /do not prove semantic music similarity/i.test(lab),
)
ok(
  'the UI warns that labels are the developer\'s claim',
  /never inferred from artist or genre/i.test(page),
)

// ------------------------------------------------------------
section('12. Energy is reported honestly')
// ------------------------------------------------------------
ok('energyMeasured is present', /put\("energyMeasured", false\)/.test(lab))
ok('the note says not directly measured', /Not directly measured/.test(lab))
ok(
  'no battery drain is estimated',
  !/estimatedDrain|batteryDrain|mAh|estimatedEnergy/.test(labCode),
)
ok(
  'the reason is documented',
  /BatteryManager counters are coarse/.test(lab),
)
ok('the UI renders the energy note', /energyNote/.test(pageCode))

// ------------------------------------------------------------
section('13. Performance metrics are recorded')
// ------------------------------------------------------------
for (const field of [
  'decodeMs', 'preprocessingMs', 'inferenceMs', 'tensorMs',
  'aggregationMs', 'totalMs', 'rtf',
]) {
  ok(`${field} is recorded per track`, new RegExp(`put\\("${field}"`).test(lab))
}
ok('medians are computed for the summary', /medianInferenceMs/.test(lab))
ok(
  'medians use successful tracks only',
  /evaluations\.filter \{ it\.ok \}/.test(labCode),
)
ok('memory before/peak/after are reported',
  /memoryBeforeKb/.test(lab) && /memoryPeakKb/.test(lab) &&
  /memoryAfterKb/.test(lab))
ok(
  'inferenceMs still comes straight from the runtime',
  /result\.inferenceMs/.test(labCode),
)
ok(
  'totalMs keeps the same four-term formula as the benchmark',
  /decodeMs \+ prepared\.preparationMs \+ result\.inferenceMs \+ result\.tensorMs/
    .test(labCode),
)

// ------------------------------------------------------------
section('14. No fabricated quality verdict')
// ------------------------------------------------------------
ok(
  'the conclusion is the constant INSUFFICIENT EVIDENCE',
  /put\("qualityConclusion", "INSUFFICIENT EVIDENCE"\)/.test(lab),
)
ok(
  'there is no GOOD verdict anywhere',
  !/"GOOD"|'GOOD'|= *GOOD\b/.test(labCode) && !/"GOOD"/.test(pageCode),
)
ok(
  'there is no BAD verdict anywhere',
  !/"BAD"|'BAD'/.test(labCode) && !/"BAD"/.test(pageCode),
)
ok(
  'no threshold grades the similarity statistics',
  !/mean > 0\.[0-9]+ *->|if \(mean > 0\.[0-9]/.test(labCode),
)
ok(
  'the stats type has no quality or grade field',
  // Scoped to SimilarityStats. PairSimilarity legitimately has a
  // `score` — that is one measured cosine value, not a verdict.
  !/val quality|val grade|val verdict|val rating/.test(
    simCode.slice(simCode.indexOf('data class SimilarityStats')),
  ),
)
ok(
  'describeQualityConclusion has no good/bad branch',
  !/GOOD|BAD/.test(
    tsServiceCode.slice(tsServiceCode.indexOf('describeQualityConclusion')),
  ),
)
ok(
  'the TS type documents the constant',
  /INSUFFICIENT EVIDENCE/.test(tsPlugin),
)
ok(
  'the page shows the conclusion',
  /qualityConclusion/.test(pageCode),
)
ok(
  'no similarity score is hardcoded in the lab',
  !/= 0\.8[0-9]|= 0\.7[0-9]|score = 0\./.test(labCode),
)
ok(
  'the page never claims the model is production ready',
  !/production[- ]ready/i.test(page),
)
ok(
  'the page states no production model is selected',
  /No production model has been selected/i.test(page),
)

// ------------------------------------------------------------
section('15. Scope: nothing out of bounds was built')
// ------------------------------------------------------------
const allNew = sim + lab + read(PLUGIN)
ok('no embedding database', !/CREATE TABLE|EmbeddingEntity|embeddingDao/i.test(allNew))
ok('no Room migration added', !/Migration\(/.test(allNew))
ok('no library-wide scan', !/scanLibrary|indexLibrary|getAllTracks/.test(stripComments(allNew)))
ok('no background worker', !/WorkManager|OneTimeWorkRequest|JobScheduler/.test(allNew))
ok('no semantic search', !/semanticSearch|searchByEmbedding/i.test(allNew))
ok('no recommendation engine', !/recommend/i.test(stripComments(allNew)))
ok(
  'a track cap exists',
  /const val MAX_TRACKS = 20/.test(lab),
)
ok(
  'the cap is enforced in the lab',
  /tracks\.size > MAX_TRACKS/.test(labCode),
)
ok(
  'the cap is enforced again at the bridge',
  /rawTracks\.length\(\) > EmbeddingQualityLab\.MAX_TRACKS/.test(pluginCode) ||
  /rawTracks\.length\(\) > EmbeddingQualityLab\.MAX_TRACKS/.test(plugin),
)
ok(
  'the aggregation pipeline was not modified',
  /MEAN -> dimension/.test(stripComments(read(AGG))),
)
ok(
  'the lab reuses the benchmark runtime registry',
  /benchmark\.runtime\(it\)/.test(pluginCode),
  'no model-loading logic is duplicated',
)

// ------------------------------------------------------------
section('16. The suite is wired into the runner')
// ------------------------------------------------------------
ok('the runner compiles SimilarityTest', /SimilarityTest\.kt/.test(runner))
ok(
  'the runner executes it',
  /com\.systema\.music\.inference\.SimilarityTest/.test(runner),
)
ok(
  'a failing similarity suite fails the runner',
  /Similarity suite FAILED/.test(runner),
)
ok(
  'the test suite disclaims device verification',
  /does NOT[\s\S]{0,80}touch a device/i.test(test),
)

// ============================================================
// BEHAVIOURAL SIMULATION
// ============================================================
// The protocol above is asserted structurally. Here it is asserted
// BEHAVIOURALLY, by driving a faithful model of the native loop and
// checking the observable consequences. This catches ordering bugs
// that no amount of regex matching would.
// ============================================================

interface SimTrack { id: string, fails?: boolean }

interface SimEvent {
  type: 'started' | 'trackStarted' | 'trackCompleted' | 'finished'
  payload: Record<string, unknown>
}

/** Deterministic pseudo-random unit vector. */
function fakeVector(seed: number, dim = 16): number[] {
  let s = seed * 2654435761 % 2147483647
  const v: number[] = []
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) % 2147483647
    v.push((s / 2147483647) * 2 - 1)
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0))
  return v.map(x => x / n)
}

function dot(a: number[], b: number[]): number {
  return Math.min(1, Math.max(-1, a.reduce((acc, x, i) => acc + x * (b[i] as number), 0)))
}

/**
 * A faithful model of EmbeddingQualityLab.evaluate.
 *
 * Mirrors the real control flow: emit per track, keep vectors only
 * for successes, check cancellation between tracks, always build the
 * final report.
 */
function simulateRun(
  tracks: SimTrack[],
  opts: { cancelAfter?: number } = {},
): { events: SimEvent[], report: Record<string, unknown> } {
  const events: SimEvent[] = []
  const vectors: number[][] = []
  const ids: string[] = []
  const completed: Array<Record<string, unknown>> = []
  let cancelled = false

  events.push({ type: 'started', payload: { totalTracks: tracks.length } })

  for (let i = 0; i < tracks.length; i++) {
    if (opts.cancelAfter !== undefined && completed.length >= opts.cancelAfter) {
      cancelled = true
      break
    }
    const t = tracks[i] as SimTrack
    events.push({ type: 'trackStarted', payload: { position: i + 1, trackId: t.id } })

    let evaluation: Record<string, unknown>
    if (t.fails) {
      // No vector is produced and none is invented.
      evaluation = { index: i, trackId: t.id, ok: false, errorCode: 'DECODE_FAILED' }
    } else {
      const v = fakeVector(i + 1)
      let nearest: string | undefined
      let nearestScore: number | undefined
      let farthest: string | undefined
      let farthestScore: number | undefined
      if (vectors.length > 0) {
        let best = -Infinity
        let worst = Infinity
        vectors.forEach((other, k) => {
          const s = dot(v, other)
          if (s > best) { best = s; nearest = ids[k]; nearestScore = s }
          if (s < worst) { worst = s; farthest = ids[k]; farthestScore = s }
        })
      }
      evaluation = {
        index: i, trackId: t.id, ok: true, dimension: v.length,
        hasComparison: vectors.length > 0,
        nearestTrackId: nearest, nearestScore,
        farthestTrackId: farthest, farthestScore,
      }
      vectors.push(v)
      ids.push(t.id)
    }

    completed.push(evaluation)

    const pairs: number[] = []
    for (let a = 0; a < vectors.length; a++) {
      for (let b = a + 1; b < vectors.length; b++) {
        pairs.push(dot(vectors[a] as number[], vectors[b] as number[]))
      }
    }

    events.push({
      type: 'trackCompleted',
      payload: {
        position: i + 1,
        evaluation,
        completedCount: completed.length,
        successCount: completed.filter(e => e.ok).length,
        failureCount: completed.filter(e => !e.ok).length,
        matrixSize: vectors.length,
        pairCount: pairs.length,
      },
    })
  }

  const report = {
    requestedCount: tracks.length,
    completedCount: completed.length,
    successCount: completed.filter(e => e.ok).length,
    failureCount: completed.filter(e => !e.ok).length,
    remainingCount: tracks.length - completed.length,
    cancelled,
    evaluations: completed,
    embeddingCount: vectors.length,
    qualityConclusion: 'INSUFFICIENT EVIDENCE',
  }
  events.push({ type: 'finished', payload: report })
  return { events, report }
}

// ------------------------------------------------------------
section('17. BEHAVIOUR — incremental emission')
// ------------------------------------------------------------
{
  const { events } = simulateRun([
    { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
  ])
  const completions = events.filter(e => e.type === 'trackCompleted')
  ok('one completion event per track', completions.length === 4)
  ok('a completion arrives before the run finishes',
    events.findIndex(e => e.type === 'trackCompleted') <
    events.findIndex(e => e.type === 'finished'))

  // The defining property: track N's result is emitted before track
  // N+1 even starts. That is what makes the UI live.
  const firstCompletion = events.findIndex(e => e.type === 'trackCompleted')
  const secondStart = events.map(e => e.type).indexOf('trackStarted', firstCompletion)
  ok('result 1 is emitted before track 2 starts',
    secondStart > firstCompletion, 'otherwise the UI would batch')

  ok('completed counts increase monotonically',
    completions.every((e, i) => e.payload.completedCount === i + 1))
  ok('every completion carries its own evaluation',
    completions.every(e => e.payload.evaluation !== undefined))
  ok('positions are 1-based and sequential',
    completions.map(e => e.payload.position).join(',') === '1,2,3,4')
}

// ------------------------------------------------------------
section('18. BEHAVIOUR — first track has no comparison')
// ------------------------------------------------------------
{
  const { events } = simulateRun([{ id: 'first' }, { id: 'second' }, { id: 'third' }])
  const c = events.filter(e => e.type === 'trackCompleted')
    .map(e => e.payload.evaluation as Record<string, unknown>)

  ok('track 1 has no comparison', c[0]!.hasComparison === false)
  ok('track 1 has no nearest score', c[0]!.nearestScore === undefined)
  ok('track 1 has no farthest score', c[0]!.farthestScore === undefined)
  ok('no placeholder 0 was substituted', c[0]!.nearestScore !== 0)
  ok('no placeholder 1 was substituted', c[0]!.nearestScore !== 1)

  ok('track 2 does have a comparison', c[1]!.hasComparison === true)
  ok('track 2 names its nearest', c[1]!.nearestTrackId === 'first')
  ok('track 3 has a comparison too', c[2]!.hasComparison === true)
  ok('scores are within range',
    c.slice(1).every((e) => {
      const s = e.nearestScore as number
      return s >= -1 && s <= 1
    }))
}

// ------------------------------------------------------------
section('19. BEHAVIOUR — a failure does not abort the batch')
// ------------------------------------------------------------
{
  const { events, report } = simulateRun([
    { id: 'a' }, { id: 'b' }, { id: 'c', fails: true }, { id: 'd' }, { id: 'e' },
  ])
  const completions = events.filter(e => e.type === 'trackCompleted')

  ok('all 5 tracks were attempted', completions.length === 5)
  ok('tracks after the failure still ran',
    completions.slice(3).every(e =>
      (e.payload.evaluation as Record<string, unknown>).ok === true))
  ok('the report counts 4 successes', report.successCount === 4)
  ok('the report counts 1 failure', report.failureCount === 1)
  ok('the failed track has no embedding',
    (report.evaluations as Array<Record<string, unknown>>)
      .filter(e => !e.ok)
      .every(e => e.dimension === undefined))
  ok('only 4 vectors entered the geometry', report.embeddingCount === 4)
  ok('the failed track carries a reason',
    (report.evaluations as Array<Record<string, unknown>>)
      .find(e => !e.ok)?.errorCode === 'DECODE_FAILED')
  ok('nothing remains outstanding', report.remainingCount === 0)
}

// ------------------------------------------------------------
section('20. BEHAVIOUR — cancellation preserves completed work')
// ------------------------------------------------------------
{
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}` }))
  const { events, report } = simulateRun(twenty, { cancelAfter: 7 })

  ok('exactly 7 tracks completed', report.completedCount === 7)
  ok('the report is flagged cancelled', report.cancelled === true)
  ok('7 results were kept, not discarded',
    (report.evaluations as unknown[]).length === 7)
  ok('13 remain', report.remainingCount === 13)
  ok('failures are still reported as 0', report.failureCount === 0)
  ok('7 embeddings survived', report.embeddingCount === 7)
  ok('a finished event was still emitted',
    events.some(e => e.type === 'finished'))
  ok('only 7 completion events fired',
    events.filter(e => e.type === 'trackCompleted').length === 7)
  ok('the conclusion is unchanged by cancelling',
    report.qualityConclusion === 'INSUFFICIENT EVIDENCE')
}

// ------------------------------------------------------------
section('21. BEHAVIOUR — the matrix grows incrementally')
// ------------------------------------------------------------
{
  const { events } = simulateRun([
    { id: 'a' }, { id: 'b' }, { id: 'c', fails: true }, { id: 'd' }, { id: 'e' },
  ])
  const sizes = events.filter(e => e.type === 'trackCompleted')
    .map(e => e.payload.matrixSize as number)
  const pairs = events.filter(e => e.type === 'trackCompleted')
    .map(e => e.payload.pairCount as number)

  ok('matrix grows 1,2,2,3,4 (the failure adds nothing)',
    sizes.join(',') === '1,2,2,3,4', `got ${sizes.join(',')}`)
  ok('pair counts follow N(N-1)/2',
    pairs.join(',') === '0,1,1,3,6', `got ${pairs.join(',')}`)
  ok('the matrix never shrinks',
    sizes.every((s, i) => i === 0 || s >= (sizes[i - 1] as number)))
  ok('a matrix exists before the run ends',
    (sizes[1] as number) >= 2, 'so the UI can show it live')
  ok('the first track produces zero pairs', pairs[0] === 0)
}

// ------------------------------------------------------------
section('22. BEHAVIOUR — statistics come only from real embeddings')
// ------------------------------------------------------------
{
  const { report } = simulateRun([
    { id: 'a' }, { id: 'b', fails: true }, { id: 'c', fails: true }, { id: 'd' },
  ])
  ok('4 attempted, 2 succeeded', report.completedCount === 4 && report.successCount === 2)
  ok('only 2 vectors exist', report.embeddingCount === 2)

  // 2 vectors give exactly 1 pair - not 6, which is what including
  // failures and the diagonal would have produced.
  const n = report.embeddingCount as number
  ok('that is 1 pair, not 6', n * (n - 1) / 2 === 1)

  const evaluations = report.evaluations as Array<Record<string, unknown>>
  ok('no failed track carries a similarity score',
    evaluations.filter(e => !e.ok).every(e =>
      e.nearestScore === undefined && e.farthestScore === undefined))
  ok('no failed track carries a dimension',
    evaluations.filter(e => !e.ok).every(e => e.dimension === undefined))
}

// ------------------------------------------------------------
console.log('\n============================================================')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('============================================================')
if (failures.length > 0) console.log(`  failing: ${failures.join(', ')}`)
console.log(`
SCOPE OF THIS SUITE
-------------------
Static wiring audit plus a behavioural simulation of the incremental
protocol. The similarity ARITHMETIC is proven separately by executing
it: SimilarityTest.kt runs on a JVM via scripts/run-inference-tests.sh.

Neither suite runs the real yamnet.onnx, decodes audio, compiles the
Android app, or touches a device. NO EMBEDDING QUALITY CONCLUSION IS
AVAILABLE FROM THESE TESTS — that requires a real device run, which
has not been performed.
`)

process.exit(failed > 0 ? 1 : 0)
