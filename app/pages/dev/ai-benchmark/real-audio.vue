<script setup lang="ts">
// ============================================================
// SYSTEMA — Real-audio device test (Phase 14)
// ============================================================
// The shortcut for "add a song, get a response" on real hardware.
//
// What this page honestly measures
// --------------------------------
// Phase 14 has no ONNX runtime and no model weights, so there is no
// neural inference to time on a real track. What DOES exist is the
// Phase 13 native pipeline, which genuinely decodes real audio with
// MediaCodec and runs DSP over it.
//
// So this page measures DECODE + DSP cost per track. That is the
// most decision-relevant number available today, because any future
// on-device model must pay the decode cost before it sees a single
// sample. If a 4-minute track already costs 800 ms to decode, that
// is a floor no model can beat — worth knowing before choosing one.
//
// It is labelled as decode+DSP everywhere. It is NOT presented as
// model inference, because it isn't.
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  canMeasureRealAudio,
  measureRealTrack,
  type DeviceAudioMeasurement,
} from '~/services/ai-lab/deviceAudio'
import { MAX_DATASET_SAMPLES } from '~/services/ai-lab/dataset'
import { detectDevice } from '~/services/ai-lab/deviceInfo'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Real audio device test' })

const library = useLibraryStore()
const router = useRouter()

const device = computed(() => detectDevice())
const available = canMeasureRealAudio()
const isNative = computed(() => device.value.platform === 'android')

// ---- Library access (self-sufficient, like the Phase 13 page) ----
const isScanning = computed(() => library.isScanning)
const scanLabel = computed(() => library.scanLabel)
const scanPercent = computed(() => library.scanPercent)
const permissionGranted = computed(() => library.permissionStatus === 'granted')
const totalInLibrary = computed(() => library.nativeTotal || library.tracks.length)

/** Only the first page: this is a picker, not a library browser. */
const tracks = computed(() => library.tracks.slice(0, 100))

function onScan() {
  if (isScanning.value) void library.cancelLibraryScan()
  else void library.scanLibrary()
}

async function loadTracks() {
  try {
    await library.loadFirstPage()
  } catch {
    // The list simply stays as it is.
  }
}

onMounted(() => {
  if (isNative.value && !library.tracks.length) void loadTracks()
})

watch(isScanning, async (scanning, was) => {
  if (was && !scanning) await loadTracks()
})

// ---- Selection ---------------------------------------------------
const selected = ref<string[]>([])

function toggle(trackId: string) {
  if (selected.value.includes(trackId)) {
    selected.value = selected.value.filter(id => id !== trackId)
    return
  }
  if (selected.value.length >= MAX_DATASET_SAMPLES) return
  selected.value = [...selected.value, trackId]
}

const atCap = computed(() => selected.value.length >= MAX_DATASET_SAMPLES)

// ---- Measurement -------------------------------------------------
interface Row {
  trackId: string
  title: string
  status: 'PENDING' | 'RUNNING' | 'OK' | 'FAILED'
  measurement?: DeviceAudioMeasurement
  errorCode?: string
  errorMessage?: string
}

const rows = ref<Row[]>([])
const running = ref(false)
const progress = ref<{ done: number, total: number } | null>(null)

async function runTest() {
  if (running.value || !selected.value.length) return

  running.value = true
  rows.value = selected.value.map((id) => ({
    trackId: id,
    title: tracks.value.find(t => t.id === id)?.title ?? id,
    status: 'PENDING' as const,
  }))

  let done = 0
  progress.value = { done, total: rows.value.length }

  for (const row of rows.value) {
    row.status = 'RUNNING'
    try {
      // force = true: a cached result would report a decode cost that
      // never happened on this run.
      row.measurement = await measureRealTrack(row.trackId, true)
      row.status = 'OK'
    } catch (error) {
      // One bad file must not abort the batch (§25).
      row.status = 'FAILED'
      const e = error as { code?: string, message?: string }
      row.errorCode = e.code ?? 'UNKNOWN'
      row.errorMessage = e.message ?? String(error)
    }
    done++
    progress.value = { done, total: rows.value.length }
  }

  running.value = false
  progress.value = null
}

// ---- Aggregates --------------------------------------------------
const ok = computed(() => rows.value.filter(r => r.status === 'OK' && r.measurement))

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const summary = computed(() => {
  const list = ok.value.map(r => r.measurement!)
  if (!list.length) return null
  return {
    count: list.length,
    medianDecode: median(list.map(m => m.decodeMs)),
    medianDsp: median(list.map(m => m.dspMs)),
    medianTotal: median(list.map(m => m.totalMs)),
    medianRtf: median(list.map(m => m.realTimeFactor ?? 0).filter(v => v > 0)),
    totalAudioSec: list.reduce((a, m) => a + m.audioSec, 0),
  }
})

