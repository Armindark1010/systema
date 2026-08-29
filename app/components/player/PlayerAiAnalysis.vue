<script setup lang="ts">
/**
 * Single-track AI analysis panel for the Full Player (Phase 24).
 *
 * Renders what the analysis actually produced. Every value comes from
 * the runtime record; there is no fallback constant, and a missing
 * measurement renders as a dash.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No Mood, Language, Danceability, Acoustic, Vocal or "good for
 * Driving/Workout". No classifier for any of those exists in this
 * repo, and printing a plausible-looking value would be inventing
 * data. They are listed under "Not yet available" with the reason, so
 * the gap is visible instead of disguised.
 */
import { computed } from 'vue'

import type { AiAnalysisState } from '~/composables/useTrackAiAnalysis'
import type {
  TrackAnalysisFailureRecord,
  TrackAnalysisRecord,
} from '~/services/ai-similarity/trackAnalysis'

const props = defineProps<{
  state: AiAnalysisState
  result: TrackAnalysisRecord | null
  failure: TrackAnalysisFailureRecord | null
  saveWarning?: string | null
  fromCache?: boolean
}>()

const emit = defineEmits<{ analyze: [force: boolean] }>()

const isAnalyzing = computed(() => props.state === 'analyzing')
const hasResult = computed(() => props.state === 'done' && props.result !== null)

/** A dash, never a plausible-looking placeholder. */
const DASH = '—'

function fmt(v: number | null | undefined, digits = 0, suffix = ''): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH
  return `${v.toFixed(digits)}${suffix}`
}

/** Measured DSP features, shown only when the DSP analyser has run. */
const dspRows = computed(() => {
  const d = props.result?.dsp
  if (!d) return []
  const rows: { label: string, value: string }[] = []
  // BPM is null when confidence was too low to state a number honestly.
  rows.push({ label: 'Tempo', value: d.bpm === null ? DASH : `${Math.round(d.bpm)} BPM` })
  if (d.bpm !== null && d.bpmConfidence !== null) {
    rows.push({ label: 'Tempo conf.', value: fmt(d.bpmConfidence * 100, 0, '%') })
  }
  rows.push({ label: 'Loudness', value: fmt(d.loudnessDbfs, 1, ' dBFS') })
  rows.push({ label: 'Dynamics', value: fmt(d.dynamicRangeDb, 1, ' dB') })
  return rows
})

const audioRows = computed(() => {
  const a = props.result?.audio
  if (!a) return []
  return [
    { label: 'Duration', value: fmt(a.durationSec, 0, ' s') },
    { label: 'Analysed', value: fmt(a.processedDurationSec, 0, ' s') },
    { label: 'Source rate', value: a.sourceSampleRate ? `${a.sourceSampleRate} Hz` : DASH },
    { label: 'Windows', value: a.windowsProcessed === null ? DASH : String(a.windowsProcessed) },
  ]
})

const modelRows = computed(() => {
  const r = props.result
  if (!r) return []
  return [
    { label: 'Model', value: r.model.id || DASH },
    { label: 'Version', value: r.model.version || DASH },
    { label: 'Embedding', value: r.embedding.dimension > 0 ? `${r.embedding.dimension}-d` : DASH },
    { label: 'Normalised', value: r.embedding.normalised ? 'Yes' : 'No' },
    { label: 'Experimental', value: r.model.experimental ? 'Yes' : 'No' },
  ]
})

const timing = computed(() => {
  const t = props.result?.timings
  if (!t) return null
  const parts: string[] = []
  if (t.inferenceMs !== null) parts.push(`${Math.round(t.inferenceMs)} ms inference`)
  if (t.decodeMs !== null) parts.push(`${Math.round(t.decodeMs)} ms decode`)
  return parts.length ? parts.join(' · ') : null
})

const analysedAt = computed(() => {
  const iso = props.result?.analyzedAt
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
})
</script>

