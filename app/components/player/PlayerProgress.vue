<script setup lang="ts">
// ============================================================
// PlayerProgress — immersive minimal scrubber
// ============================================================
// Requirements: scrubbable, keyboard accessible, touch friendly,
// smooth updates, semantic range input, minimal visual.
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

const pct = computed(() => {
  if (!props.durationMs) return 0
  return Math.min(100, Math.max(0, (props.currentMs / props.durationMs) * 100))
})

const displayPct = computed(() => isDragging.value ? localPct.value : pct.value)

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const currentLabel = computed(() => formatMs(props.currentMs))
const durationLabel = computed(() => formatMs(props.durationMs))

const trackRef = ref<HTMLElement | null>(null)

function pctFromEvent(e: MouseEvent | TouchEvent): number {
  if (!trackRef.value) return 0
  const rect = trackRef.value.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0]!.clientX : (e as MouseEvent).clientX
  const x = clientX - rect.left
  return Math.min(100, Math.max(0, (x / rect.width) * 100))
}

function onPointerDown(e: MouseEvent | TouchEvent) {
  isDragging.value = true
  localPct.value = pctFromEvent(e)
  // prevent scroll on touch
  if ('touches' in e) e.preventDefault()
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  if (!isDragging.value) return
  localPct.value = pctFromEvent(e)
}

function onPointerUp() {
  if (!isDragging.value) return
  isDragging.value = false
  const ms = (localPct.value / 100) * props.durationMs
  emit('seek', ms)
}

function onKeySeek(e: KeyboardEvent) {
  const step = props.durationMs * 0.02 // 2%
  let next = props.currentMs
  if (e.key === 'ArrowLeft') next -= step
  if (e.key === 'ArrowRight') next += step
  if (e.key === 'Home') next = 0
  if (e.key === 'End') next = props.durationMs
  next = Math.max(0, Math.min(props.durationMs, next))
  emit('seek', next)
}

onMounted(() => {
  window.addEventListener('mousemove', onPointerMove as any)
  window.addEventListener('mouseup', onPointerUp)
  window.addEventListener('touchmove', onPointerMove as any, { passive: false })
  window.addEventListener('touchend', onPointerUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onPointerMove as any)
  window.removeEventListener('mouseup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove as any)
  window.removeEventListener('touchend', onPointerUp)
})
</script>

<template>
  <div class="player-progress">
    <div class="player-progress-times">
      <span class="player-progress-time">{{ currentLabel }}</span>
      <span class="player-progress-time player-progress-time--duration">{{ durationLabel }}</span>
    </div>

    <div
      ref="trackRef"
      class="player-progress-track"
      role="slider"
      :aria-valuemin="0"
      :aria-valuemax="durationMs"
      :aria-valuenow="currentMs"
      :aria-label="`Seek, ${currentLabel} of ${durationLabel}`"
      tabindex="0"
      @mousedown="onPointerDown"
      @touchstart.passive="onPointerDown"
      @keydown="onKeySeek"
    >
      <div class="player-progress-rail" />
      <div class="player-progress-fill" :style="{ width: displayPct + '%' }" />
      <div class="player-progress-thumb" :style="{ left: displayPct + '%' }" />
      <!-- native range for semantics, visually hidden but accessible -->
      <input
        type="range"
        :min="0"
        :max="durationMs"
        :value="currentMs"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        @input="(e) => emit('seek', Number((e.target as HTMLInputElement).value))"
      >
    </div>
  </div>
</template>

<style scoped>
.player-progress {
  width: 100%;
  padding-inline: var(--player-content-padding);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  height: 28px;
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
  transition: width 120ms linear;
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
  transition: transform 160ms var(--player-ease-smooth), left 120ms linear;
  will-change: left, transform;
}

.player-progress-track:active .player-progress-thumb,
.player-progress-track:focus-visible .player-progress-thumb {
  transform: translate(-50%, -50%) scale(1.2);
}

@media (min-width: 768px) {
  .player-progress-track {
    height: 32px;
  }
}
</style>