const failures = computed(() => rows.value.filter(r => r.status === 'FAILED'))

// ---- Export ------------------------------------------------------
function exportJson() {
  const payload = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    kind: 'real-audio-decode-dsp',
    disclaimer:
      'Decode + DSP timings from the Phase 13 native pipeline on real device '
      + 'audio. These are NOT neural model inference times — Phase 14 ships no '
      + 'model weights and no ONNX runtime. Decode cost is the floor any future '
      + 'on-device model must pay. Contains no audio and no file paths.',
    device: device.value,
    results: rows.value.map(r => ({
      status: r.status,
      errorCode: r.errorCode,
      // Track ids only; never titles or paths in the export.
      measurement: r.measurement,
    })),
    summary: summary.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `systema-real-audio-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits)
}
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-line bg-surface">
      <div class="sys-container py-6">
        <button
          type="button"
          class="label text-fg-muted hover:text-fg t-col"
          @click="router.push('/dev/ai-benchmark')"
        >
          ← BENCHMARK LAB
        </button>
        <h1 class="mt-3 text-[22px] font-bold tracking-tight text-fg">
          Real audio device test
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Pick real tracks, measure what they actually cost to decode and analyse
          on this device.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <!-- ---- What this measures, stated up front ---------- -->
      <LabBanner tone="warning" title="THIS MEASURES DECODE + DSP, NOT MODEL INFERENCE">
        Phase 14 ships no model weights and no ONNX runtime, so there is no neural
        inference to time on a real track yet. What is measured here is the real
        MediaCodec decode plus the Phase 13 DSP pass. That matters because
        <strong class="text-fg">any future on-device model must pay the decode cost
          first</strong> — it is the floor under every model choice. Nothing on this
        page is presented as a model benchmark.
      </LabBanner>

      <!-- ---- Environment --------------------------------- -->
      <LabBanner
        v-if="!available"
        tone="danger"
        title="NO DECODER IN THIS ENVIRONMENT"
      >
        There is no audio decoder in the browser, so real tracks cannot be read
        here. Install and run the Android build, then open this page on the device.
        No placeholder numbers are shown.
      </LabBanner>
      <LabBanner v-else tone="info" title="DEVICE BENCHMARK">
        {{ device.label }} · {{ device.osVersion }} · {{ device.cpuArchitecture }}.
        Timings below come from real decoding on this hardware.
      </LabBanner>

      <template v-if="available">
        <!-- ---- Step 1: get music indexed ----------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              STEP 1 — INDEX YOUR MUSIC
            </p>
          </div>
          <div class="px-5 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-small text-fg-muted">
                <template v-if="isScanning">{{ scanLabel }}</template>
                <template v-else-if="!permissionGranted">
                  Audio permission is required to read your library.
                </template>
                <template v-else-if="totalInLibrary">
                  {{ totalInLibrary }} track(s) indexed.
                </template>
                <template v-else>No tracks indexed yet.</template>
              </p>
              <button type="button" class="sys-btn-outline" @click="onScan">
                {{ isScanning ? 'CANCEL' : 'SCAN' }}
              </button>
            </div>
            <div v-if="isScanning && scanPercent !== null" class="mt-3 h-1 bg-line">
              <div class="h-full bg-fg t-all" :style="{ width: `${scanPercent}%` }" />
            </div>
          </div>
        </section>

        <!-- ---- Step 2: pick tracks ----------------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between gap-3">
            <p class="label text-fg-muted">
              STEP 2 — PICK TRACKS ({{ selected.length }}/{{ MAX_DATASET_SAMPLES }})
            </p>
            <button
              v-if="selected.length"
              type="button"
              class="label text-fg-muted hover:text-fg t-col"
              @click="selected = []"
            >
              CLEAR
            </button>
          </div>

          <p v-if="atCap" class="px-5 pt-3 text-small text-warning">
            Selection cap reached. Phase 14 never benchmarks more than
            {{ MAX_DATASET_SAMPLES }} tracks — it must not sweep your library.
          </p>

          <div class="divide-y divide-line max-h-[360px] overflow-y-auto">
            <button
              v-for="track in tracks"
              :key="track.id"
              type="button"
              class="w-full text-left px-5 py-3 hover:bg-hover t-col flex items-center gap-3"
              :class="selected.includes(track.id) ? 'bg-hover' : ''"
              @click="toggle(track.id)"
            >
              <input
                type="checkbox"
                :checked="selected.includes(track.id)"
                class="accent-primary pointer-events-none shrink-0"
              >
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-bold text-fg truncate">{{ track.title }}</span>
                <span class="block text-small text-fg-muted truncate">
                  {{ track.artist ?? 'Unknown artist' }}
                </span>
              </span>
            </button>
            <p v-if="!tracks.length" class="px-5 py-8 text-small text-fg-muted">
              No tracks loaded yet. Scan above, then they appear here.
            </p>
          </div>
        </section>

        <!-- ---- Step 3: run ------------------------------- -->
        <section class="border border-line bg-surface px-5 py-4">
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="sys-btn-primary"
              :disabled="running || !selected.length"
              @click="runTest"
            >
              {{ running ? 'MEASURING…' : `MEASURE ${selected.length} TRACK(S)` }}
            </button>
            <button
              v-if="ok.length"
              type="button"
              class="sys-btn-outline"
              @click="exportJson"
            >
              EXPORT JSON
            </button>
          </div>

          <div v-if="progress" class="mt-4">
            <p class="text-small text-fg-muted">
              {{ progress.done }} / {{ progress.total }} decoded
            </p>
            <div class="mt-2 h-1 bg-line">
              <div
                class="h-full bg-fg t-all"
                :style="{ width: `${(progress.done / progress.total) * 100}%` }"
              />
            </div>
          </div>

          <p class="mt-3 text-small text-fg-faint leading-relaxed max-w-[76ch]">
            Each track is re-decoded rather than read from cache — a cached result
            would report a decode cost that never happened. Analysis is capped at
            the first 5 minutes of each track, as in Phase 13.
          </p>
        </section>

        <!-- ---- Summary ----------------------------------- -->
        <section v-if="summary">
          <h2 class="label text-fg-muted mb-3">
            SUMMARY — {{ summary.count }} TRACK(S), {{ fmt(summary.totalAudioSec) }}s AUDIO
          </h2>
          <dl class="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN DECODE
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.medianDecode) }} <span class="text-small font-normal text-fg-muted">ms</span>
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN DSP
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.medianDsp) }} <span class="text-small font-normal text-fg-muted">ms</span>
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN TOTAL
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.medianTotal) }} <span class="text-small font-normal text-fg-muted">ms</span>
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN RTF
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.medianRtf, 4) }}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
            Real-time factor below 1.0 means the pipeline processes audio faster than
            it plays. The decode column is the number to watch when judging whether a
            heavier model is affordable.
          </p>
        </section>

        <!-- ---- Per-track results ------------------------- -->
        <section v-if="rows.length">
          <h2 class="label text-fg-muted mb-3">
            PER-TRACK RESULTS
          </h2>
          <div class="border border-line overflow-x-auto">
            <table class="w-full text-small">
              <thead class="bg-surface border-b border-line">
                <tr>
                  <th class="text-left px-4 py-2 label text-fg-muted">
                    TRACK
                  </th>
                  <th class="text-left px-4 py-2 label text-fg-muted">
                    STATUS
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    DECODE
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    DSP
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    TOTAL
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    AUDIO
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    RTF
                  </th>
                  <th class="text-right px-4 py-2 label text-fg-muted">
                    BPM
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="row in rows" :key="row.trackId" class="bg-surface">
                  <td class="px-4 py-2 text-fg truncate max-w-[200px]">
                    {{ row.title }}
                  </td>
                  <td
                    class="px-4 py-2 label"
                    :class="{
                      'text-success': row.status === 'OK',
                      'text-danger': row.status === 'FAILED',
                      'text-fg-muted': row.status !== 'OK' && row.status !== 'FAILED',
                    }"
                  >
                    {{ row.status }}
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg">
                    {{ fmt(row.measurement?.decodeMs) }}
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg-muted">
                    {{ fmt(row.measurement?.dspMs) }}
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg-muted">
                    {{ fmt(row.measurement?.totalMs) }}
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg-muted">
                    {{ fmt(row.measurement?.audioSec) }}s
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg-muted">
                    {{ fmt(row.measurement?.realTimeFactor, 3) }}
                  </td>
                  <td class="px-4 py-2 text-right tnum text-fg-muted">
                    {{ row.measurement?.bpm ? fmt(row.measurement.bpm) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ---- Failures (§25) ---------------------------- -->
        <section v-if="failures.length">
          <h2 class="label text-fg-muted mb-3">
            FAILURES ({{ failures.length }})
          </h2>
          <div class="border border-line divide-y divide-line">
            <div v-for="row in failures" :key="row.trackId" class="bg-surface px-4 py-3">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-small font-bold text-fg truncate">
                  {{ row.title }}
                </p>
                <span class="label text-danger">{{ row.errorCode }}</span>
              </div>
              <p class="mt-1 text-small text-fg-muted leading-relaxed">
                {{ row.errorMessage }}
              </p>
            </div>
          </div>
          <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
            A file that cannot be decoded fails on its own — the rest of the batch
            still completes.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
