<script setup lang="ts">
// ============================================================
// SearchPlaylistResult — compact playlist result row
// ============================================================

import type { Playlist } from '~/types'
import type { ScoredSearchResult } from '~/services/search/searchTypes'

const props = defineProps<{
  result: ScoredSearchResult<Playlist>
  cover?: string
}>()

const emit = defineEmits<{
  select: [playlist: Playlist]
  actions: [playlist: Playlist]
}>()

const playlist = computed(() => props.result.item)
</script>

<template>
  <article class="search-entity-row">
    <button
      type="button"
      class="search-entity-main focus-ring"
      :aria-label="`Open playlist ${playlist.title}`"
      @click="emit('select', playlist)"
    >
      <Artwork
        :src="cover"
        :alt="`${playlist.title} cover`"
        :seed="playlist.id"
        class="search-entity-art"
      />
      <div class="search-entity-meta">
        <span class="search-entity-title">{{ playlist.title }}</span>
        <span class="search-entity-subtitle">
          PLAYLIST · {{ playlist.trackIds.length }} {{ playlist.trackIds.length === 1 ? 'TRACK' : 'TRACKS' }}
        </span>
      </div>
    </button>

    <button
      type="button"
      class="search-entity-menu-btn focus-ring"
      :aria-label="`More actions for ${playlist.title}`"
      @click.stop="emit('actions', playlist)"
    >
      <UIcon name="lucide:ellipsis" class="search-entity-menu-icon" />
    </button>
  </article>
</template>

<style scoped>
.search-entity-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2.5rem;
  gap: 0.75rem;
  align-items: center;
  min-height: 3.5rem;
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-entity-row:last-child {
  border-bottom: 0;
}

.search-entity-main {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0.25rem 0;
}

.search-entity-main:hover .search-entity-title {
  color: var(--sys-primary, #64a0ff);
}

.search-entity-art {
  width: 2.75rem;
  height: 2.75rem;
  aspect-ratio: 1;
}

.search-entity-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.search-entity-title,
.search-entity-subtitle {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-entity-title {
  color: var(--sys-foreground, #fff);
  font-size: 0.875rem;
  font-weight: 600;
}

.search-entity-subtitle {
  color: var(--sys-foreground-muted, #9ba3af);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.search-entity-menu-btn {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--sys-foreground-muted, #9ba3af);
  cursor: pointer;
  transition: all 140ms ease;
}

.search-entity-menu-btn:hover {
  color: var(--sys-foreground, #fff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.08));
}

.search-entity-menu-icon {
  width: 1.125rem;
  height: 1.125rem;
}
</style>
