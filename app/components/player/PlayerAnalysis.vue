<script setup lang="ts">
// ============================================================
// PlayerAnalysis — analysis status sheet + result
// ============================================================

import type { TrackAnalysis, AnalysisStatus } from '~/composables/useTrackAnalysis'

const props = defineProps<{
  open: boolean
  status: AnalysisStatus
  analysis: TrackAnalysis | null
  trackTitle: string
  isAnalyzing: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [force: boolean]
}>()

const mode = ref<'confirm' | 'result'>('confirm')
const force = ref(false)
const sheetDrag = useSwipeToDismiss(() => emit('close'))

watch(() => props.open, (v) => {
  if (v) {
    mode.value = props.status === 'analyzed' ? 'result' : 'confirm'
    force.value = false
  }
})

const title = computed(() => {
  if (mode.value === 'result' && props.analysis) return 'AI ANALYSIS — ANALYZED'
  return 'AI ANALYSIS'
})

const statusLabel = computed(() => {
  switch (props.status) {
    case 'analyzed': return 'ANALYZED'
    case 'analyzing': return 'ANALYZING'
    case 'error': return 'ERROR'
    default: return 'NOT ANALYZED'
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
        aria-label="AI Analysis"
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
            <h2 class="player-sheet-title">{{ title }}</h2>
            <button class="player-sheet-close" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="w-4 h-4" />
            </button>
          </div>

          <!-- status indicator -->
          <div class="analysis-status">
            <div class="analysis-status-icon" :class="`is-${status}`">
              <UIcon
                :name="status === 'analyzed' ? 'lucide:check' : status === 'analyzing' ? 'lucide:loader-2' : status === 'error' ? 'lucide:alert-circle' : 'lucide:scan'"
                class="w-5 h-5"
                :class="{ 'animate-spin': status === 'analyzing' }"
              />
            </div>
            <p class="analysis-status-label">{{ statusLabel }}</p>
            <p class="analysis-status-track">{{ trackTitle }}</p>
          </div>

          <!-- confirm mode -->
          <div v-if="mode === 'confirm'" class="analysis-confirm">
            <p v-if="status === 'not-analyzed'" class="analysis-desc">
              This track has not been analyzed yet.
            </p>
            <p v-else-if="status === 'analyzed'" class="analysis-desc">
              This track has already been analyzed.
            </p>
            <p v-else-if="status === 'error'" class="analysis-desc">
              Last analysis failed. You can try again.
            </p>
            <p v-else class="analysis-desc">
              Analysis is in progress...
            </p>

            <div v-if="status !== 'analyzing'" class="analysis-actions">
              <p class="analysis-action-label">
                {{ status === 'analyzed' ? 'ANALYZE AGAIN?' : 'FORCE ANALYZE?' }}
              </p>
              <div class="analysis-btns">
                <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CANCEL</button>
                <button
                  class="player-sheet-btn player-sheet-btn--primary"
                  @click="emit('confirm', status === 'analyzed')"
                >
                  {{ status === 'analyzed' ? 'ANALYZE AGAIN' : 'FORCE ANALYZE' }}
                </button>
              </div>
            </div>

            <div v-else class="analysis-progress">
              <div class="analysis-progress-bar">
                <div class="analysis-progress-fill" />
              </div>
              <p class="analysis-progress-text">Analyzing audio features, mood, and structure…</p>
            </div>
          </div>

          <!-- result mode -->
          <div v-else-if="analysis" class="analysis-result">
            <div class="analysis-grid">
              <div class="analysis-field">
                <span class="analysis-field-label">MOOD</span>
                <span class="analysis-field-value">{{ analysis.mood.join(', ') }}</span>
              </div>
              <div class="analysis-field">
                <span class="analysis-field-label">GENRES</span>
                <span class="analysis-field-value">{{ analysis.genres.join(', ') }}</span>
              </div>
              <div class="analysis-field">
                <span class="analysis-field-label">ENERGY</span>
                <span class="analysis-field-value">{{ (analysis.energy * 100).toFixed(0) }}% · {{ analysis.bpm }} BPM</span>
              </div>
              <div class="analysis-field">
                <span class="analysis-field-label">LANGUAGE</span>
                <span class="analysis-field-value">{{ analysis.language }}</span>
              </div>
              <div class="analysis-field">
                <span class="analysis-field-label">THEMES</span>
                <span class="analysis-field-value">{{ analysis.themes.join(', ') }}</span>
              </div>
              <div class="analysis-field">
                <span class="analysis-field-label">CONFIDENCE</span>
                <span class="analysis-field-value">{{ (analysis.confidence * 100).toFixed(0) }}%</span>
              </div>
            </div>

            <div class="analysis-btns" style="margin-top:1.25rem">
              <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CLOSE</button>
              <button class="player-sheet-btn player-sheet-btn--primary" @click="mode='confirm'">ANALYZE AGAIN</button>
            </div>
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

.analysis-status-icon.is-error {
  color: #ff6b5e;
  border-color: rgba(255,107,94,0.3);
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

.analysis-confirm, .analysis-result {
  padding: 1.25rem;
}

.analysis-desc {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--player-fg-muted);
}

.analysis-actions {
  margin-top: 1.25rem;
}

.analysis-action-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
  margin-bottom: 0.75rem;
}

.analysis-btns {
  display: flex;
  gap: 0.5rem;
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
  color: var(--player-fg-muted);
}

.analysis-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.analysis-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
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
