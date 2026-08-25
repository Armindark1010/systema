<script setup lang="ts">
// ============================================================
// QueueItem — Up Next queue track item
// ============================================================
// Features:
// - Direct tap to play track immediately without opening Full Player
// - Three-dot action menu
// - Visually obvious dedicated drag handle (⋮⋮)
// ============================================================

import type { Track } from '~/types'

const props = defineProps<{
  track: Track
  index: number
  isDragging?: boolean
  isHoldPending?: boolean
  durationFormatted: string
  cover?: string
  artistName: string
}>()

const emit = defineEmits<{
  play: []
  menu: [event: MouseEvent]
  'handle-pointerdown': [event: PointerEvent]
  'handle-pointermove': [event: PointerEvent]
  'handle-pointerup': [event: PointerEvent]
  'handle-pointercancel': [event: PointerEvent]
}>()
</script>

<template>
  <article
    class="player-queue-item"
    :class="{
      'is-dragging': isDragging,
      'is-hold-pending': isHoldPending,
    }"
    :data-queue-index="index"
  >
    <!-- Direct tap to play immediately -->
    <button
      type="button"
      class="player-queue-item__play focus-ring"
      :aria-label="`Play ${track.title} by ${artistName} now`"
      @click="emit('play')"
    >
      <Artwork
        :src="cover"
        :alt="`${track.title} artwork`"
        :seed="track.id"
        class="player-queue-item__art"
      />
      <span class="player-queue-copy">
        <span class="player-queue-title">{{ track.title }}</span>
        <span class="player-queue-artist">{{ artistName }}</span>
      </span>
    </button>

    <!-- Duration -->
    <span class="player-queue-duration">{{ durationFormatted }}</span>

    <!-- Three-dot menu (NOT the drag handle) -->
    <button
      type="button"
      class="player-queue-item__menu focus-ring"
      :aria-label="`Options for ${track.title}`"
      @click.stop="emit('menu', $event)"
    >
      <UIcon name="lucide:ellipsis" class="player-queue-item__menu-icon" />
    </button>

    <!-- Dedicated drag handle: primary touch target for vertical reorder -->
    <button
      type="button"
      class="player-queue-item__drag focus-ring"
      :class="{ 'is-active-handle': isDragging || isHoldPending }"
      :aria-label="`Press and hold to reorder ${track.title}`"
      @pointerdown="emit('handle-pointerdown', $event)"
      @pointermove="emit('handle-pointermove', $event)"
      @pointerup="emit('handle-pointerup', $event)"
      @pointercancel="emit('handle-pointercancel', $event)"
      @contextmenu.prevent
    >
      <UIcon name="lucide:grip-vertical" class="player-queue-item__drag-icon" />
    </button>
  </article>
</template>

<style scoped>
.player-queue-item {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto var(--player-queue-handle-size) var(--player-queue-handle-size);
  gap: var(--player-queue-row-gap);
  align-items: center;
  min-height: var(--player-queue-row-height);
  border-bottom: var(--player-queue-border-width) solid var(--player-line);
  transition: transform var(--player-queue-item-transition) var(--player-ease),
              box-shadow var(--player-queue-item-transition) var(--player-ease),
              background-color var(--player-queue-item-transition) var(--player-ease);
  will-change: transform;
}

.player-queue-item:last-child {
  border-bottom: 0;
}

.player-queue-item.is-dragging {
  background: var(--player-bg-soft);
  box-shadow: var(--player-queue-drag-shadow);
  border-color: transparent;
}

.player-queue-item__play {
  display: grid;
  min-width: 0;
  grid-template-columns: var(--player-queue-art-size) minmax(0, 1fr);
  gap: var(--player-queue-content-gap);
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0.25rem 0;
}

.player-queue-item__play:hover .player-queue-title {
  color: var(--player-accent);
}

.player-queue-item__art {
  width: var(--player-queue-art-size);
  aspect-ratio: 1;
}

.player-queue-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--player-queue-copy-gap);
}

.player-queue-title,
.player-queue-artist {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-queue-title {
  color: var(--player-fg);
  font-size: var(--player-queue-title-size);
  font-weight: var(--player-queue-title-weight);
}

.player-queue-artist {
  color: var(--player-fg-muted);
  font-size: var(--player-queue-meta-size);
  font-weight: var(--player-queue-meta-weight);
  letter-spacing: var(--player-queue-meta-tracking);
  text-transform: uppercase;
}

.player-queue-duration {
  color: var(--player-fg-faint);
  font-size: var(--player-queue-duration-size);
  font-weight: var(--player-queue-meta-weight);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.player-queue-item__menu,
.player-queue-item__drag {
  display: grid;
  width: var(--player-queue-handle-size);
  height: var(--player-queue-handle-size);
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--player-fg-muted);
  cursor: pointer;
  border-radius: var(--player-queue-pill-radius);
  transition: all 140ms ease;
}

.player-queue-item__menu:hover {
  color: var(--player-fg);
  background: var(--player-control);
}

.player-queue-item__drag {
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.player-queue-item__drag:hover {
  color: var(--player-fg);
  background: var(--player-control);
}

.player-queue-item__drag:active,
.player-queue-item__drag.is-active-handle {
  cursor: grabbing;
  color: var(--player-accent);
  background: var(--player-control-hover);
}

.player-queue-item__menu-icon,
.player-queue-item__drag-icon {
  width: var(--player-queue-icon-size);
  height: var(--player-queue-icon-size);
}
</style>
