<script setup lang="ts">
// ============================================================
// AICompanionStage — EMO in the companion context
// ============================================================
// Reuses the existing <EmoCompanion> character verbatim (its
// headphones, face and motion system are untouched); only the
// surrounding halo, scale and copy belong to this page.
// ============================================================

import type { EmoExpression } from '~/types/emo'
import type { AICompanionStatus } from '~/types/ai'

const props = defineProps<{
  status: AICompanionStatus
  expression: EmoExpression
  line: string
  /** Compact mode once a conversation is running. */
  compact?: boolean
}>()

const emit = defineEmits<{ tap: [] }>()

const isActive = computed(() => props.status !== 'idle')
</script>

<template>
  <section
    class="relative flex flex-col items-center"
    :class="compact ? 'pt-4 pb-2' : 'pt-6 pb-3'"
    aria-label="EMO companion"
  >
    <!-- controlled glow: one soft pool behind EMO, nothing else -->
    <div
      class="ai-companion-halo pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      :class="[
        compact ? 'h-40 w-40' : 'h-64 w-64',
        isActive ? 'ai-pulse-glow' : 'opacity-45',
      ]"
      aria-hidden="true"
    />

    <div
      class="ai-companion-emo relative flex justify-center"
      :class="compact ? 'ai-companion-emo--compact' : ''"
    >
      <EmoCompanion
        :expression="expression"
        :is-thinking="status === 'thinking'"
        :message="line"
        @tap="emit('tap')"
      />
    </div>
  </section>
</template>
