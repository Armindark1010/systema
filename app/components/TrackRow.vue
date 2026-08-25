<script setup lang="ts">
// ============================================================
// TrackRow — one row of the archive list
// ============================================================

import type { Track } from '~/types'

const props = withDefaults(defineProps<{
  track: Track
  index?: number
  context: string
  draggable?: boolean
  hideAlbum?: boolean
}>(), { index: undefined, draggable: false, hideAlbum: false })

const emit = defineEmits<{
  play: [t: Track]
  favorite: [id: string]
  reorder: [from: number, to: number]
}>()

const player = usePlayer()
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()

const isCurrent = computed(() => player.currentTrack.value?.id === props.track.id)
const isFavorite = computed(() => player.isFavorite(props.track.id))
const albumTitle = computed(() => getAlbum(props.track.albumId)?.title ?? '')
const artistName = computed(() => getArtist(props.track.artistId)?.name ?? '')

const dragOver = ref(false)

// A row has a strict column template at every breakpoint. Without this,
// CSS Grid creates one implicit column per child, which lets the artwork
// expand to the width of the list and overlap the following recent tracks.
const rowGridClass = computed(() => {
  const mobile = props.draggable
    ? 'grid-cols-[24px_minmax(0,1fr)_28px_14px] sm:grid-cols-[24px_minmax(0,1fr)_40px_28px_14px]'
    : 'grid-cols-[24px_minmax(0,1fr)_28px] sm:grid-cols-[24px_minmax(0,1fr)_40px_28px]'

  if (props.hideAlbum) return mobile

  return props.draggable
    ? `${mobile} lg:grid-cols-[24px_minmax(0,1fr)_160px_40px_28px_14px] 2xl:grid-cols-[24px_minmax(0,1fr)_224px_40px_28px_14px]`
    : `${mobile} lg:grid-cols-[24px_minmax(0,1fr)_160px_40px_28px] 2xl:grid-cols-[24px_minmax(0,1fr)_224px_40px_28px]`
})

function onDragStart(e: DragEvent) {
  if (!props.draggable) return
  e.dataTransfer?.setData('text/plain', String(props.index ?? 0))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(e: DragEvent) {
  if (!props.draggable) return
  dragOver.value = false
  const from = Number(e.dataTransfer?.getData('text/plain'))
  const to = props.index ?? 0
  if (!Number.isNaN(from) && from !== to) emit('reorder', from, to)
}
</script>

<template>
  <li
    class="group relative grid items-center gap-3 h-12 px-2 t-col hover:bg-hover focus-within:bg-hover border-b border-line last:border-b-0"
    :class="[rowGridClass, isCurrent ? 'bg-primary-muted/60 hover:bg-primary-muted' : '', dragOver ? 'ring-1 ring-inset ring-primary' : '']"
    :draggable="draggable"
    @dragstart="onDragStart"
    @dragover.prevent="draggable && (dragOver = true)"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <!-- index / playing state -->
    <span class="w-6 shrink-0 grid place-items-center" aria-hidden="true">
      <template v-if="isCurrent">
        <span class="flex gap-[2px] items-end h-3">
          <span v-if="player.isPlaying.value" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 0ms" />
          <span v-if="player.isPlaying.value" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 160ms" />
          <span v-if="player.isPlaying.value" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 300ms" />
          <UIcon v-if="!player.isPlaying.value" name="lucide:pause" class="w-3 h-3 text-primary" />
        </span>
      </template>
      <template v-else>
        <span class="tnum text-[11px] text-fg-faint group-hover:hidden">{{ String((index ?? 0) + 1).padStart(2, '0') }}</span>
        <UIcon name="lucide:play" class="w-3 h-3 text-primary hidden group-hover:block" />
      </template>
    </span>

    <!-- main: artwork + title + artist -->
    <button
      class="flex items-center gap-3 min-w-0 flex-1 text-left pressable focus-ring py-1"
      :aria-label="`Play ${track.title} by ${artistName}`"
      @click="emit('play', track)"
    >
      <Artwork :src="getAlbum(track.albumId)?.cover" :alt="track.title" class="w-8 h-8 shrink-0" :seed="track.id" />
      <span class="min-w-0">
        <span class="block text-[13px] font-medium truncate" :class="isCurrent ? 'text-primary' : 'text-fg'">{{ track.title }}</span>
        <span class="block text-[11.5px] text-fg-muted truncate">{{ artistName }}</span>
      </span>
    </button>

    <!-- album (desktop) -->
    <span v-if="!hideAlbum" class="hidden lg:block text-[12px] text-fg-muted truncate w-40 2xl:w-56 shrink-0">{{ albumTitle }}</span>

    <!-- duration -->
    <span class="tnum text-[11.5px] text-fg-faint shrink-0 w-10 text-right hidden sm:block">{{ formatDuration(track.duration) }}</span>

    <!-- favorite -->
    <button
      class="pressable focus-ring w-7 h-7 grid place-items-center shrink-0 t-col"
      :class="isFavorite ? 'text-primary' : 'text-fg-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg'"
      :aria-label="isFavorite ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`"
      :aria-pressed="isFavorite"
      @click="emit('favorite', track.id)"
    >
      <UIcon name="lucide:heart" class="w-3.5 h-3.5" />
    </button>

    <!-- drag handle (playlist reorder) -->
    <UIcon
      v-if="draggable"
      name="lucide:grip-vertical"
      class="w-3.5 h-3.5 text-fg-faint shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
      aria-hidden="true"
    />
  </li>
</template>
