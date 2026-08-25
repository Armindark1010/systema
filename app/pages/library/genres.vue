<script setup lang="ts">
// ============================================================
// LIBRARY — GENRES · categorized sections
// ============================================================

useHead({ title: 'Library — Genres' })

const { genres, genreCatalog } = useMusicLibrary()

const sections = computed(() =>
  genres.value
    .map((g) => ({
      genre: g,
      tracks: genreCatalog.value.find((x) => x.genre.id === g.id)?.tracks ?? [],
    }))
    .filter((s) => s.tracks.length),
)
</script>

<template>
  <div class="pb-14">
    <header class="sys-container mt-6 md:mt-10">
      <div class="flex items-baseline gap-4 hairline-b pb-4">
        <h1 class="text-h1 font-bold tracking-tight text-fg">GENRES</h1>
        <span class="label tnum text-fg-faint">{{ sections.length }} CATEGORIES</span>
      </div>
    </header>

    <div class="sys-container mt-8 grid lg:grid-cols-2 gap-6">
      <GenreSection v-for="s in sections" :key="s.genre.id" :genre="s.genre" />
    </div>
  </div>
</template>
