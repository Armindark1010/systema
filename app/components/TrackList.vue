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
  /** render a compact two-column list on desktop */
  split?: boolean
  /** set when draggable — emits reorder(from, to) */
  playlistId?: string
}>(), { showHeader: true, hideAlbum: false, draggable: false, split: false, playlistId: undefined })

const emit = defineEmits<{ reorder: [from: number, to: number] }>()

const player = usePlayer()
const { toggleFavorite: toggleLibraryFavorite } = useMusicLibrary()

function onPlay(t: Track) {
  // The list on screen is the playback context, positioned at the
  // tapped track. (The previous check read `player.queue.value` — an
  // extra `.value` on an already-unwrapped store array, so it was
  // always undefined-guarded into the else branch.)
  const idx = props.tracks.findIndex((x) => x.id === t.id)
  if (idx >= 0) player.playQueue(props.tracks, idx)
  else player.playTrack(t, props.context)
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
      class="hidden sm:flex items-center gap-3 h-8 px-2 bg-muted border-b border-line text-[10px] font-bold tracking-[0.14em] text-fg-faint uppercase"
      aria-hidden="true"
    >
      <span class="w-6 shrink-0 text-right">#</span>
      <span class="flex-1">TITLE</span>
      <span v-if="!hideAlbum" class="hidden lg:block w-40 2xl:w-56 shrink-0">ALBUM</span>
      <span class="w-10 shrink-0 text-right">TIME</span>
      <span class="w-7 shrink-0" />
    </div>

    <template v-if="tracks.length">
      <ul :class="split ? 'track-list-split' : ''">
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
