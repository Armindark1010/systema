<script setup lang="ts">
// ============================================================
// PlayerControls — prev / play-pause / next
// Center Play/Pause has strongest hierarchy, icons only.
// ============================================================

const props = defineProps<{
  isPlaying: boolean
  isLoading?: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  toggle: []
}>()
</script>

<template>
  <div class="player-controls" role="group" aria-label="Playback controls">
    <button
      class="player-control-btn"
      aria-label="Previous track"
      @click="emit('prev')"
    >
      <UIcon name="lucide:skip-back" class="player-control-icon" />
    </button>

    <button
      class="player-control-btn player-control-btn--play"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
      :aria-pressed="isPlaying"
      @click="emit('toggle')"
    >
      <span v-if="isLoading" class="player-control-spinner" aria-hidden="true" />
      <UIcon
        v-else
        :name="isPlaying ? 'lucide:pause' : 'lucide:play'"
        class="player-control-icon player-control-icon--play"
      />
    </button>

    <button
      class="player-control-btn"
      aria-label="Next track"
      @click="emit('next')"
    >
      <UIcon name="lucide:skip-forward" class="player-control-icon" />
    </button>
  </div>
</template>

<style scoped>
.player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding-inline: var(--player-content-padding);
}

.player-control-btn {
  display: grid;
  place-items: center;
  width: var(--player-control-size);
  height: var(--player-control-size);
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg);
  border-radius: 2px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  outline: none;
}

.player-control-btn:hover {
  background: var(--player-control-hover);
  border-color: var(--player-line-strong);
}

.player-control-btn:active {
  transform: scale(0.96);
}

.player-control-btn:focus-visible {
  border-color: var(--player-fg);
  box-shadow: 0 0 0 1px var(--player-fg);
}

.player-control-btn--play {
  width: var(--player-control-play-size);
  height: var(--player-control-play-size);
  background: var(--player-primary);
  color: var(--player-primary-fg);
  border-color: var(--player-primary);
}

.player-control-btn--play:hover {
  background: var(--player-fg);
  border-color: var(--player-fg);
  color: var(--player-bg);
}

.player-control-icon {
  width: 1.125rem;
  height: 1.125rem;
}

.player-control-icon--play {
  width: 1.35rem;
  height: 1.35rem;
  /* optical centering for play icon */
  margin-left: 2px;
}

.player-control-btn--play[aria-pressed="true"] .player-control-icon--play {
  margin-left: 0;
}

.player-control-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid rgba(10,11,14,0.2);
  border-top-color: var(--player-primary-fg);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
