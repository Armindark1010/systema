<script setup lang="ts">
// ============================================================
// PlayerAnalysis — REAL on-device DSP, from the player
// ============================================================
// This sheet used to render the mock companion analysis (invented
// moods, genres and themes seeded from a string hash). It now renders
// the Phase 13 native analyser and nothing else: every value below was
// measured from the actual audio file on this device.
//
// State drives the whole surface, so the four cases the user can
// actually be in each look different and each offer the right action:
//
//   unavailable  → no decoder here (browser). Say so, offer nothing.
//   not-analyzed → explain, offer ANALYSE.
//   analyzing    → progress, and a promise that playback is untouched.
//   analyzed     → the measurements, plus RE-ANALYSE.
//   failed       → the structured code and message, plus TRY AGAIN.
//
// Analysis runs off the UI thread in Kotlin and never touches Media3,
// so the sheet stays interactive and the music keeps playing.
// ============================================================

import type { AudioAnalysisState } from '~/composables/useAudioAnalysis'
import type { AudioAnalysis } from '~/services/native/audioAnalysisPlugin'
import type { AudioAnalysisFailure } from '~/services/native/audioAnalysisService'
import { formatAnalysisValue, formatBpm } from '~/services/native/audioAnalysisService'

const props = defineProps<{
  open: boolean
  state: AudioAnalysisState
  analysis: AudioAnalysis | null
  failure: AudioAnalysisFailure | null
  trackTitle: string
}>()

const emit = defineEmits<{
  close: []
  analyze: [force: boolean]
}>()

const sheetDrag = useSwipeToDismiss(() => emit('close'))

const isAnalyzing = computed(() => props.state === 'analyzing')
const hasResult = computed(() => props.state === 'analyzed' && props.analysis !== null)

const statusLabel = computed(() => {
  switch (props.state) {
    case 'unavailable': return 'UNAVAILABLE'
    case 'analyzed': return 'ANALYSED'
    case 'analyzing': return 'ANALYSING'
    case 'failed': return 'FAILED'
    case 'not-analyzed': return 'NOT ANALYSED'
    default: return 'CHECKING'
  }
})

const statusIcon = computed(() => {
  switch (props.state) {
    case 'unavailable': return 'lucide:monitor-off'
    case 'analyzed': return 'lucide:check'
    case 'analyzing': return 'lucide:loader-2'
    case 'failed': return 'lucide:alert-circle'
    default: return 'lucide:activity'
  }
})

/** Primary action wording, so the button never lies about what it does. */
const actionLabel = computed(() => {
  if (props.state === 'analyzed') return 'RE-ANALYSE'
  if (props.state === 'failed') return 'TRY AGAIN'
  return 'ANALYSE'
})

/**
 * Measured values, rendered only from what the analyser returned.
 *
 * A dash means "could not determine" and is never replaced with zero —
 * the two mean genuinely different things to every later phase.
 */
const rows = computed(() => {
  const a = props.analysis
  if (!a) return []
  return [
    { label: 'BPM', value: formatBpm(a), wide: true },
    { label: 'LOUDNESS', value: formatAnalysisValue(a.loudnessDbfs, ' dBFS', 1) },
    { label: 'DYNAMIC RANGE', value: formatAnalysisValue(a.dynamicRangeDb, ' dB', 1) },
    { label: 'PEAK', value: formatAnalysisValue(a.peak, '', 3) },
    { label: 'RMS', value: formatAnalysisValue(a.rms, '', 3) },
    { label: 'BRIGHTNESS', value: formatAnalysisValue(a.spectralCentroid, ' Hz', 0) },
    { label: 'BANDWIDTH', value: formatAnalysisValue(a.spectralBandwidth, ' Hz', 0) },
    { label: 'ROLLOFF', value: formatAnalysisValue(a.spectralRolloff, ' Hz', 0) },
    { label: 'ZERO CROSSING', value: formatAnalysisValue(a.zeroCrossingRate, '', 3) },
    { label: 'SILENCE', value: formatAnalysisValue(a.silenceRatio, '', 3) },
    { label: 'SAMPLE RATE', value: `${a.sampleRate} Hz` },
  ]
})

