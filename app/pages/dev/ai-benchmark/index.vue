<script setup lang="ts">
// ============================================================
// SYSTEMA — AI Benchmark Lab (Phase 14)
// ============================================================
// The research instrument for deciding which on-device audio model,
// if any, SYSTEMA should adopt.
//
// Isolation (§15)
// ---------------
// Reachable only by typing /dev/ai-benchmark. It is not linked from
// Home, Library, Player, AI Insights or Settings, and it uses the
// `dev` layout so none of the application chrome mounts.
//
// The safety property (§2, §21)
// -----------------------------
// This page cannot analyse the music library. The only datasets it
// can construct are the built-in synthetic set and a hand-picked
// selection capped at 20 tracks. There is no "analyse everything"
// control because the underlying store offers no such action.
// ============================================================

import { useAiLabStore } from '~/stores/aiLab'
import { useLibraryStore } from '~/stores/library'
import { MAX_DATASET_SAMPLES } from '~/services/ai-lab/dataset'
import { MAX_SUSTAINED_ITERATIONS } from '~/services/ai-lab/benchmarkRunner'
import { buildRecommendations } from '~/services/ai-lab/comparison'

definePageMeta({ layout: 'dev' })
useHead({ title: 'AI Benchmark Lab' })

const lab = useAiLabStore()
const library = useLibraryStore()
const router = useRouter()

// Explicit load — nothing runs on mount except reading stored results.
onMounted(() => lab.refresh())

const recommendations = computed(() => buildRecommendations(lab.runs))

// ---- Device dataset selection ---------------------------------
// The track list is only ever loaded when the developer switches to
// device mode AND presses the button. It is never fetched eagerly.
const tracksLoaded = ref(false)
const availableTracks = computed(() =>
  library.tracks.slice(0, 100).map(t => ({
    id: t.id,
    title: t.title,
    durationMs: t.durationMs ?? 0,
  })))

async function loadTracksForSelection() {
  try {
    await library.loadFirstPage()
    tracksLoaded.value = true
  } catch {
    tracksLoaded.value = true
  }
}

async function onRun() {
  const run = await lab.execute(availableTracks.value)
  if (run) router.push(`/dev/ai-benchmark/${run.id}`)
}

// ---- Production selection (§28) --------------------------------
const showSelectDialog = ref(false)
const selectionRationale = ref('')
const selectionModelId = ref('')

function openSelectDialog(modelId: string) {
  selectionModelId.value = modelId
  selectionRationale.value = ''
  showSelectDialog.value = true
}

function confirmSelection() {
  const ok = lab.selectProductionModel(
    selectionModelId.value,
    selectionRationale.value,
    lab.runs.find(r => r.modelId === selectionModelId.value)?.id ?? null,
  )
  if (ok) showSelectDialog.value = false
}

