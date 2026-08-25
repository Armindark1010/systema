<script setup lang="ts">
// ============================================================
// PlayerQueue — touch-first UP NEXT panel using Centralized Pinia Store
// ============================================================
// Single source of truth is usePlayerStore().
// Supports:
// - Dynamic count: player.queue.length
// - Direct touch vertical reorder with visual lift and midpoint calculation
// - Gesture priority: Reordering completely disables sheet dismiss
// - Direct tap to play without opening full player
// - Three-dot action sheet with Remove, Add to Playlist, Track Info
// ============================================================

import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'add-to-playlist': [track: Track]
}>()

const player = usePlayerStore()
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()
const toast = useToast()

const currentCover = computed(() =>
  player.currentTrack ? (player.currentTrack.artwork || getAlbum(player.currentTrack.albumId)?.cover) : undefined
)

function trackCover(track: Track) {
  return track.artwork || getAlbum(track.albumId)?.cover
}

function trackArtist(track: Track) {
  return track.artist || getArtist(track.artistId)?.name || 'SYSTEMA'
}

// Queue reorder controller
const reorder = useQueueReorder({
  itemsCount: computed(() => player.queue.length),
  onReorder: (from, to) => {
    player.reorderQueue(from, to)
  },
})

// Swipe down to dismiss sheet — disabled whenever reordering is active
const sheetDrag = useSwipeToDismiss(() => {
  if (reorder.isReordering.value) return
  emit('close')
})

const actionItem = ref<{ track: Track; index: number } | null>(null)
const actionDrag = useSwipeToDismiss(() => { actionItem.value = null })

function onTrackPlay(index: number) {
  player.playQueueItem(index)
  // User stays in the queue / current context — do NOT force full player open
}

function openActionMenu(track: Track, index: number) {
  actionItem.value = { track, index }
}

function closeActionMenu() {
  actionItem.value = null
}

