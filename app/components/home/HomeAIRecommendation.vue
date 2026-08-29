<script setup lang="ts">
import type { Track, TrackMood } from '~/types'
import { useLibraryStore } from '~/stores/library'

const libraryStore = useLibraryStore()
const { recentlyPlayed } = usePlaybackHistory()
const { playQueue } = usePlayer()

const libraryTracks = computed(() => libraryStore.tracks)
const recentBehavior = computed(() => recentlyPlayed(12))

const dominantMood = computed<TrackMood>(() => {
  const counts = new Map<TrackMood, number>()
  for (const track of recentBehavior.value) {
    counts.set(track.mood, (counts.get(track.mood) ?? 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'focused'
})

const averageEnergy = computed(() => {
  if (!recentBehavior.value.length) return 50
  return recentBehavior.value.reduce((total, track) => total + track.energy, 0) / recentBehavior.value.length
})

const title = computed(() => {
  if (averageEnergy.value >= 78) return 'INTENSE WORKOUT'
  switch (dominantMood.value) {
    case 'dark': return 'NIGHT DRIVE'
    case 'dreamy': return 'LATE NIGHT'
    case 'calm': return 'LOW ENERGY'
    case 'melancholic': return 'LATE NIGHT'
    case 'energetic': return 'FUNCTIONAL BEATS'
    default: return 'DEEP FOCUS'
  }
})

const purpose = computed(() => {
  switch (title.value) {
    case 'INTENSE WORKOUT': return 'high-energy movement'
    case 'NIGHT DRIVE': return 'after-dark listening'
    case 'LATE NIGHT': return 'quiet late hours'
    case 'LOW ENERGY': return 'a slower pace'
    case 'DEEP FOCUS': return 'sustained concentration'
    default: return 'focused work'
  }
})

function recommendationScore(track: Track) {
  const moodMatch = track.mood === dominantMood.value ? 100 : 0
  const instrumental = track.lang === 'inst' ? 20 : 0
  const energyDistance = 100 - Math.abs(track.energy - averageEnergy.value)
  return moodMatch + instrumental + energyDistance + (track.plays || 0) / 1000
}

const recommendationTracks = computed(() =>
  [...libraryTracks.value]
    .sort((a, b) => recommendationScore(b) - recommendationScore(a))
    .slice(0, 18),
)

function playRecommendation() {
  if (!recommendationTracks.value.length) return
  playQueue(recommendationTracks.value)
}
</script>

<template>
  <section class="h-full border border-line bg-primary-muted p-5 md:p-6 flex flex-col" aria-labelledby="home-ai-title">
    <p class="label text-primary tnum">AI / 01</p>

    <div class="mt-6 flex-1">
      <h2 id="home-ai-title" class="text-h2 font-semibold text-fg">
        {{ title }}
      </h2>
      <p class="mt-2 text-small text-fg-muted">
        <template v-if="recommendationTracks.length">
          {{ recommendationTracks.length }} tracks selected<br>
          for {{ purpose }}.
        </template>
        <template v-else>
          Ready for your device music library.<br>
          Scan your music to activate recommendations.
        </template>
      </p>
    </div>

    <div class="mt-6 pt-4 hairline-t flex items-center gap-2">
      <button
        type="button"
        class="sys-btn-primary"
        :disabled="!recommendationTracks.length"
        :aria-label="`Play AI recommendation ${title}`"
        @click="playRecommendation"
      >
        PLAY →
      </button>
      <NuxtLink to="/ai/insights" class="sys-btn-ghost">
        VIEW
      </NuxtLink>
    </div>
  </section>
</template>
