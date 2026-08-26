<script setup lang="ts">
// ============================================================
// SYSTEMA — Audio analysis debug readout (Phase 13)
// ============================================================
// A DEVELOPER path, deliberately kept out of the production Library
// UI. It exists so the DSP pipeline can be exercised against real
// device audio — which is the only way to verify the decoder half of
// the pipeline, since MediaCodec cannot run in a unit test.
//
// It is not linked from the settings index and adds nothing to the
// normal browsing experience: reach it directly at
// /settings/audio-analysis.
//
// In the browser every call returns null (there is no decoder and no
// MediaStore), so the page reports that plainly instead of showing
// fabricated numbers.
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  analyzeTrack,
  getAnalysis,
  getAnalysisSummary,
  formatAnalysisValue,
  formatBpm,
  toAnalysisError,
} from '~/services/native/audioAnalysisService'
import { isAudioAnalysisAvailable } from '~/services/native/audioAnalysisPlugin'
import type { AudioAnalysis, AudioAnalysisSummary } from '~/services/native/audioAnalysisPlugin'

useHead({ title: 'Audio Analysis (debug)' })

const library = useLibraryStore()

const available = isAudioAnalysisAvailable()

// ---- Library access -------------------------------------------
// This page has to be self-sufficient. Someone arriving here to test
// the DSP should not have to go to Library settings, scan, come back,
// and hope the first page happens to be loaded. Permission, scanning
// and loading all happen right here.

const isNativeLibrary = computed(() => library.isNativeLibrary)
const isScanning = computed(() => library.isScanning)
const scanLabel = computed(() => library.scanLabel)
const scanPercent = computed(() => library.scanPercent)
const permissionGranted = computed(() => library.permissionStatus === 'granted')
const libraryLoading = computed(() => library.isLoading)

function onScan() {
  if (isScanning.value) void library.cancelLibraryScan()
  else void library.scanLibrary()
}
const selectedTrackId = ref<string | null>(null)
const analysis = ref<AudioAnalysis | null>(null)
const summary = ref<AudioAnalysisSummary | null>(null)
const running = ref(false)
const errorMessage = ref<string | null>(null)
const errorCode = ref<string | null>(null)

/** First page of the library is enough for a debug picker. */
const tracks = computed(() => library.tracks.slice(0, 50))

/** Total rows the native index knows about, not just the loaded page. */
const totalInLibrary = computed(() => library.nativeTotal || library.tracks.length)

const selectedTrack = computed(() =>
  tracks.value.find(t => t.id === selectedTrackId.value) ?? null)

async function refreshSummary() {
  try {
    summary.value = await getAnalysisSummary()
  } catch {
    summary.value = null
  }
}

async function loadStored(trackId: string) {
  selectedTrackId.value = trackId
  errorMessage.value = null
  errorCode.value = null
  analysis.value = await getAnalysis(trackId)
}

async function runAnalysis(force = false) {
  const trackId = selectedTrackId.value
  if (!trackId || running.value) return

  running.value = true
  errorMessage.value = null
  errorCode.value = null

  try {
    analysis.value = await analyzeTrack(trackId, { force })
    if (analysis.value === null) {
      errorMessage.value = 'No native analyser on this platform.'
    }
    await refreshSummary()
  } catch (error) {
    const failure = toAnalysisError(error)
    errorCode.value = failure.code
    errorMessage.value = failure.message
  } finally {
    running.value = false
  }
}

