<script setup lang="ts">
// ============================================================
// AISearch — semantic search experience with staged states:
// UNDERSTANDING REQUEST → SEARCHING LIBRARY → RANKING RESULTS
// then BEST MATCHES with relevance.
// ============================================================

import { aiSearchExamples, aiSearchStages } from '~/data/ai'

const route = useRoute()
const ai = useAI()
const { search } = ai
const { getAlbum, getArtist } = useMusicLibrary()
const player = usePlayer()

const query = ref(String(route.query.q ?? ''))

onMounted(() => {
  if (query.value.trim()) search.run(query.value)
})

watch(() => route.query.q, (q) => {
  if (typeof q === 'string' && q !== query.value) {
    query.value = q
    search.run(q)
  }
})

function run() {
  if (!query.value.trim()) return
  search.run(query.value.trim())
}

function pickExample(q: string) {
  query.value = q
  search.run(q)
}

function playResult(track: { id: string }) {
  const full = search.results.value.find((r) => r.track.id === track.id)
  if (full) player.playTrack(full.track, 'AI SEARCH')
}
</script>

<template>
  <div class="sys-container pt-8 md:pt-10 pb-16">
    <!-- prompt -->
    <section aria-label="AI search">
      <p class="label-ai">SEMANTIC SEARCH</p>
      <div class="mt-3 max-w-[760px]">
        <label class="block">
          <span class="sr-only">Describe what you want to hear</span>
          <div class="relative">
            <UIcon name="lucide:sparkles" class="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-ai-primary pointer-events-none" />
            <input
              v-model="query"
              type="text"
              class="w-full h-14 pl-11 pr-4 bg-ai-surface/80 border border-ai-line-strong text-lead text-ai-fg placeholder:text-ai-fg-faint shadow-ai-1 focus:(border-ai-primary shadow-ai-glow) t-all outline-none"
              placeholder="“یه آهنگ غمگین فارسی برای شب”"
              @keydown.enter="run"
            >
          </div>
        </label>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button class="ai-btn-primary" :disabled="!query.trim() || search.phase.value === 'understanding' || search.phase.value === 'searching' || search.phase.value === 'ranking'" @click="run">
            <UIcon name="lucide:search" class="w-4 h-4" /> SEARCH
          </button>
          <NuxtLink to="/ai/generate" class="ai-btn-ghost">
            <UIcon name="lucide:wand-2" class="w-4 h-4" /> GENERATE PLAYLIST
          </NuxtLink>
        </div>
      </div>

      <ul class="mt-6 flex flex-wrap gap-2">
        <li v-for="ex in aiSearchExamples" :key="ex.label">
          <button class="ai-chip" :lang="ex.lang === 'fa' ? 'fa' : undefined" @click="pickExample(ex.query)">
            {{ ex.label }}
          </button>
        </li>
      </ul>
    </section>

    <!-- staged processing -->
    <section v-if="search.phase.value !== 'idle' && search.phase.value !== 'done'" class="mt-10 max-w-[560px]" aria-live="polite">
      <p class="label-ai mb-4">PROCESSING</p>
      <ol class="space-y-3">
        <li
          v-for="(stage, i) in aiSearchStages"
          :key="stage.key"
          class="flex items-center gap-3 t-all"
          :class="i <= search.stageIndex.value ? 'opacity-100' : 'opacity-30'"
        >
          <span
            class="w-6 h-6 shrink-0 grid place-items-center border text-[10px] font-bold tnum"
            :class="i < search.stageIndex.value ? 'border-ai-primary text-ai-primary' : i === search.stageIndex.value ? 'border-ai-primary text-ai-fg bg-ai-primary/20' : 'border-ai-line text-ai-fg-faint'"
          >
            {{ i < search.stageIndex.value ? '✓' : String(i + 1).padStart(2, '0') }}
          </span>
          <span class="text-[12px] font-bold tracking-[0.16em] text-ai-fg">{{ stage.label }}</span>
          <UIcon v-if="i === search.stageIndex.value" name="lucide:loader-circle" class="w-3.5 h-3.5 text-ai-primary animate-spin ml-auto" />
        </li>
      </ol>
      <div class="mt-6 max-w-[420px]">
        <Meter :value="search.progress.value" label="ENGINE LOAD" color="bg-ai-primary" ai />
      </div>
    </section>

    <!-- results -->
    <section v-if="search.phase.value === 'done'" class="mt-10" aria-live="polite">
      <div class="flex items-end justify-between border-b border-ai-line pb-3">
        <div>
          <p class="label-ai">BEST MATCHES</p>
          <p class="mt-1 text-small text-ai-fg-muted max-w-[52ch]">“{{ search.query.value }}” — ranked by semantic relevance.</p>
        </div>
        <span class="label text-ai-fg-faint tnum">{{ search.results.value.length }} RESULTS</span>
      </div>

      <ul class="mt-4 border border-ai-line divide-y divide-ai-line bg-ai-surface/50">
        <li
          v-for="(r, i) in search.results.value"
          :key="r.track.id"
          class="flex items-center gap-4 px-3 py-3 t-all hover:bg-ai-muted"
          :class="player.currentTrack.value?.id === r.track.id ? 'bg-ai-muted' : ''"
        >
          <span class="tnum text-[11px] text-ai-fg-faint w-5 shrink-0 text-right">{{ String(i + 1).padStart(2, '0') }}</span>
          <Artwork :src="getAlbum(r.track.albumId)?.cover" :alt="r.track.title" class="w-10 h-10 shrink-0" :seed="r.track.id" />
          <div class="min-w-0 flex-1">
            <p class="text-[13.5px] font-semibold text-ai-fg truncate">{{ r.track.title }}</p>
            <p class="text-[11.5px] text-ai-fg-muted truncate">{{ getArtist(r.track.artistId)?.name }}</p>
          </div>
          <div class="hidden sm:block w-36 shrink-0">
            <Meter :value="r.match" label="MATCH" color="bg-ai-primary" ai />
          </div>
          <span class="tnum text-[11px] text-ai-fg-faint w-8 shrink-0 hidden sm:block text-right">{{ r.match }}%</span>
          <button
            class="ai-btn-ghost !h-8 !w-8 !p-0 shrink-0"
            :aria-label="`Play ${r.track.title}`"
            @click="playResult(r.track)"
          >
            <UIcon :name="player.currentTrack.value?.id === r.track.id && player.isPlaying.value ? 'lucide:pause' : 'lucide:play'" class="w-3.5 h-3.5" />
          </button>
        </li>
      </ul>

      <div class="mt-5 flex flex-wrap gap-3">
        <button class="ai-btn-primary" @click="navigateTo(`/ai/generate?q=${encodeURIComponent(search.query.value)}`)">
          <UIcon name="lucide:wand-2" class="w-4 h-4" /> GENERATE PLAYLIST FROM RESULTS
        </button>
      </div>
    </section>

    <!-- idle -->
    <p v-if="search.phase.value === 'idle'" class="mt-10 text-small text-ai-fg-faint">
      DESCRIBE WHAT YOU WANT TO HEAR — IN ANY LANGUAGE. THE ENGINE IS MOCKED; ON-DEVICE INFERENCE PLUGS IN LATER.
    </p>
  </div>
</template>
