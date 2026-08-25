<script setup lang="ts">
import type { Track } from '~/types'

defineProps<{
  tracks: Track[]
  getArtist: (id: string) => { name: string } | undefined
  getAlbum: (id: string) => { cover: string } | undefined
  formatDuration: (seconds: number) => string
}>()

const emit = defineEmits<{
  play: [track: Track]
  actions: [track: Track]
}>()
</script>

<template>
  <section v-if="tracks.length" id="library-tracks" class="library-track-list" aria-label="Tracks">
    <LibraryTrackItem
      v-for="(track, index) in tracks"
      :key="track.id"
      :track="track"
      :index="index"
      :artist="getArtist(track.artistId)?.name ?? 'UNKNOWN ARTIST'"
      :cover="getAlbum(track.albumId)?.cover"
      :duration="formatDuration(track.duration)"
      @play="emit('play', track)"
      @actions="emit('actions', track)"
    />
  </section>
  <LibraryEmptyState v-else title="NO TRACKS YET">Your music library is empty.</LibraryEmptyState>
</template>

<style scoped>
.library-track-list {
  border-top: var(--library-line-width) solid var(--sys-border);
  border-bottom: var(--library-line-width) solid var(--sys-border);
}
</style>
