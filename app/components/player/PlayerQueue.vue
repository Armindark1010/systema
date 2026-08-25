<script setup lang="ts">
// ============================================================
// PlayerQueue — touch-first UP NEXT panel using usePlayer queue
// ============================================================

import type { QueueItem, Track } from '~/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'add-to-playlist': [track: Track]
}>()

const player = usePlayer()
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()
const toast = useToast()
const sheetDrag = useSwipeToDismiss(() => emit('close'))

const upNext = computed(() =>
  player.queue.value.slice(player.index.value + 1).map((item, upcomingIndex) => ({
    item,
    queueIndex: player.index.value + 1 + upcomingIndex,
    upcomingIndex,
  })),
)
const currentCover = computed(() => player.currentTrack.value ? getAlbum(player.currentTrack.value.albumId)?.cover : undefined)

const actionItem = ref<{ item: QueueItem; queueIndex: number } | null>(null)
const actionDrag = useSwipeToDismiss(() => { actionItem.value = null })

let holdTimer: ReturnType<typeof setTimeout> | null = null
let dragPointerId: number | null = null
let dragSourceIndex = -1
let dropTargetIndex = -1
let dragStartY = 0
const dragOffset = ref(0)
const isDragging = ref(false)
const isHoldPending = ref(false)

function artistName(track: Track) {
  return getArtist(track.artistId)?.name ?? 'UNKNOWN ARTIST'
}

function stopDrag() {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = null
  dragPointerId = null
  dragSourceIndex = -1
  dropTargetIndex = -1
  dragOffset.value = 0
  isDragging.value = false
  isHoldPending.value = false
}

function beginDrag(event: PointerEvent, queueIndex: number) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.currentTarget as HTMLElement
  dragPointerId = event.pointerId
  dragSourceIndex = queueIndex
  dropTargetIndex = queueIndex
  dragStartY = event.clientY
  dragOffset.value = 0
  isHoldPending.value = true
  target.setPointerCapture?.(event.pointerId)

  // A deliberate hold keeps a normal scroll or tap from becoming a reorder.
  holdTimer = setTimeout(() => {
    if (dragPointerId !== event.pointerId) return
    isHoldPending.value = false
    isDragging.value = true
  }, 280)
}

function updateDropTarget(event: PointerEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const row = target instanceof Element ? target.closest<HTMLElement>('[data-queue-index]') : null
  const candidate = Number(row?.dataset.queueIndex)
  if (!Number.isInteger(candidate) || candidate <= player.index.value || candidate >= player.queue.value.length) return
  dropTargetIndex = candidate
}

function moveDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  const distance = event.clientY - dragStartY
  if (isHoldPending.value && Math.abs(distance) > 10) {
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
    isHoldPending.value = false
    return
  }
  if (!isDragging.value) return
  dragOffset.value = distance
  updateDropTarget(event)
}

function endDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = null

  if (isDragging.value && dragSourceIndex !== dropTargetIndex) {
    player.reorderQueue(dragSourceIndex, dropTargetIndex)
  }
  stopDrag()
}

function itemDragStyle(queueIndex: number) {
  if (!isDragging.value) return undefined
  if (queueIndex === dragSourceIndex) {
    return { transform: `translate3d(0, ${dragOffset.value}px, 0) scale(var(--player-queue-drag-lift))`, zIndex: 2 }
  }
  if (dragSourceIndex < dropTargetIndex && queueIndex > dragSourceIndex && queueIndex <= dropTargetIndex) {
    return { transform: 'translate3d(0, calc(var(--player-queue-row-height) * -1), 0)' }
  }
  if (dragSourceIndex > dropTargetIndex && queueIndex >= dropTargetIndex && queueIndex < dragSourceIndex) {
    return { transform: 'translate3d(0, var(--player-queue-row-height), 0)' }
  }
  return undefined
}

function playQueueItem(queueIndex: number) {
  player.playQueueItem(queueIndex)
  emit('close')
}

function chooseAction(action: 'play-now' | 'remove' | 'playlist' | 'info') {
  const target = actionItem.value
  if (!target) return
  if (action === 'play-now') {
    player.playQueueItem(target.queueIndex)
    actionItem.value = null
    emit('close')
    return
  }
  if (action === 'remove') {
    player.removeFromQueue(target.queueIndex)
    toast.add({ title: 'Removed from queue', description: target.item.track.title, icon: 'lucide:trash-2' })
  }
  if (action === 'playlist') emit('add-to-playlist', target.item.track)
  if (action === 'info') {
    toast.add({ title: target.item.track.title, description: `${artistName(target.item.track)} · ${formatDuration(target.item.track.duration)}`, icon: 'lucide:info' })
  }
  actionItem.value = null
}