/** Provenance line: how long it took, and which DSP version produced it. */
const provenance = computed(() => {
  const a = props.analysis
  if (!a) return null
  const total = (a.totalAnalysisTimeMs / 1000).toFixed(1)
  const rtf = a.realTimeFactor === null ? null : a.realTimeFactor.toFixed(3)
  return {
    duration: `${(a.durationMs / 1000).toFixed(0)}s of audio`,
    timing: `${total}s (decode ${a.decodeTimeMs}ms · dsp ${a.dspTimeMs}ms)`,
    rtf: rtf === null ? '—' : `${rtf}× real time`,
    version: `analyzer v${a.analyzerVersion}`,
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="player-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Audio analysis"
        @click.self="emit('close')"
      >
        <div class="player-sheet" :class="{ 'is-dragging': sheetDrag.isDragging.value }" :style="sheetDrag.dragStyle.value">
          <div
            class="player-sheet-handle"
            aria-label="Swipe down to close"
            @pointerdown="sheetDrag.onDragStart"
            @pointermove="sheetDrag.onDragMove"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          ><span /></div>

          <div class="player-sheet-header">
            <h2 class="player-sheet-title">AUDIO ANALYSIS</h2>
            <button class="player-sheet-close" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="w-4 h-4" />
            </button>
          </div>

          <!-- status -->
          <div class="analysis-status">
            <div class="analysis-status-icon" :class="`is-${state}`">
              <UIcon
                :name="statusIcon"
                class="w-5 h-5"
                :class="{ 'animate-spin': isAnalyzing }"
              />
            </div>
            <p class="analysis-status-label">{{ statusLabel }}</p>
            <p class="analysis-status-track">{{ trackTitle }}</p>
          </div>

          <div class="analysis-body">
            <!-- NO ANALYSER HERE ------------------------------------ -->
            <template v-if="state === 'unavailable'">
              <p class="analysis-desc">
                On-device analysis needs the Android build. A browser has no
                audio decoder and no access to your music files, so there is
                nothing real to measure here.
              </p>
              <p class="analysis-note">
                No placeholder numbers are shown in place of a measurement.
              </p>
              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CLOSE</button>
              </div>
            </template>

            <!-- RUNNING --------------------------------------------- -->
            <template v-else-if="isAnalyzing">
              <p class="analysis-desc">
                Decoding the file and running the DSP on this device.
              </p>
              <div class="analysis-progress">
                <div class="analysis-progress-bar">
                  <div class="analysis-progress-fill" />
                </div>
                <p class="analysis-progress-text">
                  Playback is unaffected — the analyser reads the file separately
                  from the player.
                </p>
              </div>
              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">
                  RUN IN BACKGROUND
                </button>
              </div>
            </template>

            <!-- RESULT ---------------------------------------------- -->
            <template v-else-if="hasResult">
              <dl class="analysis-grid">
                <div
                  v-for="row in rows"
                  :key="row.label"
                  class="analysis-field"
                  :class="{ 'analysis-field--wide': row.wide }"
                >
                  <dt class="analysis-field-label">{{ row.label }}</dt>
                  <dd class="analysis-field-value tnum">{{ row.value }}</dd>
                </div>
              </dl>

              <div v-if="provenance" class="analysis-provenance">
                <span>{{ provenance.duration }}</span>
                <span>{{ provenance.timing }}</span>
                <span>{{ provenance.rtf }}</span>
                <span>{{ provenance.version }}</span>
              </div>

              <p class="analysis-note">
                Measured on this device. Loudness is RMS-derived dBFS, not LUFS.
                A dash means the analyser could not determine that value.
              </p>

              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CLOSE</button>
                <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', true)">
                  RE-ANALYSE
                </button>
              </div>
            </template>

            <!-- FAILED ---------------------------------------------- -->
            <template v-else-if="state === 'failed'">
              <p class="analysis-desc">
                This track could not be analysed.
              </p>
              <div v-if="failure" class="analysis-error">
                <p class="analysis-error-code">{{ failure.code }}</p>
                <p class="analysis-error-message">{{ failure.message }}</p>
              </div>
              <p class="analysis-note">
                Playback is unaffected: a file the analyser cannot decode may
                still play perfectly.
              </p>
              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CLOSE</button>
                <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', true)">
                  TRY AGAIN
                </button>
              </div>
            </template>

            <!-- NOT ANALYSED YET ------------------------------------ -->
            <template v-else>
              <p class="analysis-desc">
                This track has not been analysed yet. SYSTEMA will decode it on
                this device and measure tempo, loudness, dynamics and spectral
                shape from the audio itself — not from file tags.
              </p>
              <p class="analysis-note">
                Nothing is uploaded, and the music keeps playing while it runs.
              </p>
              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CANCEL</button>
                <button class="player-sheet-btn player-sheet-btn--primary" @click="emit('analyze', false)">
                  {{ actionLabel }}
                </button>
              </div>
            </template>
          </div>

          <div class="player-sheet-footer-safe" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(10,11,14,0.56);
  backdrop-filter: blur(8px);
}

.player-sheet {
  width: 100%;
  max-width: 480px;
  max-height: calc(100dvh - var(--player-safe-top));
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--player-sheet-bg);
  border: 1px solid var(--player-sheet-line);
  border-bottom: 0;
  border-radius: var(--player-sheet-radius) var(--player-sheet-radius) 0 0;
  box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
  animation: sheet-in 360ms var(--player-ease);
}

.player-sheet.is-dragging {
  animation: none;
  user-select: none;
}

.player-sheet-handle {
  display: grid;
  place-items: center;
  height: 28px;
  cursor: grab;
  touch-action: none;
}
.player-sheet-handle:active { cursor: grabbing; }
.player-sheet-handle span {
  width: 32px;
  height: 3px;
  background: var(--player-fg-faint);
  border-radius: 999px;
  opacity: 0.6;
}

.player-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--player-line);
}

