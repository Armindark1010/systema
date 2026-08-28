<script setup lang="ts">
// ============================================================
// SYSTEMA — Labelled Quality Evaluation (Phase 18)
// ============================================================
// Phase 17 showed the embeddings have geometry: 78 pairs, mean cosine
// 0.7439. It could not show whether that geometry means anything,
// because unrelated tracks also scored 0.8-0.9 and there was no ground
// truth to check against.
//
// This page adds the ground truth. A person labels pairs SAME /
// SIMILAR / DIFFERENT *before* the cosines are computed, and the run
// then reports whether cosine actually orders those labels.
//
// TWO RULES THIS PAGE IS BUILT AROUND
// -----------------------------------
// 1. A label is entered before its measurement and never changes
//    afterwards. Once a run starts, the label controls are locked.
// 2. No cosine threshold is invented. Separation is reported as a
//    rank statistic (AUC), which needs no cutoff at all.
//
// WHY EVERYTHING IS EVENT-DRIVEN
// ------------------------------
// 13 tracks then 78 pairs takes minutes. Each track and each pair is
// rendered the instant native produces it, so the screen always shows
// progress rather than looking hung.
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  describeClass,
  describeVerdict,
  formatAuc,
  formatDeltaMb,
  formatMb,
  getLabeledEvaluationStatus,
  onLabeledEvalEvents,
  renderProgressBar,
  runLabeledEvaluation,
  stopLabeledEvaluation,
  getCapabilities,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  RUNTIME_ONNX,
  type ClassStats,
  type LabeledEvaluationReport,
  type LabeledPairResult,
  type MemoryCheckpointSample,
  type PairLabel,
  type SeparationAnalysis,
  type TrackEmbeddingRow,
  type MaybeNumber,
} from '~/services/native/inferencePlugin'
import {
  LABEL_DEFINITIONS,
  LABEL_ORDER,
  MIN_CLASS_PAIRS,
  allPairs,
  labellingReadiness,
  pairKey,
  seededLabelMap,
  SEEDED_LABELS,
} from '~/data/labeledPairs'
import {
  buildDataset,
  countByLabel,
  emptyDataset,
  fromPositionalLabels,
  loadDataset,
  mergeDatasets,
  parseDataset,
  saveDataset,
  toPositionalLabels,
  validateDataset,
  type DatasetTrack,
  type LabelDataset,
} from '~/services/ai-lab/labelDataset'
import {
  findComparison,
  mapClassStats,
  mapNativeReport,
  mapPairs,
  tallyConsistency,
  verifyPairIntegrity,
} from '~/services/ai-lab/reportMapping'
import {
  copyToClipboard,
  downloadText,
  toJson,
  toMarkdown,
  toPlainText,
  toSummary,
  type EvaluationReportInput,
} from '~/services/ai-lab/reportExport'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Labelled quality evaluation' })

const library = useLibraryStore()
const router = useRouter()
const available = isInferenceAvailable()

// ---- Model selection ------------------------------------------
const models = ref<Array<{ id: string, name: string }>>([])
const modelId = ref('')
const loadingModels = ref(false)

