<script setup lang="ts">
// ============================================================
// SYSTEMA — Embedding Quality Lab (Phase 17)
// ============================================================
// Answers the question Phase 16A left open: are YAMNet's 1024-d
// track embeddings actually distinguishable from one another?
//
// WHY THIS PAGE IS BUILT AROUND EVENTS
// ------------------------------------
// A twenty-track run over real audio takes minutes. If results only
// appeared at the end, the screen would be indistinguishable from a
// hung app for the whole run. So every result is rendered the instant
// the native side produces it, and the header always states what is
// happening right now.
//
// WHAT THIS PAGE WILL NOT DO
// --------------------------
// It will not grade the model. Cosine statistics describe geometry;
// calling a mean of 0.7 "good" would require labelled ground truth
// that does not exist here. The conclusion field is a constant, and
// that is the honest answer rather than a missing feature.
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  describeNeighbours,
  describeQualityConclusion,
  getQualityEvaluationStatus,
  onQualityEvalEvents,
  renderHistogram,
  renderProgressBar,
  runQualityEvaluation,
  stopQualityEvaluation,
  MAX_QUALITY_TRACKS,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  type EvaluationReport,
  type QualityEvalTrackCompletedEvent,
  type SimilarityMatrix,
  type SimilarityStats,
  type TrackEvaluation,
} from '~/services/native/inferencePlugin'
import { getCapabilities } from '~/services/native/inferenceService'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Embedding quality lab' })

const library = useLibraryStore()
const router = useRouter()

const available = isInferenceAvailable()

// ---- Model selection ------------------------------------------
const models = ref<Array<{ id: string, name: string }>>([])
const modelId = ref<string>('')
const loadingModels = ref(false)

