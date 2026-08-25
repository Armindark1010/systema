<script setup lang="ts">
import type { EmoExpression, EmoMusicState } from '~/types/emo'
import { emoBehavior, emoPrototypeTracks } from '~/data/emo'

useHead({
  title: 'EMO Prototype',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

definePageMeta({
  layout: 'emo',
  pageTransition: { name: 'sys-page', mode: 'out-in' },
})

const trackIndex = ref(0)
const currentTrack = computed(() => emoPrototypeTracks[trackIndex.value]!)
const expression = ref<EmoExpression>('idle')
const musicState = ref<EmoMusicState>('idle')
const isPlaying = ref(false)
const isThinking = ref(false)
const currentTime = ref(0)
const energy = ref(currentTrack.value.energy)
const volume = ref(0.8)
const statusMessage = ref('READY TO LISTEN')

const reactionTimers = new Set<ReturnType<typeof setTimeout>>()
let playbackTimer: ReturnType<typeof setInterval> | undefined

function later(callback: () => void, delay: number) {
  const timer = setTimeout(() => {
    reactionTimers.delete(timer)
    callback()
  }, delay)
  reactionTimers.add(timer)
}

function clearReactions() {
  for (const timer of reactionTimers) clearTimeout(timer)
  reactionTimers.clear()
}

function applyMusicEnergy() {
  if (!isPlaying.value || isThinking.value) return

  if (energy.value >= emoBehavior.music.highEnergy) {
    musicState.value = 'high-energy'
    expression.value = 'dancing'
    statusMessage.value = 'THIS ONE MOVES'
    return
  }

  if (energy.value <= emoBehavior.music.lowEnergy) {
    musicState.value = 'low-energy'
    expression.value = 'listening'
    statusMessage.value = 'LISTENING QUIETLY'
    return
  }

  musicState.value = 'playing'
  expression.value = 'listening'
  statusMessage.value = 'IN THE RHYTHM'
}

function settleExpression() {
  if (isThinking.value) return
  if (isPlaying.value) {
    applyMusicEnergy()
  } else {
    musicState.value = musicState.value === 'idle' ? 'idle' : 'paused'
    expression.value = 'idle'
    statusMessage.value = musicState.value === 'idle' ? 'READY TO LISTEN' : 'PAUSED · STILL HERE'
  }
}

function startPlayback() {
  clearReactions()
  isThinking.value = false
  isPlaying.value = true
  musicState.value = 'music-started'
  expression.value = 'excited'
  statusMessage.value = 'MUSIC STARTED'
  later(applyMusicEnergy, emoBehavior.music.startedDuration)
}

function pausePlayback() {
  clearReactions()
  isThinking.value = false
  isPlaying.value = false
  musicState.value = 'paused'
  expression.value = 'idle'
  statusMessage.value = 'PAUSED · STILL HERE'
}

function togglePlayback() {
  if (isPlaying.value) pausePlayback()
  else startPlayback()
}

function changeTrack(direction: 1 | -1) {
  clearReactions()
  isThinking.value = false
  trackIndex.value = (trackIndex.value + direction + emoPrototypeTracks.length) % emoPrototypeTracks.length
  energy.value = currentTrack.value.energy
  currentTime.value = 0
  musicState.value = 'track-changed'
  expression.value = 'curious'
  statusMessage.value = 'NEW SIGNAL?'

  later(() => {
    expression.value = 'excited'
    statusMessage.value = 'I LIKE THIS ONE'
    later(settleExpression, emoBehavior.music.trackChangedDuration)
  }, emoBehavior.music.trackChangedDuration)
}

function runThinking(startExpression: 'thinking' | 'analyzing' = 'thinking') {
  clearReactions()
  expression.value = startExpression
  isThinking.value = startExpression === 'thinking'
  statusMessage.value = 'ANALYZING MUSIC...'

  later(() => {
    isThinking.value = false
    expression.value = 'happy'
    statusMessage.value = 'FOUND SOMETHING'
    later(settleExpression, emoBehavior.thinking.foundDuration)
  }, emoBehavior.thinking.analyzingDuration)
}

function setExpression(nextExpression: EmoExpression) {
  if (nextExpression === 'thinking' || nextExpression === 'analyzing') {
    runThinking(nextExpression)
    return
  }

  clearReactions()
  isThinking.value = false
  expression.value = nextExpression
  statusMessage.value = `EXPRESSION · ${nextExpression.toUpperCase()}`
}

function interactWithEmo() {
  clearReactions()
  isThinking.value = false
  expression.value = 'curious'
  statusMessage.value = 'HEY.'

  later(() => {
    expression.value = 'happy'
    statusMessage.value = 'NICE TO SEE YOU'
    later(settleExpression, emoBehavior.interaction.happyDuration)
  }, emoBehavior.interaction.curiousDuration)
}

function updateEnergy(nextEnergy: number) {
  energy.value = Math.max(0, Math.min(1, nextEnergy))
  if (isPlaying.value) applyMusicEnergy()
}

onMounted(() => {
  playbackTimer = setInterval(() => {
    if (!isPlaying.value) return
    if (currentTime.value >= currentTrack.value.duration) {
      changeTrack(1)
      return
    }
    currentTime.value += 1
  }, emoBehavior.music.tick)
})

onBeforeUnmount(() => {
  clearReactions()
  if (playbackTimer) clearInterval(playbackTimer)
})
</script>

<template>
  <div class="sys-container py-5 md:py-7">
    <header class="hairline-b pb-4 flex items-end justify-between gap-5">
      <div>
        <p class="label-faint tnum">PROTOTYPE / 001</p>
        <h1 class="mt-1 text-h1 font-semibold text-fg">EMO</h1>
        <p class="mt-1 label-muted">SYSTEMA MUSIC COMPANION</p>
      </div>
      <p class="hidden sm:block label-faint text-right">ISOLATED CHARACTER LAB</p>
    </header>

    <main class="mt-5 border border-line bg-surface">
      <div class="grid grid-cols-12">
        <section class="col-span-12 lg:col-span-7 p-3 md:p-5" aria-label="EMO character preview">
          <div class="emo-stage border border-line">
            <EmoCompanion
              :expression="expression"
              :is-playing="isPlaying"
              :bpm="currentTrack.bpm"
              :energy="energy"
              :mood="currentTrack.mood"
              :volume="volume"
              :is-thinking="isThinking"
              :message="statusMessage"
              @tap="interactWithEmo"
            />
          </div>
        </section>

        <EmoDebugPanel
          class="col-span-12 lg:col-span-5 p-4 md:p-5 border-t lg:border-t-0 lg:border-l border-line"
          :expression="expression"
          :music-state="musicState"
          :track="currentTrack"
          :is-playing="isPlaying"
          :energy="energy"
          @update:expression="setExpression"
          @update:energy="updateEnergy"
          @toggle-playback="togglePlayback"
        />
      </div>

      <EmoMusicControls
        class="hairline-t p-4 md:p-5"
        :track="currentTrack"
        :is-playing="isPlaying"
        :current-time="currentTime"
        :energy="energy"
        @previous="changeTrack(-1)"
        @toggle-playback="togglePlayback"
        @next="changeTrack(1)"
      />
    </main>
  </div>
</template>
