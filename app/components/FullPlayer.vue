<script setup lang="ts">
// ============================================================
// FullPlayer — immersive SYSTEMA player (Nuxt 4)
// ============================================================
// Premium immersive Now Playing environment:
// - artwork as background with dark overlay + gradient
// - EMO companion reacting to music state
// - track info, progress, actions, controls
// - AI, Lyrics, Analysis, Sleep Timer, More, Playlist
// ============================================================

import type { EmoExpression } from '~/types/emo'

const player = usePlayer()
const {
  fullPlayerOpen,
  currentTrack,
  setFullPlayerOpen,
  setQueueOpen,
  isPlaying,
  progressMs,
  durationMs,
  togglePlay,
  next,
  prev,
  seek,
  favorites,
  toggleFavorite,
  queue,
  index,
} = player

const { getAlbum, getArtist } = useMusicLibrary()
const { playlists, addTracks, createPlaylist } = usePlaylists()

// composables
const sleepTimer = useSleepTimer()
const lyrics = useLyrics()
const analysis = useTrackAnalysis()
const ai = usePlayerAI()

// derived track data
const cover = computed(() => (currentTrack.value ? getAlbum(currentTrack.value.albumId)?.cover : undefined))
const artistName = computed(() => (currentTrack.value ? getArtist(currentTrack.value.artistId)?.name : ''))
const albumTitle = computed(() => (currentTrack.value ? getAlbum(currentTrack.value.albumId)?.title : undefined))

const isLiked = computed(() => currentTrack.value ? favorites.value.has(currentTrack.value.id) : false)

// UI states
const showSleepSheet = ref(false)
const showAnalysisSheet = ref(false)
const showMoreSheet = ref(false)
const showPlaylistPicker = ref(false)
const showCustomSleepInput = ref(false)
const addedToPlaylist = ref<string | null>(null)
const sleepEnded = ref(false)

// EMO expression logic
const emoExpression = ref<EmoExpression>('idle')
const emoIsThinking = ref(false)
const emoMessage = ref('')

// compute EMO based on player states
watchEffect(() => {
  if (!currentTrack.value) {
    emoExpression.value = 'idle'
    emoIsThinking.value = false
    emoMessage.value = 'READY'
    return
  }

  if (sleepEnded.value) {
    emoExpression.value = 'sleepy'
    emoIsThinking.value = false
    emoMessage.value = 'SLEEP MODE'
    return
  }

  if (analysis.isAnalyzing.value) {
    emoExpression.value = 'analyzing'
    emoIsThinking.value = true
    emoMessage.value = 'ANALYZING...'
    return
  }

  if (ai.isAIMode.value) {
    if (ai.isThinking.value) {
      emoExpression.value = 'thinking'
      emoIsThinking.value = true
      emoMessage.value = 'THINKING...'
    } else {
      emoExpression.value = 'listening'
      emoIsThinking.value = false
      emoMessage.value = 'LISTENING'
    }
    return
  }

  if (lyrics.isLyricsMode.value) {
    emoExpression.value = 'focused'
    emoIsThinking.value = false
    emoMessage.value = 'FOCUSED · LYRICS'
    return
  }

  if (!isPlaying.value) {
    emoExpression.value = 'idle'
    emoIsThinking.value = false
    emoMessage.value = 'PAUSED'
    return
  }

  // playing states
  const energy = currentTrack.value.energy / 100
  if (energy >= 0.78) {
    emoExpression.value = 'dancing'
    emoMessage.value = 'DANCING'
  } else if (energy <= 0.35) {
    emoExpression.value = 'listening'
    emoMessage.value = 'LISTENING QUIETLY'
  } else {
    emoExpression.value = 'listening'
    emoMessage.value = 'IN THE RHYTHM'
  }
  emoIsThinking.value = false
})

// energy, bpm, mood for EMO
const emoEnergy = computed(() => currentTrack.value ? currentTrack.value.energy / 100 : 0.5)
const emoBpm = computed(() => {
  if (analysis.currentAnalysis.value?.bpm) return analysis.currentAnalysis.value.bpm
  return 118
})
const emoMood = computed(() => {
  if (currentTrack.value?.mood) return currentTrack.value.mood.toUpperCase()
  return 'FOCUSED'
})

