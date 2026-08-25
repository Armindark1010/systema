<script setup lang="ts">
// SearchResult — generic result row (album / artist / playlist)
import type { SearchResultType } from '~/types'

const props = defineProps<{
  type: SearchResultType
  title: string
  subtitle: string
  meta?: string
  ai?: boolean
}>()

const icons: Record<string, string> = {
  album: 'lucide:disc-3',
  artist: 'lucide:mic-vocal',
  playlist: 'lucide:list-music',
  ai: 'lucide:sparkles',
  track: 'lucide:music-2',
}
</script>

<template>
  <button
    class="w-full flex items-center gap-3 h-14 px-3 text-left t-col pressable focus-ring"
    :class="ai ? 'hover:bg-ai-hover text-ai-fg' : 'hover:bg-hover text-fg'"
    :aria-label="`${type}: ${title}`"
  >
    <span
      class="w-9 h-9 shrink-0 grid place-items-center border"
      :class="ai ? 'border-ai-line bg-ai-muted text-ai-primary' : 'border-line bg-muted text-fg-muted'"
      aria-hidden="true"
    >
      <UIcon :name="icons[type] ?? 'lucide:music-2'" class="w-4 h-4" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-[13.5px] font-semibold truncate">{{ title }}</span>
      <span class="block text-[11.5px] truncate" :class="ai ? 'text-ai-fg-muted' : 'text-fg-muted'">{{ subtitle }}</span>
    </span>
    <span v-if="meta" class="tnum text-[11px] shrink-0" :class="ai ? 'text-ai-fg-faint' : 'text-fg-faint'">{{ meta }}</span>
    <UIcon name="lucide:arrow-up-right" class="w-3.5 h-3.5 shrink-0" :class="ai ? 'text-ai-fg-faint' : 'text-fg-faint'" />
  </button>
</template>
