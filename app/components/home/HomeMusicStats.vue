<script setup lang="ts">
const { stats, genreCatalog } = useMusicLibrary()

const library = computed(() => stats())

const mostPlayedGenre = computed(() => {
  const ranked = genreCatalog.value
    .map(({ genre, tracks }) => ({
      name: genre.name,
      plays: tracks.reduce((total, track) => total + track.plays, 0),
    }))
    .sort((a, b) => b.plays - a.plays)

  return ranked[0]?.name ?? '—'
})

const summaries = computed(() => [
  { label: 'TRACKS', value: library.value.tracks, to: '/library/tracks' },
  { label: 'ARTISTS', value: library.value.artists, to: '/library/artists' },
  { label: 'ALBUMS', value: library.value.albums, to: '/library/albums' },
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

      <div class="hairline-t p-3 md:p-4 flex items-end justify-between gap-4">
        <div>
          <p class="label-faint">MOST PLAYED</p>
          <p class="mt-1 text-small font-semibold text-fg uppercase">
            {{ mostPlayedGenre }}
          </p>
        </div>
        <NuxtLink to="/library/genres" class="label text-fg-muted hover:text-primary t-col focus-ring py-1">
          BROWSE →
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