function closeActionMenu() {
  actionItem.value = null
}

watch(() => props.open, open => {
  if (!open) {
    actionItem.value = null
    stopDrag()
  }
})
onBeforeUnmount(stopDrag)
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div v-if="open" class="player-queue-overlay" role="dialog" aria-modal="true" aria-label="Up next queue" @click.self="emit('close')">
        <section class="player-queue-sheet" :class="{ 'is-dragging-sheet': sheetDrag.isDragging.value }" :style="sheetDrag.dragStyle.value">
          <div
            class="player-queue-sheet__handle"
            aria-label="Swipe down to close queue"
            @pointerdown="sheetDrag.onDragStart"
            @pointermove="sheetDrag.onDragMove"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          ><span /></div>

          <header class="player-queue-sheet__header">
            <div>
              <h2 class="player-queue-sheet__title">UP NEXT</h2>
              <p class="player-queue-sheet__count">{{ upNext.length }} {{ upNext.length === 1 ? 'TRACK' : 'TRACKS' }}</p>
            </div>
            <button class="player-queue-sheet__close" aria-label="Close queue" @click="emit('close')">
              <UIcon name="lucide:x" class="player-queue-sheet__close-icon" />
            </button>
          </header>

          <div class="player-queue-sheet__content">
            <section v-if="player.currentTrack.value" class="player-queue-current" aria-label="Now playing">
              <p class="player-queue-label">NOW PLAYING</p>
              <div class="player-queue-current__row">
                <Artwork :src="currentCover" :alt="player.currentTrack.value.title" :seed="player.currentTrack.value.id" class="player-queue-current__art" />
                <div class="player-queue-copy">
                  <p class="player-queue-title">{{ player.currentTrack.value.title }}</p>
                  <p class="player-queue-artist">{{ artistName(player.currentTrack.value) }}</p>
                </div>
                <span class="player-queue-duration">{{ formatDuration(player.currentTrack.value.duration) }}</span>
              </div>
            </section>

            <section class="player-queue-upcoming" aria-label="Upcoming tracks">
              <p class="player-queue-label">UP NEXT</p>
              <p v-if="!upNext.length" class="player-queue-empty">
                <strong>QUEUE EMPTY</strong>
                <span>No more tracks are scheduled.</span>
              </p>
              <div v-else class="player-queue-list">
                <article
                  v-for="entry in upNext"
                  :key="`${entry.item.track.id}-${entry.queueIndex}`"
                  class="player-queue-item"
                  :class="{ 'is-dragging': isDragging && entry.queueIndex === dragSourceIndex }"
                  :style="itemDragStyle(entry.queueIndex)"
                  :data-queue-index="entry.queueIndex"
                >
                  <button class="player-queue-item__play" :aria-label="`Play ${entry.item.track.title} now`" @click="playQueueItem(entry.queueIndex)">
                    <Artwork :src="getAlbum(entry.item.track.albumId)?.cover" :alt="`${entry.item.track.title} artwork`" :seed="entry.item.track.id" class="player-queue-item__art" />
                    <span class="player-queue-copy">
                      <span class="player-queue-title">{{ entry.item.track.title }}</span>
                      <span class="player-queue-artist">{{ artistName(entry.item.track) }}</span>
                    </span>
                  </button>
                  <span class="player-queue-duration">{{ formatDuration(entry.item.track.duration) }}</span>
                  <button class="player-queue-item__menu" :aria-label="`Actions for ${entry.item.track.title}`" @click.stop="actionItem = { item: entry.item, queueIndex: entry.queueIndex }">
                    <UIcon name="lucide:ellipsis" class="player-queue-item__menu-icon" />
                  </button>
                  <button
                    class="player-queue-item__drag"
                    :class="{ 'is-hold-pending': isHoldPending && entry.queueIndex === dragSourceIndex }"
                    :aria-label="`Hold and drag ${entry.item.track.title} to reorder`"
                    @pointerdown.stop="beginDrag($event, entry.queueIndex)"
                    @pointermove.stop="moveDrag"
                    @pointerup.stop="endDrag"
                    @pointercancel.stop="endDrag"
                    @contextmenu.prevent
                  >
                    <UIcon name="lucide:grip-vertical" class="player-queue-item__drag-icon" />
                  </button>
                </article>
              </div>
            </section>
          </div>

          <div class="player-queue-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>

    <Transition name="sys-overlay">
      <div v-if="actionItem" class="player-queue-action-overlay" role="dialog" aria-modal="true" aria-label="Queue item actions" @click.self="closeActionMenu">
        <section class="player-queue-action-sheet" :class="{ 'is-dragging-sheet': actionDrag.isDragging.value }" :style="actionDrag.dragStyle.value">
          <div
            class="player-queue-sheet__handle"
            aria-label="Swipe down to close actions"
            @pointerdown="actionDrag.onDragStart"
            @pointermove="actionDrag.onDragMove"
            @pointerup="actionDrag.onDragEnd"
            @pointercancel="actionDrag.onDragEnd"
          ><span /></div>
          <p class="player-queue-action-sheet__title">{{ actionItem.item.track.title }}</p>
          <button class="player-queue-action" @click="chooseAction('play-now')"><UIcon name="lucide:play" /> PLAY NOW</button>
          <button class="player-queue-action" @click="chooseAction('remove')"><UIcon name="lucide:trash-2" /> REMOVE FROM QUEUE</button>
          <button class="player-queue-action" @click="chooseAction('playlist')"><UIcon name="lucide:list-plus" /> ADD TO PLAYLIST</button>
          <button class="player-queue-action" @click="chooseAction('info')"><UIcon name="lucide:info" /> TRACK INFO</button>
          <div class="player-queue-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-queue-overlay,
