<script setup lang="ts">
// ============================================================
// TrackList — structured archive list
// ============================================================

import type { Track } from '~/types'

const props = withDefaults(defineProps<{
  tracks: Track[]
  context: string
  showHeader?: boolean
  hideAlbum?: boolean
  draggable?: boolean
  /** set when draggable — emits reorder(from, to) */
  playlistId?: string
}>(), { showHeader: true, hideAlbum: false, draggable: false, playlistId: undefined })

const emit = defineEmits<{ reorder: [from: number, to: number] }>()

// Keep the column labels aligned with TrackRow's breakpoint-specific grid.
// The explicit template also prevents CSS Grid from creating implicit rows.
const listGridClass = computed(() => {
  const mobile = props.draggable
    ? 'grid-cols-[24px_minmax(0,1fr)_28px_14px] sm:grid-cols-[24px_minmax(0,1fr)_40px_28px_14px]'
    : 'grid-cols-[24px_minmax(0,1fr)_28px] sm:grid-cols-[24px_minmax(0,1fr)_40px_28px]'

  if (props.hideAlbum) return mobile

  return props.draggable
    ? `${mobile} lg:grid-cols-[24px_minmax(0,1fr)_160px_40px_28px_14px] 2xl:grid-cols-[24px_minmax(0,1fr)_224px_40px_28px_14px]`
    : `${mobile} lg:grid-cols-[24px_minmax(0,1fr)_160px_40px_28px] 2xl:grid-cols-[24px_minmax(0,1fr)_224px_40px_28px]`
})

const player = usePlayer()
const { toggleFavorite: toggleLibraryFavorite } = useMusicLibrary()

function onPlay(t: Track) {
  const idx = props.tracks.findIndex((x) => x.id === t.id)
  const alreadyInQueue = player.queue.value.some((q) => q.track.id === t.id)
  if (alreadyInQueue) {
    player.playTrack(t, props.context)
  } else {
    player.playQueue(
      props.tracks.map((track) => ({ track, context: props.context })),
      idx,
    )
  }
}

function onFavorite(id: string) {
  player.toggleFavoriteId(id)
  toggleLibraryFavorite(id)
}
</script>

<template>
  <div class="border border-line bg-surface">
    <!-- column header -->
    <div
      v-if="showHeader"
      class="hidden sm:grid items-center gap-3 h-8 px-2 bg-muted border-b border-line text-[10px] font-bold tracking-[0.14em] text-fg-faint uppercase"
      :class="listGridClass"
      aria-hidden="true"
    >
      <span class="w-6 shrink-0 text-right">#</span>
      <span class="flex-1">TITLE</span>
      <span v-if="!hideAlbum" class="hidden lg:block w-40 2xl:w-56 shrink-0">ALBUM</span>
      <span class="w-10 shrink-0 text-right">TIME</span>
      <span class="w-7 shrink-0" />
    </div>

    <template v-if="tracks.length">
      <ul>
        <TrackRow
          v-for="(t, i) in tracks"
          :key="t.id"
          :track="t"
          :index="i"
          :context="context"
          :hide-album="hideAlbum"
          :draggable="draggable"
          @play="onPlay"
          @favorite="onFavorite"
          @reorder="(from: number, to: number) => emit('reorder', from, to)"
        />
      </ul>
    </template>
    <slot v-else name="empty">
      <p class="py-12 text-center text-small text-fg-faint">NO TRACKS</p>
    </slot>
  </div>
</template>