// sleep timer event
function onSleepTimerEnd() {
  sleepEnded.value = true
  setTimeout(() => {
    sleepEnded.value = false
  }, 6000)
}

if (import.meta.client) {
  window.addEventListener('systema:sleep-timer-end', onSleepTimerEnd as any)
}

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('systema:sleep-timer-end', onSleepTimerEnd as any)
  }
})

// sheet controls
function closeFullPlayer() {
  setFullPlayerOpen(false)
  // reset modes when closing
  ai.setAIMode(false)
  lyrics.setLyricsMode(false)
}

function onSeek(ms: number) {
  seek(ms)
}

function onLike() {
  toggleFavorite()
}

function onSleepSelect(minutes: number) {
  if (minutes === -1) {
    showCustomSleepInput.value = true
    return
  }
  if (minutes === 0) {
    sleepTimer.clearTimer()
  } else {
    sleepTimer.setTimer(minutes)
  }
  showSleepSheet.value = false
  showCustomSleepInput.value = false
}

function onCustomSleep(minutes: number) {
  sleepTimer.setCustomTimer(minutes)
  showSleepSheet.value = false
  showCustomSleepInput.value = false
}

function onAiToggle() {
  if (lyrics.isLyricsMode.value) lyrics.setLyricsMode(false)
  ai.toggleAI()
}

function onLyricsToggle() {
  if (ai.isAIMode.value) ai.setAIMode(false)
  lyrics.toggleLyricsMode()
}

function onAnalyzeConfirm(force: boolean) {
  if (!currentTrack.value) return
  analysis.analyzeTrack(currentTrack.value.id, force)
    .catch(() => {})
}

function onMoreAction(action: string) {
  showMoreSheet.value = false
  switch (action) {
    case 'playlist':
      showPlaylistPicker.value = true
      break
    case 'queue':
      // add to queue - for prototype just add current track again
      if (currentTrack.value) {
        const { queue } = usePlayer()
        queue.value = [...queue.value, { track: currentTrack.value, context: 'QUEUE' }]
      }
      break
    case 'artist':
      if (currentTrack.value) {
        closeFullPlayer()
        navigateTo(`/library/artists?artist=${currentTrack.value.artistId}`)
      }
      break
    case 'album':
      if (currentTrack.value) {
        closeFullPlayer()
        navigateTo(`/library/albums?album=${currentTrack.value.albumId}`)
      }
      break
    case 'share':
      if (navigator.share && currentTrack.value) {
        navigator.share({ title: currentTrack.value.title, text: `Listening to ${currentTrack.value.title} by ${artistName.value}` }).catch(() => {})
      }
      break
    default:
      break
  }
}

function onPlaylistSelect(id: string) {
  if (!currentTrack.value) return
  addTracks(id, [currentTrack.value.id])
  const pl = playlists.value.find(p => p.id === id)
  addedToPlaylist.value = pl?.title ?? 'PLAYLIST'
  setTimeout(() => {
    addedToPlaylist.value = null
    showPlaylistPicker.value = false
  }, 1200)
}

function onCreatePlaylist() {
  const pl = createPlaylist(`FOCUS ${new Date().toLocaleDateString()}`, 'Created from player')
  if (currentTrack.value) addTracks(pl.id, [currentTrack.value.id])
  addedToPlaylist.value = pl.title
  setTimeout(() => {
    addedToPlaylist.value = null
    showPlaylistPicker.value = false
  }, 1200)
}

// playlist options for picker
const playlistOptions = computed(() => {
  return playlists.value.slice(0, 8).map(p => ({
    id: p.id,
    title: p.title,
    count: p.trackIds.length,
  }))
})

// drag to close (mobile)
const sheetRef = ref<HTMLElement | null>(null)
const dragOffset = ref(0)
const dragging = ref(false)
let dragStartY = 0

