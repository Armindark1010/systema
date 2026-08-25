<script setup lang="ts">
// GenreSection — categorized genre block with top tracks
import type { Genre } from '~/types'

const props = defineProps<{ genre: Genre }>()
const { genreCatalog } = useMusicLibrary()

const section = computed(() => genreCatalog.value.find((g) => g.genre.id === props.genre.id))
const topTracks = computed(() => section.value?.tracks.sort((a, b) => b.plays - a.plays).slice(0, 4) ?? [])
</script>

<template>
  <section class="border border-line bg-surface" :aria-label="`Genre ${genre.name}`">
    <header class="flex items-baseline justify-between gap-4 px-4 h-11 border-b border-line bg-muted">
      <h2 class="text-[13px] font-bold tracking-[0.14em] text-fg uppercase">{{ genre.name }}</h2>
      <span class="label text-fg-faint tnum">{{ section?.tracks.length ?? 0 }} TRACKS</span>
    </header>
    <TrackList
      :tracks="topTracks"
      context="GENRE"
      :show-header="false"
      hide-album
    />
    <footer class="px-4 h-8 flex items-center justify-end border-t border-line">
      <span class="text-[10px] font-semibold tracking-[0.14em] text-fg-faint uppercase">
        {{ section?.albums.length ?? 0 }} ALBUMS IN ARCHIVE
      </span>
    </footer>
  </section>
</template>
