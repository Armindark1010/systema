<script setup lang="ts">
// ============================================================
// AICompanionStatus — subtle honest status strip
// ============================================================
// Deliberately does NOT claim a local model is running. The
// engine badge says MOCK ENGINE until the native runtime lands.
// ============================================================

import type { AICompanionStatus } from '~/types/ai'

const props = defineProps<{
  status: AICompanionStatus
  engine: string
  analyzedTracks: number
}>()

const dotClass = computed(() => {
  switch (props.status) {
    case 'listening': return 'bg-ai-cyan'
    case 'thinking': return 'bg-ai-accent'
    case 'responding': return 'bg-ai-primary'
    default: return 'bg-ai-primary'
  }
})

const stateLabel = computed(() => {
  switch (props.status) {
    case 'listening': return 'LISTENING'
    case 'thinking': return 'THINKING'
    case 'responding': return 'RESPONDING'
    default: return 'AI READY'
  }
})

const analyzedLabel = computed(() => `ANALYZED ${props.analyzedTracks.toLocaleString('en-US')} TRACKS`)
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4"
    role="status"
    aria-live="polite"
  >
    <span class="inline-flex items-center gap-2">
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-3"
        :class="[dotClass, status !== 'idle' ? 'animate-pulse' : '']"
        aria-hidden="true"
      />
      <span class="ai-label-strong">{{ stateLabel }}</span>
    </span>

    <span class="h-3 w-px bg-ai-line-strong" aria-hidden="true" />
    <span class="ai-label">{{ engine }}</span>

    <span class="h-3 w-px bg-ai-line-strong" aria-hidden="true" />
    <span class="ai-label tnum">{{ analyzedLabel }}</span>
  </div>
</template>
