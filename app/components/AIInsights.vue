<script setup lang="ts">
// ============================================================
// AIInsights — YOUR MUSIC PROFILE
// Genres · moods · patterns · energy · focus · trends
// ============================================================

import {
  topGenres,
  topMoods,
  listeningPattern,
  energyScore,
  focusScore,
  recentTrends,
} from '~/data/ai'
import { useAIInsightsData } from '~/composables/useAIInsightsData'

const { aiRecommendations } = useAIInsightsData()
const { stats } = useMusicLibrary()
const player = usePlayer()

const profileNumbers = computed(() => [
  { label: 'TRACKS', value: stats().tracks.toLocaleString() },
  { label: 'ALBUMS', value: stats().albums.toLocaleString() },
  { label: 'ARTISTS', value: stats().artists.toLocaleString() },
  { label: 'FAVORITES', value: String(player.favorites.value.size) },
])

function rankColor(i: number): string {
  return i === 0 ? 'bg-ai-primary' : i === 1 ? 'bg-ai-secondary' : 'bg-ai-accent/70'
}
</script>

<template>
  <div class="sys-container pt-8 md:pt-10 pb-16">
    <p class="label-ai">YOUR MUSIC PROFILE</p>
    <h1 class="mt-3 text-display font-bold tracking-tight text-ai-fg">INSIGHTS</h1>
    <p class="mt-2 text-lead text-ai-fg-muted max-w-[52ch]">
      Derived from your listening — energy, mood, patterns and the recommendations that follow.
    </p>

    <!-- profile numbers -->
    <div class="mt-8 grid grid-cols-2 sm:grid-cols-4 border border-ai-line bg-ai-surface/50">
      <div v-for="n in profileNumbers" :key="n.label" class="p-5 border-r border-ai-line last:border-r-0">
        <p class="text-display font-bold tnum text-ai-fg">{{ n.value }}</p>
        <p class="label text-ai-fg-faint">{{ n.label }}</p>
      </div>
    </div>

    <div class="mt-8 grid lg:grid-cols-2 gap-6">
      <!-- top genres -->
      <section class="ai-panel p-5" aria-label="Top genres">
        <p class="label-ai mb-5">TOP GENRES</p>
        <ul class="space-y-4">
          <li v-for="(g, i) in topGenres" :key="g.id">
            <div class="flex items-baseline justify-between mb-1.5">
              <span class="text-[12px] font-semibold tracking-[0.12em] text-ai-fg">{{ g.label }}</span>
              <span class="tnum text-[11px] text-ai-fg-muted">{{ g.value }}</span>
            </div>
            <Meter :value="Number(g.value.replace('%', ''))" :color="rankColor(i)" ai />
          </li>
        </ul>
      </section>

      <!-- top moods -->
      <section class="ai-panel p-5" aria-label="Top moods">
        <p class="label-ai mb-5">TOP MOODS</p>
        <ul class="space-y-4">
          <li v-for="(m, i) in topMoods" :key="m.id">
            <div class="flex items-baseline justify-between mb-1.5">
              <span class="text-[12px] font-semibold tracking-[0.12em] text-ai-fg">{{ m.label }}</span>
              <span class="tnum text-[11px] text-ai-fg-muted">{{ m.value }}</span>
            </div>
            <Meter :value="Number(m.value.replace('%', ''))" :color="i === 0 ? 'bg-ai-accent' : 'bg-ai-secondary'" ai />
          </li>
        </ul>
      </section>
    </div>

    <div class="mt-6 grid lg:grid-cols-2 gap-6">
      <!-- listening patterns: 24h bars -->
      <section class="ai-panel p-5" aria-label="Listening patterns">
        <div class="flex items-baseline justify-between mb-5">
          <p class="label-ai">LISTENING PATTERNS</p>
          <span class="label text-ai-fg-faint">24H · LOCAL</span>
        </div>
        <div class="flex items-end gap-[3px] h-28" role="img" aria-label="Listening intensity by hour">
          <div
            v-for="(v, i) in listeningPattern"
            :key="i"
            class="flex-1 min-w-0 t-all hover:opacity-100"
            :class="v > 60 ? 'bg-ai-primary' : 'bg-ai-primary/30'"
            :style="{ height: v + '%' }"
            :title="`${String(i).padStart(2, '0')}:00 — ${v}%`"
          />
        </div>
        <div class="flex justify-between mt-2 text-[9px] font-bold tracking-[0.12em] text-ai-fg-faint tnum">
          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
        </div>
        <p class="mt-4 text-[11px] text-ai-fg-faint leading-relaxed">
          PEAK 22:00 — NIGHT LISTENER PROFILE CONFIRMED.
        </p>
      </section>

      <!-- energy & focus -->
      <section class="ai-panel p-5" aria-label="Energy and focus">
        <p class="label-ai mb-5">ENERGY · FOCUS</p>
        <div class="space-y-5">
          <div>
            <div class="flex items-baseline justify-between mb-1.5">
              <span class="text-[12px] font-semibold tracking-[0.12em] text-ai-fg">{{ energyScore.label }}</span>
              <span class="tnum text-lead font-bold text-ai-cyan">{{ energyScore.value }}</span>
            </div>
            <Meter :value="Number(energyScore.value)" color="bg-ai-cyan" ai />
            <p class="text-[10px] text-ai-fg-faint mt-1">{{ energyScore.sub }}</p>
          </div>
          <div>
            <div class="flex items-baseline justify-between mb-1.5">
              <span class="text-[12px] font-semibold tracking-[0.12em] text-ai-fg">{{ focusScore.label }}</span>
              <span class="tnum text-lead font-bold text-ai-primary">{{ focusScore.value }}</span>
            </div>
            <Meter :value="Number(focusScore.value)" color="bg-ai-primary" ai />
            <p class="text-[10px] text-ai-fg-faint mt-1">{{ focusScore.sub }}</p>
          </div>
        </div>
      </section>
    </div>

    <!-- trends -->
    <section class="mt-6 ai-panel p-5" aria-label="Recent trends">
      <p class="label-ai mb-4">RECENT TRENDS</p>
      <ul class="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-ai-line">
        <li v-for="t in recentTrends" :key="t.id" class="bg-ai-surface p-4">
          <p class="tnum text-h2 font-bold text-ai-accent">{{ t.value }}</p>
          <p class="mt-1 text-[12px] font-bold tracking-[0.12em] text-ai-fg">{{ t.label }}</p>
          <p class="text-[10px] text-ai-fg-faint mt-0.5">{{ t.sub }}</p>
        </li>
      </ul>
    </section>

    <!-- recommendations -->
    <section class="mt-10">
      <div class="flex items-end justify-between border-b border-ai-line pb-3">
        <p class="label-ai">AI RECOMMENDATIONS</p>
        <span class="label text-ai-fg-faint">BUILT FOR YOU</span>
      </div>
      <div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AIRecommendationCard
          v-for="rec in aiRecommendations"
          :key="rec.id"
          :rec="rec"
          @open="navigateTo(`/playlists/${rec.id.replace('rec-', 'pl-')}`)"
        />
      </div>
    </section>
  </div>
</template>