function chooseAction(action: 'play-now' | 'remove' | 'playlist' | 'info') {
  const target = actionItem.value
  if (!target) return

  if (action === 'play-now') {
    player.playQueueItem(target.index)
    actionItem.value = null
    return
  }

  if (action === 'remove') {
    player.removeFromQueue(target.index)
    toast.add({
      title: 'Removed from queue',
      description: target.track.title,
      icon: 'lucide:trash-2',
    })
  }

  if (action === 'playlist') {
    emit('add-to-playlist', target.track)
  }

  if (action === 'info') {
    toast.add({
      title: target.track.title,
      description: `${trackArtist(target.track)} · ${formatDuration(target.track.duration)}`,
      icon: 'lucide:info',
    })
  }

  actionItem.value = null
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      actionItem.value = null
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="player-queue-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Up next queue"
        @click.self="emit('close')"
      >
        <section
          class="player-queue-sheet"
          :class="{
            'is-dragging-sheet': sheetDrag.isDragging.value,
            'is-reordering-mode': reorder.isReordering.value,
          }"
          :style="reorder.isReordering.value ? undefined : sheetDrag.dragStyle.value"
        >
          <!-- Sheet handle for swipe-down to close -->
          <div
            class="player-queue-sheet__handle"
            aria-label="Swipe down to close queue"
            @pointerdown="reorder.isReordering.value || !useSettingsStore().gestures.swipeQueue ? undefined : sheetDrag.onDragStart($event)"
            @pointermove="reorder.isReordering.value || !useSettingsStore().gestures.swipeQueue ? undefined : sheetDrag.onDragMove($event)"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          >
            <span />
          </div>

          <!-- Sheet header -->
          <header class="player-queue-sheet__header">
            <div>
              <h2 class="player-queue-sheet__title">UP NEXT</h2>
              <!-- Dynamic count straight from Pinia -->
              <p class="player-queue-sheet__count">
                {{ player.queue.length }} {{ player.queue.length === 1 ? 'TRACK' : 'TRACKS' }}
              </p>
            </div>
            <button
              class="player-queue-sheet__close focus-ring"
              aria-label="Close queue"
              @click="emit('close')"
            >
              <UIcon name="lucide:x" class="player-queue-sheet__close-icon" />
            </button>
          </header>

          <div class="player-queue-sheet__content">
            <!-- NOW PLAYING -->
            <section
              v-if="player.currentTrack"
              class="player-queue-current"
              aria-label="Now playing"
            >
              <p class="player-queue-label">NOW PLAYING</p>
              <div class="player-queue-current__row">
                <Artwork
                  :src="currentCover"
                  :alt="player.currentTrack.title"
                  :seed="player.currentTrack.id"
                  class="player-queue-current__art"
                />
                <div class="player-queue-copy">
                  <p class="player-queue-title">{{ player.currentTrack.title }}</p>
                  <p class="player-queue-artist">{{ trackArtist(player.currentTrack) }}</p>
                </div>
                <span class="player-queue-duration">
                  {{ formatDuration(player.currentTrack.duration) }}
                </span>
              </div>
            </section>

            <!-- UP NEXT -->
            <section class="player-queue-upcoming" aria-label="Upcoming tracks">
              <p class="player-queue-label">UP NEXT</p>

              <!-- Empty queue state -->
              <div v-if="!player.queue.length" class="player-queue-empty">
                <strong>QUEUE EMPTY</strong>
                <span>No more tracks are scheduled.</span>
              </div>

              <!-- Reorderable upcoming tracks list -->
              <div v-else class="player-queue-list">
                <QueueItem
                  v-for="(track, index) in player.queue"
                  :key="track.id"
                  :track="track"
                  :index="index"
                  :is-dragging="reorder.isReordering.value && reorder.dragIndex.value === index"
                  :is-hold-pending="reorder.isHoldPending.value && reorder.dragIndex.value === index"
                  :duration-formatted="formatDuration(track.duration)"
                  :cover="trackCover(track)"
                  :artist-name="trackArtist(track)"
                  :style="reorder.getItemStyle(index)"
                  @play="onTrackPlay(index)"
                  @menu="openActionMenu(track, index)"
                  @handle-pointerdown="reorder.onHandlePointerDown($event, index)"
                  @handle-pointermove="reorder.onHandlePointerMove($event)"
                  @handle-pointerup="reorder.onHandlePointerUp($event)"
                  @handle-pointercancel="reorder.onHandlePointerCancel($event)"
                />
              </div>
            </section>
          </div>

          <div class="player-queue-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>

    <!-- Queue item three-dot action menu -->
    <Transition name="sys-overlay">
      <div
        v-if="actionItem"
        class="player-queue-action-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Queue item actions"
        @click.self="closeActionMenu"
      >
        <section
          class="player-queue-action-sheet"
          :class="{ 'is-dragging-sheet': actionDrag.isDragging.value }"
          :style="actionDrag.dragStyle.value"
        >
          <div
            class="player-queue-sheet__handle"
            aria-label="Swipe down to close actions"
            @pointerdown="actionDrag.onDragStart"
            @pointermove="actionDrag.onDragMove"
            @pointerup="actionDrag.onDragEnd"
            @pointercancel="actionDrag.onDragEnd"
          >
            <span />
          </div>
          <p class="player-queue-action-sheet__title">{{ actionItem.track.title }}</p>
          <button class="player-queue-action focus-ring" @click="chooseAction('play-now')">
            <UIcon name="lucide:play" /> PLAY NOW
          </button>
          <button class="player-queue-action focus-ring" @click="chooseAction('remove')">
            <UIcon name="lucide:trash-2" /> REMOVE FROM QUEUE
          </button>
          <button class="player-queue-action focus-ring" @click="chooseAction('playlist')">
            <UIcon name="lucide:list-plus" /> ADD TO PLAYLIST
          </button>
          <button class="player-queue-action focus-ring" @click="chooseAction('info')">
            <UIcon name="lucide:info" /> TRACK INFO
          </button>
          <div class="player-queue-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-queue-overlay,
.player-queue-action-overlay {
  position: fixed;
  inset: 0;
  z-index: 71;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--player-queue-overlay-bg);
  backdrop-filter: blur(var(--player-queue-overlay-blur));
}

.player-queue-action-overlay {
  z-index: 73;
}

.player-queue-sheet,
.player-queue-action-sheet {
  width: 100%;
  max-width: var(--player-queue-sheet-width);
  max-height: calc(100dvh - var(--player-safe-top));
  overflow: hidden;
  border: var(--player-queue-border-width) solid var(--player-sheet-line);
  border-bottom: 0;
  border-radius: var(--player-sheet-radius) var(--player-sheet-radius) 0 0;
  background: var(--player-sheet-bg);
  box-shadow: var(--player-queue-sheet-shadow);
  animation: player-queue-sheet-in var(--player-queue-sheet-transition) var(--player-ease);
}

.player-queue-sheet {
  height: calc(100dvh - var(--player-safe-top));
  display: flex;
  flex-direction: column;
}

.player-queue-sheet.is-dragging-sheet,
.player-queue-action-sheet.is-dragging-sheet {
  animation: none;
  user-select: none;
}

.player-queue-sheet.is-reordering-mode {
  user-select: none;
  touch-action: none;
}

.player-queue-sheet__handle {
  display: grid;
  height: var(--player-queue-handle-size);
  place-items: center;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}

.player-queue-sheet__handle:active {
  cursor: grabbing;
}

