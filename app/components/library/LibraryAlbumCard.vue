<script setup lang="ts">
import type { Album } from '~/types'

defineProps<{
  album: Album
  artist: string
}>()

const emit = defineEmits<{
  play: []
  actions: []
}>()
</script>

<template>
  <article class="library-album-card">
    <button class="library-album-card__play focus-ring" :aria-label="`Play album ${album.title}`" @click="emit('play')">
      <Artwork :src="album.cover" :alt="`${album.title} artwork`" :seed="album.id" />
      <span class="library-album-card__copy">
        <span class="library-album-card__title text-small">{{ album.title }}</span>
        <span class="library-album-card__artist text-micro">{{ artist }}</span>
      </span>
    </button>
    <button class="library-album-card__menu focus-ring" :aria-label="`More actions for ${album.title}`" data-player-no-swipe @click="emit('actions')">
      <UIcon name="lucide:ellipsis-vertical" class="library-album-card__menu-icon" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.library-album-card { position: relative; min-width: 0; }
.library-album-card__play { display: block; width: 100%; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.library-album-card__copy { display: block; min-width: 0; padding-top: var(--library-gap); padding-right: var(--library-menu-size); }
.library-album-card__title,
.library-album-card__artist { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-album-card__title { color: var(--sys-foreground); font-weight: 600; }
.library-album-card__artist { margin-top: var(--library-gap-tight); color: var(--sys-foreground-muted); letter-spacing: 0.08em; text-transform: uppercase; }
.library-album-card__menu { position: absolute; right: 0; bottom: 0; display: grid; width: var(--library-menu-size); height: var(--library-menu-size); place-items: center; border: 0; background: transparent; color: var(--sys-foreground-muted); cursor: pointer; }
.library-album-card__menu:hover { color: var(--sys-foreground); background: var(--sys-surface-hover); }
.library-album-card__menu-icon { width: var(--library-icon-size); height: var(--library-icon-size); }
</style>
