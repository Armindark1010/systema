<script setup lang="ts">
// ============================================================
// SearchFilters — clean architectural filter pills
// ============================================================

import type { SearchFilterType } from '~/services/search/searchTypes'

defineProps<{
  activeFilter: SearchFilterType
  counts?: {
    tracks?: number
    albums?: number
    artists?: number
    playlists?: number
  }
}>()

const emit = defineEmits<{
  select: [filter: SearchFilterType]
}>()

const filterOptions: { id: SearchFilterType; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'tracks', label: 'TRACKS' },
  { id: 'albums', label: 'ALBUMS' },
  { id: 'artists', label: 'ARTISTS' },
  { id: 'playlists', label: 'PLAYLISTS' },
]
</script>

<template>
  <div class="search-filters" role="tablist" aria-label="Search result filter">
    <button
      v-for="opt in filterOptions"
      :key="opt.id"
      type="button"
      role="tab"
      :aria-selected="activeFilter === opt.id"
      class="search-filter-pill focus-ring"
      :class="{ 'is-active': activeFilter === opt.id }"
      @click="emit('select', opt.id)"
    >
      <span>{{ opt.label }}</span>
      <span
        v-if="counts && opt.id !== 'all' && counts[opt.id] !== undefined && counts[opt.id]! > 0"
        class="search-filter-count"
      >
        {{ counts[opt.id] }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.search-filters {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0 var(--sys-content-pad, 1rem) 0.75rem;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.search-filters::-webkit-scrollbar {
  display: none;
}

.search-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.875rem;
  padding: 0 0.75rem;
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.1));
  border-radius: 2px;
  background: transparent;
  color: var(--sys-foreground-muted, #9ba3af);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  white-space: nowrap;
  cursor: pointer;
  transition: all 140ms ease;
}

.search-filter-pill:hover {
  color: var(--sys-foreground, #fff);
  border-color: var(--sys-border-strong, rgba(255, 255, 255, 0.2));
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.04));
}

.search-filter-pill.is-active {
  color: var(--sys-background, #000);
  background: var(--sys-foreground, #fff);
  border-color: var(--sys-foreground, #fff);
}

.search-filter-count {
  font-size: 0.625rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}
</style>
