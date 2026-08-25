<script setup lang="ts">
import type { Playlist } from '~/types'

defineProps<{
  playlists: Playlist[]
  countTracks: (playlist: Playlist) => number
  coverFor: (playlist: Playlist) => string | undefined
}>()

const emit = defineEmits<{
  play: [playlist: Playlist]
  actions: [playlist: Playlist]
}>()
</script>

<template>
  <section v-if="playlists.length" id="library-playlists" class="library-playlist-list" aria-label="Playlists">
    <article v-for="playlist in playlists" :key="playlist.id" class="library-playlist-item">
      <button class="library-playlist-item__play focus-ring" :aria-label="`Play playlist ${playlist.title}`" @click="emit('play', playlist)">
        <Artwork class="library-playlist-item__art" :src="coverFor(playlist)" :alt="`${playlist.title} artwork`" :seed="playlist.id" />
        <span class="library-playlist-item__copy">
          <span class="library-playlist-item__name text-small">{{ playlist.title }}</span>
          <span class="library-playlist-item__count text-micro tnum">{{ countTracks(playlist) }} TRACKS</span>
        </span>
      </button>
      <button class="library-playlist-item__menu focus-ring" :aria-label="`More actions for ${playlist.title}`" data-player-no-swipe @click="emit('actions', playlist)">
        <UIcon name="lucide:ellipsis-vertical" class="library-playlist-item__menu-icon" aria-hidden="true" />
      </button>
    </article>
  </section>
  <LibraryEmptyState v-else title="NO PLAYLISTS YET" />
</template>

<style scoped>
.library-playlist-list { border-top: var(--library-line-width) solid var(--sys-border); border-bottom: var(--library-line-width) solid var(--sys-border); }
.library-playlist-item { display: grid; min-width: 0; min-height: var(--library-row-height); grid-template-columns: minmax(0, 1fr) var(--library-menu-size); align-items: center; border-bottom: var(--library-line-width) solid var(--sys-border); }
.library-playlist-item:last-child { border-bottom: 0; }
.library-playlist-item__play { display: grid; min-width: 0; grid-template-columns: var(--library-art-size) minmax(0, 1fr); gap: var(--library-row-gap); align-items: center; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.library-playlist-item__art { width: var(--library-art-size); }
.library-playlist-item__copy { display: flex; min-width: 0; flex-direction: column; gap: var(--library-gap-tight); }
.library-playlist-item__name,
.library-playlist-item__count { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-playlist-item__name { color: var(--sys-foreground); font-weight: 600; }
.library-playlist-item__count { color: var(--sys-foreground-muted); letter-spacing: 0.08em; }
.library-playlist-item__menu { display: grid; width: var(--library-menu-size); height: var(--library-menu-size); place-items: center; border: 0; background: transparent; color: var(--sys-foreground-muted); cursor: pointer; }
.library-playlist-item__menu:hover { color: var(--sys-foreground); background: var(--sys-surface-hover); }
.library-playlist-item__menu-icon { width: var(--library-icon-size); height: var(--library-icon-size); }
</style>
