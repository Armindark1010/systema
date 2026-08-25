<script setup lang="ts">
import type { EmoPrototypeTrack } from '~/types/emo'

const props = defineProps<{
  track: EmoPrototypeTrack
  isPlaying: boolean
  currentTime: number
  energy: number
}>()

const emit = defineEmits<{
  previous: []
  'toggle-playback': []
  next: []
}>()

const progress = computed(() =>
  props.track.duration ? Math.min(100, (props.currentTime / props.track.duration) * 100) : 0,
)

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
</script>

<template>
  <section aria-labelledby="emo-player-title">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="label-faint">SIMULATED PLAYBACK</p>
        <h2 id="emo-player-title" class="mt-1 text-title font-semibold text-fg truncate">
          {{ track.title }}
        </h2>
        <p class="mt-1 text-small text-fg-muted">{{ track.artist }}</p>
      </div>
      <p class="text-small text-fg-muted tnum shrink-0">
        {{ formatTime(currentTime) }} / {{ formatTime(track.duration) }}
      </p>
    </div>

    <div class="mt-4 h-1 bg-muted" role="progressbar" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100">
      <span class="block h-full bg-primary t-all" :style="{ width: `${progress}%` }" />
    </div>

    <div class="mt-5 grid grid-cols-3 gap-2">
      <button type="button" class="sys-btn-ghost" aria-label="Previous simulated track" @click="emit('previous')">
        <span class="sm:hidden">PREV</span>
        <span class="hidden sm:inline">PREVIOUS</span>
      </button>
      <button
        type="button"
        class="sys-btn-primary"
        :aria-label="isPlaying ? 'Pause simulated playback' : 'Play simulated playback'"
        @click="emit('toggle-playback')"
      >
        {{ isPlaying ? 'PAUSE' : 'PLAY' }}
      </button>
      <button type="button" class="sys-btn-ghost" aria-label="Next simulated track" @click="emit('next')">
        NEXT
      </button>
    </div>

    <dl class="mt-5 grid grid-cols-3 hairline-t hairline-b">
      <div class="py-3 border-r border-line text-center">
        <dt class="label-faint">BPM</dt>
        <dd class="mt-1 text-small font-semibold text-fg tnum">{{ track.bpm }}</dd>
      </div>
      <div class="py-3 border-r border-line text-center">
        <dt class="label-faint">ENERGY</dt>
        <dd class="mt-1 text-small font-semibold text-fg tnum">{{ Math.round(energy * 100) }}%</dd>
      </div>
      <div class="py-3 text-center">
        <dt class="label-faint">MOOD</dt>
        <dd class="mt-1 text-small font-semibold text-fg">{{ track.mood }}</dd>
      </div>
    </dl>
  </section>
</template>
