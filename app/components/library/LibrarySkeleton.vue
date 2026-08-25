<script setup lang="ts">
defineProps<{ section: 'tracks' | 'albums' | 'artists' | 'playlists' }>()
</script>

<template>
  <div v-if="section === 'albums'" class="library-skeleton library-skeleton--albums" aria-label="Loading albums" role="status">
    <span v-for="index in 6" :key="index" class="library-skeleton__album" />
  </div>
  <div v-else class="library-skeleton" aria-label="Loading library" role="status">
    <span v-for="index in 6" :key="index" class="library-skeleton__row" />
  </div>
</template>

<style scoped>
.library-skeleton { display: flex; flex-direction: column; border-top: var(--library-line-width) solid var(--sys-border); }
.library-skeleton__row { display: block; min-height: var(--library-row-height); border-bottom: var(--library-line-width) solid var(--sys-border); background: var(--sys-surface-muted); animation: library-skeleton var(--library-motion) var(--sys-ease) infinite alternate; }
.library-skeleton--albums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--library-album-gap); border: 0; }
.library-skeleton__album { display: block; aspect-ratio: 1; background: var(--sys-surface-muted); animation: library-skeleton var(--library-motion) var(--sys-ease) infinite alternate; }
@media (min-width: 640px) { .library-skeleton--albums { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@keyframes library-skeleton { from { opacity: var(--library-skeleton-opacity); } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .library-skeleton__row, .library-skeleton__album { animation: none; } }
</style>
