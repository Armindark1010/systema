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
    </div>
  </div>
</template>
