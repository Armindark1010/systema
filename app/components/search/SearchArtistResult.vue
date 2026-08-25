<script setup lang="ts">
// ============================================================
// SearchArtistResult — compact artist result row
// ============================================================

import type { Artist } from '~/types'
import type { ScoredSearchResult } from '~/services/search/searchTypes'

const props = defineProps<{
  result: ScoredSearchResult<Artist>
  trackCount?: number
}>()

const emit = defineEmits<{
  select: [artist: Artist]
  actions: [artist: Artist]
}>()

const artist = computed(() => props.result.item)
</script>

<template>
  <article class="search-entity-row">
    <button
      type="button"
      class="search-entity-main focus-ring"
      :aria-label="`Open artist ${artist.name}`"
      @click="emit('select', artist)"
    >
      <div class="search-artist-avatar" aria-hidden="true">
        <UIcon name="lucide:mic-vocal" class="w-4 h-4 text-fg-muted" />
      </div>
      <div class="search-entity-meta">
        <span class="search-entity-title">{{ artist.name }}</span>
        <span class="search-entity-subtitle">
          {{ artist.origin }}
          <span v-if="trackCount !== undefined"> · {{ trackCount }} TRACKS</span>
        </span>
      </div>
    </button>

    <button
      type="button"
      class="search-entity-menu-btn focus-ring"
      :aria-label="`More actions for ${artist.name}`"
      @click.stop="emit('actions', artist)"
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

.search-artist-avatar {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  background: var(--sys-surface, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.12));
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
