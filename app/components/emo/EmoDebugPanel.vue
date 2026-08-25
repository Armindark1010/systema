<script setup lang="ts">
import type { EmoExpression, EmoMusicState, EmoPrototypeTrack } from '~/types/emo'
import { emoExpressionOptions } from '~/data/emo'

const props = defineProps<{
  expression: EmoExpression
  musicState: EmoMusicState
  track: EmoPrototypeTrack
  isPlaying: boolean
  energy: number
}>()

const emit = defineEmits<{
  'update:expression': [expression: EmoExpression]
  'update:energy': [energy: number]
  'toggle-playback': []
}>()

const energyPercent = computed({
  get: () => Math.round(props.energy * 100),
  set: (value: number) => emit('update:energy', value / 100),
})
</script>

<template>
  <aside aria-labelledby="emo-debug-title">
    <header class="hairline-b pb-4">
      <p class="label-faint">PROTOTYPE CONTROL</p>
      <h2 id="emo-debug-title" class="mt-1 text-title font-semibold text-fg">EMO DEBUG</h2>
    </header>

    <section class="mt-5" aria-labelledby="emo-expression-controls">
      <h3 id="emo-expression-controls" class="label-muted">EXPRESSION</h3>
      <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
        <button
          v-for="option in emoExpressionOptions"
          :key="option.value"
          type="button"
          class="px-3 py-2 border text-micro font-semibold tracking-wide text-left pressable focus-ring"
          :class="expression === option.value
            ? 'border-primary bg-primary-muted text-primary'
            : 'border-line bg-surface text-fg-muted hover:bg-hover hover:text-fg'"
          :aria-pressed="expression === option.value"
          @click="emit('update:expression', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section class="mt-6" aria-labelledby="emo-music-debug">
      <div class="flex items-center justify-between gap-4">
        <h3 id="emo-music-debug" class="label-muted">MUSIC</h3>
        <button type="button" class="sys-btn-outline" @click="emit('toggle-playback')">
          {{ isPlaying ? 'PAUSE' : 'PLAY' }}
        </button>
      </div>

      <dl class="mt-4 hairline-t">
        <div class="py-2 hairline-b flex items-start justify-between gap-4">
          <dt class="label-faint">TRACK</dt>
          <dd class="text-small font-semibold text-fg text-right">{{ track.title }}</dd>
        </div>
        <div class="py-2 hairline-b flex items-center justify-between gap-4">
          <dt class="label-faint">STATE</dt>
          <dd class="label text-fg tnum">{{ musicState }}</dd>
        </div>
        <div class="py-2 hairline-b flex items-center justify-between gap-4">
          <dt class="label-faint">EXPRESSION</dt>
          <dd class="label text-fg">{{ expression }}</dd>
        </div>
        <div class="py-2 hairline-b flex items-center justify-between gap-4">
          <dt class="label-faint">BPM</dt>
          <dd class="text-small text-fg tnum">{{ track.bpm }}</dd>
        </div>
        <div class="py-2 hairline-b flex items-center justify-between gap-4">
          <dt class="label-faint">ENERGY</dt>
          <dd class="text-small text-fg tnum">{{ energyPercent }}%</dd>
        </div>
        <div class="py-2 hairline-b flex items-center justify-between gap-4">
          <dt class="label-faint">MOOD</dt>
          <dd class="label text-fg">{{ track.mood }}</dd>
        </div>
      </dl>

      <div class="mt-5">
        <div class="flex items-center justify-between gap-4">
          <label for="emo-energy" class="label-muted">ENERGY LEVEL</label>
          <span class="label-faint tnum">{{ energyPercent }}</span>
        </div>
        <USlider
          id="emo-energy"
          v-model="energyPercent"
          :min="0"
          :max="100"
          :step="1"
          size="sm"
          class="mt-3"
          aria-label="Simulated music energy"
        />
      </div>
    </section>
  </aside>
</template>
