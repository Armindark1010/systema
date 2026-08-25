<script setup lang="ts">
import type { Album } from '~/types'

defineProps<{
  albums: Album[]
  getArtist: (id: string) => { name: string } | undefined
}>()

const emit = defineEmits<{
  play: [album: Album]
  actions: [album: Album]
}>()
</script>

<template>
  <section v-if="albums.length" id="library-albums" class="library-albums" aria-label="Albums">
    <LibraryAlbumCard
      v-for="album in albums"
      :key="album.id"
      :album="album"
      :artist="getArtist(album.artistId)?.name ?? 'UNKNOWN ARTIST'"
      @play="emit('play', album)"
      @actions="emit('actions', album)"
    />
  </section>
  <LibraryEmptyState v-else title="NO ALBUMS YET" />
</template>

<style scoped>
.library-albums {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--library-album-gap);
}

@media (min-width: 640px) {
  .library-albums { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (min-width: 1024px) {
  .library-albums { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