.player-queue-sheet__handle span {
  width: var(--player-queue-grip-width);
  height: var(--player-queue-grip-height);
  border-radius: var(--player-queue-pill-radius);
  background: var(--player-fg-faint);
  opacity: var(--player-queue-grip-opacity);
}

.player-queue-sheet__header {
  display: flex;
  min-height: var(--player-queue-handle-size);
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--player-content-padding);
  border-bottom: var(--player-queue-border-width) solid var(--player-line);
  flex-shrink: 0;
}

.player-queue-sheet__title,
.player-queue-label {
  font-size: var(--player-queue-heading-size);
  font-weight: var(--player-queue-heading-weight);
  letter-spacing: var(--player-queue-heading-tracking);
  color: var(--player-fg);
}

.player-queue-sheet__count {
  margin-top: var(--player-queue-count-gap);
  font-size: var(--player-queue-meta-size);
  font-weight: var(--player-queue-heading-weight);
  letter-spacing: var(--player-queue-heading-tracking);
  color: var(--player-fg-faint);
  font-variant-numeric: tabular-nums;
}

.player-queue-sheet__close {
  display: grid;
  width: var(--player-queue-handle-size);
  height: var(--player-queue-handle-size);
  place-items: center;
  border: var(--player-queue-border-width) solid var(--player-line);
  border-radius: var(--player-queue-pill-radius);
  background: var(--player-control);
  color: var(--player-fg-muted);
  cursor: pointer;
}

.player-queue-sheet__close:hover {
  background: var(--player-control-hover);
  color: var(--player-fg);
}

.player-queue-sheet__close-icon {
  width: var(--player-queue-icon-size);
  height: var(--player-queue-icon-size);
}

.player-queue-sheet__content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--player-content-padding);
  scrollbar-width: none;
}

.player-queue-sheet__content::-webkit-scrollbar {
  display: none;
}

.player-queue-current {
  padding-bottom: var(--player-content-padding);
  border-bottom: var(--player-queue-border-width) solid var(--player-line);
}

.player-queue-label {
  margin-bottom: var(--player-queue-content-gap);
  color: var(--player-fg-faint);
}

.player-queue-current__row {
  display: grid;
  min-width: 0;
  grid-template-columns: var(--player-queue-art-size) minmax(0, 1fr) auto;
  gap: var(--player-queue-row-gap);
  align-items: center;
}

.player-queue-current__art {
  width: var(--player-queue-art-size);
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

.player-queue-upcoming {
  padding-top: var(--player-content-padding);
}

.player-queue-empty {
  display: flex;
  min-height: var(--player-queue-row-height);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--player-queue-count-gap);
  color: var(--player-fg-muted);
  font-size: var(--player-queue-empty-size);
  text-align: center;
  padding: 1.5rem 0;
}

.player-queue-empty strong {
  color: var(--player-fg-faint);
  font-size: var(--player-queue-duration-size);
  font-weight: var(--player-queue-heading-weight);
  letter-spacing: var(--player-queue-heading-tracking);
}

.player-queue-list {
  border-top: var(--player-queue-border-width) solid var(--player-line);
  border-bottom: var(--player-queue-border-width) solid var(--player-line);
  position: relative;
}

.player-queue-sheet__safe {
  height: calc(var(--player-content-padding) + var(--player-safe-bottom));
  flex-shrink: 0;
}

.player-queue-action-sheet {
  max-width: var(--player-queue-sheet-width);
  overflow-y: auto;
}

.player-queue-action-sheet__title {
  padding: 0 var(--player-content-padding) var(--player-content-padding);
  color: var(--player-fg-muted);
  font-size: var(--player-queue-empty-size);
  font-weight: var(--player-queue-title-weight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-queue-action {
  display: grid;
  width: 100%;
  min-height: var(--player-queue-handle-size);
  grid-template-columns: var(--player-queue-icon-size) minmax(0, 1fr);
  gap: var(--player-queue-action-gap);
  align-items: center;
  padding-inline: var(--player-content-padding);
  border: 0;
  border-top: var(--player-queue-border-width) solid var(--player-line);
  background: transparent;
  color: var(--player-fg);
  font-size: var(--player-queue-heading-size);
  font-weight: var(--player-queue-heading-weight);
  letter-spacing: var(--player-queue-meta-tracking);
  text-align: left;
  cursor: pointer;
}

.player-queue-action:hover {
  background: var(--player-control);
}

.player-queue-action :deep(svg) {
  width: var(--player-queue-icon-size);
  height: var(--player-queue-icon-size);
  color: var(--player-fg-muted);
}

@keyframes player-queue-sheet-in {
  from {
    transform: translate3d(0, 100%, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-queue-sheet,
  .player-queue-action-sheet {
    animation: none;
  }
}
</style>
