<script setup lang="ts">
// ============================================================
// HOME — the central music dashboard. Editorial + architectural.
// ============================================================

useHead({ title: 'Home' })

const { recentlyPlayed, continueListening, getAlbum, getArtist, stats } = useMusicLibrary()
const { openPalette } = useQuickSearch()

const clock = ref('')
function tick() {
  clock.value = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
onMounted(() => {
  tick()
  const t = setInterval(tick, 30000)
  onBeforeUnmount(() => clearInterval(t))
})

const dateLabel = computed(() =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase(),
)

const rail = computed(() => continueListening())
const recent = computed(() => recentlyPlayed(12))
const s = computed(() => stats())

// mock "continue listening" progress per album
const progress = { 'al-outrun': 62, 'al-blueprint': 38, 'al-hg': 74, 'al-ram': 12, 'al-trilogy': 47, 'al-tbn': 88 }
</script>

<template>
  <div>
    <!-- editorial header -->
    <header class="sys-container pt-6 md:pt-10">
      <div class="flex items-baseline justify-between gap-6 hairline-b pb-3">
        <span class="label tnum text-fg-faint">{{ dateLabel }}</span>
        <span class="label tnum text-fg-muted hidden sm:block">LOCAL — {{ clock }}</span>
      </div>
      <div class="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p class="label-muted">GOOD MORNING</p>
          <h1 class="mt-2 text-display-xl font-bold tracking-tight text-fg">YOUR MUSIC SYSTEM</h1>
          <p class="mt-3 text-lead text-fg-muted max-w-[52ch]">
            {{ s.tracks }} tracks · {{ s.albums }} albums · {{ s.artists }} artists — one precise archive, indexed and ready.
          </p>
        </div>
        <div class="shrink-0 grid grid-cols-2 gap-px bg-line border border-line min-w-[220px]">
          <div class="bg-surface px-4 py-3">
            <p class="tnum text-title font-bold text-fg">{{ s.tracks }}</p>
            <p class="label text-fg-faint">TRACKS</p>
          </div>
          <div class="bg-surface px-4 py-3">
            <p class="tnum text-title font-bold text-fg">{{ s.favorites }}</p>
            <p class="label text-fg-faint">FAVORITES</p>
          </div>
          <div class="bg-surface px-4 py-3">
            <p class="tnum text-title font-bold text-fg">{{ s.albums }}</p>
            <p class="label text-fg-faint">ALBUMS</p>
          </div>
          <div class="bg-surface px-4 py-3">
            <p class="tnum text-title font-bold text-fg">{{ s.genres }}</p>
            <p class="label text-fg-faint">GENRES</p>
          </div>
        </div>
      </div>
    </header>

    <!-- continue listening -->
    <section class="sys-container mt-10" aria-label="Continue listening">
      <SectionHeader index="01" label="CONTINUE LISTENING" />
      <div class="sys-rail no-scrollbar mt-4 pb-1">
        <div v-for="al in rail" :key="al.id" class="snap-start shrink-0 w-36 sm:w-40">
          <NuxtLink :to="`/library/albums?album=${al.id}`" class="block t-col pressable focus-ring group">
            <Artwork :src="al.cover" :alt="al.title" :seed="al.id" rounded />
            <div class="mt-2">
              <p class="text-[12.5px] font-semibold text-fg truncate group-hover:text-primary t-col">{{ al.title }}</p>
              <p class="text-[11px] text-fg-muted truncate">{{ getArtist(al.artistId)?.name }}</p>
            </div>
            <div class="mt-2 h-[2px] bg-hover" aria-hidden="true">
              <div class="h-full bg-primary/70" :style="{ width: (progress[al.id as keyof typeof progress] ?? 30) + '%' }" />
            </div>
            <p class="mt-1 text-[9px] font-bold tracking-[0.14em] text-fg-faint tnum">
              {{ progress[al.id as keyof typeof progress] ?? 30 }}% PLAYED
            </p>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- recently played -->
    <section class="sys-container mt-12" aria-label="Recently played">
      <SectionHeader index="02" label="RECENTLY PLAYED" to="/library/tracks" />
      <div class="mt-4">
        <TrackList :tracks="recent" context="RECENTLY PLAYED" hide-album />
      </div>
    </section>

    <!-- AI INSIGHTS — the black strip that bleeds the AI system into home -->
    <section class="mt-12" aria-label="AI insights">
      <div class="ai-aurora relative overflow-hidden">
        <div class="pointer-events-none absolute inset-0 ai-grid-fade" aria-hidden="true" />
        <div class="relative sys-container py-10 md:py-12">
          <div class="grid lg:grid-cols-[1fr_auto] gap-8 items-center">
            <div>
              <div class="flex items-baseline gap-4">
                <span class="label tnum text-ai-fg-faint">03</span>
                <span class="label text-ai-fg-muted">AI INSIGHTS</span>
              </div>
              <h2 class="mt-3 text-h1 md:text-display font-bold tracking-tight text-ai-fg">FUNCTIONAL BEATS</h2>
              <p class="mt-2 text-lead text-ai-fg-muted max-w-[52ch]">
                18 tracks selected for focused work — energy-matched, mood-ranked, instrumental-first.
              </p>
              <dl class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-ai-line max-w-[560px]">
                <div class="bg-ai-surface/80 px-4 py-3">
                  <dt class="label text-ai-fg-faint">ENERGY</dt>
                  <dd class="tnum text-title font-bold text-ai-fg">62</dd>
                </div>
                <div class="bg-ai-surface/80 px-4 py-3">
                  <dt class="label text-ai-fg-faint">MOOD</dt>
                  <dd class="text-title font-bold text-ai-fg">FOCUSED</dd>
                </div>
                <div class="bg-ai-surface/80 px-4 py-3">
                  <dt class="label text-ai-fg-faint">FOCUS</dt>
                  <dd class="tnum text-title font-bold text-ai-fg">84</dd>
                </div>
                <div class="bg-ai-surface/80 px-4 py-3">
                  <dt class="label text-ai-fg-faint">LISTENING</dt>
                  <dd class="tnum text-title font-bold text-ai-fg">21H</dd>
                </div>
              </dl>
            </div>
            <div class="flex flex-col gap-3 lg:items-end">
              <NuxtLink to="/ai/insights" class="ai-btn-primary !h-12 !px-8">
                <UIcon name="lucide:sparkles" class="w-4.5 h-4.5" /> OPEN AI INSIGHTS
              </NuxtLink>
              <NuxtLink to="/playlists/pl-functional" class="ai-btn-ghost">
                VIEW PLAYLIST →
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- quick access strip -->
    <section class="sys-container mt-10 pb-14">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line">
        <NuxtLink to="/playlists" class="bg-surface px-5 py-4 t-col pressable focus-ring hover:bg-hover">
          <p class="label text-fg-faint">PLAYLISTS</p>
          <p class="mt-1 text-small font-semibold text-fg">08 ARCHIVED</p>
        </NuxtLink>
        <NuxtLink to="/library/albums" class="bg-surface px-5 py-4 t-col pressable focus-ring hover:bg-hover">
          <p class="label text-fg-faint">ALBUMS</p>
          <p class="mt-1 text-small font-semibold text-fg">{{ s.albums }} IN ARCHIVE</p>
        </NuxtLink>
        <NuxtLink to="/library/genres" class="bg-surface px-5 py-4 t-col pressable focus-ring hover:bg-hover">
          <p class="label text-fg-faint">GENRES</p>
          <p class="mt-1 text-small font-semibold text-fg">{{ s.genres }} CATEGORIES</p>
        </NuxtLink>
        <button class="bg-surface px-5 py-4 text-left t-col pressable focus-ring hover:bg-hover" @click="openPalette()">
          <p class="label text-fg-faint">QUICK SEARCH</p>
          <p class="mt-1 text-small font-semibold text-fg">PRESS ⌘K</p>
        </button>
      </div>
    </section>
  </div>
</template>
