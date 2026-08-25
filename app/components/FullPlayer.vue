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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') setFullPlayerOpen(false)
}

watch(fullPlayerOpen, (v) => {
  if (v) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
})

const moreItems = [
  { key: 'album', label: 'View album', icon: 'lucide:disc-3' },
  { key: 'artist', label: 'View artist', icon: 'lucide:mic-vocal' },
  { key: 'clear', label: 'Clear queue', icon: 'lucide:trash-2' },
]

function onMore(item: { key: string }) {
  const t = currentTrack.value
  if (!t) return
  if (item.key === 'album') {
    setFullPlayerOpen(false)
    navigateTo(`/library/albums?album=${t.albumId}`)
  }
  if (item.key === 'artist') {
    setFullPlayerOpen(false)
    navigateTo(`/library/artists?artist=${t.artistId}`)
  }
  if (item.key === 'clear') clearQueue()
}
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
        @click.self="setFullPlayerOpen(false)"
      >
        <div class="relative w-full md:max-w-[860px] max-h-[92dvh] overflow-y-auto bg-surface border-t md:border border-line md:shadow-2 flex flex-col">
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
                aria-label="Close now playing"
                @click="setFullPlayerOpen(false)"
              >
                <UIcon name="lucide:x" class="w-4.5 h-4.5" />
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
