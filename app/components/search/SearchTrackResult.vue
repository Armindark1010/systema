<script setup lang="ts">
// ============================================================
// SearchTrackResult — compact track result row
// ============================================================
// Features:
// - Direct tap to play track immediately without opening Full Player
// - Three-dot action button
// - Duration display
// - Optional AI match explanation chip
// ============================================================

import type { Track } from '~/types'
import type { ScoredSearchResult } from '~/services/search/searchTypes'

const props = defineProps<{
  result: ScoredSearchResult<Track>
  artistName: string
  cover?: string
  durationFormatted: string
}>()

const emit = defineEmits<{
  play: [track: Track]
  actions: [track: Track]
}>()

const track = computed(() => props.result.item)
</script>

<template>
  <article class="search-track-row">
    <!-- Click to play immediately -->
    <button
      type="button"
      class="search-track-play focus-ring"
      :aria-label="`Play ${track.title} by ${artistName}`"
      @click="emit('play', track)"
    >
      <Artwork
        :src="cover"
        :alt="`${track.title} artwork`"
        :seed="track.id"
        class="search-track-art"
      />
      <div class="search-track-meta">
        <span class="search-track-title">{{ track.title }}</span>
        <span class="search-track-artist">{{ artistName }}</span>
        <span v-if="result.aiExplanation" class="search-track-ai-badge">
          <UIcon name="lucide:sparkles" class="w-2.5 h-2.5" />
          <span>{{ result.aiExplanation }}</span>
        </span>
      </div>
    </button>

    <!-- Duration -->
    <span class="search-track-duration">{{ durationFormatted }}</span>

    <!-- Three-dot contextual actions button -->
    <button
      type="button"
      class="search-track-menu-btn focus-ring"
      :aria-label="`More actions for ${track.title}`"
      @click.stop="emit('actions', track)"
    >
      <UIcon name="lucide:ellipsis" class="search-track-menu-icon" />
    </button>
  </article>
</template>

<style scoped>
.search-track-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 2.5rem;
  gap: 0.75rem;
  align-items: center;
  min-height: 3.75rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-track-row:last-child {
  border-bottom: 0;
}

.search-track-play {
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

.search-track-play:hover .search-track-title {
  color: var(--sys-primary, #64a0ff);
}

.search-track-art {
  width: 2.75rem;
  height: 2.75rem;
  aspect-ratio: 1;
}

.search-track-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.search-track-title,
.search-track-artist {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-track-title {
  color: var(--sys-foreground, #fff);
  font-size: 0.875rem;
  font-weight: 600;
}

.search-track-artist {
  color: var(--sys-foreground-muted, #9ba3af);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.search-track-ai-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--sys-primary, #64a0ff);
  margin-top: 0.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-track-duration {
  color: var(--sys-foreground-faint, #6b7280);
  font-size: 0.6875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.search-track-menu-btn {
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

.search-track-menu-btn:hover {
  color: var(--sys-foreground, #fff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.08));
}

.search-track-menu-icon {
  width: 1.125rem;
  height: 1.125rem;
}
</style>