async function loadModels() {
  if (!available) return
  loadingModels.value = true
  try {
    const caps = await getCapabilities()
    // Only real side-loaded models. The deterministic test model has
    // no audio contract and produces no embedding, so offering it
    // here would only ever yield a confusing failure.
    models.value = caps.models
      .filter(m => m.kind !== 'test')
      .map(m => ({ id: m.id, name: m.name }))
    if (!modelId.value && models.value.length) {
      modelId.value = models.value[0]!.id
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loadingModels.value = false
  }
}

// ---- Track selection ------------------------------------------
const tracks = computed(() => library.tracks.slice(0, 100))
const selected = ref<string[]>([])
/** Optional developer-supplied relationship labels, keyed by track id. */
const labels = ref<Record<string, string>>({})
const showLabels = ref(false)

const LABEL_OPTIONS = [
  'same song',
  'same artist',
  'same genre',
  'different artist',
  'different genre',
] as const

function toggle(trackId: string) {
  if (selected.value.includes(trackId)) {
    selected.value = selected.value.filter(id => id !== trackId)
    return
  }
  if (selected.value.length >= MAX_QUALITY_TRACKS) return
  selected.value = [...selected.value, trackId]
}

const atCap = computed(() => selected.value.length >= MAX_QUALITY_TRACKS)

function titleFor(trackId: string): string {
  return tracks.value.find(t => t.id === trackId)?.title ?? trackId
}

// ---- Live run state -------------------------------------------
const running = ref(false)
const stopping = ref(false)
const error = ref<string | null>(null)

const totalTracks = ref(0)
const currentIndex = ref<number | null>(null)
const currentTrackId = ref<string | null>(null)
const elapsedMs = ref(0)
const rows = ref<TrackEvaluation[]>([])
const matrix = ref<SimilarityMatrix | null>(null)
const liveStats = ref<SimilarityStats | null>(null)
const report = ref<EvaluationReport | null>(null)
const memoryPssKb = ref<number | null>(null)

let disposeListeners: (() => void) | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
const wallClockMs = ref(0)

const completedCount = computed(() => rows.value.length)
const successCount = computed(() => rows.value.filter(r => r.ok).length)
const failureCount = computed(() => rows.value.filter(r => !r.ok).length)
const remainingCount = computed(() =>
  Math.max(0, totalTracks.value - completedCount.value))

const progressBar = computed(() =>
  renderProgressBar(completedCount.value, totalTracks.value))

/**
 * The single most important line on the page: is it still working?
 * Derived from the actual event stream, never from a timer.
 */
const stateLabel = computed(() => {
  if (error.value) return 'ERROR'
  if (stopping.value) return 'STOPPING…'
  if (running.value && currentTrackId.value) return 'PROCESSING'
  if (running.value) return 'STARTING…'
  if (report.value?.cancelled) return 'STOPPED'
  if (report.value) return 'FINISHED'
  return 'IDLE'
})

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)} ms`
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function mb(kb: number | null | undefined): string {
  if (kb === null || kb === undefined) return '—'
  return `${(kb / 1024).toFixed(1)} MB`
}

async function start() {
  if (running.value || !selected.value.length || !modelId.value) return

  error.value = null
  report.value = null
  rows.value = []
  matrix.value = null
  liveStats.value = null
  memoryPssKb.value = null
  currentIndex.value = null
  currentTrackId.value = null
  elapsedMs.value = 0
  wallClockMs.value = 0
  stopping.value = false
  running.value = true
  totalTracks.value = selected.value.length

  // Subscribed BEFORE starting: the native side can emit the first
  // event before the start promise resolves.
  disposeListeners = await onQualityEvalEvents({
    onStarted: (e) => {
      totalTracks.value = e.totalTracks
    },
    onTrackStarted: (e) => {
      currentIndex.value = e.position
      currentTrackId.value = e.trackId
      elapsedMs.value = e.elapsedMs
    },
    onTrackCompleted: (e: QualityEvalTrackCompletedEvent) => {
      // Rendered immediately. This is the whole point of the phase:
      // result N appears while result N+1 is still being computed.
      rows.value = [...rows.value, e.evaluation]
      matrix.value = e.matrix
      liveStats.value = e.stats ?? null
      elapsedMs.value = e.elapsedMs
      memoryPssKb.value = e.memoryPssKb
      currentTrackId.value = null
    },
    onFinished: (e) => {
      running.value = false
      stopping.value = false
      currentTrackId.value = null
      currentIndex.value = null
      if (e.failed) {
        error.value = e.errorMessage ?? 'The evaluation failed.'
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
    await runQualityEvaluation({
      runtimeId: 'onnx',
      modelId: modelId.value,
      tracks: selected.value.map(id => ({
        trackId: id,
        uri: tracks.value.find(t => t.id === id)?.uri ?? '',
        ...(labels.value[id] ? { label: labels.value[id] } : {}),
      })),
    })
  } catch (e) {
    running.value = false
    error.value = (e as Error).message
  }
}

async function stop() {
  if (!running.value) return
  stopping.value = true
  try {
    await stopQualityEvaluation()
  } catch (e) {
    error.value = (e as Error).message
  }
}

/** Colours a matrix cell by magnitude, so structure is visible at a glance. */
function cellClass(v: number): string {
  if (v >= 0.999) return 'text-fg-faint'
  if (v >= 0.8) return 'text-success font-semibold'
  if (v >= 0.6) return 'text-fg'
  if (v >= 0.3) return 'text-fg-muted'
  return 'text-fg-faint'
}

const histogramLines = computed(() => {
  const s = report.value?.stats ?? liveStats.value
  return s ? renderHistogram(s) : []
})

onMounted(() => {
  if (available) {
    void loadModels()
    void getQualityEvaluationStatus().then((s) => { running.value = s.running })
  }
  if (!library.tracks.length) void library.loadFirstPage()
})

onBeforeUnmount(() => {
  disposeListeners?.()
  if (tickTimer) clearInterval(tickTimer)
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
          Embedding Quality Lab
        </h1>
        <p class="text-small text-fg-muted max-w-[72ch] leading-relaxed">
          Runs the real model over tracks you choose, pools each one into a
          single normalized vector, and measures how those vectors sit relative
          to each other. Results appear one track at a time, as they finish.
          This measures geometry — it does not decide whether the model is good.
        </p>
      </header>

      <!-- ---- Not on device ------------------------------ -->
      <section
        v-if="!available"
        class="border border-warning/40 bg-surface px-5 py-4"
      >
        <p class="label text-warning">
          ANDROID BUILD ONLY
        </p>
        <p class="text-small text-fg-muted mt-2 leading-relaxed">
          There is no audio decoder and no ONNX runtime in the browser. This lab
          needs both, and simulating either would produce embeddings that mean
          nothing. Run the Android build to use it.
        </p>
      </section>

      <template v-else>
        <!-- ---- Step 1: model -------------------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between">
            <p class="label text-fg-muted">
              STEP 1 — MODEL
            </p>
            <button
              type="button"
              class="text-micro text-fg-faint hover:text-fg t-col"
              :disabled="loadingModels"
              @click="loadModels"
            >
              REFRESH
            </button>
          </div>
          <div class="px-5 py-4">
            <p v-if="!models.length" class="text-small text-fg-muted leading-relaxed">
              No importable model found. Import one in the
              <button
                type="button"
                class="underline hover:text-fg"
                @click="router.push('/dev/ai-benchmark/onnx')"
              >
                ONNX Runtime Lab
              </button>
              first — this lab never picks a model for you.
            </p>
            <div v-else class="flex flex-wrap gap-2">
              <button
                v-for="m in models"
                :key="m.id"
                type="button"
                class="chip"
                :class="modelId === m.id ? 'border-primary text-fg' : ''"
                :disabled="running"
                @click="modelId = m.id"
              >
                {{ m.name }}
              </button>
            </div>
          </div>
        </section>

        <!-- ---- Step 2: tracks ------------------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between">
            <p class="label text-fg-muted">
              STEP 2 — PICK TRACKS ({{ selected.length }}/{{ MAX_QUALITY_TRACKS }})
            </p>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="text-micro text-fg-faint hover:text-fg t-col"
                @click="showLabels = !showLabels"
              >
                {{ showLabels ? 'HIDE LABELS' : 'ADD LABELS' }}
              </button>
              <button
                v-if="selected.length"
                type="button"
                class="text-micro text-fg-faint hover:text-fg t-col"
                :disabled="running"
                @click="selected = []; labels = {}"
              >
                CLEAR
              </button>
            </div>
          </div>
          <div class="px-5 py-3 border-b border-line">
            <p class="text-micro text-fg-faint leading-relaxed">
              Only the tracks you tick are read. Nothing scans your library.
              Capped at {{ MAX_QUALITY_TRACKS }} tracks — that is
              {{ MAX_QUALITY_TRACKS * (MAX_QUALITY_TRACKS - 1) / 2 }} pairs.
            </p>
            <p v-if="showLabels" class="text-micro text-warning mt-2 leading-relaxed">
              Labels are YOUR claim about a track, used only to group pairs.
              They are never inferred from artist or genre metadata — doing that
              would measure your tags, not the embeddings.
            </p>
          </div>
          <ul class="max-h-72 overflow-y-auto divide-y divide-line">
            <li
              v-for="t in tracks"
              :key="t.id"
              class="px-5 py-2.5 flex items-center gap-3"
            >
              <input
                type="checkbox"
                class="shrink-0"
                :checked="selected.includes(t.id)"
                :disabled="running || (atCap && !selected.includes(t.id))"
                @change="toggle(t.id)"
              >
              <div class="min-w-0 flex-1">
                <p class="text-small truncate">
                  {{ t.title }}
                </p>
                <p class="text-micro text-fg-faint truncate">
                  {{ t.artist }}
                </p>
              </div>
              <select
                v-if="showLabels && selected.includes(t.id)"
                v-model="labels[t.id]"
                class="text-micro bg-bg border border-line px-1.5 py-1 shrink-0"
                :disabled="running"
              >
                <option value="">
                  no label
                </option>
                <option v-for="opt in LABEL_OPTIONS" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </li>
          </ul>
        </section>

        <!-- ---- Step 3: run ---------------------------- -->
        <section class="border border-line bg-surface">
          <div class="px-5 py-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="sys-btn"
              :disabled="running || !selected.length || !modelId"
              @click="start"
            >
              RUN EVALUATION
            </button>
            <button
              v-if="running"
              type="button"
              class="sys-btn-outline"
              :disabled="stopping"
              @click="stop"
            >
              {{ stopping ? 'STOPPING…' : 'STOP EVALUATION' }}
            </button>
            <p class="text-micro text-fg-faint">
              Model stays loaded for the whole run and is unloaded at the end.
            </p>
          </div>
        </section>

        <!-- ---- Live progress -------------------------- -->
        <section
          v-if="running || rows.length"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3 flex items-center justify-between">
            <p class="label text-fg-muted">
              PROGRESS
            </p>
            <span
              class="chip"
              :class="{
                'border-primary text-fg': running,
                'border-danger text-danger': stateLabel === 'ERROR',
              }"
            >{{ stateLabel }}</span>
          </div>

          <div class="px-5 py-4 space-y-3">
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p class="text-body tnum">
                {{ completedCount }} / {{ totalTracks }} tracks
              </p>
              <p class="text-micro text-fg-faint tnum font-mono">
                {{ progressBar }}
              </p>
              <p class="text-micro text-fg-faint tnum">
                elapsed {{ fmtDuration(running ? wallClockMs : elapsedMs) }}
              </p>
            </div>

            <p class="text-small tnum">
              <span class="text-fg-faint">completed</span>
              {{ completedCount }}
              <span class="text-fg-faint ml-3">ok</span>
              <span class="text-success">{{ successCount }}</span>
              <span class="text-fg-faint ml-3">failed</span>
              <span :class="failureCount ? 'text-danger' : ''">{{ failureCount }}</span>
              <span class="text-fg-faint ml-3">remaining</span>
              {{ remainingCount }}
            </p>

            <!-- The "is it still alive" line. -->
            <p
              v-if="currentTrackId"
              class="text-small"
            >
              <span class="text-fg-faint">[{{ currentIndex }}/{{ totalTracks }}]</span>
              {{ titleFor(currentTrackId) }}
              <span class="text-fg-muted ml-2">⏳ Processing…</span>
            </p>
            <p
              v-else-if="running"
              class="text-small text-fg-muted"
            >
              ⏳ Preparing next track…
            </p>

            <p v-if="memoryPssKb" class="text-micro text-fg-faint tnum">
              process memory {{ mb(memoryPssKb) }} (PSS)
            </p>
          </div>
        </section>

        <!-- ---- Error ---------------------------------- -->
        <section
          v-if="error"
          class="border border-danger/40 bg-surface px-5 py-4"
        >
          <p class="label text-danger">
            EVALUATION ERROR
          </p>
          <p class="text-small text-fg-muted mt-2 leading-relaxed">
            {{ error }}
          </p>
        </section>

        <!-- ---- Live results (newest first) ------------- -->
        <section
          v-if="rows.length"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              RESULTS ({{ rows.length }})
            </p>
          </div>
          <ul class="divide-y divide-line">
            <li
              v-for="row in [...rows].reverse()"
              :key="row.trackId"
              class="px-5 py-4 space-y-2"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-small">
                    <span class="text-fg-faint tnum">[{{ row.index + 1 }}]</span>
                    {{ titleFor(row.trackId) }}
                  </p>
                </div>
                <span
                  class="chip shrink-0"
                  :class="row.ok
                    ? 'border-success/50 text-success'
                    : 'border-danger/50 text-danger'"
                >{{ row.ok ? 'SUCCESS' : 'FAILED' }}</span>
              </div>

              <!-- Failure: reason, then the batch simply continues. -->
              <template v-if="!row.ok">
                <p class="text-micro text-danger">
                  {{ row.errorCode }}
                </p>
                <p class="text-micro text-fg-muted leading-relaxed">
                  {{ row.errorMessage }}
                </p>
                <p class="text-micro text-fg-faint">
                  No embedding was produced for this track, and none was invented.
                  The run continued.
                </p>
              </template>

              <template v-else>
                <p class="text-micro text-fg-faint tnum">
                  EMBEDDING
                  <span class="text-fg">{{ row.dimension }}</span> dimensions ·
                  L2 normalized · norm
                  <span
                    :class="row.norm && Math.abs(row.norm - 1) <= 1e-4
                      ? 'text-success' : 'text-danger'"
                  >{{ fmt(row.norm, 4) }}</span> ·
                  from {{ row.frameCount }} × {{ row.frameDimension }} frames
                </p>

                <p class="text-micro text-fg-faint tnum">
                  PROCESSING
                  decode {{ fmtMs(row.decodeMs) }} ·
                  prep {{ fmtMs(row.preprocessingMs) }} ·
                  inference {{ fmtMs(row.inferenceMs) }} ·
                  aggregation {{ fmtMs(row.aggregationMs) }} ·
                  total {{ fmtMs(row.totalMs) }} ·
                  rtf {{ fmt(row.rtf, 3) }}
                </p>

                <div class="text-micro tnum">
                  <p class="text-fg-faint">
                    SIMILARITY
                    <span class="sr-only">{{ describeNeighbours(row) }}</span>
                  </p>
                  <p v-if="!row.hasComparison" class="text-fg-muted">
                    No comparison available — first embedding.
                  </p>
                  <template v-else>
                    <p>
                      <span class="text-fg-faint">closest</span>
                      {{ titleFor(row.nearestTrackId!) }}
                      <span class="text-success ml-1">{{ fmt(row.nearestScore, 4) }}</span>
                    </p>
                    <p>
                      <span class="text-fg-faint">farthest</span>
                      {{ titleFor(row.farthestTrackId!) }}
                      <span class="text-fg-muted ml-1">{{ fmt(row.farthestScore, 4) }}</span>
                    </p>
                  </template>
                </div>

                <details v-if="row.outputContract" class="mt-1">
                  <summary class="text-micro text-fg-faint cursor-pointer hover:text-fg">
                    TECHNICAL DETAIL
                  </summary>
                  <div class="mt-2 space-y-1">
                    <p
                      v-for="o in row.outputContract.outputs"
                      :key="o.index"
                      class="text-micro text-fg-faint tnum"
                    >
                      {{ o.name }} [{{ o.shape.join(', ') }}]
                      <span class="text-fg-muted">{{ o.role }}</span>
                      <span v-if="o.selected" class="text-warning ml-1">← read as output</span>
                    </p>
                    <p class="text-micro text-fg-faint">
                      preview [{{ row.preview }} …]
                    </p>
                  </div>
                </details>
              </template>
            </li>
          </ul>
        </section>

        <!-- ---- Live similarity matrix ------------------ -->
        <section
          v-if="matrix && matrix.size >= 2"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              SIMILARITY MATRIX ({{ matrix.size }} × {{ matrix.size }})
            </p>
          </div>
          <div class="px-5 py-4 overflow-x-auto">
            <table class="text-micro tnum">
              <thead>
                <tr>
                  <th class="text-left pr-3 pb-1 text-fg-faint font-normal">
                    &nbsp;
                  </th>
                  <th
                    v-for="(id, i) in matrix.trackIds"
                    :key="id"
                    class="px-2 pb-1 text-fg-faint font-normal"
                  >
                    {{ i + 1 }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in matrix.rows" :key="i">
                  <td class="pr-3 py-0.5 text-fg-faint whitespace-nowrap max-w-[16ch] truncate">
                    {{ i + 1 }}. {{ titleFor(matrix.trackIds[i]!) }}
                  </td>
                  <td
                    v-for="(v, j) in row"
                    :key="j"
                    class="px-2 py-0.5 text-right"
                    :class="cellClass(v)"
                  >
                    {{ v.toFixed(2) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="text-micro text-fg-faint mt-3 leading-relaxed">
              The diagonal is 1.00 by definition — a vector is identical to
              itself. Statistics below use the
              {{ matrix.size * (matrix.size - 1) / 2 }} distinct off-diagonal
              pairs only; including the diagonal would drag every mean toward 1.
            </p>
          </div>
        </section>

        <!-- ---- Live statistics ------------------------- -->
        <section
          v-if="liveStats || report?.stats"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              PAIRWISE SIMILARITY
            </p>
          </div>
          <div class="px-5 py-4 space-y-3">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-small tnum">
              <div>
                <p class="text-micro text-fg-faint">
                  MEAN
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.mean, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  MEDIAN
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.median, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  MIN
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.min, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  MAX
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.max, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  RANGE
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.range, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  STD DEV
                </p>
                <p>{{ fmt((report?.stats ?? liveStats)!.stdDev, 4) }}</p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  P25 / P75
                </p>
                <p>
                  {{ fmt((report?.stats ?? liveStats)!.p25, 3) }} /
                  {{ fmt((report?.stats ?? liveStats)!.p75, 3) }}
                </p>
              </div>
              <div>
                <p class="text-micro text-fg-faint">
                  PAIRS
                </p>
                <p>{{ (report?.stats ?? liveStats)!.pairCount }}</p>
              </div>
            </div>

            <div>
              <p class="text-micro text-fg-faint mb-1">
                DISTRIBUTION (fixed buckets across −1…1)
              </p>
              <pre class="text-micro text-fg-muted font-mono leading-tight">{{ histogramLines.join('\n') }}</pre>
            </div>
          </div>
        </section>

        <!-- ---- Group statistics ------------------------ -->
        <section
          v-if="report?.groupedStats && Object.keys(report.groupedStats).length"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              GROUPED BY YOUR LABELS
            </p>
          </div>
          <div class="px-5 py-4 space-y-2">
            <div
              v-for="(s, key) in report.groupedStats"
              :key="key"
              class="text-small tnum"
            >
              <span class="text-fg-faint">{{ key }}</span>
              <span class="ml-3">n={{ s.pairCount }}</span>
              <span class="ml-3">mean {{ fmt(s.mean, 4) }}</span>
              <span class="ml-3">median {{ fmt(s.median, 4) }}</span>
              <span class="ml-3 text-fg-muted">
                [{{ fmt(s.min, 3) }} … {{ fmt(s.max, 3) }}]
              </span>
            </div>
            <p class="text-micro text-fg-faint mt-2 leading-relaxed">
              These groups come from labels you assigned. They are evidence about
              a small sample, not a verdict.
            </p>
          </div>
        </section>

        <!-- ---- Final summary --------------------------- -->
        <section
          v-if="report && !report.failed"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3 flex items-center justify-between">
            <p class="label text-fg-muted">
              {{ report.cancelled ? 'EVALUATION STOPPED' : 'EVALUATION SUMMARY' }}
            </p>
            <span class="chip">{{ report.aggregationStrategy }}</span>
          </div>
          <div class="px-5 py-4 space-y-3 text-small tnum">
            <p v-if="report.cancelled" class="text-warning">
              Stopped early. Completed: {{ report.completedCount }} /
              {{ report.requestedCount }} · Failed: {{ report.failureCount }} ·
              Remaining: {{ report.remainingCount }}. Completed results were kept.
            </p>

            <div>
              <p class="text-micro text-fg-faint">
                TRACKS
              </p>
              <p>
                requested {{ report.requestedCount }} ·
                completed {{ report.completedCount }} ·
                succeeded {{ report.successCount }} ·
                failed {{ report.failureCount }}
              </p>
            </div>

            <div>
              <p class="text-micro text-fg-faint">
                EMBEDDING
              </p>
              <p>
                {{ report.evaluations.find(e => e.ok)?.dimension ?? '—' }}-d ·
                {{ report.aggregationStrategy }} pooling · L2 normalized
              </p>
            </div>

            <div v-if="report.stats">
              <p class="text-micro text-fg-faint">
                PAIRWISE SIMILARITY
              </p>
              <p>
                mean {{ fmt(report.stats.mean, 4) }} ·
                median {{ fmt(report.stats.median, 4) }} ·
                min {{ fmt(report.stats.min, 4) }} ·
                max {{ fmt(report.stats.max, 4) }}
              </p>
            </div>

            <div>
              <p class="text-micro text-fg-faint">
                PERFORMANCE (median over successful tracks)
              </p>
              <p>
                decode {{ fmtMs(report.medianDecodeMs) }} ·
                inference {{ fmtMs(report.medianInferenceMs) }} ·
                aggregation {{ fmtMs(report.medianAggregationMs) }} ·
                total {{ fmtMs(report.medianTotalMs) }} ·
                rtf {{ fmt(report.medianRtf, 3) }}
              </p>
              <p class="text-micro text-fg-faint mt-1">
                wall clock {{ fmtDuration(report.totalElapsedMs) }}
              </p>
            </div>

            <div>
              <p class="text-micro text-fg-faint">
                MEMORY
              </p>
              <p>
                before {{ mb(report.memoryBeforeKb) }} ·
                peak {{ mb(report.memoryPeakKb) }} ·
                after {{ mb(report.memoryAfterKb) }} ·
                delta {{ mb(report.memoryDeltaKb) }}
              </p>
            </div>

            <div>
              <p class="text-micro text-fg-faint">
                ENERGY
              </p>
              <p :class="report.energyMeasured ? '' : 'text-fg-muted'">
                {{ report.energyNote }}
              </p>
            </div>

            <div>
              <p class="text-micro text-fg-faint">
                EVALUATION
              </p>
              <p>{{ report.labelled ? 'LABELED' : 'UNLABELED' }}</p>
              <p class="text-micro text-fg-muted mt-1 leading-relaxed">
                {{ report.qualityNote }}
              </p>
            </div>

            <div class="border-t border-line pt-3">
              <p class="text-micro text-fg-faint">
                QUALITY CONCLUSION
              </p>
              <p class="text-warning font-semibold">
                {{ report.qualityConclusion }}
              </p>
              <p class="text-micro text-fg-muted mt-1 leading-relaxed">
                {{ describeQualityConclusion(report) }}
              </p>
              <p class="text-micro text-fg-faint mt-2 leading-relaxed">
                No production model has been selected, and this run does not
                select one.
              </p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
