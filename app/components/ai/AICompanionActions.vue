<script setup lang="ts">
// ============================================================
// AICompanionActions — compact quick actions
// ============================================================
// Each action runs a mock response inline. Nothing navigates
// away: the user stays inside the companion experience.
// ============================================================

import type { AIQuickAction } from '~/types/ai'

defineProps<{
  actions: AIQuickAction[]
  /** Actions requiring a track are disabled without one. */
  hasTrack: boolean
  busy: boolean
}>()

const emit = defineEmits<{ run: [action: AIQuickAction] }>()
</script>

<template>
  <section class="px-4" aria-label="Quick actions">
    <h2 class="ai-label mb-2">QUICK ACTIONS</h2>
    <ul class="grid grid-cols-2 gap-2">
      <li v-for="action in actions" :key="action.id">
        <button
          type="button"
          class="ai-action-chip w-full"
          :disabled="busy || (action.needsTrack && !hasTrack)"
          :aria-label="action.needsTrack && !hasTrack
            ? `${action.label} — needs a playing track`
            : action.label"
          @click="emit('run', action)"
        >
          <UIcon :name="action.icon" class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{{ action.label }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
