<script setup lang="ts">
// ============================================================
// AICompanionResult — one ranked track row
// ============================================================
// Artwork · title · artist · match % · play · three-dot menu.
// Playback goes straight to the shared player store — this
// component holds no playback state of its own.
// ============================================================

import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'

const props = defineProps<{
  track: Track
  artist: string
  cover?: string
  /** 0–100 mock confidence. */
  match: number
  index?: number
}>()

const emit = defineEmits<{
  play: [track: Track]
  menu: [track: Track]
}>()

const player = usePlayerStore()

const isCurrent = computed(() => player.currentTrack?.id === props.track.id)
const isPlayingThis = computed(() => isCurrent.value && player.isPlaying)

const playLabel = computed(() =>
  isPlayingThis.value
    ? `Pause ${props.track.title}`
    : `Play recommendation ${props.track.title} by ${props.artist}`,
)

function onPlay() {
  if (isCurrent.value) player.togglePlay()
  else emit('play', props.track)
}
</script>

<template>
  <article
    class="ai-rise grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-ai-line px-3 py-2.5 last:border-b-0 transition-colors duration-160 ease-sys"
    :class="isCurrent ? 'bg-ai-muted' : 'hover:bg-ai-surface'"
    :style="index !== undefined ? { animationDelay: `${Math.min(index, 8) * 60}ms` } : undefined"
  >
    <!-- artwork + now-playing marker -->
    <div class="relative h-11 w-11 shrink-0 overflow-hidden">
      <Artwork :src="cover" :alt="`${track.title} artwork`" :seed="track.id" class="h-11 w-11" />
      <span
        v-if="isPlayingThis"
        class="absolute inset-0 grid place-items-center bg-ai-veil"
        aria-hidden="true"
      >
        <UIcon name="lucide:audio-lines" class="h-4.5 w-4.5 animate-pulse text-ai-primary" />
      </span>
    </div>

    <!-- title + artist + match -->
    <div class="flex min-w-0 flex-col gap-0.5">
      <span
        class="truncate text-body font-semibold"
        :class="isCurrent ? 'text-ai-primary' : 'text-ai-fg'"
      >{{ track.title }}</span>
      <span class="truncate text-small text-ai-fg-muted">{{ artist }}</span>
      <span
        class="text-micro font-bold tabular-nums tracking-[0.06em] text-ai-secondary"
        :aria-label="`${match} percent match`"
      >{{ match }}% match</span>
    </div>

    <!-- controls -->
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="ai-icon-btn h-10 w-10 border-transparent bg-transparent"
        :class="isCurrent ? 'text-ai-primary' : ''"
        :aria-label="playLabel"
        @click="onPlay"
      >
        <UIcon :name="isPlayingThis ? 'lucide:pause' : 'lucide:play'" class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="ai-icon-btn h-10 w-10 border-transparent bg-transparent"
        :aria-label="`More actions for ${track.title}`"
        @click="emit('menu', track)"
      >
        <UIcon name="lucide:ellipsis" class="h-4.5 w-4.5" />
      </button>
    </div>
  </article>
</template>
