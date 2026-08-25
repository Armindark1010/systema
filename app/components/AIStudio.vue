<script setup lang="ts">
// ============================================================
// AIStudio — the Intelligence home: prompt → SEARCH / GENERATE
// ============================================================

import { aiSearchExamples } from '~/data/ai'
import { useAIInsightsData } from '~/composables/useAIInsightsData'

const prompt = ref('')
const { analysis } = useAI()
const { aiRecommendations } = useAIInsightsData()
const recommendations = aiRecommendations.slice(0, 4)

function goSearch() {
  navigateTo(`/ai/search?q=${encodeURIComponent(prompt.value.trim() || 'dark cinematic electronic music for a night drive')}`)
}

function goGenerate() {
  navigateTo(`/ai/generate${prompt.value.trim() ? `?q=${encodeURIComponent(prompt.value.trim())}` : ''}`)
}

function pickExample(q: string) {
  prompt.value = q
}
</script>

<template>
  <div class="sys-container pt-10 md:pt-14 pb-16">
    <!-- hero prompt -->
    <section aria-label="AI studio prompt">
      <h1 class="text-display-xl font-bold tracking-tight text-ai-fg text-balance max-w-[16ch]">
        WHAT DO YOU<br>WANT TO HEAR?
      </h1>
      <p class="mt-4 text-lead text-ai-fg-muted max-w-[56ch]">
        Describe a mood, a scene, a language — the system will search, rank and build
        playlists from your archive.
      </p>

      <div class="mt-8 max-w-[760px]">
        <label class="block">
          <span class="sr-only">Describe what you want to hear</span>
          <div class="relative">
            <UIcon name="lucide:sparkles" class="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-ai-primary pointer-events-none" />
            <input
              v-model="prompt"
              type="text"
              class="w-full h-14 pl-11 pr-4 bg-ai-surface/80 border border-ai-line-strong text-lead text-ai-fg placeholder:text-ai-fg-faint shadow-ai-1 focus:(border-ai-primary shadow-ai-glow) t-all outline-none"
              placeholder="“dark cinematic electronic music for a night drive”"
              @keydown.enter="goSearch"
            >
          </div>
        </label>
        <div class="mt-4 flex flex-wrap gap-3">
          <button class="ai-btn-primary" @click="goSearch">
            <UIcon name="lucide:search" class="w-4 h-4" /> SEARCH
          </button>
          <button class="ai-btn-outline" @click="goGenerate">
            <UIcon name="lucide:wand-2" class="w-4 h-4" /> GENERATE PLAYLIST
          </button>
        </div>
      </div>

      <!-- examples -->
      <div class="mt-10">
        <p class="label-ai mb-3">TRY</p>
        <ul class="flex flex-wrap gap-2">
          <li v-for="ex in aiSearchExamples" :key="ex.label">
            <button class="ai-chip" :lang="ex.lang === 'fa' ? 'fa' : undefined" @click="pickExample(ex.query)">
              {{ ex.label }}
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- analysis strip -->
    <AIAnalysis class="mt-14" @start="analysis.start()" />

    <!-- insights teaser -->
    <section class="mt-14">
      <div class="flex items-end justify-between border-b border-ai-line pb-3">
        <p class="label-ai">INSIGHTS</p>
        <NuxtLink to="/ai/insights" class="label text-ai-fg-muted hover:text-ai-fg t-col focus-ring py-1">OPEN INSIGHTS →</NuxtLink>
      </div>
      <div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AIRecommendationCard
          v-for="rec in recommendations"
          :key="rec.id"
          :rec="rec"
          @open="navigateTo('/ai/insights')"
        />
      </div>
    </section>
  </div>
</template>
