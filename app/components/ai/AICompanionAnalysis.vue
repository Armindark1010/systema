<script setup lang="ts">
// ============================================================
// AICompanionAnalysis — the REAL analysis panel on the AI page
// ============================================================
// Everything else on the AI page is mock: invented moods, a hardcoded
// "1,284 tracks analyzed", a fake progress meter. This panel is the
// one place there that reports measured facts, and it is labelled
// ON-DEVICE DSP precisely so it cannot be confused with its
// neighbours.
//
// It shows two things:
//   · library counters straight out of the analysis table
//     (completed / failed / pending at the current analyzer version)
//   · the measured result for the track playing right now, with a
//     button to analyse it
//
// In the browser there is no decoder, so it renders an honest
// "unavailable" state rather than zeros that look like real counts.
// ============================================================

import { formatAnalysisValue, formatBpm } from '~/services/native/audioAnalysisService'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const audioAnalysis = useAudioAnalysis()

const track = computed(() => player.currentTrack)
const state = computed(() => audioAnalysis.stateFor(track.value?.id))
const result = computed(() => audioAnalysis.resultFor(track.value?.id))
const failure = computed(() => audioAnalysis.failureFor(track.value?.id))
const summary = computed(() => audioAnalysis.summary.value)

const isAnalyzing = computed(() => state.value === 'analyzing')

/** Headline measurements. Deliberately few: this is not the debug page. */
const rows = computed(() => {
  const a = result.value
  if (!a) return []
  return [
    { label: 'BPM', value: formatBpm(a) },
    { label: 'LOUDNESS', value: formatAnalysisValue(a.loudnessDbfs, ' dBFS', 1) },
    { label: 'DYNAMIC RANGE', value: formatAnalysisValue(a.dynamicRangeDb, ' dB', 1) },
    { label: 'BRIGHTNESS', value: formatAnalysisValue(a.spectralCentroid, ' Hz', 0) },
  ]
})

const actionLabel = computed(() => {
  if (isAnalyzing.value) return 'ANALYSING…'
  if (state.value === 'analyzed') return 'RE-ANALYSE'
  if (state.value === 'failed') return 'TRY AGAIN'
  return 'ANALYSE THIS TRACK'
})

function onAnalyze() {
  const current = track.value
  if (!current) return
  void audioAnalysis.analyze(current.id, {
    force: state.value === 'analyzed',
    title: current.title,
  })
}

// Counters and the current track's stored result, refreshed when this
// panel appears and whenever the track changes underneath it.
onMounted(() => {
  void audioAnalysis.refreshSummary()
  if (track.value) void audioAnalysis.hydrate(track.value.id, true)
})

watch(track, (current) => {
  if (current) void audioAnalysis.hydrate(current.id)
})
</script>

<template>
  <section class="px-4" aria-labelledby="ai-dsp-heading">
    <div class="flex items-baseline justify-between gap-3 border-b border-ai-line-strong pb-2.5">
      <h2 id="ai-dsp-heading" class="text-title font-bold tracking-[0.02em] text-ai-fg">
        ON-DEVICE DSP
      </h2>
      <span class="ai-label">REAL MEASUREMENT</span>
    </div>

    <!-- No analyser: browser build -->
    <div v-if="!audioAnalysis.available.value" class="mt-4 border border-ai-line px-3 py-3">
      <p class="ai-label">ANALYSER UNAVAILABLE</p>
      <p class="mt-1.5 text-small leading-relaxed text-ai-fg-muted">
        Signal analysis runs natively on Android. A browser has no decoder,
        so no counts or measurements are shown here rather than placeholder
        numbers.
      </p>
    </div>

    <template v-else>
      <!-- Library counters, straight from the analysis table -->
      <dl v-if="summary" class="mt-4 grid grid-cols-3 border border-ai-line">
        <div class="border-r border-ai-line px-3 py-2.5">
          <dt class="ai-label">ANALYSED</dt>
          <dd class="mt-1 ai-value tnum">{{ summary.completed.toLocaleString('en-US') }}</dd>
        </div>
        <div class="border-r border-ai-line px-3 py-2.5">
          <dt class="ai-label">PENDING</dt>
          <dd class="mt-1 ai-value tnum">{{ summary.pending.toLocaleString('en-US') }}</dd>
        </div>
        <div class="px-3 py-2.5">
          <dt class="ai-label">FAILED</dt>
          <dd class="mt-1 ai-value tnum">{{ summary.failed.toLocaleString('en-US') }}</dd>
        </div>
      </dl>

      <!-- Current track -->
      <div v-if="track" class="mt-4">
        <p class="ai-label">CURRENT TRACK</p>
        <p class="mt-1 truncate text-lead font-semibold text-ai-fg">{{ track.title }}</p>

        <dl v-if="rows.length" class="mt-3 grid grid-cols-2 border border-ai-line">
          <div
            v-for="(row, index) in rows"
            :key="row.label"
            class="px-3 py-2.5"
            :class="[
              index % 2 === 0 ? 'border-r border-ai-line' : '',
              index < rows.length - 2 ? 'border-b border-ai-line' : '',
            ]"
          >
            <dt class="ai-label">{{ row.label }}</dt>
            <dd class="mt-1 ai-value tnum">{{ row.value }}</dd>
          </div>
        </dl>

        <p v-else-if="isAnalyzing" class="mt-3 text-small leading-relaxed text-ai-fg-muted">
          Decoding and measuring on this device. Playback is unaffected.
        </p>

        <div v-else-if="state === 'failed'" class="mt-3 border border-ai-line px-3 py-2.5">
          <p class="ai-label text-ai-accent">{{ failure?.code ?? 'FAILED' }}</p>
          <p class="mt-1 text-small leading-relaxed text-ai-fg-muted">
            {{ failure?.message ?? 'This track could not be analysed.' }}
          </p>
        </div>

        <p v-else class="mt-3 text-small leading-relaxed text-ai-fg-muted">
          Not analysed yet. Tempo, loudness and spectral shape are measured from
          the audio itself — never read from file tags.
        </p>

        <button
          type="button"
          class="ai-btn-primary mt-3 w-full"
          :disabled="isAnalyzing"
          @click="onAnalyze"
        >
          <UIcon
            :name="isAnalyzing ? 'lucide:loader-circle' : 'lucide:activity'"
            class="h-4 w-4"
            :class="isAnalyzing ? 'animate-spin' : ''"
          />
          {{ actionLabel }}
        </button>
      </div>

      <p v-else class="mt-4 text-small leading-relaxed text-ai-fg-muted">
        Play something to measure it, or open Settings → AUDIO DSP to analyse any
        track in your library.
      </p>
    </template>
  </section>
</template>