const sheetStyle = computed(() => {
  if (!dragging.value && dragOffset.value === 0) return undefined
  return {
    transform: `translate3d(0, ${dragOffset.value}px, 0)`,
    transition: dragging.value ? 'none' : 'transform 280ms var(--player-ease)',
  }
})

function onHandlePointerDown(e: PointerEvent) {
  dragStartY = e.clientY
  dragOffset.value = 0
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onHandlePointerMove(e: PointerEvent) {
  if (!dragging.value) return
  dragOffset.value = Math.max(0, e.clientY - dragStartY)
}

function onHandlePointerEnd(e: PointerEvent) {
  if (!dragging.value) return
  const shouldClose = dragOffset.value > 80
  dragging.value = false
  const target = e.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId)
  if (shouldClose) closeFullPlayer()
  else dragOffset.value = 0
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showSleepSheet.value || showAnalysisSheet.value || showMoreSheet.value || showPlaylistPicker.value) {
      showSleepSheet.value = false
      showAnalysisSheet.value = false
      showMoreSheet.value = false
      showPlaylistPicker.value = false
    } else if (ai.isAIMode.value || lyrics.isLyricsMode.value) {
      ai.setAIMode(false)
      lyrics.setLyricsMode(false)
    } else {
      closeFullPlayer()
    }
  }
}

watch(fullPlayerOpen, (v) => {
  if (v) document.addEventListener('keydown', onKeydown)
  else {
    document.removeEventListener('keydown', onKeydown)
    dragOffset.value = 0
    dragging.value = false
  }
})

