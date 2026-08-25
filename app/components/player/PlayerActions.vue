<script setup lang="ts">
// ============================================================
// PlayerActions — secondary compact action row
// LIKE, SLEEP TIMER, AI, LYRICS, ANALYZE, MORE
// Must remain compact, not overpower player.
// ============================================================

import type { AnalysisStatus } from '~/composables/useTrackAnalysis'

const props = defineProps<{
  isLiked: boolean
  sleepActive: boolean
  sleepLabel: string | null
  isAiMode: boolean
  isLyricsMode: boolean
  analysisStatus: AnalysisStatus
  isAnalyzing: boolean
}>()

const emit = defineEmits<{
  like: []
  sleep: []
  ai: []
  lyrics: []
  analyze: []
  more: []
}>()

const analysisIcon = computed(() => {
  switch (props.analysisStatus) {
    case 'analyzed': return 'lucide:check'
    case 'analyzing': return 'lucide:loader-2'
    case 'error': return 'lucide:alert-circle'
    default: return 'lucide:scan'
  }
})

const analysisLabel = computed(() => {
  switch (props.analysisStatus) {
    case 'analyzed': return 'Analyzed'
    case 'analyzing': return 'Analyzing'
    case 'error': return 'Error'
    default: return 'Analyze'
  }
})
</script>

<template>
  <div class="player-actions" role="toolbar" aria-label="Player actions">
    <!-- LIKE -->
    <button
      class="player-action-btn"
      :class="{ 'is-active': isLiked }"
      :aria-label="isLiked ? 'Unlike' : 'Like'"
      :aria-pressed="isLiked"
      @click="emit('like')"
    >
      <UIcon :name="isLiked ? 'lucide:heart' : 'lucide:heart'" class="player-action-icon" :class="{ 'fill-current': isLiked }" />
      <span class="sr-only">Like</span>
    </button>

    <!-- SLEEP TIMER -->
    <button
      class="player-action-btn"
      :class="{ 'is-active': sleepActive }"
      aria-label="Sleep timer"
      @click="emit('sleep')"
    >
      <UIcon name="lucide:clock-3" class="player-action-icon" />
      <span v-if="sleepLabel" class="player-action-badge">{{ sleepLabel }}</span>
      <span v-else class="sr-only">Sleep timer</span>
    </button>

    <!-- AI -->
    <button
      class="player-action-btn"
      :class="{ 'is-active': isAiMode }"
      aria-label="AI"
      :aria-pressed="isAiMode"
      @click="emit('ai')"
    >
      <UIcon name="lucide:sparkles" class="player-action-icon" />
    </button>

    <!-- LYRICS -->
    <button
      class="player-action-btn"
      :class="{ 'is-active': isLyricsMode }"
      aria-label="Lyrics"
      :aria-pressed="isLyricsMode"
      @click="emit('lyrics')"
    >
      <UIcon name="lucide:mic-vocal" class="player-action-icon" />
    </button>

    <!-- ANALYZE -->
    <button
      class="player-action-btn player-action-btn--analyze"
      :class="{
        'is-analyzed': analysisStatus === 'analyzed',
        'is-analyzing': analysisStatus === 'analyzing',
        'is-error': analysisStatus === 'error',
      }"
      :aria-label="analysisLabel"
      @click="emit('analyze')"
    >
      <UIcon :name="analysisIcon" class="player-action-icon" :class="{ 'animate-spin': isAnalyzing }" />
      <span v-if="analysisStatus === 'analyzing'" class="player-action-pulse" aria-hidden="true" />
    </button>

    <!-- MORE -->
    <button
      class="player-action-btn"
      aria-label="More options"
      @click="emit('more')"
    >
      <UIcon name="lucide:ellipsis" class="player-action-icon" />
    </button>
  </div>
</template>

<style scoped>
.player-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding-inline: var(--player-content-padding);
  flex-wrap: wrap;
}

.player-action-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--player-action-size);
  height: var(--player-action-size);
  border: 1px solid var(--player-line);
  background: transparent;
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  outline: none;
}

.player-action-btn:hover {
  color: var(--player-fg);
  border-color: var(--player-line-strong);
  background: var(--player-control);
}

.player-action-btn:focus-visible {
  border-color: var(--player-fg);
  box-shadow: 0 0 0 1px var(--player-fg);
}

.player-action-btn.is-active {
  color: var(--player-fg);
  background: var(--player-control-hover);
  border-color: var(--player-line-strong);
}

.player-action-btn--analyze.is-analyzed {
  color: var(--player-accent);
  border-color: color-mix(in srgb, var(--player-accent) 30%, transparent);
  background: color-mix(in srgb, var(--player-accent) 12%, transparent);
}

.player-action-btn--analyze.is-analyzing {
  color: var(--player-accent);
  border-color: color-mix(in srgb, var(--player-accent) 35%, transparent);
}

.player-action-btn--analyze.is-error {
  color: #ff6b5e;
  border-color: rgba(255,107,94,0.3);
}

.player-action-icon {
  width: 1rem;
  height: 1rem;
}

.player-action-badge {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--player-fg);
  color: var(--player-bg);
  padding: 1px 4px;
  border-radius: 999px;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.player-action-pulse {
  position: absolute;
  inset: -2px;
  border: 1px solid var(--player-accent);
  border-radius: 999px;
  opacity: 0.6;
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.08); opacity: 0; }
}
</style>