async function loadModels() {
  if (!available) return
  loadingModels.value = true
  try {
    const caps = await getCapabilities()
    // The bundled arithmetic test model is excluded on purpose: it has
    // no audio contract and would fail every track with the same error.
    models.value = caps.models
      .filter(m => m.installed && m.id !== 'systema-test-model')
      .map(m => ({ id: m.id, name: m.name }))
    if (!modelId.value && models.value.length > 0) {
      modelId.value = models.value[0]!.id
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loadingModels.value = false
  }
}

// ---- Track selection ------------------------------------------
const tracks = computed(() => library.tracks ?? [])
const selected = ref<string[]>([])

function toggleTrack(id: string) {
  if (running.value) return
  const at = selected.value.indexOf(id)
  if (at >= 0) {
    selected.value = selected.value.filter(t => t !== id)
    // Labels are keyed by POSITION in the selection, so removing a
    // track would silently repoint every later label onto the wrong
    // pair. Clearing is the honest response.
    resetLabels()
  } else {
    selected.value = [...selected.value, id]
    resetLabels()
  }
}

const selectedTitles = computed(() =>
  selected.value.map(id => tracks.value.find(t => t.id === id)?.title ?? id),
)

// ---- Labels ---------------------------------------------------
//
// Keyed "i:j" against the CURRENT selection order.
const labels = ref<Record<string, { label: PairLabel, source: 'HUMAN' | 'FIXTURE' }>>({})
const showLabeller = ref(false)

function resetLabels() {
  labels.value = {}
}

// ---- Phase 20: persistent dataset (§12) -----------------------
//
// Labels used to live only in the ref above, so a refresh, a route
// change or a rerun destroyed hours of human judgement. They are
// research data, so they are now persisted by STABLE TRACK ID and
// survive all three.
//
// Positional "i:j" keys are converted at this boundary and never
// stored: they are only valid for one exact selection order.

const datasetStatus = ref<string | null>(null)
const importSummary = ref<ImportSummary | null>(null)
const pendingImport = ref<LabelDataset | null>(null)
const importIsMerge = ref(true)
const confirmReplace = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

interface ImportSummary {
  ok: boolean
  issues: { severity: string, code: string, message: string }[]
  trackCount: number
  pairCount: number
  counts: { same: number, similar: number, different: number }
  missingTracks: string[]
  duplicates: string[]
  conflicts: { pairId: string, existingLabel: string, incomingLabel: string }[]
  added: number
  unchanged: number
}

/** Tracks currently selected, as portable dataset records. */
function currentDatasetTracks(): DatasetTrack[] {
  return selected.value.map((id) => {
    const t = tracks.value.find(x => x.id === id)
    return {
      id,
      title: t?.title ?? id,
      uri: t?.uri ?? undefined,
      artist: (t as any)?.artist ?? undefined,
    }
  })
}

/** The complete dataset: persisted pairs merged with on-screen labels. */
function currentDataset(): LabelDataset {
  const stored = loadDataset() ?? emptyDataset()
  const live = buildDataset(
    currentDatasetTracks(),
    fromPositionalLabels(selected.value, labels.value),
  )
  // Live edits win over the stored copy for the same pair, because the
  // on-screen state is what the human most recently decided.
  return mergeDatasets(live, stored).dataset
}

function persistLabels() {
  // Deliberately unguarded. The storage adapter already handles the
  // quota / private-mode failure internally, so wrapping this again
  // would only add a second silent swallow point on the page that the
  // white-screen regression exists to keep clear.
  saveDataset(currentDataset())
}

// Autosave. Deep watch is safe here: `labels` holds only small
// {label, source} records, never embeddings or tensors.
watch(labels, () => {
  if (Object.keys(labels.value).length > 0) persistLabels()
}, { deep: true })

/** Re-applies stored labels whenever the selection changes. */
function restoreLabelsForSelection() {
  const stored = loadDataset()
  if (!stored || selected.value.length < 2) return
  const restored = toPositionalLabels(selected.value, stored.pairs)
  const n = Object.keys(restored).length
  if (n === 0) return
  labels.value = { ...restored, ...labels.value }
  datasetStatus.value = `Restored ${n} saved label${n === 1 ? '' : 's'} for this selection.`
}

watch(selected, () => { restoreLabelsForSelection() }, { deep: true })
onMounted(() => {
  const stored = loadDataset()
  if (stored && stored.pairs.length) {
    datasetStatus.value
      = `${stored.pairs.length} saved label(s) available across ${stored.tracks.length} track(s).`
  }
  restoreLabelsForSelection()
})

function exportDataset() {
  const d = currentDataset()
  if (d.pairs.length === 0) {
    datasetStatus.value = 'Nothing to export — no labels recorded yet.'
    return
  }
  saveDataset(d)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  downloadText(`systema-labels-${stamp}.json`, JSON.stringify(d, null, 2))
  datasetStatus.value = `Exported ${d.pairs.length} pair(s) and ${d.tracks.length} track(s).`
}

function backupDataset() {
  exportDataset()
}

function chooseImportFile(merge: boolean) {
  importIsMerge.value = merge
  confirmReplace.value = false
  fileInput.value?.click()
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const text = await file.text()
  const { data, parseError } = parseDataset(text)
  if (parseError) {
    importSummary.value = {
      ok: false,
      issues: [{ severity: 'ERROR', code: 'BAD_JSON', message: `Invalid JSON: ${parseError}` }],
      trackCount: 0, pairCount: 0, counts: { same: 0, similar: 0, different: 0 },
      missingTracks: [], duplicates: [], conflicts: [], added: 0, unchanged: 0,
    }
    pendingImport.value = null
    return
  }

  const v = validateDataset(data)
  // Validate BEFORE applying anything: an invalid file must change nothing.
  if (!v.ok) {
    importSummary.value = {
      ok: false, issues: v.issues, trackCount: v.trackCount, pairCount: v.pairCount,
      counts: v.counts, missingTracks: v.missingTrackRefs, duplicates: v.duplicatePairIds,
      conflicts: [], added: 0, unchanged: 0,
    }
    pendingImport.value = null
    return
  }

  const incoming = data as LabelDataset
  const existing = loadDataset() ?? emptyDataset()
  const preview = mergeDatasets(existing, incoming)

  pendingImport.value = incoming
  importSummary.value = {
    ok: true, issues: v.issues, trackCount: v.trackCount, pairCount: v.pairCount,
    counts: v.counts, missingTracks: v.missingTrackRefs, duplicates: v.duplicatePairIds,
    conflicts: preview.conflicts, added: preview.added, unchanged: preview.unchanged,
  }
}

function applyImport() {
  const incoming = pendingImport.value
  if (!incoming) return

  if (importIsMerge.value) {
    const existing = loadDataset() ?? emptyDataset()
    const merged = mergeDatasets(existing, incoming)
    saveDataset(merged.dataset)
    datasetStatus.value
      = `Merged: ${merged.added} added, ${merged.unchanged} unchanged, `
      + `${merged.conflicts.length} conflict(s) kept as existing.`
  }
  else {
    // Destructive, and never the default. Guarded by an explicit
    // confirmation checkbox in the template.
    if (!confirmReplace.value) {
      datasetStatus.value = 'REPLACE requires explicit confirmation.'
      return
    }
    saveDataset(incoming)
    datasetStatus.value = `Replaced dataset with ${incoming.pairs.length} pair(s).`
  }

  pendingImport.value = null
  importSummary.value = null
  confirmReplace.value = false
  labels.value = {}
  restoreLabelsForSelection()
}

function cancelImport() {
  pendingImport.value = null
  importSummary.value = null
  confirmReplace.value = false
}

// ---- Report export (§12) --------------------------------------

/**
 * Resolves a stable track id to a display title.
 *
 * The report previously emitted blank Track A / Track B cells because
 * it read `trackA`/`trackB` (which the native contract does not have)
 * and never looked a title up at all. Falling back to the id keeps a
 * row identifiable when a track has left the library.
 */
function resolveTrackTitle(trackId: string): string | null {
  const fromDataset = currentDataset().tracks.find(t => t.id === trackId)
  if (fromDataset?.title) return fromDataset.title
  const fromLibrary = tracks.value.find(t => t.id === trackId)
  return fromLibrary?.title ?? null
}

function buildReportInput(): EvaluationReportInput {
  const d = currentDataset()
  const counts = countByLabel(d.pairs)

  // A completed native run is the authoritative source. Map it through
  // the tested contract mapper rather than re-reading fields here.
  if (report.value) {
    const { input } = mapNativeReport(report.value, {
      phase: 'Phase 20',
      modelId: modelId.value || null,
      modelName: models.value.find(m => m.id === modelId.value)?.name ?? null,
      datasetVersion: d.datasetVersion,
      resolveTitle: resolveTrackTitle,
      expectedCounts: counts.same + counts.similar + counts.different > 0
        ? counts
        : undefined,
    })
    return input
  }

  // Reached only when no completed native report exists, so the live
  // (mid-run) values are the best available source.
  const sep = liveSeparation.value as any
  const mem = memoryTimeline.value
  // The native timeline reports KB; the report is stated in MB.
  // `null` when a checkpoint is absent, never 0 — a missing sample and
  // a genuine 0 MB reading must not render the same way.
  const toMb = (kb: number | null | undefined) =>
    typeof kb === 'number' && Number.isFinite(kb) ? kb / 1024 : null
  const at = (name: string) =>
    toMb(mem.find(m => m.checkpoint === name)?.sample?.totalPssKb)

  const baseline = at('BEFORE_MODEL_LOAD')
  const post = at('AFTER_SESSION_CLEANUP')
  const peakKb = mem.length
    ? Math.max(...mem.map(m => m.runningPeakKb ?? m.sample?.totalPssKb ?? 0))
    : null
  const peak = peakKb ? toMb(peakKb) : null

  return {
    phase: 'Phase 20',
    timestamp: new Date().toISOString(),
    modelId: modelId.value || null,
    modelName: models.value.find(m => m.id === modelId.value)?.name ?? null,
    deviceLabel: null,
    osVersion: null,
    // Only a completed native run counts. No run => not verified.
    deviceVerified: Boolean(report.value) && available,
    datasetVersion: d.datasetVersion,
    trackCount: d.tracks.length,
    pairCount: d.pairs.length,
    counts,
    // Live (mid-run) values use the same contract mapper, so this path
    // cannot drift back to inventing field names that do not exist.
    sameVsDifferentAuc: findComparison(sep?.comparisons, 'SAME', 'DIFFERENT').auc,
    similarVsDifferentAuc: findComparison(sep?.comparisons, 'SIMILAR', 'DIFFERENT').auc,
    sameVsSimilarAuc: findComparison(sep?.comparisons, 'SAME', 'SIMILAR').auc,
    overlapPercent: (() => {
      const f = findComparison(sep?.comparisons, 'SIMILAR', 'DIFFERENT').overlapFraction
      return f === null ? null : f * 100
    })(),
    classStats: mapClassStats(liveClasses.value ?? []),
    pairs: mapPairs(pairs.value, resolveTrackTitle),
    consistency: tallyConsistency(pairs.value),
    integrity: verifyPairIntegrity(pairs.value),
    embeddingDimension: rows.value[0]?.dimension ?? null,
    pooling: 'MEAN',
    memory: {
      baselinePssMb: baseline,
      peakPssMb: peak,
      postCleanupPssMb: post,
      retainedMb: baseline !== null && post !== null ? post - baseline : null,
      classification: post !== null && baseline !== null
        ? (post - baseline <= 0 ? 'RELEASED' : 'SEE MEMORY AUDIT')
        : null,
    },
    verdict: report.value ? 'See separation metrics above' : 'NOT MEASURED — no run completed',
    warnings: [],
    blockers: [],
    nextAction: 'Human decision required. No production model selected.',
  }
}

async function copyReport() {
  const ok = await copyToClipboard(toMarkdown(buildReportInput()))
  datasetStatus.value = ok ? 'Report copied to clipboard.' : 'Clipboard unavailable.'
}

async function copySummary() {
  const ok = await copyToClipboard(toSummary(buildReportInput()))
  datasetStatus.value = ok ? 'Summary copied to clipboard.' : 'Clipboard unavailable.'
}

function exportReport(format: 'json' | 'md' | 'txt') {
  const input = buildReportInput()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (format === 'json') {
    downloadText(`systema-report-${stamp}.json`, toJson(input), 'application/json')
  }
  else if (format === 'md') {
    downloadText(`systema-report-${stamp}.md`, toMarkdown(input), 'text/markdown')
  }
  else {
    downloadText(`systema-report-${stamp}.txt`, toPlainText(input), 'text/plain')
  }
  datasetStatus.value = `Report exported as ${format.toUpperCase()}.`
}

/**
 * Applies the documented seed labels.
 *
 * Only meaningful when the selection matches the Phase 17 ordering,
 * so it is offered rather than applied automatically.
 */
function applySeeds() {
  if (running.value) return
  labels.value = { ...labels.value, ...seededLabelMap() }
}

function setLabel(i: number, j: number, label: PairLabel) {
  // Locked during a run: a label edited after its cosine is known is
  // no longer ground truth.
  if (running.value) return
  const key = pairKey(i, j)
  const current = labels.value[key]
  if (current?.label === label) {
    // Tapping the active label clears it — unlabelled is a valid,
    // and honest, state.
    const next = { ...labels.value }
    delete next[key]
    labels.value = next
  } else {
    labels.value = { ...labels.value, [key]: { label, source: 'HUMAN' } }
  }
}

const pairList = computed(() => allPairs(selected.value.length))
const readiness = computed(() => labellingReadiness(labels.value))
const labelledCount = computed(() => Object.keys(labels.value).length)

// ---- Run state ------------------------------------------------
const running = ref(false)
const stopping = ref(false)
const error = ref<string | null>(null)
const stage = ref<'idle' | 'embedding' | 'pairing' | 'done'>('idle')

const rows = ref<TrackEmbeddingRow[]>([])
const trackPosition = ref(0)
const trackTotal = ref(0)

const pairs = ref<LabeledPairResult[]>([])
const pairPosition = ref(0)
const pairTotal = ref(0)

const liveClasses = ref<ClassStats[]>([])
const liveSeparation = ref<SeparationAnalysis | null>(null)
const memoryTimeline = ref<MemoryCheckpointSample[]>([])
const report = ref<LabeledEvaluationReport | null>(null)

// ---- Native payload guards ------------------------------------
//
// Everything below arrives from Kotlin over the Capacitor bridge. It
// is validated at the boundary, once, before it reaches reactive
// state — not at each of the dozens of places the template reads it.
//
// This is a guard, not a repair: nothing here invents a value or
// substitutes a plausible-looking default for a measurement. A
// payload that fails these checks is DROPPED and REPORTED, because a
// fabricated number in a results table is worse than a gap.

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A finite number, or the fallback. Never NaN, null or a string. */
function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Count of payloads rejected this run; surfaced in the UI. */
const malformedEvents = ref<string[]>([])

function noteMalformed(event: string, payload: unknown) {
  const note = `${event}: unusable payload`
  // Goes to logcat via `adb logcat -s chromium`, with the payload, so
  // the shape can actually be diagnosed on the device.
  console.error('[labelled-eval] dropped malformed event', event, payload)
  if (!malformedEvents.value.includes(note)) {
    malformedEvents.value = [...malformedEvents.value, note]
  }
}

const wallClockMs = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
let dispose: (() => void) | null = null

/**
 * Removes the native listeners and stops the clock.
 *
 * Idempotent, and always called before a new run subscribes. Each
 * onLabeledEvalEvents() registers FIVE Capacitor listeners; without
 * this a second run would leave the first run's five attached, and
 * every event would be handled twice — duplicated rows and pairs, and
 * a wall clock ticking at double speed.
 */
function disposeListeners() {
  dispose?.()
  dispose = null
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

const trackProgress = computed(() =>
  renderProgressBar(trackPosition.value, trackTotal.value || 1),
)
const pairProgress = computed(() =>
  renderProgressBar(pairPosition.value, pairTotal.value || 1),
)

// Newest first: with 78 pairs the interesting one is the one that just
// landed, and it should not require scrolling to find.
const pairsNewestFirst = computed(() => [...pairs.value].reverse())

/**
 * The scored pairs, mapped through the SAME contract mapper the report
 * uses. Phase 21.4's analysis reads this; it does not re-derive
 * cosines and does not run anything.
 */
const analysablePairs = computed(() => mapPairs(pairs.value, resolveTrackTitle))

async function start() {
  if (!available || running.value) return
  if (!modelId.value) {
    error.value = 'Select a model first.'
    return
  }
  if (selected.value.length < 2) {
    error.value = 'Select at least two tracks — a pair needs both ends.'
    return
  }

  error.value = null
  report.value = null
  rows.value = []
  pairs.value = []
  liveClasses.value = []
  liveSeparation.value = null
  memoryTimeline.value = []
  trackPosition.value = 0
  pairPosition.value = 0
  pairTotal.value = labelledCount.value
  trackTotal.value = selected.value.length
  wallClockMs.value = 0
  running.value = true
  stage.value = 'embedding'

  // Clears any previous run's listeners AND its interval before this
  // run subscribes again.
  disposeListeners()
  renderError.value = null
  malformedEvents.value = []
  dispose = await onLabeledEvalEvents({
    onStarted: (e) => {
      trackTotal.value = e.totalTracks
      pairTotal.value = e.totalLabelledPairs
    },
    onTrackCompleted: (e) => {
      // Rendered immediately, one track at a time.
      //
      // The payload is validated before it enters reactive state.
      // Anything that reaches `rows` is rendered, and a malformed row
      // that got that far would throw during render — which is what
      // blanks the page. Rejecting it here keeps the damage to one
      // missing row, reported in the error line.
      if (!isRecord(e) || !isRecord(e.row)) {
        noteMalformed('trackCompleted', e)
        return
      }
      rows.value = [...rows.value, e.row]
      trackPosition.value = numberOr(e.position, trackPosition.value + 1)
      if (numberOr(e.position, 0) >= numberOr(e.totalTracks, trackTotal.value)) {
        stage.value = 'pairing'
      }
    },
    onPairCompleted: (e) => {
      // Rendered immediately, one pair at a time. This is the
      // requirement the whole page is shaped around.
      if (!isRecord(e) || !isRecord(e.pair)) {
        noteMalformed('pairCompleted', e)
        return
      }
      pairs.value = [...pairs.value, e.pair]
      pairPosition.value = numberOr(e.position, pairPosition.value + 1)
      pairTotal.value = numberOr(e.totalPairs, pairTotal.value)
      // Arrays only: `v-for` over a non-array renders nothing useful
      // and `.length` on a non-array throws in the template.
      liveClasses.value = Array.isArray(e.classStats) ? e.classStats : []
      liveSeparation.value = isRecord(e.separation) ? e.separation : null
    },
    onMemory: (e) => {
      if (!isRecord(e) || !isRecord(e.sample)) {
        noteMalformed('memory', e)
        return
      }
      memoryTimeline.value = [...memoryTimeline.value, e]
    },
    onFinished: (e) => {
      running.value = false
      stopping.value = false
      stage.value = 'done'
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
      if (!isRecord(e)) {
        noteMalformed('finished', e)
        error.value = 'The evaluation finished but sent no readable report.'
        return
      }
      if (e.failed) {
        error.value = e.errorMessage ?? 'The evaluation failed.'
        return
      }
      // The final report drives the largest render on the page. If its
      // required sub-objects are missing, say so instead of mounting a
      // panel that will throw.
      if (!isRecord(e.separation) || !isRecord(e.memory)) {
        noteMalformed('finished.report', e)
        error.value = 'The final report was incomplete, so it is not shown. '
          + 'Per-pair results above are unaffected.'
        return
      }
      report.value = e
    },
  })

  const startedAt = Date.now()
  tickTimer = setInterval(() => {
    if (running.value) wallClockMs.value = Date.now() - startedAt
  }, 500)

  try {
    await runLabeledEvaluation({
      runtimeId: RUNTIME_ONNX,
      modelId: modelId.value,
      tracks: selected.value.map(id => ({
        trackId: id,
        uri: tracks.value.find(t => t.id === id)?.uri ?? '',
      })),
      pairLabels: labels.value,
    })
  } catch (e) {
    // The native call itself was rejected, so no finished event is
    // coming: tear the subscription down here or it leaks.
    running.value = false
    stage.value = 'idle'
    error.value = (e as Error).message
    disposeListeners()
  }
}

async function stop() {
  if (!running.value) return
  stopping.value = true
  try {
    await stopLabeledEvaluation()
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(async () => {
  if (!available) return
  await loadModels()
  try {
    const status = await getLabeledEvaluationStatus()
    running.value = status.running
  } catch {
    // A status probe failing must not block the page.
  }
})

onBeforeUnmount(() => {
  disposeListeners()
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})

// ---- Render safety net --------------------------------------
//
// The results panels below are wrapped in <DevResultsBoundary>. A
// TypeError thrown inside a render function unmounts the Vue tree and
// leaves a blank (but still scrollable) page — the symptom this page
// was reported with. The bridge bug that caused it is fixed at source;
// the boundary makes the class of failure non-fatal.
//
// It has to be a child component: onErrorCaptured never sees errors
// raised by the component that declares it.
//
// Recorded here too so a display failure is visible in the run's own
// error line, not only inside the collapsed panel.
const renderError = ref<string | null>(null)

function onPanelError(message: string) {
  renderError.value = message
}

// ---- Display helpers ------------------------------------------
function labelOf(i: number, j: number): PairLabel | null {
  return labels.value[pairKey(i, j)]?.label ?? null
}

function titleAt(i: number): string {
  const id = selected.value[i]
  return tracks.value.find(t => t.id === id)?.title ?? id ?? `#${i}`
}

/**
 * Renders an enum name for display without assuming it is a string.
 *
 * A malformed payload must degrade to a readable placeholder rather
 * than throw `.replace is not a function` inside the render.
 */
function prettyVerdict(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v.replace(/_/g, ' ') : 'UNKNOWN'
}

function outcomeClass(o: string): string {
  if (o === 'CONSISTENT') return 'text-success'
  if (o === 'INCONSISTENT') return 'text-danger'
  return 'text-fg-faint'
}

function verdictClass(v: string | undefined): string {
  if (v === 'CLEAR_SEPARATION') return 'text-success'
  if (v === 'HEAVY_OVERLAP') return 'text-danger'
  return 'text-fg-muted'
}

// Both accept null: the bridge sends JSON null for a non-finite
// double (see EvaluationJson.kt putNumeric), and `null.toFixed` is
// the crash that used to blank this page.
function fmt(n: MaybeNumber | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function fmtMs(n: MaybeNumber | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(0)} ms`
}

const elapsedLabel = computed(() => {
  const s = Math.floor(wallClockMs.value / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
})
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <div class="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <!-- ---- Header ------------------------------------- -->
      <header class="space-y-2">
        <button
          type="button"
          class="text-micro text-fg-faint hover:text-fg t-col"
          @click="router.push('/dev/ai-benchmark')"
        >
          ← AI BENCHMARK
        </button>
        <h1 class="text-h2 font-semibold tracking-tight">
          Labelled Quality Evaluation
        </h1>
        <p class="text-small text-fg-muted max-w-[72ch] leading-relaxed">
          You label pairs SAME / SIMILAR / DIFFERENT first. Then the model
          measures them. The run reports whether cosine actually orders your
          labels — using a rank statistic, so no similarity threshold is
          invented anywhere.
        </p>
      </header>

      <!-- ---- Not on device ------------------------------ -->
      <section
        v-if="!available"
        class="border border-line rounded-lg bg-surface p-4 space-y-2"
      >
        <p class="label text-fg-faint">ANDROID BUILD ONLY</p>
        <p class="text-small text-fg-muted">
          This lab needs the native inference plugin. Run it in the Android
          app; the browser has no model and no audio decoder.
        </p>
      </section>

      <template v-else>
        <!-- ---- Error ------------------------------------ -->
        <section
          v-if="error"
          class="border border-danger/40 rounded-lg bg-danger/5 p-4"
        >
          <p class="label text-danger">EVALUATION ERROR</p>
          <p class="text-small text-fg mt-1">{{ error }}</p>
        </section>

        <!--
          A results panel failed to RENDER. Distinct from an evaluation
          error: the run itself may have completed correctly. Shown
          outside the boundary so it is visible even when the panel
          that raised it is collapsed.
        -->
        <section
          v-if="renderError"
          class="border border-danger/40 rounded-lg bg-danger/5 p-4"
        >
          <p class="label text-danger">RESULTS DISPLAY ERROR</p>
          <p class="text-small text-fg mt-1 leading-relaxed">
            The evaluation data arrived but a results panel could not be
            drawn. The run is unaffected; the failing panel is isolated
            below. Full trace is in <span class="font-mono">logcat</span>.
          </p>
          <p class="text-micro text-fg-muted mt-1 font-mono break-all">
            {{ renderError }}
          </p>
        </section>

        <!-- ---- Step 1: model ---------------------------- -->
        <section class="border border-line rounded-lg bg-surface p-4 space-y-3">
          <p class="label text-fg-faint">STEP 1 — MODEL</p>
          <p v-if="loadingModels" class="text-small text-fg-muted">Loading…</p>
          <p v-else-if="models.length === 0" class="text-small text-fg-muted">
            No installed model. Import one in the ONNX Runtime Lab first.
          </p>
          <div v-else class="flex flex-wrap gap-2">
            <button
              v-for="m in models"
              :key="m.id"
              type="button"
              :disabled="running"
              class="chip"
              :class="modelId === m.id ? 'sys-btn' : 'sys-btn-outline'"
              @click="modelId = m.id"
            >
              {{ m.name }}
            </button>
          </div>
        </section>

        <!-- ---- Step 2: tracks --------------------------- -->
        <section class="border border-line rounded-lg bg-surface p-4 space-y-3">
          <div class="flex items-baseline justify-between">
            <p class="label text-fg-faint">STEP 2 — TRACKS</p>
            <p class="text-micro text-fg-faint tnum">
              {{ selected.length }} selected
            </p>
          </div>
          <p class="text-micro text-fg-faint">
            Order matters: labels are keyed to selection position, so changing
            the selection clears them.
          </p>
          <div class="max-h-64 overflow-y-auto space-y-1">
            <button
              v-for="t in tracks"
              :key="t.id"
              type="button"
              :disabled="running"
              class="w-full text-left px-2 py-1.5 rounded text-small t-col"
              :class="selected.includes(t.id)
                ? 'bg-accent/10 text-fg'
                : 'text-fg-muted hover:bg-surface-2'"
              @click="toggleTrack(t.id)"
            >
              <span class="tnum text-micro text-fg-faint mr-2">
                {{ selected.includes(t.id) ? `#${selected.indexOf(t.id) + 1}` : '—' }}
              </span>
              {{ t.title }}
            </button>
          </div>
        </section>

        <!-- ---- Step 3: labels --------------------------- -->
        <section class="border border-line rounded-lg bg-surface p-4 space-y-3">
          <div class="flex items-baseline justify-between">
            <p class="label text-fg-faint">STEP 3 — HUMAN LABELS</p>
            <p class="text-micro text-fg-faint tnum">
              {{ labelledCount }} / {{ pairList.length }} pairs labelled
            </p>
          </div>

          <div class="space-y-1">
            <p
              v-for="l in LABEL_ORDER"
              :key="l"
              class="text-micro text-fg-muted leading-relaxed"
            >
              <span class="label text-fg">{{ l }}</span>
              — {{ LABEL_DEFINITIONS[l] }}
            </p>
          </div>

          <div
            class="rounded border px-3 py-2 text-micro leading-relaxed"
            :class="readiness.ready
              ? 'border-success/40 bg-success/5 text-fg'
              : 'border-line bg-bg text-fg-muted'"
          >
            {{ readiness.message }}
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="sys-btn-outline chip"
              :disabled="running || selected.length < 2"
              @click="showLabeller = !showLabeller"
            >
              {{ showLabeller ? 'HIDE' : 'LABEL' }} PAIRS
            </button>
            <button
              type="button"
              class="sys-btn-outline chip"
              :disabled="running"
              @click="applySeeds"
            >
              APPLY DOCUMENTED SEEDS
            </button>
            <button
              type="button"
              class="sys-btn-outline chip"
              :disabled="running || labelledCount === 0"
              @click="resetLabels"
            >
              CLEAR
            </button>
          </div>

          <!-- ---- Phase 20 §12: dataset persistence ------------- -->
          <!--
            Labels are research data. These controls exist so hours of
            human judgement survive a refresh, a reinstall or a branch
            switch. IMPORT & MERGE is the default; REPLACE is visually
            separated and gated behind a confirmation.
          -->
          <div class="border border-line rounded p-3 space-y-3">
            <p class="label text-fg-muted">DATASET — HUMAN LABELS ARE SAVED AUTOMATICALLY</p>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="sys-btn-outline chip" @click="exportDataset">
                EXPORT DATASET
              </button>
              <button
                type="button"
                class="sys-btn-outline chip"
                :disabled="running"
                @click="chooseImportFile(true)"
              >
                IMPORT DATASET
              </button>
              <button type="button" class="sys-btn-outline chip" @click="backupDataset">
                BACKUP DATASET
              </button>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="sys-btn-outline chip" @click="copyReport">
                COPY REPORT
              </button>
              <button type="button" class="sys-btn-outline chip" @click="copySummary">
                COPY SUMMARY
              </button>
              <button type="button" class="sys-btn-outline chip" @click="exportReport('json')">
                EXPORT REPORT (JSON)
              </button>
              <button type="button" class="sys-btn-outline chip" @click="exportReport('md')">
                MARKDOWN
              </button>
              <button type="button" class="sys-btn-outline chip" @click="exportReport('txt')">
                TEXT
              </button>
            </div>

            <input
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              class="hidden"
              @change="onImportFile"
            >

            <p v-if="datasetStatus" class="text-micro text-fg-muted">
              {{ datasetStatus }}
            </p>

            <!-- Validation summary shown BEFORE anything is applied -->
            <div
              v-if="importSummary"
              class="border rounded p-3 space-y-2"
              :class="importSummary.ok ? 'border-line' : 'border-danger'"
            >
              <p class="label" :class="importSummary.ok ? 'text-fg' : 'text-danger'">
                {{ importSummary.ok ? 'IMPORT PREVIEW — NOTHING APPLIED YET' : 'IMPORT REJECTED' }}
              </p>

              <p v-if="importSummary.ok" class="text-micro text-fg-muted">
                {{ importSummary.trackCount }} track(s), {{ importSummary.pairCount }} pair(s) —
                SAME {{ importSummary.counts.same }} ·
                SIMILAR {{ importSummary.counts.similar }} ·
                DIFFERENT {{ importSummary.counts.different }}
              </p>
              <p v-if="importSummary.ok" class="text-micro text-fg-muted">
                Would add {{ importSummary.added }}, leave {{ importSummary.unchanged }} unchanged.
              </p>

              <p
                v-for="iss in importSummary.issues"
                :key="iss.code + iss.message"
                class="text-micro"
                :class="iss.severity === 'ERROR' ? 'text-danger' : 'text-warning'"
              >
                {{ iss.severity }} · {{ iss.code }} — {{ iss.message }}
              </p>

              <div v-if="importSummary.conflicts.length" class="space-y-1">
                <p class="text-micro text-warning">
                  {{ importSummary.conflicts.length }} CONFLICT(S) — your existing label is
                  kept. Nothing is overwritten.
                </p>
                <p
                  v-for="c in importSummary.conflicts.slice(0, 8)"
                  :key="c.pairId"
                  class="text-micro text-fg-faint"
                >
                  {{ c.pairId }}: existing {{ c.existingLabel }} ≠ incoming {{ c.incomingLabel }}
                </p>
              </div>

              <p v-if="importSummary.missingTracks.length" class="text-micro text-warning">
                {{ importSummary.missingTracks.length }} referenced track(s) are missing from
                the file.
              </p>

              <div v-if="importSummary.ok" class="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" class="sys-btn-outline chip" @click="applyImport">
                  {{ importIsMerge ? 'APPLY IMPORT & MERGE' : 'APPLY REPLACE' }}
                </button>
                <button type="button" class="sys-btn-outline chip" @click="cancelImport">
                  CANCEL
                </button>
              </div>

              <!-- Destructive path, deliberately separated -->
              <div v-if="importSummary.ok" class="border-t border-line pt-2 space-y-1">
                <label class="flex items-center gap-2 text-micro text-danger">
                  <input v-model="confirmReplace" type="checkbox">
                  I understand REPLACE deletes all existing labels
                </label>
                <button
                  type="button"
                  class="sys-btn-outline chip border-danger text-danger"
                  :disabled="!confirmReplace"
                  @click="importIsMerge = false; applyImport()"
                >
                  REPLACE DATASET
                </button>
              </div>
            </div>
          </div>

          <details class="text-micro text-fg-muted">
            <summary class="cursor-pointer text-fg-faint">
              What the seeds are, and why only one
            </summary>
            <div class="mt-2 space-y-2 leading-relaxed">
              <p
                v-for="s in SEEDED_LABELS"
                :key="s.key"
                class="border-l-2 border-line pl-2"
              >
                <span class="label">{{ s.key }} → {{ s.label }}</span><br>
                {{ s.justification }}
              </p>
              <p>
                Every other pair starts unlabelled. Guessing them from artist
                or genre metadata would measure how tidy the tags are and then
                report it as a claim about the embedding.
              </p>
            </div>
          </details>

          <!-- The labelling grid: one row per pair -->
          <div
            v-if="showLabeller && selected.length >= 2"
            class="max-h-80 overflow-y-auto border border-line rounded divide-y divide-line"
          >
            <div
              v-for="[i, j] in pairList"
              :key="`${i}:${j}`"
              class="px-2 py-1.5 flex items-center gap-2"
            >
              <span class="text-micro text-fg-faint tnum w-12 shrink-0">
                {{ i + 1 }}×{{ j + 1 }}
              </span>
              <span class="text-micro text-fg-muted flex-1 truncate">
                {{ titleAt(i) }} <span class="text-fg-faint">↔</span> {{ titleAt(j) }}
              </span>
              <span class="flex gap-1 shrink-0">
                <button
                  v-for="l in LABEL_ORDER"
                  :key="l"
                  type="button"
                  :disabled="running"
                  class="text-micro px-1.5 py-0.5 rounded border t-col"
                  :class="labelOf(i, j) === l
                    ? 'border-accent bg-accent/15 text-fg'
                    : 'border-line text-fg-faint hover:text-fg'"
                  @click="setLabel(i, j, l)"
                >
                  {{ l[0] }}
                </button>
              </span>
            </div>
          </div>
        </section>

        <!-- ---- Run controls ----------------------------- -->
        <section class="flex flex-wrap gap-2">
          <button
            type="button"
            class="sys-btn"
            :disabled="running || !modelId || selected.length < 2"
            @click="start"
          >
            RUN EVALUATION
          </button>
          <button
            type="button"
            class="sys-btn-outline"
            :disabled="!running || stopping"
            @click="stop"
          >
            {{ stopping ? 'STOPPING…' : 'STOP EVALUATION' }}
          </button>
        </section>

        <!--
          Dropped payloads are reported, never silently discarded: a
          missing pair changes the statistics, so the user has to know
          the results are incomplete.
        -->
        <section
          v-if="malformedEvents.length > 0"
          class="border border-warning/40 rounded-lg bg-warning/5 p-4"
        >
          <p class="label text-warning">MALFORMED NATIVE EVENTS DROPPED</p>
          <p class="text-small text-fg mt-1 leading-relaxed">
            One or more events could not be read and were discarded, so
            the results below are INCOMPLETE. Details in
            <span class="font-mono">logcat</span>.
          </p>
          <p
            v-for="m in malformedEvents"
            :key="m"
            class="text-micro text-fg-muted font-mono mt-0.5"
          >
            {{ m }}
          </p>
        </section>

        <!-- ---- Live progress ---------------------------- -->
        <section
          v-if="running || stage === 'done'"
          class="border border-line rounded-lg bg-surface p-4 space-y-2"
        >
          <div class="flex items-baseline justify-between">
            <p class="label text-fg-faint">
              {{ stage === 'embedding' ? 'EMBEDDING TRACKS'
                : stage === 'pairing' ? 'SCORING PAIRS'
                  : 'COMPLETE' }}
            </p>
            <p class="text-micro text-fg-faint tnum">{{ elapsedLabel }}</p>
          </div>

          <p class="text-micro text-fg-muted tnum">
            TRACKS {{ trackProgress }}
            {{ trackPosition }} / {{ trackTotal }}
          </p>
          <p class="text-micro text-fg-muted tnum">
            PAIRS &nbsp;{{ pairProgress }}
            {{ pairPosition }} / {{ pairTotal }}
          </p>
        </section>

        <!--
          Everything below renders numbers produced by native code.
          Wrapped so that a display failure in one of these panels
          isolates itself instead of unmounting the page and leaving a
          blank screen. Progress, controls and errors sit ABOVE the
          boundary and therefore always stay on screen.
        -->
        <DevResultsBoundary label="EVALUATION RESULTS" @error="onPanelError">
          <!-- ---- Live verdict ----------------------------- -->
          <section
            v-if="liveSeparation"
            class="border border-line rounded-lg bg-surface p-4 space-y-2"
          >
            <p class="label text-fg-faint">LIVE SEPARATION</p>
            <p class="text-body font-semibold" :class="verdictClass(liveSeparation.verdict)">
              {{ prettyVerdict(liveSeparation.verdict) }}
            </p>
            <p class="text-micro text-fg-muted leading-relaxed">
              {{ liveSeparation.rationale }}
            </p>
            <div class="space-y-1 pt-1">
              <p
                v-for="c in liveSeparation.comparisons"
                :key="`${c.higher}-${c.lower}`"
                class="text-micro text-fg-muted tnum"
              >
                {{ c.higher }} vs {{ c.lower }}:
                AUC {{ formatAuc(c.auc) }}
                · overlap {{ c.overlappingPairs }} pair(s)
                <span v-if="c.insufficient" class="text-fg-faint">· too few pairs</span>
              </p>
            </div>
          </section>

          <!-- ---- Per-pair results, newest first ----------- -->
          <section
            v-if="pairs.length > 0"
            class="border border-line rounded-lg bg-surface p-4 space-y-2"
          >
            <p class="label text-fg-faint">
              PAIR RESULTS — {{ pairs.length }} scored
            </p>
            <div class="divide-y divide-line max-h-96 overflow-y-auto">
              <div
                v-for="p in pairsNewestFirst"
                :key="`${p.indexA}:${p.indexB}`"
                class="py-2 space-y-0.5"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-small text-fg truncate">
                    {{ titleAt(p.indexA) }}
                    <span class="text-fg-faint">↔</span>
                    {{ titleAt(p.indexB) }}
                  </span>
                  <span class="text-micro text-fg-faint tnum shrink-0">
                    {{ p.position }} / {{ pairTotal }}
                  </span>
                </div>
                <div class="flex flex-wrap gap-x-4 text-micro tnum">
                  <span class="text-fg-muted">
                    GROUND TRUTH
                    <span class="text-fg">{{ p.label }}</span>
                    <span class="text-fg-faint">({{ p.source }})</span>
                  </span>
                  <span class="text-fg-muted">
                    COSINE
                    <span class="text-fg">{{ fmt(p.cosine) }}</span>
                  </span>
                  <span :class="outcomeClass(p.outcome)">
                    {{ p.outcome === 'NOT_SCORED' ? 'NOT SCORED' : p.outcome }}
                  </span>
                </div>
                <p
                  v-if="p.outcome === 'NOT_SCORED'"
                  class="text-micro text-fg-faint"
                >
                  No reference distribution yet — needs {{ MIN_CLASS_PAIRS }}
                  DIFFERENT pairs before a pair can be called either way.
                </p>
              </div>
            </div>
          </section>

          <!-- ---- Class distributions ---------------------- -->
          <section
            v-if="liveClasses.length > 0"
            class="border border-line rounded-lg bg-surface p-4 space-y-2"
          >
            <p class="label text-fg-faint">DISTRIBUTION BY LABEL</p>
            <div
              v-for="c in liveClasses"
              :key="c.label"
              class="space-y-0.5"
            >
              <p class="text-small text-fg">{{ c.label }}</p>
              <p class="text-micro text-fg-muted tnum">{{ describeClass(c) }}</p>
              <p class="text-micro text-fg-faint tnum">
                P25 {{ fmt(c.stats.p25) }} · P75 {{ fmt(c.stats.p75) }}
                · range {{ fmt(c.stats.range) }}
              </p>
            </div>
          </section>

          <!-- ---- Track embedding rows --------------------- -->
          <section
            v-if="rows.length > 0"
            class="border border-line rounded-lg bg-surface p-4 space-y-2"
          >
            <p class="label text-fg-faint">EMBEDDINGS</p>
            <div class="divide-y divide-line max-h-64 overflow-y-auto">
              <div v-for="r in rows" :key="r.index" class="py-1.5">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-small text-fg truncate">
                    {{ titleAt(r.index) }}
                  </span>
                  <span
                    class="text-micro tnum shrink-0"
                    :class="r.ok ? 'text-success' : 'text-danger'"
                  >
                    {{ r.ok ? 'OK' : 'FAILED' }}
                  </span>
                </div>
                <p v-if="r.ok" class="text-micro text-fg-muted tnum">
                  {{ r.dimension }}-d · norm {{ fmt(r.l2Norm) }}
                  · {{ r.frameCount }}×{{ r.frameDimension }}
                  · decode {{ fmtMs(r.decodeMs) }}
                  · infer {{ fmtMs(r.inferenceMs) }}
                  · agg {{ fmtMs(r.aggregationMs) }}
                  · total {{ fmtMs(r.totalMs) }}
                </p>
                <p v-else class="text-micro text-danger">
                  {{ r.errorCode }} — {{ r.errorMessage }}
                </p>
              </div>
            </div>
          </section>

          <!-- ---- Memory lifecycle ------------------------- -->
          <section
            v-if="memoryTimeline.length > 0"
            class="border border-line rounded-lg bg-surface p-4 space-y-2"
          >
            <p class="label text-fg-faint">MEMORY LIFECYCLE</p>
            <div class="space-y-0.5">
              <p
                v-for="(m, idx) in memoryTimeline"
                :key="`${m.checkpoint}-${idx}`"
                class="text-micro text-fg-muted tnum"
              >
                <span class="text-fg-faint">{{ m.checkpoint }}</span>
                — total {{ formatMb(m.sample.totalPssKb) }}
                ({{ formatDeltaMb(m.deltaTotalKb) }})
                · native {{ formatMb(m.sample.nativeHeapKb) }}
                · java {{ formatMb(m.sample.javaHeapKb) }}
              </p>
            </div>
            <div v-if="report" class="pt-2 space-y-1 border-t border-line">
              <p class="text-small text-fg">
                {{ prettyVerdict(report.memory.attribution) }}
              </p>
              <p class="text-micro text-fg-muted leading-relaxed">
                {{ report.memory.rationale }}
              </p>
              <p class="text-micro text-fg-faint leading-relaxed">
                {{ report.memory.caveat }}
              </p>
            </div>
          </section>

          <!-- ---- Final report ----------------------------- -->
          <section
            v-if="report"
            class="border border-line rounded-lg bg-surface p-4 space-y-3"
          >
            <p class="label text-fg-faint">FINAL REPORT</p>

            <p class="text-body font-semibold" :class="verdictClass(report.separation.verdict)">
              {{ prettyVerdict(report.separation.verdict) }}
            </p>
            <p class="text-micro text-fg-muted leading-relaxed">
              {{ describeVerdict(report.separation.verdict) }}
              {{ report.separation.rationale }}
            </p>

            <div class="text-micro text-fg-muted tnum space-y-0.5 pt-1">
              <p>
                TRACKS {{ report.successCount }} ok · {{ report.failureCount }} failed
                of {{ report.requestedTracks }}
              </p>
              <p>
                PAIRS {{ report.scoredPairCount }} scored
                of {{ report.labelledPairsRequested }} labelled
              </p>
              <p v-if="report.cancelled" class="text-fg">
                EVALUATION STOPPED — partial results retained
              </p>
              <p>
                MEDIAN decode {{ fmtMs(report.medianDecodeMs) }}
                · prep {{ fmtMs(report.medianPreprocessingMs) }}
                · infer {{ fmtMs(report.medianInferenceMs) }}
                · tensor {{ fmtMs(report.medianTensorMs) }}
                · agg {{ fmtMs(report.medianAggregationMs) }}
                · total {{ fmtMs(report.medianTotalMs) }}
              </p>
              <p>MEDIAN RTF {{ fmt(report.medianRtf, 3) }}</p>
              <p>
                STAGES embed {{ fmtMs(report.embedStageMs) }}
                · pairs {{ fmtMs(report.pairStageMs) }}
                · wall {{ fmtMs(report.totalElapsedMs) }}
              </p>
              <p>
                MEMORY {{ formatMb(report.memory.baselineKb) }} →
                peak {{ formatMb(report.memory.peakKb) }} →
                {{ formatMb(report.memory.finalKb) }}
                (net {{ formatDeltaMb(report.memory.netDeltaKb) }})
              </p>
              <p>ENERGY {{ report.energyMeasured ? 'measured' : 'Not directly measured' }}</p>
            </div>

            <p class="text-micro text-fg-faint leading-relaxed pt-1 border-t border-line">
              No production model is selected by this phase. The verdict describes
              how cosine orders your labels on this set of tracks, on this device,
              in this run — nothing more.
            </p>
          </section>
        </DevResultsBoundary>

      </template>

      <!-- ---- Phase 21.4: threshold & distribution analysis ---------
           Deliberately OUTSIDE the native-only branch above. This panel
           runs no model and needs no plugin: it reads pairs that were
           already scored, either from the live run or from an exported
           report JSON. Gating it on `available` would make the 190-pair
           results unanalysable the moment the page is reloaded, or on
           any machine that is not the phone. It selects nothing and
           changes no recommendation behaviour. -->
      <ThresholdAnalysisPanel :pairs="analysablePairs" />
    </div>
  </div>
</template>