.player-queue-action-overlay { position: fixed; inset: 0; z-index: 71; display: flex; align-items: flex-end; justify-content: center; background: var(--player-queue-overlay-bg); backdrop-filter: blur(var(--player-queue-overlay-blur)); }
.player-queue-action-overlay { z-index: 73; }
.player-queue-sheet,
.player-queue-action-sheet { width: 100%; max-width: var(--player-queue-sheet-width); max-height: calc(100dvh - var(--player-safe-top)); overflow: hidden; border: var(--player-queue-border-width) solid var(--player-sheet-line); border-bottom: 0; border-radius: var(--player-sheet-radius) var(--player-sheet-radius) 0 0; background: var(--player-sheet-bg); box-shadow: var(--player-queue-sheet-shadow); animation: player-queue-sheet-in var(--player-queue-sheet-transition) var(--player-ease); }
.player-queue-sheet { height: calc(100dvh - var(--player-safe-top)); display: flex; flex-direction: column; }
.player-queue-sheet.is-dragging-sheet,
.player-queue-action-sheet.is-dragging-sheet { animation: none; user-select: none; }
.player-queue-sheet__handle { display: grid; height: var(--player-queue-handle-size); place-items: center; flex-shrink: 0; cursor: grab; touch-action: none; }
.player-queue-sheet__handle:active { cursor: grabbing; }
.player-queue-sheet__handle span { width: var(--player-queue-grip-width); height: var(--player-queue-grip-height); border-radius: var(--player-queue-pill-radius); background: var(--player-fg-faint); opacity: var(--player-queue-grip-opacity); }
.player-queue-sheet__header { display: flex; min-height: var(--player-queue-handle-size); align-items: center; justify-content: space-between; padding: 0 var(--player-content-padding); border-bottom: var(--player-queue-border-width) solid var(--player-line); flex-shrink: 0; }
.player-queue-sheet__title,
.player-queue-label { font-size: var(--player-queue-heading-size); font-weight: var(--player-queue-heading-weight); letter-spacing: var(--player-queue-heading-tracking); color: var(--player-fg); }
.player-queue-sheet__count { margin-top: var(--player-queue-count-gap); font-size: var(--player-queue-meta-size); font-weight: var(--player-queue-heading-weight); letter-spacing: var(--player-queue-heading-tracking); color: var(--player-fg-faint); font-variant-numeric: tabular-nums; }
.player-queue-sheet__close { display: grid; width: var(--player-queue-handle-size); height: var(--player-queue-handle-size); place-items: center; border: var(--player-queue-border-width) solid var(--player-line); border-radius: var(--player-queue-pill-radius); background: var(--player-control); color: var(--player-fg-muted); cursor: pointer; }
.player-queue-sheet__close:hover { background: var(--player-control-hover); color: var(--player-fg); }
.player-queue-sheet__close-icon { width: var(--player-queue-icon-size); height: var(--player-queue-icon-size); }
.player-queue-sheet__content { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: var(--player-content-padding); scrollbar-width: none; }
.player-queue-sheet__content::-webkit-scrollbar { display: none; }
.player-queue-current { padding-bottom: var(--player-content-padding); border-bottom: var(--player-queue-border-width) solid var(--player-line); }
.player-queue-label { margin-bottom: var(--player-queue-content-gap); color: var(--player-fg-faint); }
.player-queue-current__row,
.player-queue-item { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) auto var(--player-queue-handle-size) var(--player-queue-handle-size); gap: var(--player-queue-row-gap); align-items: center; }
.player-queue-current__row { grid-template-columns: var(--player-queue-art-size) minmax(0, 1fr) auto; }
.player-queue-current__art,
.player-queue-item__art { width: var(--player-queue-art-size); }
.player-queue-copy { display: flex; min-width: 0; flex-direction: column; gap: var(--player-queue-copy-gap); }
.player-queue-title,
.player-queue-artist { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-queue-title { color: var(--player-fg); font-size: var(--player-queue-title-size); font-weight: var(--player-queue-title-weight); }
.player-queue-artist { color: var(--player-fg-muted); font-size: var(--player-queue-meta-size); font-weight: var(--player-queue-meta-weight); letter-spacing: var(--player-queue-meta-tracking); text-transform: uppercase; }
.player-queue-duration { color: var(--player-fg-faint); font-size: var(--player-queue-duration-size); font-weight: var(--player-queue-meta-weight); font-variant-numeric: tabular-nums; white-space: nowrap; }
.player-queue-upcoming { padding-top: var(--player-content-padding); }
.player-queue-empty { display: flex; min-height: var(--player-queue-row-height); flex-direction: column; align-items: center; justify-content: center; gap: var(--player-queue-count-gap); color: var(--player-fg-muted); font-size: var(--player-queue-empty-size); text-align: center; }
.player-queue-empty strong { color: var(--player-fg-faint); font-size: var(--player-queue-duration-size); font-weight: var(--player-queue-heading-weight); letter-spacing: var(--player-queue-heading-tracking); }
.player-queue-list { border-top: var(--player-queue-border-width) solid var(--player-line); border-bottom: var(--player-queue-border-width) solid var(--player-line); }
.player-queue-item { min-height: var(--player-queue-row-height); border-bottom: var(--player-queue-border-width) solid var(--player-line); transition: transform var(--player-queue-item-transition) var(--player-ease), box-shadow var(--player-queue-item-transition) var(--player-ease), background-color var(--player-queue-item-transition) var(--player-ease); will-change: transform; }
.player-queue-item:last-child { border-bottom: 0; }
.player-queue-item.is-dragging { background: var(--player-bg-soft); box-shadow: var(--player-queue-drag-shadow); }
.player-queue-item__play { display: grid; min-width: 0; grid-column: 1 / 2; grid-template-columns: var(--player-queue-art-size) minmax(0, 1fr); gap: var(--player-queue-content-gap); align-items: center; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.player-queue-item__play:hover .player-queue-title { color: var(--player-accent); }
.player-queue-item__menu,
.player-queue-item__drag { display: grid; width: var(--player-queue-handle-size); height: var(--player-queue-handle-size); place-items: center; border: 0; background: transparent; color: var(--player-fg-muted); cursor: pointer; }
.player-queue-item__menu:hover { color: var(--player-fg); background: var(--player-control); }
.player-queue-item__drag { cursor: grab; touch-action: none; }
.player-queue-item__drag:active,
.player-queue-item__drag.is-hold-pending { cursor: grabbing; color: var(--player-fg); }
.player-queue-item__menu-icon,
.player-queue-item__drag-icon { width: var(--player-queue-icon-size); height: var(--player-queue-icon-size); }
.player-queue-sheet__safe { height: calc(var(--player-content-padding) + var(--player-safe-bottom)); flex-shrink: 0; }
.player-queue-action-sheet { max-width: var(--player-queue-sheet-width); overflow-y: auto; }
.player-queue-action-sheet__title { padding: 0 var(--player-content-padding) var(--player-content-padding); color: var(--player-fg-muted); font-size: var(--player-queue-empty-size); font-weight: var(--player-queue-title-weight); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-queue-action { display: grid; width: 100%; min-height: var(--player-queue-handle-size); grid-template-columns: var(--player-queue-icon-size) minmax(0, 1fr); gap: var(--player-queue-action-gap); align-items: center; padding-inline: var(--player-content-padding); border: 0; border-top: var(--player-queue-border-width) solid var(--player-line); background: transparent; color: var(--player-fg); font-size: var(--player-queue-heading-size); font-weight: var(--player-queue-heading-weight); letter-spacing: var(--player-queue-meta-tracking); text-align: left; cursor: pointer; }
.player-queue-action:hover { background: var(--player-control); }
.player-queue-action :deep(svg) { width: var(--player-queue-icon-size); height: var(--player-queue-icon-size); color: var(--player-fg-muted); }
@keyframes player-queue-sheet-in { from { transform: translate3d(0, 100%, 0); } to { transform: translate3d(0, 0, 0); } }
@media (prefers-reduced-motion: reduce) { .player-queue-sheet, .player-queue-action-sheet { animation: none; } .player-queue-item { transition: none; } }
</style>