// central visual mode
const visualMode = computed<'artwork' | 'lyrics' | 'ai'>(() => {
  if (ai.isAIMode.value) return 'ai'
  if (lyrics.isLyricsMode.value) return 'lyrics'
  return 'artwork'
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="fullPlayerOpen && currentTrack"
        class="player-root"
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        @click.self="closeFullPlayer()"
      >
        <!-- background -->
        <PlayerBackground :src="cover" :alt="currentTrack.title" />

        <!-- main sheet -->
        <div
          ref="sheetRef"
          class="player-sheet-main"
          :class="{ 'is-dragging': dragging }"
          :style="sheetStyle"
        >
          <!-- mobile handle -->
          <div
            class="player-mobile-handle"
            aria-hidden="true"
            @pointerdown="onHandlePointerDown"
            @pointermove="onHandlePointerMove"
            @pointerup="onHandlePointerEnd"
            @pointercancel="onHandlePointerEnd"
          >
            <span />
          </div>

          <!-- top bar -->
          <div class="player-topbar">
            <button class="player-topbar-btn" aria-label="Close player" @click="closeFullPlayer()">
              <UIcon name="lucide:chevron-down" class="w-5 h-5 md:hidden" />
              <UIcon name="lucide:x" class="w-4 h-4 hidden md:block" />
            </button>
            <span class="player-topbar-label">SYSTEMA</span>
            <button class="player-topbar-btn" aria-label="Open queue" @click="setQueueOpen(true)">
              <UIcon name="lucide:list-music" class="w-4 h-4" />
            </button>
          </div>

          <!-- content -->
          <div class="player-content">
            <!-- EMO area -->
            <div class="player-emo-area">
              <div class="player-emo-wrap">
                <EmoCompanion
                  :expression="emoExpression"
                  :is-playing="isPlaying"
                  :bpm="emoBpm"
                  :energy="emoEnergy"
                  :mood="emoMood"
                  :is-thinking="emoIsThinking"
                  :message="emoMessage"
                />
              </div>
            </div>

            <!-- central visual switcher -->
            <div class="player-visual">
              <Transition name="player-visual" mode="out-in">
                <!-- AI mode -->
                <div v-if="visualMode === 'ai'" key="ai" class="player-visual-pane">
                  <PlayerAI
                    :messages="ai.messages.value"
                    :is-thinking="ai.isThinking.value"
                    :input="ai.input.value"
                    :prompts="ai.prompts"
                    :track-title="currentTrack.title"
                    :context-label="ai.contextLabel.value"
                    @close="ai.setAIMode(false)"
                    @send="(t) => ai.sendMessage(t)"
                    @update:input="(v) => ai.input.value = v"
                  />
                </div>

                <!-- Lyrics mode -->
                <div v-else-if="visualMode === 'lyrics'" key="lyrics" class="player-visual-pane">
                  <PlayerLyrics
                    :lines="lyrics.displayLyrics.value"
                    :current-index="lyrics.currentLineIndex.value"
                    :track-title="currentTrack.title"
                    :artist="artistName"
                    :has-lyrics="lyrics.hasLyrics.value"
                    @close="lyrics.setLyricsMode(false)"
                  />
                </div>

                <!-- Artwork mode -->
                <div v-else key="artwork" class="player-visual-pane player-visual-pane--artwork">
                  <div class="player-artwork-wrap">
                    <img
                      v-if="cover"
                      :src="cover"
                      :alt="`${currentTrack.title} artwork`"
                      class="player-artwork-img"
                      loading="eager"
                      decoding="async"
                    >
                    <div v-else class="player-artwork-fallback">
                      <span>{{ currentTrack.title.slice(0, 2).toUpperCase() }}</span>
                    </div>
                    <!-- subtle inner glow -->
                    <div class="player-artwork-glow" aria-hidden="true" />
                  </div>
                </div>
              </Transition>
            </div>

            <!-- track info -->
            <PlayerTrackInfo
              :title="currentTrack.title"
              :artist="artistName"
              :album="albumTitle"
              :is-ai-mode="ai.isAIMode.value"
              :is-lyrics-mode="lyrics.isLyricsMode.value"
            />

            <!-- progress -->
            <PlayerProgress
              :current-ms="progressMs"
              :duration-ms="durationMs"
              @seek="onSeek"
            />

            <!-- actions -->
            <PlayerActions
              :is-liked="isLiked"
              :sleep-active="sleepTimer.isActive.value"
              :sleep-label="sleepTimer.displayLabel.value"
              :is-ai-mode="ai.isAIMode.value"
              :is-lyrics-mode="lyrics.isLyricsMode.value"
              :analysis-status="analysis.status.value"
              :is-analyzing="analysis.isAnalyzing.value"
              @like="onLike"
              @sleep="showSleepSheet = true"
              @ai="onAiToggle"
              @lyrics="onLyricsToggle"
              @analyze="showAnalysisSheet = true"
              @more="showMoreSheet = true"
            />

            <!-- controls -->
            <PlayerControls
              :is-playing="isPlaying"
              :is-loading="false"
              @prev="prev()"
              @next="next()"
              @toggle="togglePlay()"
            />

            <!-- sleep indicator -->
            <div v-if="sleepTimer.isActive.value" class="player-sleep-indicator">
              <UIcon name="lucide:moon" class="w-3 h-3" />
              <span>SLEEP {{ sleepTimer.remainingFormatted.value }}</span>
            </div>
          </div>
        </div>

        <!-- sheets -->
        <PlayerSleepTimer
          :open="showSleepSheet"
          :options="sleepTimer.options"
          :selected="sleepTimer.selectedMinutes.value"
          :remaining="sleepTimer.remainingFormatted.value"
          :is-active="sleepTimer.isActive.value"
          :custom-minutes="sleepTimer.customMinutes.value"
          :show-custom-input="showCustomSleepInput"
          @close="showSleepSheet = false; showCustomSleepInput = false"
          @select="onSleepSelect"
          @update:custom-minutes="(v) => sleepTimer.customMinutes.value = v"
          @set-custom="onCustomSleep"
          @clear="sleepTimer.clearTimer(); showSleepSheet = false"
        />

        <PlayerAnalysis
          :open="showAnalysisSheet"
          :status="analysis.status.value"
          :analysis="analysis.currentAnalysis.value"
          :track-title="currentTrack.title"
          :is-analyzing="analysis.isAnalyzing.value"
          @close="showAnalysisSheet = false"
          @confirm="onAnalyzeConfirm"
        />

        <PlayerMoreMenu
          :open="showMoreSheet"
          :track-title="currentTrack.title"
          @close="showMoreSheet = false"
          @action="onMoreAction"
        />

        <PlayerPlaylistPicker
          :open="showPlaylistPicker"
          :playlists="playlistOptions"
          :track-title="currentTrack.title"
          :added-to="addedToPlaylist"
          @close="showPlaylistPicker = false"
          @select="onPlaylistSelect"
          @create="onCreatePlaylist"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: stretch;
  justify-content: center;
  overflow: hidden;
  background: var(--player-bg);
}

.player-sheet-main {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.player-sheet-main::-webkit-scrollbar {
  display: none;
}

.player-sheet-main.is-dragging {
  user-select: none;
  will-change: transform;
}

@media (min-width: 768px) {
  .player-sheet-main {
    max-width: 520px;
    margin-inline: auto;
    border-left: 1px solid var(--player-line);
    border-right: 1px solid var(--player-line);
  }
}

@media (min-width: 1024px) {
  .player-sheet-main {
    max-width: 560px;
  }
}

.player-mobile-handle {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  height: calc(28px + var(--player-safe-top));
  padding-top: var(--player-safe-top);
  background: linear-gradient(to bottom, var(--player-overlay-strong), transparent);
  backdrop-filter: blur(12px);
  cursor: grab;
  flex-shrink: 0;
}

.player-mobile-handle:active {
  cursor: grabbing;
}

.player-mobile-handle span {
  width: 36px;
  height: 3px;
  background: var(--player-fg-faint);
  border-radius: 999px;
  opacity: 0.7;
}

@media (min-width: 768px) {
  .player-mobile-handle {
    display: none;
  }
}

.player-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 3rem;
  padding-inline: 0.75rem;
  flex-shrink: 0;
}

.player-topbar-label {
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: var(--player-fg-faint);
}

.player-topbar-btn {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
}

.player-topbar-btn:hover {
  color: var(--player-fg);
  background: var(--player-control);
  border-color: var(--player-line);
}

.player-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: calc(1.5rem + var(--player-safe-bottom));
  padding-top: 0.5rem;
}

