<script setup lang="ts">
// PlaylistList — archive grid + CREATE / CREATE WITH AI tiles
import type { Playlist } from '~/types'

defineProps<{ playlists: Playlist[] }>()
const emit = defineEmits<{ create: [] }>()
</script>

<template>
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-5 gap-y-8">
    <PlaylistCard v-for="p in playlists" :key="p.id" :playlist="p" />

    <!-- create -->
    <button
      class="group t-col pressable focus-ring text-left"
      aria-label="Create playlist"
      @click="emit('create')"
    >
      <div class="aspect-square border-2 border-dashed border-line-strong grid place-items-center t-col group-hover:(border-primary text-primary) bg-surface">
        <span class="flex flex-col items-center gap-2 text-fg-muted group-hover:text-primary t-col">
          <UIcon name="lucide:plus" class="w-6 h-6" />
          <span class="text-[10px] font-bold tracking-[0.18em] uppercase">New playlist</span>
        </span>
      </div>
      <p class="mt-2.5 text-[13px] font-semibold text-fg">CREATE PLAYLIST</p>
      <p class="text-[11.5px] text-fg-muted">EMPTY — BUILD FROM THE ARCHIVE</p>
    </button>

    <!-- create with AI — the AI visual system bleeds in here -->
    <NuxtLink
      to="/ai/generate"
      class="group t-col pressable focus-ring text-left ai-panel !bg-ai-base relative overflow-hidden"
    >
      <div class="absolute inset-0 ai-grid-fade opacity-60 pointer-events-none" aria-hidden="true" />
      <div class="relative aspect-square border border-ai-line-strong grid place-items-center">
        <span class="flex flex-col items-center gap-2 text-ai-primary group-hover:(text-ai-accent) t-col">
          <UIcon name="lucide:sparkles" class="w-6 h-6 drop-shadow-[0_0_8px_var(--ai-glow)]" />
          <span class="text-[10px] font-bold tracking-[0.18em] uppercase text-ai-fg">Generate with AI</span>
        </span>
      </div>
      <p class="mt-2.5 text-[13px] font-semibold text-ai-fg">CREATE WITH AI</p>
      <p class="text-[11.5px] text-ai-fg-muted">DESCRIBE WHAT TO HEAR</p>
    </NuxtLink>
  </div>
</template>
