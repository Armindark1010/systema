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
const player = usePlayerStore()
const isCurrentTrack = computed(() => player.currentTrack?.id === track.value.id)
</script>

<template>
  <article class="grid min-h-18 grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-3 border-b border-line px-2 py-2 transition-colors last:border-b-0" :class="isCurrentTrack ? 'bg-primary-muted' : 'bg-transparent'">
    <!-- Click to play immediately -->
    <button
      type="button"
      class="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 bg-transparent p-0 text-left focus-ring"
      :aria-label="`Play ${track.title} by ${artistName}`"
      @click="emit('play', track)"
    >
      <div class="relative h-11 w-11 overflow-hidden">
        <Artwork :src="cover" :alt="`${track.title} artwork`" :seed="track.id" class="h-11 w-11" />
        <span v-if="isCurrentTrack" class="absolute inset-0 grid place-items-center bg-primary/80 text-primary-fg" aria-label="Currently playing"><UIcon name="lucide:audio-lines" class="h-5 w-5 animate-pulse" /></span>
      </div>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-body font-semibold text-fg">{{ track.title }}</span>
        <span class="truncate text-micro font-bold tracking-[0.08em] text-fg-muted">{{ artistName }}</span>
        <span v-if="result.aiExplanation" class="inline-flex min-w-0 items-center gap-1 truncate text-micro font-semibold text-primary">
          <UIcon name="lucide:sparkles" class="w-2.5 h-2.5" />
          <span>{{ result.aiExplanation }}</span>
        </span>
      </div>
    </button>

    <!-- Duration -->
    <span class="text-micro font-semibold tabular-nums text-fg-muted">{{ durationFormatted }}</span>

    <!-- Three-dot contextual actions button -->
    <button
      type="button"
      class="grid h-10 w-10 place-items-center border border-transparent bg-transparent text-fg-muted transition-colors hover:border-line hover:bg-hover hover:text-fg focus-ring"
      :aria-label="`More actions for ${track.title}`"
      @click.stop="emit('actions', track)"
    >
        <UIcon name="lucide:ellipsis" class="h-5 w-5" />
    </button>
  </article>
</template>

