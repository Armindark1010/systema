<script setup lang="ts">
// ============================================================
// AICompanionForYou — mock recommendation sections
// ============================================================
// Swiss editorial grouping: a hairline heading, a one-line
// rationale, then ranked rows. No cards inside cards.
// ============================================================

import type { Track } from '~/types'
import type { AIForYouSection } from '~/types/ai'

defineProps<{ sections: AIForYouSection[] }>()

const emit = defineEmits<{
  play: [track: Track]
  menu: [track: Track]
}>()

const { resolve } = useAICompanion()
</script>

<template>
  <section class="px-4" aria-labelledby="ai-for-you-heading">
    <div class="flex items-baseline justify-between gap-3 border-b border-ai-line-strong pb-2.5">
      <h2 id="ai-for-you-heading" class="text-title font-bold tracking-[0.02em] text-ai-fg">FOR YOU</h2>
      <span class="ai-label">MOCK RANKING</span>
    </div>

    <div class="mt-5 flex flex-col gap-7">
      <article v-for="section in sections" :key="section.id">
        <header class="mb-2">
          <h3 class="ai-label-strong">{{ section.label }}</h3>
          <p class="mt-1 text-small text-ai-fg-muted">{{ section.description }}</p>
        </header>

        <div class="ai-card">
          <AICompanionResult
            v-for="(result, i) in resolve(section.items)"
            :key="result.track.id"
            :track="result.track"
            :artist="result.artist"
            :cover="result.cover"
            :match="result.match"
            :index="i"
            @play="emit('play', $event)"
            @menu="emit('menu', $event)"
          />
        </div>
      </article>
    </div>
  </section>
</template>
