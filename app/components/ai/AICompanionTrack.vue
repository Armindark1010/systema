<script setup lang="ts">
// ============================================================
// AICompanionTrack — CURRENT TRACK + mock AI ANALYSIS
// ============================================================
// Reads the now-playing track from the shared player store and
// renders a mock analysis row. Nothing here is real analysis —
// the panel says so, honestly, in its own header.
// ============================================================

import type { Track } from '~/types'
import type { AITrackInsight } from '~/types/ai'

defineProps<{
  track: Track
  artist: string
  cover?: string
  insight: AITrackInsight
  busy: boolean
}>()

const emit = defineEmits<{
  ask: []
  analyze: []
}>()
</script>

<template>
  <section class="px-4" aria-labelledby="ai-current-track-heading">
    <div class="flex items-baseline justify-between gap-3 border-b border-ai-line-strong pb-2.5">
      <h2 id="ai-current-track-heading" class="text-title font-bold tracking-[0.02em] text-ai-fg">
        CURRENT TRACK
      </h2>
      <span class="ai-label">MOCK ANALYSIS</span>
    </div>

    <!-- now playing -->
    <div class="mt-4 flex items-center gap-3">
      <Artwork :src="cover" :alt="`${track.title} artwork`" :seed="track.id" class="h-16 w-16 shrink-0" />
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-lead font-semibold text-ai-fg">{{ track.title }}</span>
        <span class="truncate text-small text-ai-fg-muted">{{ artist }}</span>
      </div>
    </div>

    <!-- analysis grid -->
    <h3 class="mt-5 ai-label">AI ANALYSIS</h3>
    <dl class="mt-2 grid grid-cols-2 border border-ai-line">
      <div class="border-b border-r border-ai-line px-3 py-2.5">
        <dt class="ai-label">MOOD</dt>
        <dd class="mt-1 ai-value">{{ insight.mood }}</dd>
      </div>
      <div class="border-b border-ai-line px-3 py-2.5">
        <dt class="ai-label">ENERGY</dt>
        <dd class="mt-1 ai-value tnum">{{ insight.energy }}%</dd>
        <div class="mt-2 h-[3px] w-full bg-ai-hover" role="presentation">
          <div class="h-full bg-ai-primary" :style="{ width: `${insight.energy}%` }" />
        </div>
      </div>
      <div class="border-b border-r border-ai-line px-3 py-2.5">
        <dt class="ai-label">TEMPO</dt>
        <dd class="mt-1 ai-value tnum">{{ insight.tempo }} BPM</dd>
      </div>
      <div class="border-b border-ai-line px-3 py-2.5">
        <dt class="ai-label">GENRE</dt>
        <dd class="mt-1 truncate ai-value">{{ insight.genre }}</dd>
      </div>
      <div class="col-span-2 px-3 py-2.5">
        <dt class="ai-label">ATMOSPHERE</dt>
        <dd class="mt-1 ai-value">{{ insight.atmosphere }}</dd>
      </div>
    </dl>

    <!-- companion entry points -->
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="inline-flex h-11 flex-1 items-center justify-center gap-2 bg-ai-primary px-4 text-micro font-bold uppercase tracking-[0.12em] text-white ai-press focus-ring-ai hover:bg-ai-secondary disabled:(bg-ai-muted text-ai-fg-faint pointer-events-none)"
        :disabled="busy"
        aria-label="Ask EMO about this track"
        @click="emit('ask')"
      >
        <UIcon name="lucide:message-circle" class="h-4 w-4" />
        ASK EMO ABOUT THIS TRACK
      </button>
      <button
        type="button"
        class="ai-action-chip h-11 px-4"
        :disabled="busy"
        aria-label="Analyze current track"
        @click="emit('analyze')"
      >
        <UIcon name="lucide:activity" class="h-3.5 w-3.5" />
        ANALYZE
      </button>
    </div>
  </section>
</template>
