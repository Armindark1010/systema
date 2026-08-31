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
import type { SemanticAnalysis } from '~/services/ai-dataset/semanticRecord'
import { topNFor } from '~/services/ai-dataset/semanticRecord'

const props = defineProps<{
  state: AiAnalysisState
  result: TrackAnalysisRecord | null
  failure: TrackAnalysisFailureRecord | null
  saveWarning?: string | null
  fromCache?: boolean
  /** Phase 29 model predictions. Null when none have been produced. */
  semantic?: SemanticAnalysis | null
  /** Why semantics are unavailable. Shown rather than hidden. */
  semanticNote?: string | null
  semanticFromCache?: boolean
}>()

const emit = defineEmits<{ analyze: [force: boolean] }>()

const isAnalyzing = computed(() => props.state === 'analyzing')
const hasResult = computed(() => props.state === 'done' && props.result !== null)

/**
 * Top predictions per field, for display only.
 *
 * The COMPLETE ranked output stays in the dataset — this slice exists
 * because a 56-row list in a player sheet is unreadable, not because
 * the rest is disposable. /dev/ai-dataset shows every class.
 */
const SHEET_TOP_N = 5

const moodPredictions = computed(() => topNFor(props.semantic, 'mood', SHEET_TOP_N))
const genrePredictions = computed(() => topNFor(props.semantic, 'genre', SHEET_TOP_N))
const stylePredictions = computed(() => topNFor(props.semantic, 'style', SHEET_TOP_N))
const tagPredictions = computed(() => topNFor(props.semantic, 'tags', SHEET_TOP_N))
const vocalPredictions = computed(() =>
  topNFor(props.semantic, 'vocalInstrumental', 2))

const hasSemantic = computed(() =>
  Boolean(props.semantic && props.semantic.heads.length > 0))

/**
 * A real embedding was produced, whether or not any head ran.
 *
 * Phase 29.x: Discogs-EffNet produces a 1280-d vector and NO labels,
 * because no classifier head has been converted or imported. Gating
 * the whole section on `heads.length > 0` would render an entirely
 * successful, expensive inference as if nothing had happened.
 */
const hasEmbedding = computed(() =>
  Boolean(props.semantic?.embedding && props.semantic.embedding.length > 0))

/** Shown whenever the model produced anything at all. */
const hasSemanticOutput = computed(() => hasSemantic.value || hasEmbedding.value)

const embeddingDim = computed(() =>
  props.semantic?.embeddingDim ?? props.semantic?.embedding?.length ?? null)

/**
 * The model identity that ACTUALLY produced this row.
 *
 * Read from the stored record rather than from a constant, so a row
 * written by a different export is labelled with that export.
 */
const semanticModelLabel = computed(() => {
  const m = props.semantic
  if (!m?.model) return null
  return m.modelVersion ? `${m.model} v${m.modelVersion}` : m.model
})

/** Fields the model could not produce, with the reason. */
const semanticUnsupported = computed(() => props.semantic?.unsupported ?? [])

/** Score as a percentage string. The raw value is never discarded. */
function pct(score: number): string {
  return `${Math.round(score * 100)}%`
}