.player-sheet-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg);
}

.player-sheet-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
}

.analysis-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 1.25rem;
  border-bottom: 1px solid var(--player-line);
  text-align: center;
}

.analysis-status-icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  border: 1px solid var(--player-line);
  color: var(--player-fg-muted);
}

.analysis-status-icon.is-analyzed {
  color: var(--player-accent);
  border-color: color-mix(in srgb, var(--player-accent) 30%, transparent);
  background: color-mix(in srgb, var(--player-accent) 12%, transparent);
}

.analysis-status-icon.is-analyzing {
  color: var(--player-accent);
  border-color: color-mix(in srgb, var(--player-accent) 35%, transparent);
}

.analysis-status-icon.is-failed {
  color: #ff6b5e;
  border-color: rgba(255,107,94,0.3);
}

.analysis-status-icon.is-unavailable {
  color: var(--player-fg-faint);
  opacity: 0.7;
}

.analysis-status-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--player-fg);
}

.analysis-status-track {
  font-size: 0.8125rem;
  color: var(--player-fg-muted);
}

.analysis-body {
  padding: 1.25rem;
}

.analysis-desc {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--player-fg-muted);
}

.analysis-note {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--player-fg-faint);
}

.analysis-btns {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.player-sheet-btn {
  flex: 1;
  height: 2.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  border: 1px solid var(--player-line);
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
}

.player-sheet-btn--ghost {
  background: transparent;
  color: var(--player-fg-muted);
}

.player-sheet-btn--ghost:hover {
  color: var(--player-fg);
  border-color: var(--player-line-strong);
}

.player-sheet-btn--primary {
  background: var(--player-fg);
  color: var(--player-bg);
  border-color: var(--player-fg);
}

.analysis-progress {
  margin-top: 1.5rem;
}

.analysis-progress-bar {
  height: 2px;
  background: var(--player-line);
  overflow: hidden;
}

.analysis-progress-fill {
  height: 100%;
  width: 60%;
  background: var(--player-accent);
  animation: progress 1.2s ease-in-out infinite;
}

.analysis-progress-text {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--player-fg-muted);
}

.analysis-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--player-line);
  border: 1px solid var(--player-line);
}

.analysis-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.625rem 0.75rem;
  background: var(--player-sheet-bg);
}

.analysis-field--wide {
  grid-column: span 2;
}

.analysis-field-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
}

.analysis-field-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--player-fg);
  line-height: 1.3;
}

.analysis-provenance {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 0.75rem;
  margin-top: 0.75rem;
  font-size: 0.6875rem;
  color: var(--player-fg-faint);
}

.analysis-error {
  margin-top: 0.875rem;
  border: 1px solid rgba(255,107,94,0.3);
  padding: 0.75rem;
}

.analysis-error-code {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #ff6b5e;
}

.analysis-error-message {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--player-fg-muted);
}

.player-sheet-footer-safe {
  height: calc(1rem + var(--player-safe-bottom));
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
</style>