<template>
  <section class="ai-analysis">
    <div class="ai-analysis-head">
      <p class="ai-analysis-title">AI ANALYSIS</p>
      <span class="ai-analysis-tag">EXPERIMENTAL</span>
    </div>

    <!-- RUNNING ---------------------------------------------------- -->
    <template v-if="isAnalyzing">
      <p class="analysis-desc">
        Embedding this track on device. Playback is unaffected.
      </p>
      <div class="analysis-progress">
        <div class="analysis-progress-bar">
          <div class="analysis-progress-fill" />
        </div>
      </div>
    </template>

    <!-- RESULT ----------------------------------------------------- -->
    <template v-else-if="hasResult">
      <dl v-if="dspRows.length" class="analysis-grid">
        <div v-for="row in dspRows" :key="row.label" class="analysis-field">
          <dt class="analysis-field-label">{{ row.label }}</dt>
          <dd class="analysis-field-value tnum">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="analysis-note">
        No measured tempo or loudness yet — run the on-device audio
        analysis for this track to add them.
      </p>

      <dl class="analysis-grid">
        <div v-for="row in audioRows" :key="row.label" class="analysis-field">
          <dt class="analysis-field-label">{{ row.label }}</dt>
          <dd class="analysis-field-value tnum">{{ row.value }}</dd>
        </div>
      </dl>

      <dl class="analysis-grid">
        <div v-for="row in modelRows" :key="row.label" class="analysis-field">
          <dt class="analysis-field-label">{{ row.label }}</dt>
          <dd class="analysis-field-value tnum">{{ row.value }}</dd>
        </div>
      </dl>

      <!-- The honest gap. Not decoration: this is why the panel has no
           Mood or Language row. -->
      <details v-if="result?.unsupported?.length" class="ai-unsupported">
        <summary class="ai-unsupported-summary">
          Not yet available ({{ result.unsupported.length }})
        </summary>
        <ul class="ai-unsupported-list">
          <li v-for="u in result.unsupported" :key="u.feature">
            <strong>{{ u.feature }}</strong> — {{ u.reason }}
          </li>
        </ul>
      </details>

      <div v-if="timing || analysedAt" class="analysis-provenance">
        <span v-if="timing">{{ timing }}</span>
        <span v-if="analysedAt">{{ analysedAt }}</span>
        <span v-if="fromCache">saved result</span>
      </div>

      <p v-if="saveWarning" class="analysis-note">{{ saveWarning }}</p>

      <p class="analysis-note">
        Experimental. This model is under evaluation and has not been selected
        for production; nothing here changes playback or recommendations.
      </p>

      <div class="analysis-btns">
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', true)">
          RE-RUN
        </button>
      </div>
    </template>

    <!-- FAILED ----------------------------------------------------- -->
    <template v-else-if="state === 'failed'">
      <div v-if="failure" class="analysis-error">
        <p class="analysis-error-code">{{ failure.code }}</p>
        <p class="analysis-error-message">{{ failure.message }}</p>
      </div>
      <p class="analysis-note">
        Playback is unaffected.
      </p>
      <div class="analysis-btns">
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', true)">
          TRY AGAIN
        </button>
      </div>
    </template>

    <!-- IDLE ------------------------------------------------------- -->
    <template v-else>
      <p class="analysis-desc">
        Run the experimental embedding model on this track. It reads the file
        on this device; nothing is uploaded.
      </p>
      <div class="analysis-btns">
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', false)">
          RUN AI ANALYSIS
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ai-analysis {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ai-analysis-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.ai-analysis-title {
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: var(--fg-faint, rgba(255, 255, 255, 0.5));
}

.ai-analysis-tag {
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.14));
  color: var(--fg-faint, rgba(255, 255, 255, 0.5));
}

.ai-unsupported {
  font-size: 0.75rem;
  color: var(--fg-faint, rgba(255, 255, 255, 0.5));
}

.ai-unsupported-summary {
  cursor: pointer;
  padding: 0.25rem 0;
}

.ai-unsupported-list {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
