<script setup lang="ts">
// ============================================================
// AIPlaylistGenerator — GENERATE PLAYLIST with staged states:
// ANALYZING → SELECTING TRACKS → RANKING → FINALIZING
// ============================================================

import { generationPresets, aiGenerationStages } from '~/data/ai'
import type { Track } from '~/types'

const route = useRoute()
const ai = useAI()
const { generation } = ai
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()
// Canonical artwork resolution, shared with every player surface.
const { coverFor } = useTrackFields()
const player = usePlayer()
const playlists = usePlaylists()
const toast = useToast()

// presync concept from ?q=
if (route.query.q) generation.form.value.concept = String(route.query.q)

function run() {
  generation.run()
}

function saveToLibrary() {
  const tracks = generation.result.value.map((r) => r.track)
  const pl = playlists.createPlaylist(
    `AI — ${generation.form.value.mood} / ${generation.form.value.energy}`,
    `Generated from “${generation.form.value.concept || generation.form.value.mood}”`,
  )
  playlists.addTracks(pl.id, tracks.map((t) => t.id))
  toast.add({ title: 'Playlist saved', description: pl.title, icon: 'lucide:check' })
  navigateTo(`/playlists/${pl.id}`)
}

function playResult() {
  const tracks = generation.result.value.map((r) => r.track)
  player.playQueue(
    tracks.map((track) => ({ track, context: 'AI GENERATION' })),
    0,
  )
}
</script>