/** Rows rendered from whatever the analyser actually returned. */
const rows = computed(() => {
  const a = analysis.value
  if (!a) return []
  return [
    { label: 'DURATION', value: `${(a.durationMs / 1000).toFixed(1)} s` },
    { label: 'SAMPLE RATE', value: `${a.sampleRate} Hz` },
    { label: 'CHANNELS', value: String(a.channels) },
    { label: 'SAMPLES ANALYSED', value: a.analyzedSampleCount.toLocaleString() },
    { label: 'BPM', value: formatBpm(a) },
    { label: 'RMS', value: formatAnalysisValue(a.rms, '', 4) },
    { label: 'PEAK', value: formatAnalysisValue(a.peak, '', 4) },
    { label: 'DYNAMIC RANGE', value: formatAnalysisValue(a.dynamicRangeDb, ' dB', 1) },
    { label: 'SILENCE RATIO', value: formatAnalysisValue(a.silenceRatio, '', 3) },
    { label: 'LOUDNESS (RMS dBFS)', value: formatAnalysisValue(a.loudnessDbfs, ' dBFS', 1) },
    { label: 'SPECTRAL CENTROID', value: formatAnalysisValue(a.spectralCentroid, ' Hz', 0) },
    { label: 'CENTROID RANGE', value:
      `${formatAnalysisValue(a.spectralCentroidMin, '', 0)} – ${formatAnalysisValue(a.spectralCentroidMax, ' Hz', 0)}` },
    { label: 'SPECTRAL BANDWIDTH', value: formatAnalysisValue(a.spectralBandwidth, ' Hz', 0) },
    { label: 'SPECTRAL ROLLOFF', value: formatAnalysisValue(a.spectralRolloff, ' Hz', 0) },
    { label: 'ZERO CROSSING RATE', value: formatAnalysisValue(a.zeroCrossingRate, '', 4) },
    { label: 'ANALYZER VERSION', value: String(a.analyzerVersion) },
    { label: 'DECODE TIME', value: `${a.decodeTimeMs} ms` },
    { label: 'DSP TIME', value: `${a.dspTimeMs} ms` },
    { label: 'TOTAL TIME', value: `${a.totalAnalysisTimeMs} ms` },
    { label: 'REAL-TIME FACTOR', value: formatAnalysisValue(a.realTimeFactor, '', 4) },
  ]
})

onMounted(async () => {
  // Pull the first page if nothing is loaded yet, so the picker below
  // is populated even when this page is the first thing opened.
  if (library.isNativeLibrary && !library.tracks.length && !library.isLoading) {
    try {
      await library.loadFirstPage()
    } catch {
      // Non-fatal: the empty-state guidance below covers it.
    }
  }
  await refreshSummary()
})

// After a scan finishes, reload the picker so newly indexed tracks
// appear without the user having to leave and come back.
watch(isScanning, async (scanning, wasScanning) => {
  if (wasScanning && !scanning) {
    try {
      await library.loadFirstPage()
    } catch {
      // Ignored: the list simply stays as it was.
    }
    await refreshSummary()
  }
})
</script>

