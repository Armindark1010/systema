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
const selectedTrackId = ref<string | null>(null)
const analysis = ref<AudioAnalysis | null>(null)
const summary = ref<AudioAnalysisSummary | null>(null)
const running = ref(false)
const errorMessage = ref<string | null>(null)
const errorCode = ref<string | null>(null)

/** First page of the library is enough for a debug picker. */
const tracks = computed(() => library.tracks.slice(0, 50))

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

onMounted(refreshSummary)
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
        <p v-if="!tracks.length" class="px-4 py-6 text-small text-fg-muted">
          The library index is empty. Scan the device library first.
        </p>
      </div>

      <div v-if="selectedTrack" class="mt-4 flex flex-wrap gap-3">
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