<template>
  <div class="sys-container pt-8 md:pt-10 pb-16">
    <p class="label-ai">GENERATE PLAYLIST</p>
    <h1 class="mt-3 text-display font-bold tracking-tight text-ai-fg">DESCRIBE. THE SYSTEM BUILDS.</h1>

    <div class="mt-8 grid lg:grid-cols-[1fr_340px] gap-8">
      <!-- form -->
      <div v-if="generation.phase.value !== 'done'" class="space-y-8">
        <section aria-label="Mood">
          <p class="label-ai mb-3">MOOD</p>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Mood">
            <button
              v-for="m in generationPresets.moods"
              :key="m"
              class="h-9 px-4 border text-[11px] font-bold tracking-[0.14em] t-all pressable focus-ring-ai"
              :class="generation.form.value.mood === m ? 'border-ai-primary bg-ai-primary text-white shadow-ai-glow' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
              role="radio"
              :aria-checked="generation.form.value.mood === m"
              @click="generation.form.value.mood = m"
            >
              {{ m }}
            </button>
          </div>
        </section>

        <section aria-label="Energy">
          <p class="label-ai mb-3">ENERGY</p>
          <div class="flex gap-2" role="radiogroup" aria-label="Energy">
            <button
              v-for="e in generationPresets.energies"
              :key="e"
              class="flex-1 h-9 border text-[11px] font-bold tracking-[0.14em] t-all pressable focus-ring-ai"
              :class="generation.form.value.energy === e ? 'border-ai-accent bg-ai-accent/20 text-ai-accent shadow-[0_0_16px_rgba(232,121,249,0.25)]' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
              role="radio"
              :aria-checked="generation.form.value.energy === e"
              @click="generation.form.value.energy = e"
            >
              {{ e }}
            </button>
          </div>
        </section>

        <section aria-label="Duration">
          <p class="label-ai mb-3">DURATION</p>
          <div class="flex gap-2" role="radiogroup" aria-label="Duration">
            <button
              v-for="d in generationPresets.durations"
              :key="d"
              class="flex-1 h-9 border text-[11px] font-bold tracking-[0.14em] tnum t-all pressable focus-ring-ai"
              :class="generation.form.value.duration === d ? 'border-ai-primary bg-ai-muted text-ai-fg' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
              role="radio"
              :aria-checked="generation.form.value.duration === d"
              @click="generation.form.value.duration = d"
            >
              {{ d }} MIN
            </button>
          </div>
        </section>

        <section aria-label="Language">
          <p class="label-ai mb-3">LANGUAGE</p>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Language">
            <button
              v-for="l in generationPresets.languages"
              :key="l"
              class="h-9 px-4 border text-[11px] font-bold tracking-[0.14em] t-all pressable focus-ring-ai"
              :class="generation.form.value.language === l ? 'border-ai-primary bg-ai-muted text-ai-fg' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
              role="radio"
              :aria-checked="generation.form.value.language === l"
              @click="generation.form.value.language = l"
            >
              {{ l }}
            </button>
          </div>
        </section>

        <section aria-label="Genre">
          <p class="label-ai mb-3">GENRE</p>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Genre">
            <button
              v-for="g in generationPresets.genres"
              :key="g"
              class="h-8 px-3 border text-[10px] font-bold tracking-[0.14em] t-all pressable focus-ring-ai"
              :class="generation.form.value.genre === g ? 'border-ai-primary bg-ai-primary/20 text-ai-fg' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
              role="radio"
              :aria-checked="generation.form.value.genre === g"
              @click="generation.form.value.genre = g"
            >
              {{ g }}
            </button>
          </div>
        </section>

        <section aria-label="Concept">
          <label class="block">
            <span class="label-ai">CONCEPT</span>
            <input
              v-model="generation.form.value.concept"
              type="text"
              class="mt-3 w-full h-12 px-4 bg-ai-surface/80 border border-ai-line text-body text-ai-fg placeholder:text-ai-fg-faint focus:(border-ai-primary shadow-ai-glow) t-all outline-none"
              placeholder="Free text — scene, feeling, reference…"
            >
          </label>
        </section>

        <div class="border-t border-ai-line pt-5">
          <button class="ai-btn-primary !h-12 !px-8" :disabled="generation.phase.value !== 'idle'" @click="run">
            <UIcon name="lucide:wand-2" class="w-4.5 h-4.5" />
            GENERATE
          </button>
          <p class="mt-3 text-[11px] text-ai-fg-faint">
            MOCK PIPELINE — ANALYZING → SELECTING TRACKS → RANKING → FINALIZING
          </p>
        </div>
      </div>

      <!-- processing stages -->
      <aside v-if="generation.phase.value !== 'idle' && generation.phase.value !== 'done'" class="lg:sticky lg:top-8 self-start ai-panel p-5" aria-live="polite">
        <p class="label-ai mb-4">GENERATING</p>
        <ol class="space-y-3">
          <li
            v-for="(stage, i) in aiGenerationStages"
            :key="stage.key"
            class="flex items-center gap-3 t-all"
            :class="i <= generation.stageIndex.value ? 'opacity-100' : 'opacity-30'"
          >
            <span
              class="w-6 h-6 shrink-0 grid place-items-center border text-[10px] font-bold tnum"
              :class="i < generation.stageIndex.value ? 'border-ai-primary text-ai-primary' : i === generation.stageIndex.value ? 'border-ai-primary text-ai-fg bg-ai-primary/20' : 'border-ai-line text-ai-fg-faint'"
            >
              {{ i < generation.stageIndex.value ? '✓' : String(i + 1).padStart(2, '0') }}
            </span>
            <span class="text-[11px] font-bold tracking-[0.16em] text-ai-fg">{{ stage.label }}</span>
            <UIcon v-if="i === generation.stageIndex.value" name="lucide:loader-circle" class="w-3.5 h-3.5 text-ai-primary animate-spin ml-auto" />
          </li>
        </ol>
        <div class="mt-5">
          <Meter :value="generation.progress.value" label="PIPELINE" color="bg-ai-primary" ai />
        </div>
      </aside>

      <!-- result -->
      <div v-if="generation.phase.value === 'done'" class="lg:col-span-2">
        <div class="flex flex-wrap items-end justify-between gap-4 border-b border-ai-line pb-3">
          <div>
            <p class="label-ai">GENERATED PLAYLIST</p>
            <p class="mt-1 text-small text-ai-fg-muted">
              {{ generation.form.value.mood }} · {{ generation.form.value.energy }} ENERGY · {{ generation.form.value.duration }} MIN{{ generation.form.value.concept ? ` · “${generation.form.value.concept}”` : '' }}
            </p>
          </div>
          <div class="flex gap-2">
            <button class="ai-btn-primary" @click="playResult()">
              <UIcon name="lucide:play" class="w-4 h-4" /> PLAY
            </button>
            <button class="ai-btn-outline" @click="saveToLibrary()">
              <UIcon name="lucide:bookmark-plus" class="w-4 h-4" /> SAVE TO LIBRARY
            </button>
          </div>
        </div>

        <ul class="mt-4 border border-ai-line divide-y divide-ai-line bg-ai-surface/50">
          <li
            v-for="(r, i) in generation.result.value"
            :key="r.track.id"
            class="flex items-center gap-4 px-3 py-2.5 t-all hover:bg-ai-muted"
            :class="player.currentTrack.value?.id === r.track.id ? 'bg-ai-muted' : ''"
          >
            <span class="tnum text-[11px] text-ai-fg-faint w-5 shrink-0 text-right">{{ String(i + 1).padStart(2, '0') }}</span>
            <Artwork :src="coverFor(r.track)" :alt="r.track.title" class="w-9 h-9 shrink-0" :seed="r.track.id" />
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold text-ai-fg truncate">{{ r.track.title }}</p>
              <p class="text-[11px] text-ai-fg-muted truncate">{{ getArtist(r.track.artistId)?.name }}</p>
            </div>
            <span class="tnum text-[11px] text-ai-fg-faint shrink-0">{{ formatDuration(r.track.duration) }}</span>
            <button
              class="ai-btn-ghost !h-7 !w-7 !p-0 shrink-0"
              :aria-label="`Play ${r.track.title}`"
              @click="player.playTrack(r.track, 'AI GENERATION')"
            >
              <UIcon name="lucide:play" class="w-3 h-3" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
