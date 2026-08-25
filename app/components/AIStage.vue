<script setup lang="ts">
// ============================================================
// AIStage — wrapper for all Intelligence pages.
// Near-black surfaces, violet/magenta accents, controlled
// glow and grid-fade atmosphere — while preserving SYSTEMA's
// grid, spacing, typography and alignment discipline.
// ============================================================

import { useSettingsStore } from '~/stores/settings'

const route = useRoute()
const settings = useSettingsStore()

const tabs = [
  { label: 'STUDIO', to: '/ai' },
  { label: 'SEARCH', to: '/ai/search' },
  { label: 'GENERATE', to: '/ai/generate' },
  { label: 'INSIGHTS', to: '/ai/insights' },
]

function isActive(to: string): boolean {
  if (to === '/ai') return route.path === '/ai'
  return route.path === to
}
</script>

<template>
  <div class="ai-aurora relative min-h-[calc(100dvh-56px)] lg:min-h-dvh text-ai-fg" :data-ai="true">
    <!-- atmospheric grid fade -->
    <div class="pointer-events-none absolute inset-0 ai-grid-fade" aria-hidden="true" />

    <div class="relative">
      <!-- intelligence header -->
      <div class="sys-container pt-6 md:pt-8">
        <div class="flex items-baseline justify-between gap-6 border-b border-ai-line pb-4">
          <span class="label text-ai-fg-faint">INTELLIGENCE — SYSTEMA AI CORE</span>
          <span class="label text-ai-fg-muted hidden sm:block">LOCAL INFERENCE · MOCK ENGINE</span>
        </div>
        <nav class="flex gap-6 mt-5 overflow-x-auto no-scrollbar" aria-label="Intelligence sections">
          <NuxtLink
            v-for="t in tabs"
            :key="t.to"
            :to="t.to"
            class="shrink-0 pb-2 text-[12px] font-bold tracking-[0.18em] uppercase t-col focus-ring"
            :class="isActive(t.to) ? 'text-ai-fg border-b-2 border-ai-primary' : 'text-ai-fg-faint hover:text-ai-fg-muted'"
            :aria-current="isActive(t.to) ? 'page' : undefined"
          >
            {{ t.label }}
          </NuxtLink>
        </nav>
      </div>

      <div v-if="!settings.ai.enabled" class="sys-container mt-6">
        <div class="border border-ai-line bg-ai-muted px-4 py-4">
          <p class="label text-ai-fg-faint">AI FEATURES DISABLED</p>
          <p class="mt-2 text-small text-ai-fg-muted max-w-[56ch]">
            Intelligence interactions are off. Stored analysis is kept.
            Re-enable from Settings → AI.
          </p>
          <NuxtLink to="/settings/ai" class="ai-btn-outline mt-4">OPEN AI SETTINGS</NuxtLink>
        </div>
      </div>

      <slot />
    </div>
  </div>
</template>
