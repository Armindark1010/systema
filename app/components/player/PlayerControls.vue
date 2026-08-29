<script setup lang="ts">
// ============================================================
// PlayerControls — transport + hold-to-seek + shuffle + repeat
// ============================================================

import type { RepeatMode } from '~/types'

const props = withDefaults(defineProps<{
  isPlaying: boolean
  isLoading?: boolean
  isShuffle?: boolean
  repeatMode?: RepeatMode
}>(), {
  isLoading: false,
  isShuffle: false,
  repeatMode: 'off',
})

const emit = defineEmits<{
  prev: []
  next: []
  toggle: []
  seekStep: [milliseconds: number]
  toggleShuffle: []
  cycleRepeat: []
}>()

const repeatIcon = computed(() => {
  if (props.repeatMode === 'one') return 'lucide:repeat-1'
  return 'lucide:repeat'
})

const repeatLabel = computed(() => {
  if (props.repeatMode === 'one') return 'Repeat current track (Active)'
  if (props.repeatMode === 'all') return 'Repeat all tracks (Active)'
  return 'Repeat off'
})

const shuffleLabel = computed(() => {
  return props.isShuffle ? 'Shuffle on' : 'Shuffle off'
})

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
    <!-- SHUFFLE -->
    <button
      class="player-control-btn player-control-btn--secondary"
      :class="{ 'is-active': isShuffle }"
      :aria-label="shuffleLabel"
      :aria-pressed="isShuffle"
      @click="emit('toggleShuffle')"
    >
      <UIcon name="lucide:shuffle" class="player-control-icon" />
      <span v-if="isShuffle" class="player-control-dot" aria-hidden="true" />
    </button>

    <!-- PREVIOUS -->
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

    <!-- PLAY / PAUSE -->
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

    <!-- NEXT -->
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

    <!-- REPEAT -->
    <button
      class="player-control-btn player-control-btn--secondary"
      :class="{ 'is-active': repeatMode !== 'off', 'is-repeat-one': repeatMode === 'one' }"
      :aria-label="repeatLabel"
      :aria-pressed="repeatMode !== 'off'"
      @click="emit('cycleRepeat')"
    >
      <UIcon :name="repeatIcon" class="player-control-icon" />
      <span v-if="repeatMode !== 'off'" class="player-control-dot" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(0.75rem, 3.5vw, 1.25rem);
  padding-inline: var(--player-content-padding);
  flex-shrink: 0;
}

.player-control-btn {
  display: grid;
  place-items: center;
  position: relative;
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

.player-control-btn--secondary {
  width: calc(var(--player-control-size) * 0.88);
  height: calc(var(--player-control-size) * 0.88);
  color: var(--player-fg-muted);
  border-color: rgba(237, 240, 244, 0.08);
  background: rgba(20, 23, 28, 0.6);
}

.player-control-btn--secondary:hover {
  color: var(--player-fg);
  background: var(--player-control-hover);
  border-color: var(--player-line-strong);
}

.player-control-btn--secondary.is-active {
  color: var(--player-primary);
  border-color: var(--player-primary);
  background: rgba(var(--sys-primary-rgb, 237, 240, 244), 0.12);
}

.player-control-dot {
  position: absolute;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--player-primary);
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
