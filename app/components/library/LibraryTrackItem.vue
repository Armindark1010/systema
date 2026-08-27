<script setup lang="ts">
import type { Track } from '~/types'

const props = defineProps<{
  track: Track
  index: number
  artist: string
  cover?: string
  duration: string
}>()

const emit = defineEmits<{
  play: []
  actions: []
  longpress: []
}>()

const player = usePlayer()
const isCurrent = computed(() => player.currentTrack.value?.id === props.track.id)
const isPlaying = computed(() => isCurrent.value && player.isPlaying.value)

let holdTimer: ReturnType<typeof setTimeout> | null = null
let holdFired = false

function clearHold() {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = null
}

function onPressStart() {
  holdFired = false
  clearHold()
  holdTimer = setTimeout(() => {
    holdFired = true
    emit('longpress')
  }, 420)
}

function onPressEnd() {
  clearHold()
}

function onPlayClick() {
  if (holdFired) return
  emit('play')
}
</script>

<template>
  <article
    class="library-track-item"
    :class="{ 'is-current': isCurrent, 'is-playing': isPlaying }"
  >
    <button
      class="library-track-item__play focus-ring"
      :aria-label="`Play ${track.title} by ${artist}`"
      @click="emit('play')"
    >
      <div class="relative library-track-item__art-container rounded-md overflow-hidden shrink-0">
        <Artwork
          class="library-track-item__art rounded-md"
          :src="cover"
          :alt="`${track.title} artwork`"
          :seed="track.id"
        />

        <!-- Live Equalizer on Cover when active -->
        <div
          v-if="isCurrent"
          class="absolute inset-0 bg-white/45 backdrop-blur-[0.5px] flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <div class="flex items-end justify-center gap-[2px] h-3.5 w-full px-1">
            <span class="w-[2.5px] bg-primary rounded-full eq-bar eq-bar-1" :class="{ 'is-paused': !isPlaying }" />
            <span class="w-[2.5px] bg-primary rounded-full eq-bar eq-bar-2" :class="{ 'is-paused': !isPlaying }" />
            <span class="w-[2.5px] bg-primary rounded-full eq-bar eq-bar-3" :class="{ 'is-paused': !isPlaying }" />
            <span class="w-[2.5px] bg-primary rounded-full eq-bar eq-bar-4" :class="{ 'is-paused': !isPlaying }" />
          </div>
        </div>
      </div>

      <span class="library-track-item__copy">
        <span class="library-track-item__title text-small">{{ track.title }}</span>
        <span class="library-track-item__artist text-micro">{{ artist }}</span>
      </span>
    </button>

    <span class="library-track-item__duration text-micro tnum">{{ duration }}</span>

    <button
      class="library-track-item__menu focus-ring"
      :aria-label="`More actions for ${track.title}`"
      data-player-no-swipe
      @click="emit('actions')"
    >
      <UIcon name="lucide:ellipsis-vertical" class="library-track-item__menu-icon" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.library-track-item {
  display: grid;
  min-width: 0;
  min-height: var(--library-row-height);
  content-visibility: auto;
  contain-intrinsic-size: auto var(--library-row-height);
  grid-template-columns: minmax(0, 1fr) var(--library-duration-column) var(--library-menu-size);
  gap: var(--library-row-gap);
  align-items: center;
  /* border-bottom: var(--library-line-width) solid var(--sys-border); */
  padding-inline: 0.5rem;
  transition: background-color 150ms ease;
}

.library-track-item:hover {
  background: var(--sys-surface-hover);
}

.library-track-item.is-current {
  background: var(--sys-primary-muted);
}

.library-track-item.is-current:hover {
  background: var(--sys-primary-muted);
  filter: brightness(0.95);
}

.library-track-item:last-child { border-bottom: 0; }

.library-track-item__play {
  display: grid;
  min-width: 0;
  grid-template-columns: var(--library-art-size) minmax(0, 1fr);
  gap: var(--library-row-gap);
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.library-track-item__play:hover .library-track-item__title { color: var(--sys-primary); }

.library-track-item__art-container {
  width: var(--library-art-size);
  height: var(--library-art-size);
}

.library-track-item__art {
  width: 100%;
  height: 100%;
}

/* Equalizer Bars Animation */
.eq-bar {
  display: inline-block;
  transform-origin: bottom;
  animation: eq-bounce 0.8s ease-in-out infinite alternate;
}

.eq-bar-1 { height: 45%; animation-duration: 0.65s; animation-delay: 0.1s; }
.eq-bar-2 { height: 100%; animation-duration: 0.95s; animation-delay: 0.25s; }
.eq-bar-3 { height: 75%; animation-duration: 0.75s; animation-delay: 0.15s; }
.eq-bar-4 { height: 50%; animation-duration: 0.85s; animation-delay: 0.35s; }

.eq-bar.is-paused {
  animation-play-state: paused;
  opacity: 0.8;
}

@keyframes eq-bounce {
  0% { transform: scaleY(0.2); }
  50% { transform: scaleY(1); }
  100% { transform: scaleY(0.35); }
}

.library-track-item__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--library-gap-tight);
}

.library-track-item__title,
.library-track-item__artist {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-track-item__title {
  color: var(--sys-foreground);
  font-weight: 600;
}

.library-track-item.is-current .library-track-item__title {
  color: var(--sys-primary);
  font-weight: 700;
}

.library-track-item__artist {
  color: var(--sys-foreground-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.library-track-item__duration {
  color: var(--sys-foreground-faint);
  text-align: right;
  white-space: nowrap;
}

.library-track-item__menu {
  display: grid;
  width: var(--library-menu-size);
  height: var(--library-menu-size);
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--sys-foreground-muted);
  cursor: pointer;
}

.library-track-item__menu:hover { color: var(--sys-foreground); background: var(--sys-surface-hover); }
.library-track-item__menu-icon { width: var(--library-icon-size); height: var(--library-icon-size); }
</style>