.player-emo-area {
  display: flex;
  justify-content: center;
  padding-block: 0.5rem 0.25rem;
}

.player-emo-wrap {
  transform: scale(0.72);
  transform-origin: center;
}

@media (min-width: 768px) {
  .player-emo-wrap {
    transform: scale(0.8);
  }
}

.player-visual {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
  min-height: 18rem;
}

.player-visual-pane {
  width: 100%;
  display: flex;
  justify-content: center;
}

.player-visual-pane--artwork {
  padding-inline: var(--player-content-padding);
}

.player-artwork-wrap {
  position: relative;
  width: var(--player-art-size);
  aspect-ratio: 1;
  max-width: 84vw;
  overflow: hidden;
  border: 1px solid var(--player-line-strong);
  background: var(--player-bg-soft);
  box-shadow:
    0 1px 2px rgba(0,0,0,0.3),
    0 12px 32px -12px rgba(0,0,0,0.6);
}

.player-artwork-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.player-artwork-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--player-bg-soft);
  color: var(--player-fg-faint);
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.player-artwork-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(60% 60% at 50% 10%, rgba(237,240,244,0.08), transparent 70%);
  pointer-events: none;
}

.player-sleep-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
  margin-top: -0.5rem;
  font-variant-numeric: tabular-nums;
}

/* visual mode transition */
.player-visual-enter-active,
.player-visual-leave-active {
  transition: opacity 320ms var(--player-ease), transform 320ms var(--player-ease);
}

.player-visual-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

.player-visual-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(1.02);
}

@media (prefers-reduced-motion: reduce) {
  .player-visual-enter-active,
  .player-visual-leave-active {
    transition: opacity 160ms;
  }
  .player-visual-enter-from,
  .player-visual-leave-to {
    transform: none;
  }
}
</style>
