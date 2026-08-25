<script setup lang="ts">
// ============================================================
// PlayerProgress — precise, pointer-first playback scrubber
// ============================================================

const props = defineProps<{
  currentMs: number
  durationMs: number
}>()

const emit = defineEmits<{
  seek: [ms: number]
}>()

const isDragging = ref(false)
const localPct = ref(0)
const trackRef = ref<HTMLElement | null>(null)
let activePointerId: number | null = null

const pct = computed(() => {
  if (!props.durationMs) return 0
  return Math.min(100, Math.max(0, (props.currentMs / props.durationMs) * 100))
})

const displayPct = computed(() => isDragging.value ? localPct.value : pct.value)

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

const currentLabel = computed(() => formatMs(props.currentMs))
const durationLabel = computed(() => formatMs(props.durationMs))

function pctFromPointer(event: PointerEvent): number {
  const rect = trackRef.value?.getBoundingClientRect()
  if (!rect?.width) return 0
  return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))
}

function seekToPointer(event: PointerEvent) {
  localPct.value = pctFromPointer(event)
  // Emit immediately for both taps and drags. `progressMs` in usePlayer is
  // the source of truth, so the timestamp, lyrics, and visual position agree.
  emit('seek', (localPct.value / 100) * props.durationMs)
}

function onPointerDown(event: PointerEvent) {
  if (!props.durationMs || (event.pointerType === 'mouse' && event.button !== 0)) return
  activePointerId = event.pointerId
  isDragging.value = true
  trackRef.value?.setPointerCapture?.(event.pointerId)
  seekToPointer(event)
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value || event.pointerId !== activePointerId) return
  seekToPointer(event)
}

function finishPointer(event: PointerEvent) {
  if (!isDragging.value || event.pointerId !== activePointerId) return
  if (trackRef.value?.hasPointerCapture?.(event.pointerId)) trackRef.value.releasePointerCapture(event.pointerId)
  activePointerId = null
  isDragging.value = false
}

function onKeySeek(event: KeyboardEvent) {
  if (!props.durationMs) return
  const fineStep = 1000
  const coarseStep = 15000
  const step = event.shiftKey ? coarseStep : fineStep
  let next = props.currentMs

  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step
  else if (event.key === 'PageDown') next -= coarseStep
  else if (event.key === 'PageUp') next += coarseStep
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = props.durationMs
  else return

  event.preventDefault()
  emit('seek', Math.max(0, Math.min(props.durationMs, next)))
}
</script>

<template>
  <div class="player-progress">
    <div
      ref="trackRef"
      class="player-progress-track"
      :class="{ 'is-dragging': isDragging }"
      role="slider"
      :aria-valuemin="0"
      :aria-valuemax="durationMs"
      :aria-valuenow="Math.round(currentMs)"
      :aria-valuetext="`${currentLabel} of ${durationLabel}`"
      :aria-label="`Seek, ${currentLabel} of ${durationLabel}`"
      tabindex="0"
      @pointerdown.stop="onPointerDown"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="finishPointer"
      @pointercancel.stop="finishPointer"
      @lostpointercapture="(event) => finishPointer(event as PointerEvent)"
      @keydown="onKeySeek"
    >
      <div class="player-progress-rail" />
      <div class="player-progress-fill" :style="{ width: `${displayPct}%` }" />
      <div class="player-progress-thumb" :style="{ left: `${displayPct}%` }" />
    </div>

    <div class="player-progress-times" aria-hidden="true">
      <span class="player-progress-time">{{ currentLabel }}</span>
      <span class="player-progress-time player-progress-time--duration">{{ durationLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.player-progress {
  width: 100%;
  padding-inline: var(--player-content-padding);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex-shrink: 0;
}

.player-progress-times {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.player-progress-time {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--player-fg-muted);
}

.player-progress-time--duration {
  color: var(--player-fg-faint);
}

.player-progress-track {
  position: relative;
  height: 30px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

.player-progress-track:focus-visible .player-progress-rail {
  background: var(--player-line-strong);
}

.player-progress-rail {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--player-progress-height);
  background: var(--player-line);
  transition: background 160ms var(--player-ease-smooth);
}

.player-progress-fill {
  position: absolute;
  left: 0;
  height: var(--player-progress-height);
  background: var(--player-fg);
  transition: width 80ms linear;
  pointer-events: none;
}

.player-progress-thumb {
  position: absolute;
  top: 50%;
  width: var(--player-progress-thumb);
  height: var(--player-progress-thumb);
  background: var(--player-fg);
  border: 2px solid var(--player-bg);
  border-radius: 999px;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 160ms var(--player-ease-smooth), left 80ms linear;
  will-change: left, transform;
}

.player-progress-track.is-dragging .player-progress-fill,
.player-progress-track.is-dragging .player-progress-thumb {
  transition: none;
}

.player-progress-track:active .player-progress-thumb,
.player-progress-track:focus-visible .player-progress-thumb {
  transform: translate(-50%, -50%) scale(1.2);
}

@media (min-width: 768px) {
  .player-progress-track { height: 32px; }
}
</style>