/** Official Discogs `Parent---Style` → style name, parent kept in the label. */
function styleDisplay(raw: string): string {
  const i = raw.indexOf('---')
  if (i <= 0) return raw
  return `${raw.slice(i + 3)}  (${raw.slice(0, i)})`
}

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

      <!-- Phase 29 semantic predictions. MODEL OUTPUT, never ground
           truth, and never shown without its score. -->
      <div v-if="hasSemanticOutput" class="ai-semantic">
        <div class="ai-semantic-head">
          <span class="ai-semantic-title">SEMANTIC</span>
          <span class="ai-analysis-tag">EXPERIMENTAL</span>
        </div>

        <p class="ai-semantic-caption">
          Predicted by a model, not verified. These are not your labels.
        </p>

        <!-- The embedding is the real output in this phase. Shown as a
             fact about the run, never dressed up as a label. -->
        <div v-if="hasEmbedding" class="ai-semantic-group">
          <p class="ai-semantic-label">EMBEDDING</p>
          <div class="ai-semantic-row">
            <span class="ai-semantic-name">dimensions</span>
            <span class="ai-semantic-score tnum">{{ embeddingDim }}</span>
          </div>
          <div v-if="semanticModelLabel" class="ai-semantic-row">
            <span class="ai-semantic-name">model</span>
            <span class="ai-semantic-score">{{ semanticModelLabel }}</span>
          </div>
          <div v-if="semantic?.inferenceMs != null" class="ai-semantic-row">
            <span class="ai-semantic-name">inference</span>
            <span class="ai-semantic-score tnum">{{ Math.round(semantic.inferenceMs) }} ms</span>
          </div>
          <p v-if="!hasSemantic" class="ai-semantic-caption">
            This model produces an embedding only. Mood, tags and
            vocal detection need separate classifier heads that are not
            installed, so none are shown.
          </p>
        </div>

        <div v-if="stylePredictions.length" class="ai-semantic-group">
          <p class="ai-semantic-label">MUSIC STYLE</p>
          <p class="ai-semantic-caption">
            Discogs 400 Styles. Scores are model activations, not calibrated confidence.
          </p>
          <div v-for="p in stylePredictions" :key="`style-${p.label}`" class="ai-semantic-row">
            <span class="ai-semantic-name">{{ styleDisplay(p.label) }}</span>
            <span class="ai-semantic-score tnum">{{ pct(p.score) }}</span>
          </div>
          <div class="ai-semantic-row">
            <span class="ai-semantic-name">Model</span>
            <span class="ai-semantic-score">Discogs-EffNet</span>
          </div>
          <div class="ai-semantic-row">
            <span class="ai-semantic-name">Taxonomy</span>
            <span class="ai-semantic-score">{{ semantic?.styleTaxonomy || 'Discogs 400 Styles' }}</span>
          </div>
          <div class="ai-semantic-row">
            <span class="ai-semantic-name">Frames</span>
            <span class="ai-semantic-score tnum">{{ semantic?.styleFrameCount ?? DASH }}</span>
          </div>
          <div class="ai-semantic-row">
            <span class="ai-semantic-name">Embedding</span>
            <span class="ai-semantic-score tnum">{{ embeddingDim ? `${embeddingDim}-d` : DASH }}</span>
          </div>
        </div>

        <div v-if="moodPredictions.length" class="ai-semantic-group">
          <p class="ai-semantic-label">MOOD</p>
          <div v-for="p in moodPredictions" :key="`mood-${p.label}`" class="ai-semantic-row">
            <span class="ai-semantic-name">{{ p.label }}</span>
            <span class="ai-semantic-score tnum">{{ pct(p.score) }}</span>
          </div>
        </div>

        <div v-if="genrePredictions.length" class="ai-semantic-group">
          <p class="ai-semantic-label">GENRE</p>
          <div v-for="p in genrePredictions" :key="`genre-${p.label}`" class="ai-semantic-row">
            <span class="ai-semantic-name">{{ p.label }}</span>
            <span class="ai-semantic-score tnum">{{ pct(p.score) }}</span>
          </div>
        </div>

        <div v-if="tagPredictions.length" class="ai-semantic-group">
          <p class="ai-semantic-label">TAGS</p>
          <div v-for="p in tagPredictions" :key="`tag-${p.label}`" class="ai-semantic-row">
            <span class="ai-semantic-name">{{ p.label }}</span>
            <span class="ai-semantic-score tnum">{{ pct(p.score) }}</span>
          </div>
        </div>

        <div v-if="vocalPredictions.length" class="ai-semantic-group">
          <p class="ai-semantic-label">VOCAL / INSTRUMENTAL</p>
          <div v-for="p in vocalPredictions" :key="`voc-${p.label}`" class="ai-semantic-row">
            <span class="ai-semantic-name">{{ p.label }}</span>
            <span class="ai-semantic-score tnum">{{ pct(p.score) }}</span>
          </div>
        </div>

        <div class="ai-semantic-meta">
          <span>{{ semantic?.model }} v{{ semantic?.modelVersion }}</span>
          <span v-if="semantic?.inferenceMs != null" class="tnum">
            {{ semantic.inferenceMs }} ms
          </span>
          <span v-if="semanticFromCache">saved result</span>
        </div>

        <details v-if="semanticUnsupported.length" class="ai-unsupported">
          <summary class="ai-unsupported-summary">
            Model cannot produce ({{ semanticUnsupported.length }})
          </summary>
          <ul class="ai-unsupported-list">
            <li v-for="u in semanticUnsupported" :key="`su-${u.field}`">
              <strong>{{ u.field }}</strong> — {{ u.reason }}
            </li>
          </ul>
        </details>
      </div>

      <!-- Why there is no mood/genre section. A plain statement beats an
           empty panel that looks like a loading bug. -->
      <p v-else-if="semanticNote" class="ai-semantic-note">
        {{ semanticNote }}
      </p>

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

.ai-semantic {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--player-line, rgba(255, 255, 255, 0.08));
}
.ai-semantic-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-semantic-title {
  font-size: 11px;
  letter-spacing: 0.12em;
  opacity: 0.75;
}
.ai-semantic-caption {
  margin: 6px 0 10px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.6;
}
.ai-semantic-group {
  margin-bottom: 10px;
}
.ai-semantic-label {
  margin: 0 0 4px;
  font-size: 10px;
  letter-spacing: 0.1em;
  opacity: 0.55;
}
.ai-semantic-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
  font-size: 12px;
}
.ai-semantic-name {
  opacity: 0.9;
}
.ai-semantic-score {
  /* Not 0.65: that literal is a forbidden similarity threshold and a
     source guard greps for it. A visual value is not worth weakening
     the guard, so this is 0.66. */
  opacity: 0.66;
}
.ai-semantic-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 10px;
  opacity: 0.55;
}
.ai-semantic-note {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--player-line, rgba(255, 255, 255, 0.08));
  font-size: 11px;
  line-height: 1.55;
  opacity: 0.6;
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
