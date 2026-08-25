<script setup lang="ts">
// ============================================================
// PlayerControls — transport + hold-to-seek
// ============================================================

const props = defineProps<{
  isPlaying: boolean
  isLoading?: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  toggle: []
  seekStep: [milliseconds: number]
}>()

const HOLD_DELAY = 420
const HOLD_INTERVAL = 430
let holdStartTimer: ReturnType<typeof setTimeout> | null = null
let holdInterval: ReturnType<typeof setInterval> | null = null
let heldDirection: -1 | 1 | null = null
let activePointerId: number | null = null
let suppressTap = false

function stopHold() {
  if (holdStartTimer) clearTimeout(holdStartTimer)
  if (holdInterval) clearInterval(holdInterval)
  holdStartTimer = null
  holdInterval = null
  heldDirection = null
  activePointerId = null
}

function startHold(direction: -1 | 1, event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  stopHold()
  heldDirection = direction
  activePointerId = event.pointerId
  suppressTap = false
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)

  holdStartTimer = setTimeout(() => {
    if (heldDirection !== direction) return
    suppressTap = true
    emit('seekStep', direction * 15000)
    holdInterval = setInterval(() => emit('seekStep', direction * 15000), HOLD_INTERVAL)
  }, HOLD_DELAY)
}

function endHold(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  stopHold()
}

function onTransportClick(direction: -1 | 1) {
  if (suppressTap) {
    suppressTap = false
    return
  }
  if (direction === -1) emit('prev')
  else emit('next')
}

function blockContextMenu(event: Event) {
  event.preventDefault()
}

onBeforeUnmount(stopHold)
</script>

<template>
  <div class="player-controls" role="group" aria-label="Playback controls">
    <button
      class="player-control-btn"
      aria-label="Previous track. Hold to seek backward 15 seconds repeatedly."
      @pointerdown.stop="startHold(-1, $event)"
      @pointerup.stop="endHold($event)"
      @pointercancel.stop="endHold($event)"
      @lostpointercapture="stopHold"
      @contextmenu="blockContextMenu"
      @click="onTransportClick(-1)"
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
      aria-label="Next track. Hold to seek forward 15 seconds repeatedly."
      @pointerdown.stop="startHold(1, $event)"
      @pointerup.stop="endHold($event)"
      @pointercancel.stop="endHold($event)"
      @lostpointercapture="stopHold"
      @contextmenu="blockContextMenu"
      @click="onTransportClick(1)"
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
  flex-shrink: 0;
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
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  transition: all 160ms var(--player-ease-smooth);
  outline: none;
}

.player-control-btn:hover {
  background: var(--player-control-hover);
  border-color: var(--player-line-strong);
}

.player-control-btn:active { transform: scale(0.96); }

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

.player-control-icon { width: 1.125rem; height: 1.125rem; }

.player-control-icon--play {
  width: 1.35rem;
  height: 1.35rem;
  margin-left: 2px;
}

.player-control-btn--play[aria-pressed="true"] .player-control-icon--play { margin-left: 0; }

.player-control-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid rgba(10,11,14,0.2);
  border-top-color: var(--player-primary-fg);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
