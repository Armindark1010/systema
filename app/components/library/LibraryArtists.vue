<script setup lang="ts">
import type { Artist } from '~/types'

const props = defineProps<{
  artists: Artist[]
  trackCount: (artistId: string) => number
}>()

const emit = defineEmits<{
  play: [artist: Artist]
  actions: [artist: Artist]
}>()

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join('')
}
</script>

<template>
  <section v-if="artists.length" id="library-artists" class="library-artist-list" aria-label="Artists">
    <article v-for="artist in artists" :key="artist.id" class="library-artist-item">
      <button class="library-artist-item__play focus-ring" :aria-label="`Play music by ${artist.name}`" @click="emit('play', artist)">
        <span class="library-artist-item__monogram text-micro tnum" aria-hidden="true">{{ initials(artist.name) }}</span>
        <span class="library-artist-item__copy">
          <span class="library-artist-item__name text-small">{{ artist.name }}</span>
          <span class="library-artist-item__count text-micro tnum">{{ trackCount(artist.id) }} TRACKS</span>
        </span>
      </button>
      <button class="library-artist-item__menu focus-ring" :aria-label="`More actions for ${artist.name}`" data-player-no-swipe @click="emit('actions', artist)">
        <UIcon name="lucide:ellipsis-vertical" class="library-artist-item__menu-icon" aria-hidden="true" />
      </button>
    </article>
  </section>
  <LibraryEmptyState v-else title="NO ARTISTS YET" />
</template>

<style scoped>
.library-artist-list { border-top: var(--library-line-width) solid var(--sys-border); border-bottom: var(--library-line-width) solid var(--sys-border); }
.library-artist-item { display: grid; min-width: 0; min-height: var(--library-row-height); grid-template-columns: minmax(0, 1fr) var(--library-menu-size); align-items: center; border-bottom: var(--library-line-width) solid var(--sys-border); }
.library-artist-item:last-child { border-bottom: 0; }
.library-artist-item__play { display: grid; min-width: 0; grid-template-columns: var(--library-art-size) minmax(0, 1fr); gap: var(--library-row-gap); align-items: center; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.library-artist-item__monogram { display: grid; width: var(--library-art-size); height: var(--library-art-size); place-items: center; border: var(--library-line-width) solid var(--sys-border); background: var(--sys-surface-muted); color: var(--sys-foreground-muted); font-weight: 700; }
.library-artist-item__copy { display: flex; min-width: 0; flex-direction: column; gap: var(--library-gap-tight); }
.library-artist-item__name,
.library-artist-item__count { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-artist-item__name { color: var(--sys-foreground); font-weight: 600; }
.library-artist-item__count { color: var(--sys-foreground-muted); letter-spacing: 0.08em; }
.library-artist-item__menu { display: grid; width: var(--library-menu-size); height: var(--library-menu-size); place-items: center; border: 0; background: transparent; color: var(--sys-foreground-muted); cursor: pointer; }
.library-artist-item__menu:hover { color: var(--sys-foreground); background: var(--sys-surface-hover); }
.library-artist-item__menu-icon { width: var(--library-icon-size); height: var(--library-icon-size); }
</style>
