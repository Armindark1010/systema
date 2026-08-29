<script setup lang="ts">
/**
 * Experimental AI analysis panel for the Full Player (Phase 22.1).
 *
 * Renders whatever the generic analysis service produced. It knows
 * nothing about CLAP, ONNX or any model: every value on screen comes
 * from the runtime result, and there is no fallback constant to show
 * when a value is missing — a missing value renders as a dash.
 *
 * THE HONEST BIT
 * --------------
 * Similarity is a relationship between two tracks. The Full Player has
 * one. So when no reference was supplied, this panel says the score is
 * unavailable and why, instead of showing a number that would look like
 * a measurement of "how similar this song is" to nothing in particular.
 */
import { computed } from 'vue'

import type { AiAnalysisState } from '~/composables/useTrackAiAnalysis'
import type {
  TrackAnalysisFailure,
  TrackAnalysisResult,
} from '~/services/ai-similarity/analysis'

const props = defineProps<{
  state: AiAnalysisState
  result: TrackAnalysisResult | null
  failure: TrackAnalysisFailure | null
}>()

const emit = defineEmits<{ analyze: [] }>()

const isAnalyzing = computed(() => props.state === 'analyzing')
const hasResult = computed(() => props.state === 'done' && props.result !== null)

/** A dash rather than a plausible-looking placeholder. */
const DASH = '—'

const rows = computed(() => {
  const r = props.result
  if (!r) return []
  return [
    {
      label: 'Similarity',
      // Null means "no reference", never 0.
      value: r.cosine === null ? DASH : r.cosine.toFixed(4),
    },
    { label: 'Model', value: r.model || DASH },
    { label: 'Version', value: r.modelVersion || DASH },
    {
      label: 'Embedding',
      value: r.dimension > 0 ? `${r.dimension}-d` : DASH,
    },
    { label: 'Normalised', value: r.normalised ? 'Yes' : 'No' },
    { label: 'Experimental', value: r.experimental ? 'Yes' : 'No' },
  ]
})

const timing = computed(() => {
  const ms = props.result?.inferenceMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? `${Math.round(ms)} ms inference`
    : null
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
      <dl class="analysis-grid">
        <div v-for="row in rows" :key="row.label" class="analysis-field">
          <dt class="analysis-field-label">{{ row.label }}</dt>
          <dd class="analysis-field-value tnum">{{ row.value }}</dd>
        </div>
      </dl>

      <p v-if="result?.cosineUnavailableReason" class="analysis-note">
        {{ result.cosineUnavailableReason }}
      </p>

      <div v-if="timing" class="analysis-provenance">
        <span>{{ timing }}</span>
        <span v-if="result?.referenceTrackId">vs {{ result.referenceTrackId }}</span>
      </div>

      <p class="analysis-note">
        Experimental. This model is under evaluation and has not been selected
        for production; nothing here changes playback or recommendations.
      </p>

      <div class="analysis-btns">
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze')">
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
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze')">
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
        <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze')">
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
</style>
