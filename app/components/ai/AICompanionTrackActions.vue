<script setup lang="ts">
// ============================================================
// AICompanionTrackActions — three-dot menu for a result row
// ============================================================
// Every action routes into the shared player store or back into
// the conversation. No new playback or queue state is created.
// ============================================================

import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'

const props = defineProps<{ track: Track | null }>()

const emit = defineEmits<{
  close: []
  action: [id: string, track: Track]
}>()

const player = usePlayerStore()

const options = computed(() => [
  { id: 'play', label: 'PLAY NOW', icon: 'lucide:play' },
  { id: 'play-next', label: 'PLAY NEXT', icon: 'lucide:corner-up-right' },
  { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
  {
    id: 'favorite',
    label: props.track && player.isFavorite(props.track.id) ? 'REMOVE FROM FAVORITES' : 'ADD TO FAVORITES',
    icon: 'lucide:heart',
  },
  { id: 'ask', label: 'ASK EMO ABOUT THIS', icon: 'lucide:message-circle' },
  { id: 'similar', label: 'FIND SIMILAR', icon: 'lucide:git-compare' },
])

function onSelect(id: string) {
  if (props.track) emit('action', id, props.track)
  emit('close')
}
</script>

<template>
  <AICompanionSheet
    :open="Boolean(track)"
    :title="track?.title ?? 'TRACK'"
    close-label="Close actions"
    @close="emit('close')"
  >
    <ul class="py-1">
      <li v-for="option in options" :key="option.id">
        <button
          type="button"
          class="flex h-12 w-full items-center gap-3.5 px-4 text-left ai-press focus-ring-ai hover:bg-ai-muted"
          :aria-label="option.label"
          @click="onSelect(option.id)"
        >
          <UIcon :name="option.icon" class="h-4 w-4 shrink-0 text-ai-fg-muted" />
          <span class="truncate text-small font-semibold tracking-[0.08em] text-ai-fg">{{ option.label }}</span>
        </button>
      </li>
    </ul>
  </AICompanionSheet>
</template>
