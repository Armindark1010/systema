<script setup lang="ts">
import type { Track } from '~/types'

defineProps<{
  track: Track
  index: number
  artist: string
  cover?: string
  duration: string
}>()

const emit = defineEmits<{
  play: []
  actions: []
}>()
</script>

<template>
  <article class="library-track-item">
    <span class="library-track-item__number text-micro tnum" aria-hidden="true">
      {{ String(index + 1).padStart(2, '0') }}
    </span>

    <button
      class="library-track-item__play focus-ring"
      :aria-label="`Play ${track.title} by ${artist}`"
      @click="emit('play')"
    >
      <Artwork class="library-track-item__art" :src="cover" :alt="`${track.title} artwork`" :seed="track.id" />
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
  grid-template-columns: var(--library-number-column) minmax(0, 1fr) var(--library-duration-column) var(--library-menu-size);
  gap: var(--library-row-gap);
  align-items: center;
  border-bottom: var(--library-line-width) solid var(--sys-border);
}

.library-track-item:last-child { border-bottom: 0; }

.library-track-item__number {
  color: var(--sys-foreground-faint);
  text-align: right;
}

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

.library-track-item__art { width: var(--library-art-size); }

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