// ---- Export ----------------------------------------------------
function onExport() {
  const { filename, content } = lab.exportAsJson()
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const sustainedIterations = ref(20)
</script>

<template>
  <div class="min-h-dvh">
    <!-- ---- Header ---------------------------------------- -->
    <header class="border-b border-line bg-surface">
      <div class="sys-container py-6">
        <p class="label text-fg-faint">
          SYSTEMA / PHASE 14 / DEVELOPER INSTRUMENT
        </p>
        <h1 class="mt-2 text-[24px] font-bold tracking-tight text-fg">
          AI Model Benchmarking Lab
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Measures candidate on-device audio models so the production choice can be
          made from data instead of assumption. This page runs nothing automatically
          and never touches your music library.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <!-- ---- Safety statement --------------------------- -->
      <LabBanner tone="info" title="SCOPE — WHAT THIS PAGE DOES NOT DO">
        No library scanning, no whole-library embedding, no background indexing and no
        automatic analysis. A benchmark only ever processes the samples in the dataset
        below, which is capped at {{ MAX_DATASET_SAMPLES }} items. Phase 14 is
        measurement only — no semantic search, recommendations or AI playlists are
        built here.
      </LabBanner>

      <!-- ---- Real-audio shortcut ------------------------ -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            TEST WITH YOUR OWN MUSIC
          </p>
        </div>
        <div class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-small text-fg-muted max-w-[64ch] leading-relaxed">
            Pick real tracks and measure what they actually cost to decode and
            analyse on this device. Measures decode + DSP, not model inference —
            no model weights ship in Phase 14.
          </p>
          <button
            type="button"
            class="sys-btn-outline shrink-0"
            @click="router.push('/dev/ai-benchmark/real-audio')"
          >
            REAL AUDIO TEST →
          </button>
        </div>
      </section>

      <!-- ---- ONNX runtime lab (Phase 15) ---------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            ONNX RUNTIME
          </p>
        </div>
        <div class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-small text-fg-muted max-w-[64ch] leading-relaxed">
            Choose a runtime and a model, then measure real ONNX inference on
            this device. Ships with a deterministic 423-byte test model that
            proves the runtime genuinely executes; real candidate models are
            side-loaded, never committed. No production model has been chosen.
          </p>
          <button
            type="button"
            class="sys-btn-outline shrink-0"
            @click="router.push('/dev/ai-benchmark/onnx')"
          >
            ONNX RUNTIME LAB →
          </button>
        </div>
      </section>

      <!-- ---- Embedding quality (Phase 17) --------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            EMBEDDING QUALITY LAB
          </p>
        </div>
        <div class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-small text-fg-muted max-w-[64ch] leading-relaxed">
            Runs an imported model over tracks you pick, pools each into one
            normalized vector, and measures how those vectors sit relative to
            each other — cosine similarity, live matrix, distribution. Results
            appear one track at a time. Measures geometry only; it does not
            grade the model or select one.
          </p>
          <button
            type="button"
            class="sys-btn-outline shrink-0"
            @click="router.push('/dev/ai-benchmark/quality')"
          >
            QUALITY LAB →
          </button>
        </div>
      </section>

      <!-- ---- Candidate evaluation (Phase 16) ------------ -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            EMBEDDING CANDIDATES
          </p>
        </div>
        <div class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-small text-fg-muted max-w-[64ch] leading-relaxed">
            Researched specifications for YAMNet, VGGish, OpenL3, PANNs and CLAP —
            published figures, not measurements, with every performance cell left
            UNKNOWN. Also hosts the native memory lifecycle test. No candidate
            model has been downloaded or executed.
          </p>
          <button
            type="button"
            class="sys-btn-outline shrink-0"
            @click="router.push('/dev/ai-benchmark/candidates')"
          >
            CANDIDATE LAB →
          </button>
        </div>
      </section>

      <!-- ---- Environment -------------------------------- -->
      <LabBanner
        v-if="lab.environmentWarning"
        tone="warning"
        title="DESKTOP BENCHMARK"
      >
        {{ lab.environmentWarning }}
      </LabBanner>
      <LabBanner v-else tone="info" title="DEVICE BENCHMARK">
        Running on {{ lab.device.label }} ({{ lab.device.osVersion }},
        {{ lab.device.cpuArchitecture }}). Measurements here reflect real device
        behaviour.
      </LabBanner>

      <!-- ---- Production model state (§28) --------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            PRODUCTION MODEL
          </p>
        </div>
        <div class="px-5 py-4">
          <template v-if="lab.productionSelection">
            <p class="text-[15px] font-bold text-fg">
              {{ lab.productionSelection.selectedModelId }}
            </p>
            <p class="mt-1 text-small text-fg-muted leading-relaxed max-w-[76ch]">
              {{ lab.productionSelection.rationale }}
            </p>
            <p class="mt-2 label text-fg-faint">
              SELECTED {{ new Date(lab.productionSelection.selectedAt).toLocaleString() }}
            </p>
            <button
              type="button"
              class="mt-3 sys-btn-outline"
              @click="lab.clearProductionModel()"
            >
              CLEAR SELECTION
            </button>
          </template>
          <template v-else>
            <p class="text-[15px] font-bold text-fg-muted">
              NO PRODUCTION MODEL SELECTED
            </p>
            <p class="mt-1 text-small text-fg-muted leading-relaxed max-w-[76ch]">
              This is a valid and expected state. A production model is only ever set
              by an explicit human decision recorded with a written rationale —
              benchmarking never selects one on its own.
            </p>
          </template>
        </div>
      </section>

      <!-- ---- Model registry (§10) ----------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          CANDIDATE MODELS
        </h2>
        <div class="space-y-px bg-line border border-line">
          <div
            v-for="model in lab.models"
            :key="model.modelId"
            class="bg-surface px-5 py-4"
            :class="model.modelId === lab.selectedModelId ? 'bg-hover' : ''"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                class="text-left flex-1 min-w-0"
                @click="lab.selectedModelId = model.modelId"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[14px] font-bold text-fg">{{ model.modelName }}</span>
                  <span class="chip">{{ model.version }}</span>
                  <span
                    class="chip"
                    :class="{
                      'border-success text-success': model.availability === 'AVAILABLE',
                      'border-warning text-warning': model.availability === 'NOT_INSTALLED',
                    }"
                  >{{ model.availability.replace('_', ' ') }}</span>
                </div>
                <p class="mt-2 text-small text-fg-muted leading-relaxed max-w-[76ch]">
                  {{ model.rationale }}
                </p>
                <dl class="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                  <div class="flex gap-1.5">
                    <dt class="label text-fg-faint">SIZE</dt>
                    <dd class="tnum text-small text-fg-muted">
                      {{ model.sizeMb }} MB
                      <span class="text-fg-faint">({{ model.sizeConfidence.toLowerCase() }})</span>
                    </dd>
                  </div>
                  <div class="flex gap-1.5">
                    <dt class="label text-fg-faint">DIM</dt>
                    <dd class="tnum text-small text-fg-muted">{{ model.embeddingDimension }}</dd>
                  </div>
                  <div class="flex gap-1.5">
                    <dt class="label text-fg-faint">RATE</dt>
                    <dd class="tnum text-small text-fg-muted">{{ model.inputSampleRate }} Hz</dd>
                  </div>
                  <div class="flex gap-1.5">
                    <dt class="label text-fg-faint">WINDOW</dt>
                    <dd class="tnum text-small text-fg-muted">{{ model.inputDurationSec }} s</dd>
                  </div>
                  <div class="flex gap-1.5">
                    <dt class="label text-fg-faint">FORMAT</dt>
                    <dd class="text-small text-fg-muted">{{ model.modelFormat }}</dd>
                  </div>
                </dl>
                <ul v-if="model.limitations.length" class="mt-2 space-y-0.5">
                  <li
                    v-for="limitation in model.limitations"
                    :key="limitation"
                    class="text-small text-fg-faint leading-snug"
                  >
                    — {{ limitation }}
                  </li>
                </ul>
              </button>
              <button
                type="button"
                class="sys-btn-outline shrink-0"
                @click="openSelectDialog(model.modelId)"
              >
                SELECT AS PRODUCTION
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ---- Configuration ------------------------------ -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            RUN CONFIGURATION
          </p>
        </div>

        <div class="px-5 py-4 space-y-5">
          <!-- dataset -->
          <div>
            <p class="label text-fg-muted mb-2">
              DATASET
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="chip"
                :class="lab.datasetMode === 'synthetic' ? 'chip-active' : ''"
                @click="lab.datasetMode = 'synthetic'"
              >
                SYNTHETIC (REPRODUCIBLE)
              </button>
              <button
                type="button"
                class="chip"
                :class="lab.datasetMode === 'device' ? 'chip-active' : ''"
                @click="lab.datasetMode = 'device'"
              >
                DEVICE TRACKS (MANUAL)
              </button>
            </div>

            <template v-if="lab.datasetMode === 'synthetic'">
              <div class="mt-3 flex flex-wrap items-center gap-4">
                <label class="flex items-center gap-2">
                  <span class="label text-fg-muted">SAMPLES</span>
                  <input
                    v-model.number="lab.sampleCount"
                    type="number"
                    min="1"
                    :max="MAX_DATASET_SAMPLES"
                    class="w-20 border border-line bg-base px-2 py-1 tnum text-small text-fg"
                  >
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="lab.includeEdgeCases" type="checkbox" class="accent-primary">
                  <span class="label text-fg-muted">INCLUDE EDGE CASES</span>
                </label>
              </div>
              <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
                Deterministic generated signals with deliberately different acoustic
                properties. Reproducible on any machine, so results are comparable
                across runs and CI. Not music — this validates the harness and detects a
                model that cannot tell obviously different inputs apart.
              </p>
            </template>

            <template v-else>
              <div class="mt-3">
                <button
                  v-if="!tracksLoaded"
                  type="button"
                  class="sys-btn-outline"
                  @click="loadTracksForSelection"
                >
                  LOAD TRACK LIST
                </button>
                <template v-else>
                  <p class="text-small text-fg-muted mb-2">
                    Pick up to {{ MAX_DATASET_SAMPLES }} tracks by hand.
                    {{ lab.selectedTrackIds.length }} selected.
                  </p>
                  <div class="border border-line divide-y divide-line max-h-[280px] overflow-y-auto">
                    <button
                      v-for="track in availableTracks"
                      :key="track.id"
                      type="button"
                      class="w-full text-left px-4 py-2.5 hover:bg-hover t-col flex items-center gap-3"
                      @click="lab.toggleTrack(track.id)"
                    >
                      <input
                        type="checkbox"
                        :checked="lab.selectedTrackIds.includes(track.id)"
                        class="accent-primary pointer-events-none"
                      >
                      <span class="text-small text-fg truncate">{{ track.title }}</span>
                    </button>
                    <p
                      v-if="!availableTracks.length"
                      class="px-4 py-6 text-small text-fg-muted"
                    >
                      No tracks indexed. Scan your library from Settings first — this
                      page will not scan on its own.
                    </p>
                  </div>
                </template>
              </div>
            </template>
          </div>

          <!-- repetitions -->
          <div class="flex flex-wrap gap-5">
            <label class="flex items-center gap-2">
              <span class="label text-fg-muted">WARM-UP</span>
              <input
                v-model.number="lab.warmupRuns"
                type="number"
                min="0"
                max="10"
                class="w-20 border border-line bg-base px-2 py-1 tnum text-small text-fg"
              >
            </label>
            <label class="flex items-center gap-2">
              <span class="label text-fg-muted">REPEATS</span>
              <input
                v-model.number="lab.measuredRuns"
                type="number"
                min="1"
                max="20"
                class="w-20 border border-line bg-base px-2 py-1 tnum text-small text-fg"
              >
            </label>
            <label class="flex items-center gap-2">
              <span class="label text-fg-muted">PROVIDER</span>
              <select
                v-model="lab.executionProvider"
                class="border border-line bg-base px-2 py-1 text-small text-fg"
              >
                <option
                  v-for="provider in lab.providers"
                  :key="provider.id"
                  :value="provider.id"
                >
                  {{ provider.label }}{{ provider.available ? '' : ' (unavailable)' }}
                </option>
              </select>
            </label>
          </div>
          <p class="text-small text-fg-faint leading-relaxed max-w-[76ch]">
            Warm-up inferences are executed and discarded — the first pass through any
            runtime pays for lazy allocation and would otherwise inflate the average.
            Model load time is recorded separately and never folded into inference
            timings.
          </p>

          <!-- provider notes -->
          <div class="space-y-1.5">
            <p
              v-for="provider in lab.providers"
              :key="provider.id"
              class="text-small leading-snug"
              :class="provider.available ? 'text-fg-muted' : 'text-fg-faint'"
            >
              <span class="label" :class="provider.available ? 'text-success' : 'text-warning'">
                {{ provider.label }}
              </span>
              — {{ provider.note }}
            </p>
          </div>
        </div>

        <!-- run controls -->
        <div class="border-t border-line px-5 py-4">
          <LabBanner
            v-if="lab.blockedReason"
            tone="warning"
            title="CANNOT RUN THIS CONFIGURATION"
          >
            {{ lab.blockedReason }}
          </LabBanner>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="sys-btn-primary"
              :disabled="!lab.canRun"
              @click="onRun"
            >
              {{ lab.isRunning ? 'RUNNING…' : 'RUN BENCHMARK' }}
            </button>

            <label class="flex items-center gap-2">
              <span class="label text-fg-muted">SUSTAINED</span>
              <input
                v-model.number="sustainedIterations"
                type="number"
                min="1"
                :max="MAX_SUSTAINED_ITERATIONS"
                class="w-20 border border-line bg-base px-2 py-1 tnum text-small text-fg"
              >
            </label>
            <button
              type="button"
              class="sys-btn-outline"
              :disabled="!lab.canRun"
              @click="lab.executeSustained(sustainedIterations)"
            >
              THERMAL PROBE
            </button>
          </div>

          <div v-if="lab.progress" class="mt-4">
            <p class="text-small text-fg-muted">
              {{ lab.progress.completed }} / {{ lab.progress.total }} — {{ lab.progress.label }}
            </p>
            <div class="mt-2 h-1 bg-line">
              <div
                class="h-full bg-fg t-all"
                :style="{ width: `${lab.progress.total ? (lab.progress.completed / lab.progress.total) * 100 : 0}%` }"
              />
            </div>
          </div>

          <p v-if="lab.lastError" class="mt-3 text-small text-danger">
            {{ lab.lastError }}
          </p>
        </div>
      </section>

      <!-- ---- Sustained result (§14) --------------------- -->
      <section v-if="lab.sustainedResult" class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            SUSTAINED LOAD / THERMAL DRIFT
          </p>
        </div>
        <div class="px-5 py-4">
          <dl class="grid sm:grid-cols-4 gap-px bg-line border border-line">
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                ITERATIONS
              </dt>
              <dd class="tnum text-[15px] font-bold text-fg">
                {{ lab.sustainedResult.iterations }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                FIRST 25%
              </dt>
              <dd class="tnum text-[15px] font-bold text-fg">
                {{ lab.sustainedResult.firstQuartileMs?.toFixed(2) ?? '—' }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                LAST 25%
              </dt>
              <dd class="tnum text-[15px] font-bold text-fg">
                {{ lab.sustainedResult.lastQuartileMs?.toFixed(2) ?? '—' }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                DRIFT
              </dt>
              <dd
                class="tnum text-[15px] font-bold"
                :class="(lab.sustainedResult.driftPercent ?? 0) > 20 ? 'text-warning' : 'text-fg'"
              >
                {{ lab.sustainedResult.driftPercent?.toFixed(1) ?? '—' }} %
              </dd>
            </div>
          </dl>
          <p class="mt-3 text-small text-fg-faint leading-relaxed max-w-[76ch]">
            {{ lab.sustainedResult.note }}
          </p>
        </div>
      </section>

      <!-- ---- Recommendations (§28) ---------------------- -->
      <section v-if="lab.runs.length" class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            RECOMMENDATIONS — ADVISORY ONLY
          </p>
        </div>
        <div class="divide-y divide-line">
          <div
            v-for="rec in recommendations"
            :key="rec.category"
            class="px-5 py-3"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="label text-fg">
                {{ rec.label }}
              </p>
              <p class="text-small text-fg-muted">
                {{ rec.modelId ?? 'no candidate' }}
              </p>
            </div>
            <p class="mt-1 text-small text-fg-muted leading-relaxed max-w-[76ch]">
              {{ rec.reason }}
            </p>
            <p class="mt-1 text-small text-fg-faint">
              Basis: {{ rec.basis }}
            </p>
          </div>
        </div>
        <div class="border-t border-line px-5 py-3">
          <p class="text-small text-fg-faint leading-relaxed max-w-[76ch]">
            These are suggestions against single named metrics. There is no composite
            score, because any weighting between latency, memory and quality would be
            arbitrary. Adopting a model remains a deliberate human step.
          </p>
        </div>
      </section>

      <!-- ---- Run history -------------------------------- -->
      <section>
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 class="label text-fg-muted">
            RUN HISTORY ({{ lab.runs.length }})
          </h2>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="lab.comparisonRuns.length >= 2"
              type="button"
              class="sys-btn-outline"
              @click="router.push('/dev/ai-benchmark/compare')"
            >
              COMPARE {{ lab.comparisonRuns.length }}
            </button>
            <button
              v-if="lab.runs.length"
              type="button"
              class="sys-btn-outline"
              @click="onExport"
            >
              EXPORT JSON
            </button>
            <button
              v-if="lab.runs.length"
              type="button"
              class="sys-btn-ghost"
              @click="lab.removeAllRuns()"
            >
              CLEAR ALL
            </button>
          </div>
        </div>

        <div v-if="!lab.runs.length" class="border border-line bg-surface px-5 py-8">
          <p class="text-small text-fg-muted">
            No benchmark runs yet. Configure a model above and press RUN BENCHMARK.
          </p>
        </div>

        <div v-else class="space-y-3">
          <LabRunCard
            v-for="run in lab.runs"
            :key="run.id"
            :run="run"
            :selected="lab.comparisonRunIds.includes(run.id)"
            @open="router.push(`/dev/ai-benchmark/${run.id}`)"
            @toggle-compare="lab.toggleComparison(run.id)"
          />
        </div>
      </section>

      <!-- ---- Live log (§24) ----------------------------- -->
      <section v-if="lab.logLines.length" class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            STRUCTURED LOG
          </p>
        </div>
        <pre class="px-5 py-4 text-[11px] leading-relaxed text-fg-muted overflow-x-auto max-h-[280px]">{{ lab.logLines.join('\n') }}</pre>
      </section>
    </div>

    <!-- ---- Production selection dialog (§28) ------------ -->
    <div
      v-if="showSelectDialog"
      class="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5"
      @click.self="showSelectDialog = false"
    >
      <div class="w-full max-w-[32rem] border border-line-strong bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg">
            SELECT AS PRODUCTION MODEL
          </p>
        </div>
        <div class="px-5 py-4 space-y-3">
          <p class="text-small text-fg-muted leading-relaxed">
            You are recording a deliberate decision to adopt
            <span class="font-bold text-fg">{{ selectionModelId }}</span>
            as SYSTEMA's production audio model. A written rationale is required so the
            reasoning survives beyond this session.
          </p>
          <textarea
            v-model="selectionRationale"
            rows="4"
            placeholder="Why this model? Reference the measurements that justify it."
            class="w-full border border-line bg-base px-3 py-2 text-small text-fg"
          />
          <div class="flex gap-2 justify-end">
            <button type="button" class="sys-btn-ghost" @click="showSelectDialog = false">
              CANCEL
            </button>
            <button
              type="button"
              class="sys-btn-primary"
              :disabled="!selectionRationale.trim()"
              @click="confirmSelection"
            >
              CONFIRM SELECTION
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