<template>
  <div class="space-y-10">
    <SettingsSection
      id="analysis-status"
      index="01"
      label="AUDIO DSP"
      description="DEVELOPER DIAGNOSTIC"
    >
      <div class="border border-line bg-surface p-6 space-y-4">
        <p class="text-small text-fg-muted max-w-[64ch] leading-relaxed">
          On-device signal analysis. Decoding and DSP run natively and never
          touch the player. This page is a developer tool, not part of the
          library experience.
        </p>

        <div v-if="!available" class="border border-line px-4 py-3">
          <p class="label text-fg-muted">NATIVE ANALYSER UNAVAILABLE</p>
          <p class="mt-2 text-small text-fg-muted leading-relaxed">
            There is no decoder in the browser. Run the Android build to
            analyse real audio. No placeholder values are shown here.
          </p>
        </div>

        <dl v-else-if="summary" class="grid sm:grid-cols-4 gap-px bg-line border border-line">
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">VERSION</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ summary.analyzerVersion }}</dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">ANALYSED</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ summary.completed }}</dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">PENDING</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ summary.pending }}</dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">FAILED</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ summary.failed }}</dd>
          </div>
        </dl>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="available"
      id="analysis-track"
      index="02"
      label="TRACK"
      description="SELECT AND ANALYSE"
    >
      <!-- Step 1: get music into the index. Doing this here means the
           page works on its own, without a detour to Library settings. -->
      <div class="border border-line bg-surface px-4 py-4 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="label text-fg-muted">STEP 1 — SCAN DEVICE</p>
            <p class="mt-1 text-small text-fg-muted leading-relaxed">
              <template v-if="isScanning">{{ scanLabel }}</template>
              <template v-else-if="!permissionGranted">
                Audio permission is required to read your music.
              </template>
              <template v-else-if="totalInLibrary">
                {{ totalInLibrary }} track(s) indexed.
              </template>
              <template v-else>No tracks indexed yet.</template>
            </p>
          </div>
          <button
            type="button"
            class="border border-line px-4 py-2 label text-fg hover:bg-surface-hover transition-colors"
            @click="onScan"
          >
            {{ isScanning ? 'CANCEL' : 'SCAN' }}
          </button>
        </div>
        <div v-if="isScanning && scanPercent !== null" class="mt-3 h-1 bg-line">
          <div class="h-full bg-fg transition-all" :style="{ width: `${scanPercent}%` }" />
        </div>
      </div>

      <p class="label text-fg-muted mb-2">STEP 2 — PICK A TRACK</p>
      <div class="border border-line divide-y divide-line max-h-[320px] overflow-y-auto">
        <button
          v-for="track in tracks"
          :key="track.id"
          type="button"
          class="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors"
          :class="track.id === selectedTrackId ? 'bg-surface-hover' : ''"
          @click="loadStored(track.id)"
        >
          <span class="block text-[12px] font-bold text-fg truncate">{{ track.title }}</span>
          <span class="block text-small text-fg-muted truncate">{{ track.artist ?? 'Unknown artist' }}</span>
        </button>
        <p v-if="libraryLoading && !tracks.length" class="px-4 py-6 text-small text-fg-muted">
          Loading the library index…
        </p>
        <p v-else-if="!tracks.length" class="px-4 py-6 text-small text-fg-muted leading-relaxed">
          No tracks indexed yet. Run SCAN above, grant the audio permission
          when Android asks, and this list will fill in.
        </p>
      </div>

      <p v-if="selectedTrack" class="label text-fg-muted mt-6 mb-2">STEP 3 — ANALYSE</p>
      <div v-if="selectedTrack" class="flex flex-wrap gap-3">
        <button
          type="button"
          class="border border-line px-4 py-2 label text-fg hover:bg-surface-hover transition-colors disabled:opacity-50"
          :disabled="running"
          @click="runAnalysis(false)"
        >
          {{ running ? 'ANALYSING…' : 'ANALYSE' }}
        </button>
        <button
          type="button"
          class="border border-line px-4 py-2 label text-fg-muted hover:bg-surface-hover transition-colors disabled:opacity-50"
          :disabled="running"
          @click="runAnalysis(true)"
        >
          RE-ANALYSE
        </button>
      </div>

      <div v-if="errorMessage" class="mt-4 border border-line px-4 py-3">
        <p class="label text-fg-muted">{{ errorCode ?? 'ERROR' }}</p>
        <p class="mt-1 text-small text-fg leading-relaxed">{{ errorMessage }}</p>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="available && rows.length"
      id="analysis-result"
      index="03"
      label="RESULT"
      description="MEASURED VALUES"
    >
      <div class="border border-line divide-y divide-line">
        <div
          v-for="row in rows"
          :key="row.label"
          class="px-4 py-3 flex items-baseline justify-between gap-4"
        >
          <span class="label text-fg-muted">{{ row.label }}</span>
          <span class="tnum text-[12px] font-bold text-fg text-right">{{ row.value }}</span>
        </div>
      </div>
      <p class="mt-4 text-small text-fg-muted leading-relaxed max-w-[64ch]">
        Loudness is RMS-derived dBFS, not LUFS. A dash means the analyser could
        not determine that value; it is never substituted with zero.
      </p>
    </SettingsSection>
  </div>
</template>
