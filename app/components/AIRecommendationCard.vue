<script setup lang="ts">
// AIRecommendationCard — glowing AI playlist tile
import type { AIRecommendation } from '~/types'

const props = withDefaults(defineProps<{ rec: AIRecommendation; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <article class="group relative ai-panel t-all pressable focus-ring-ai hover:(border-ai-primary shadow-ai-glow) overflow-hidden">
    <div class="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-ai-primary/20 blur-3xl opacity-0 group-hover:opacity-100 t-all" aria-hidden="true" />
    <button class="relative block w-full text-left" :aria-label="`Open ${rec.title}`" @click="emit('open')">
      <div class="relative">
        <Artwork :src="rec.cover" :alt="rec.title" :seed="rec.id" rounded />
        <span class="absolute right-2 bottom-2 w-8 h-8 grid place-items-center bg-ai-primary text-white opacity-0 translate-y-1 group-hover:(opacity-100 translate-y-0) t-all">
          <UIcon name="lucide:arrow-up-right" class="w-4 h-4" />
        </span>
      </div>
      <div class="mt-3">
        <p class="text-[13px] font-bold tracking-wide text-ai-fg truncate">{{ rec.title }}</p>
        <p class="mt-0.5 text-[11.5px] text-ai-fg-muted leading-snug line-clamp-2">{{ rec.description }}</p>
        <p class="mt-2 text-[9.5px] font-bold tracking-[0.16em] text-ai-fg-faint uppercase tnum">
          {{ rec.trackCount }} TRACKS · {{ rec.tags.join(' · ') }}
        </p>
      </div>
    </button>
  </article>
</template>
