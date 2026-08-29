<script setup lang="ts">
import { useLibraryStore } from '~/stores/library'

const libraryStore = useLibraryStore()

const totalTracks = computed(() => libraryStore.totalTracks)
const totalArtists = computed(() => libraryStore.artists.length)
const totalAlbums = computed(() => libraryStore.albums.length)

const summaries = computed(() => [
  { label: 'TRACKS', value: totalTracks.value, to: '/library/tracks' },
  { label: 'ARTISTS', value: totalArtists.value, to: '/library/artists' },
  { label: 'ALBUMS', value: totalAlbums.value, to: '/library/albums' },
])

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}
</script>

<template>
  <section aria-labelledby="home-music-title">
    <h2 id="home-music-title" class="sr-only">Your Music</h2>
    <SectionHeader label="YOUR MUSIC" to="/library/tracks" />

    <div class="mt-4 hairline-t hairline-b">
      <div class="grid grid-cols-3">
        <NuxtLink
          v-for="summary in summaries"
          :key="summary.label"
          :to="summary.to"
          class="p-3 md:p-4 border-r border-line last:border-r-0 pressable focus-ring hover:bg-hover"
        >
          <span class="block label-faint">{{ summary.label }}</span>
          <strong class="mt-2 block text-title font-semibold text-fg tnum">
            {{ formatCount(summary.value) }}
          </strong>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
