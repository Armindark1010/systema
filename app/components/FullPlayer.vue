<script setup lang="ts">
// ============================================================
// FullPlayer — expanded now-playing overlay
// ============================================================

const player = usePlayer()
const { fullPlayerOpen, currentTrack, setFullPlayerOpen, setQueueOpen, index, queue, favorites, toggleFavorite, clearQueue } = player
const { getAlbum, getArtist } = useMusicLibrary()

const cover = computed(() => (currentTrack.value ? getAlbum(currentTrack.value.albumId)?.cover : undefined))
const artistName = computed(() => (currentTrack.value ? getArtist(currentTrack.value.artistId)?.name : ''))
const position = computed(() =>
  currentTrack.value ? `${String(index.value + 1).padStart(2, '0')} / ${String(queue.value.length).padStart(2, '0')}` : '—',
)

const sheet = ref<HTMLElement | null>(null)
const dragOffset = ref(0)
const dragging = ref(false)
let dragStartY = 0
let sheetSwipeStart: { x: number; y: number; scrollTop: number } | null = null

const sheetStyle = computed(() => {
  if (!dragging.value && dragOffset.value === 0) return undefined
  return {
    transform: `translate3d(0, ${dragOffset.value}px, 0)`,
    transition: dragging.value ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
  }
})

function resetSheetGesture() {
  dragging.value = false
  dragOffset.value = 0
  sheetSwipeStart = null
}

function closeFullPlayer() {
  resetSheetGesture()
  setFullPlayerOpen(false)
}

function onHandlePointerDown(event: PointerEvent) {
  dragStartY = event.clientY
  dragOffset.value = 0
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onHandlePointerMove(event: PointerEvent) {
  if (!dragging.value) return
  dragOffset.value = Math.max(0, event.clientY - dragStartY)
}

function onHandlePointerEnd(event: PointerEvent) {
  if (!dragging.value) return
  const shouldClose = dragOffset.value > 72
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  if (shouldClose) closeFullPlayer()
  else dragOffset.value = 0
}

function onSheetTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  const target = event.target as HTMLElement
  if (!touch || target.closest('button, a, input, textarea, select, [role="slider"]')) {
    sheetSwipeStart = null
    return
  }
  sheetSwipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    scrollTop: sheet.value?.scrollTop ?? 0,
  }
}

function onSheetTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (!touch || !sheetSwipeStart) return
  const deltaX = touch.clientX - sheetSwipeStart.x
  const deltaY = touch.clientY - sheetSwipeStart.y
  const startedAtTop = sheetSwipeStart.scrollTop <= 1
  sheetSwipeStart = null

  if (startedAtTop && deltaY > 72 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
    closeFullPlayer()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFullPlayer()
}

watch(fullPlayerOpen, (v) => {
  if (v) document.addEventListener('keydown', onKeydown)
  else {
    document.removeEventListener('keydown', onKeydown)
    resetSheetGesture()
  }
})

function goAlbum() {
  const t = currentTrack.value
  if (!t) return
  setFullPlayerOpen(false)
  navigateTo(`/library/albums?album=${t.albumId}`)
}
function goArtist() {
  const t = currentTrack.value
  if (!t) return
  setFullPlayerOpen(false)
  navigateTo(`/library/artists?artist=${t.artistId}`)
}

const moreItems = [
  { label: 'View album', icon: 'lucide:disc-3', onSelect: goAlbum },
  { label: 'View artist', icon: 'lucide:mic-vocal', onSelect: goArtist },
  { label: 'Clear queue', icon: 'lucide:trash-2', onSelect: () => clearQueue() },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="fullPlayerOpen && currentTrack"
        class="fixed inset-0 z-50 bg-base/60 backdrop-blur-sm flex items-end md:items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        @click.self="closeFullPlayer()"
      >
        <div
          ref="sheet"
          class="mobile-full-player-sheet relative w-full h-[100dvh] md:h-auto md:max-w-[860px] max-h-[100dvh] md:max-h-[92dvh] overflow-y-auto bg-surface border-0 md:border border-line md:shadow-2 flex flex-col"
          :class="dragging ? 'mobile-full-player-sheet--dragging' : ''"
          :style="sheetStyle"
          @touchstart.passive="onSheetTouchStart"
          @touchend.passive="onSheetTouchEnd"
          @touchcancel.passive="resetSheetGesture"
        >
          <!-- mobile pull handle: tap or drag down to collapse -->
          <div
            class="mobile-full-player-handle md:hidden shrink-0 grid place-items-center touch-none cursor-grab active:cursor-grabbing"
            aria-hidden="true"
            @pointerdown="onHandlePointerDown"
            @pointermove="onHandlePointerMove"
            @pointerup="onHandlePointerEnd"
            @pointercancel="onHandlePointerEnd"
          >
            <span class="w-12 h-1 rounded-full bg-fg-faint/55" />
          </div>

          <!-- top hairline row -->
          <div class="flex items-center justify-between px-4 md:px-8 h-12 border-b border-line shrink-0">
            <span class="label-muted">NOW PLAYING — {{ position }}</span>
            <div class="flex items-center gap-1">
              <button
                class="pressable focus-ring w-8 h-8 grid place-items-center text-fg-muted hover:text-fg t-col"
                aria-label="Open queue"
                @click="setQueueOpen(true)"
              >
                <UIcon name="lucide:list-music" class="w-4 h-4" />
              </button>
              <button
                class="pressable focus-ring w-8 h-8 grid place-items-center text-fg-muted hover:text-fg t-col"
                aria-label="Collapse now playing"
                @click="closeFullPlayer()"
              >
                <UIcon name="lucide:chevron-down" class="w-5 h-5 md:hidden" />
                <UIcon name="lucide:x" class="w-4.5 h-4.5 hidden md:block" />
              </button>
            </div>
          </div>

          <div class="grid md:grid-cols-2 gap-6 md:gap-10 p-4 md:p-8 items-center">
            <!-- artwork -->
            <div class="max-w-[340px] mx-auto w-full">
              <Artwork :src="cover" :alt="currentTrack.title" seed="full" />
            </div>

            <!-- metadata + transport -->
            <div class="flex flex-col gap-5">
              <div>
                <p class="label-muted">TRACK — {{ position }}</p>
                <h2 class="mt-2 text-h1 font-bold tracking-tight text-fg text-balance">{{ currentTrack.title }}</h2>
                <NuxtLink
                  :to="`/library/artists?artist=${currentTrack.artistId}`"
                  class="mt-1 inline-block text-lead text-fg-muted hover:text-primary t-col focus-ring"
                >{{ artistName }}</NuxtLink>
              </div>

              <PlayerProgress />

              <PlayerControls />

              <!-- secondary row -->
              <div class="flex items-center justify-between border-t border-line pt-3">
                <div class="flex items-center gap-1">
                  <button
                    class="pressable focus-ring w-9 h-9 grid place-items-center t-col"
                    :class="favorites.has(currentTrack.id) ? 'text-primary' : 'text-fg-faint hover:text-fg'"
                    :aria-label="favorites.has(currentTrack.id) ? 'Remove from favorites' : 'Add to favorites'"
                    @click="toggleFavorite()"
                  >
                    <UIcon name="lucide:heart" class="w-4 h-4" />
                  </button>
                  <VolumeControl class="ml-2" />
                </div>
                <UDropdownMenu :items="moreItems" :ui="{ content: 'w-52' }">
                  <button class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg t-col" aria-label="More options">
                    <UIcon name="lucide:ellipsis" class="w-4.5 h-4.5" />
                  </button>
                </UDropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
