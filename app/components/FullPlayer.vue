<script setup lang="ts">
// ============================================================
// FullPlayer — immersive, gesture-aware SYSTEMA player
// ============================================================

import type { Track } from '~/types'
import type { EmoExpression } from '~/types/emo'
import { useSettingsStore } from '~/stores/settings'

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
  seekMs,
  seekForward,
  seekBackward,
  favorites,
  toggleFavorite,
  queue,
  ensureFullPlayerNavigation,
} = player

const { playlists, addTracks, createPlaylist } = usePlaylists()
const sleepTimer = useSleepTimer()
const lyrics = useLyrics()
// Mock companion metadata (mood / genre themes) — still what EMO reads.
const analysis = useTrackAnalysis()
// The REAL on-device DSP. Kept separate from the mock above on
// purpose: one is invented for the prototype, the other is measured.
const audioAnalysis = useAudioAnalysis()
// Phase 22.1: the EXPERIMENTAL embedding model, behind the generic
// similarity service. This component never imports a provider or any
// model-specific code; it only ever sees a result object.
const aiAnalysis = useTrackAiAnalysis()
const ai = usePlayerAI()

// Canonical projection of the globally current track. These are
// computeds over the player store, so pressing Next swaps artwork,
// title and artist in place — the fullscreen surface stays mounted
// and `fullPlayerOpen` is never touched.
const { artwork: cover, artist: artistName, album: albumTitle } = useNowPlaying()
const isLiked = computed(() => currentTrack.value ? favorites.value.has(currentTrack.value.id) : false)

const showSleepSheet = ref(false)
const showAnalysisSheet = ref(false)
const showMoreSheet = ref(false)
const showQueueSheet = ref(false)
const showPlaylistPicker = ref(false)
const showCustomSleepInput = ref(false)
const playlistTrackToAdd = ref<Track | null>(null)
const addedToPlaylist = ref<string | null>(null)
const sleepEnded = ref(false)

const emoExpression = ref<EmoExpression>('listening')
const emoIsThinking = computed(() => ai.isResponding.value)
const emoMessage = computed(() => ai.isResponding.value ? 'THINKING...' : 'LISTENING')
const emoEnergy = computed(() => currentTrack.value ? currentTrack.value.energy / 100 : 0.5)
const emoBpm = computed(() => analysis.currentAnalysis.value?.bpm ?? 118)
const emoMood = computed(() => currentTrack.value?.mood?.toUpperCase() ?? 'FOCUSED')

watchEffect(() => {
  if (sleepEnded.value) emoExpression.value = 'sleepy'
  else if (ai.isResponding.value) emoExpression.value = 'thinking'
  else if (currentTrack.value?.energy && currentTrack.value.energy >= 78 && isPlaying.value) emoExpression.value = 'dancing'
  else emoExpression.value = 'listening'
})

const visualMode = computed<'artwork' | 'lyrics' | 'ai'>(() => {
  if (ai.isAIMode.value) return 'ai'
  if (lyrics.isLyricsMode.value) return 'lyrics'
  return 'artwork'
})

function onSleepTimerEnd() {
  sleepEnded.value = true
  setTimeout(() => { sleepEnded.value = false }, 6000)
}

if (import.meta.client) window.addEventListener('systema:sleep-timer-end', onSleepTimerEnd as EventListener)
onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('systema:sleep-timer-end', onSleepTimerEnd as EventListener)
})

function closeFullPlayer() {
  setFullPlayerOpen(false)
  showQueueSheet.value = false
  playlistTrackToAdd.value = null
  ai.closeAI()
  lyrics.setLyricsMode(false)
}

function closeActiveSession() {
  if (ai.isAIMode.value) ai.closeAI()
  else if (lyrics.isLyricsMode.value) lyrics.setLyricsMode(false)
}

function onSeek(ms: number) {
  seekMs(ms)
}

/**
 * ±15s hold controls.
 *
 * Routed through the relative seek actions rather than an absolute
 * `seek(position + delta)`: on Android that becomes a native seekBy,
 * which clamps against the decoder's real duration instead of the
 * MediaStore metadata copy. Behaviour in the browser is identical.
 */
function onSeekStep(milliseconds: number) {
  const seconds = Math.abs(milliseconds) / 1000
  if (milliseconds >= 0) seekForward(seconds)
  else seekBackward(seconds)
}

function onLike() {
  toggleFavorite()
}

function onSleepSelect(minutes: number) {
  if (minutes === -1) {
    showCustomSleepInput.value = true
    return
  }
  if (minutes === 0) sleepTimer.clearTimer()
  else sleepTimer.setTimer(minutes)
  showSleepSheet.value = false
  showCustomSleepInput.value = false
}

function onCustomSleep(minutes: number) {
  sleepTimer.setCustomTimer(minutes)
  showSleepSheet.value = false
  showCustomSleepInput.value = false
}

function onArtworkDoubleClick() {
  if (!useSettingsStore().gestures.doubleTap) return
  toggleFavorite()
}

function onAiToggle() {
  if (!currentTrack.value) return
  if (!useSettingsStore().ai.enabled) return
  lyrics.setLyricsMode(false)
  // Always open a new session, explicitly scoped to this track.
  ai.openAI(currentTrack.value.id)
}

function onLyricsToggle() {
  ai.closeAI()
  lyrics.toggleLyricsMode()
}

function onQueueToggle() {
  showQueueSheet.value = true
}

function onQueueAddToPlaylist(track: Track) {
  playlistTrackToAdd.value = track
  showPlaylistPicker.value = true
}

/**
 * Runs the real analyser for the track on screen.
 *
 * Fire-and-forget: the composable owns the state the sheet renders and
 * raises its own toast on completion or failure, so nothing here has
 * to await the result or interpret it.
 */
function onAnalyzeConfirm(force: boolean) {
  const track = currentTrack.value
  if (!track) return
  void audioAnalysis.analyze(track.id, { force, title: track.title })
}

/** Live DSP state for whatever is playing right now. */
const audioAnalysisState = computed(() => audioAnalysis.stateFor(currentTrack.value?.id))
const audioAnalysisResult = computed(() => audioAnalysis.resultFor(currentTrack.value?.id))
const audioAnalysisFailure = computed(() => audioAnalysis.failureFor(currentTrack.value?.id))

// ---- Experimental AI analysis (Phase 22.1) ----------------------
// Every read is keyed by the CURRENT track's id. That is what stops a
// result for track A appearing under track B: when the user skips, the
// key changes and the new track simply has no entry yet.
const aiState = computed(() => aiAnalysis.stateFor(currentTrack.value?.id))
const aiResult = computed(() => aiAnalysis.resultFor(currentTrack.value?.id))
const aiFailure = computed(() => aiAnalysis.failureFor(currentTrack.value?.id))
const aiSaveWarning = computed(() => aiAnalysis.saveWarningFor(currentTrack.value?.id))
const aiFromCache = computed(() => aiAnalysis.wasFromCache(currentTrack.value?.id))

/**
 * Runs the experimental model for the track on screen.
 *
 * Uses the URI the player already has — no second audio-loading path.
 * A track with no URI (mock catalogue entry) is rejected by the
 * provider with an explained failure rather than silently doing
 * nothing.
 */
function onAiAnalyze(force = false) {
  const track = currentTrack.value
  if (!track) return
  void aiAnalysis.analyze({
    trackId: track.id,
    uri: track.uri,
    title: track.title,
  }, force)
}

// Show a previously saved analysis immediately, so a track analysed
// earlier does not look unanalysed after a reload.
watch(() => currentTrack.value?.id, (id) => {
  if (id) aiAnalysis.hydrate(id)
}, { immediate: true })

watch(showAnalysisSheet, (open) => {
  if (open && currentTrack.value?.id) aiAnalysis.hydrate(currentTrack.value.id)
})

// Read any stored analysis for the current track, so the sheet can
// open straight into a previous result instead of offering to redo
// work the device has already done. Also re-run on track change, which
// is why this is a watcher rather than a one-shot in onMounted.
watch(currentTrack, (track) => {
  if (track) void audioAnalysis.hydrate(track.id)
}, { immediate: true })

// Opening the sheet re-checks the database: a background WorkManager
// batch may have analysed this track since the last look.
watch(showAnalysisSheet, (open) => {
  const track = currentTrack.value
  if (open && track) void audioAnalysis.hydrate(track.id, /* force */ true)
})

function onMoreAction(action: string) {
  showMoreSheet.value = false
  switch (action) {
    case 'playlist':
      playlistTrackToAdd.value = currentTrack.value
      showPlaylistPicker.value = true
      break
    case 'queue':
      if (currentTrack.value) player.addToQueue(currentTrack.value)
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
  }
}

function onPlaylistSelect(id: string) {
  const track = playlistTrackToAdd.value ?? currentTrack.value
  if (!track) return
  addTracks(id, [track.id])
  addedToPlaylist.value = playlists.value.find(playlist => playlist.id === id)?.title ?? 'PLAYLIST'
  setTimeout(() => {
    addedToPlaylist.value = null
    playlistTrackToAdd.value = null
    showPlaylistPicker.value = false
  }, 1200)
}

function onCreatePlaylist() {
  const playlist = createPlaylist(`FOCUS ${new Date().toLocaleDateString()}`, 'Created from player')
  const track = playlistTrackToAdd.value ?? currentTrack.value
  if (track) addTracks(playlist.id, [track.id])
  addedToPlaylist.value = playlist.title
  setTimeout(() => {
    addedToPlaylist.value = null
    playlistTrackToAdd.value = null
    showPlaylistPicker.value = false
  }, 1200)
}

const playlistOptions = computed(() => playlists.value.slice(0, 8).map(playlist => ({
  id: playlist.id,
  title: playlist.title,
  count: playlist.trackIds.length,
})))

// Full-player drag-down minimization (top handle only).
const fullDragOffset = ref(0)
const isFullDragging = ref(false)
let fullDragStartY = 0
let fullPointerId: number | null = null
const fullSheetStyle = computed(() => {
  if (!isFullDragging.value && fullDragOffset.value === 0) return undefined
  const scale = Math.max(0.975, 1 - fullDragOffset.value / 2400)
  return {
    transform: `translate3d(0, ${fullDragOffset.value}px, 0) scale(${scale})`,
    transition: isFullDragging.value ? 'none' : 'transform 280ms var(--player-ease)',
  }
})

function onFullHandleDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  fullDragStartY = event.clientY
  fullPointerId = event.pointerId
  fullDragOffset.value = 0
  isFullDragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function onFullHandleMove(event: PointerEvent) {
  if (!isFullDragging.value || event.pointerId !== fullPointerId) return
  fullDragOffset.value = Math.max(0, event.clientY - fullDragStartY)
}
function onFullHandleEnd(event: PointerEvent) {
  if (!isFullDragging.value || event.pointerId !== fullPointerId) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  const shouldMinimize = fullDragOffset.value > 88
  fullPointerId = null
  isFullDragging.value = false
  if (shouldMinimize) closeFullPlayer()
  else fullDragOffset.value = 0
}

// AI and lyrics are sessions inside the player. Their own handle dismisses
// the session without affecting playback or minimizing the full player.
const sessionDragOffset = ref(0)
const isSessionDragging = ref(false)
let sessionDragStartY = 0
let sessionPointerId: number | null = null
const sessionDragStyle = computed(() => {
  if (!isSessionDragging.value && sessionDragOffset.value === 0) return undefined
  return {
    transform: `translate3d(0, ${sessionDragOffset.value}px, 0)`,
    transition: isSessionDragging.value ? 'none' : 'transform 260ms var(--player-ease)',
  }
})
function onSessionHandleDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  sessionDragStartY = event.clientY
  sessionPointerId = event.pointerId
  sessionDragOffset.value = 0
  isSessionDragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function onSessionHandleMove(event: PointerEvent) {
  if (!isSessionDragging.value || event.pointerId !== sessionPointerId) return
  sessionDragOffset.value = Math.max(0, event.clientY - sessionDragStartY)
}
function onSessionHandleEnd(event: PointerEvent) {
  if (!isSessionDragging.value || event.pointerId !== sessionPointerId) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  const shouldClose = sessionDragOffset.value > 72
  sessionPointerId = null
  isSessionDragging.value = false
  if (shouldClose) closeActiveSession()
  else sessionDragOffset.value = 0
}

// Horizontal navigation belongs to the normal player surface, never buttons,
// the progress scrubber, or text inputs. A small elastic offset previews the
// direction before the track and artwork update.
const swipeOffset = ref(0)
const isSwiping = ref(false)
let swipeStartX = 0
let swipeStartY = 0
let swipePointerId: number | null = null
let swipeAxis: 'pending' | 'horizontal' | 'vertical' = 'pending'
const swipeVisualStyle = computed(() => ({
  transform: `translate3d(${swipeOffset.value}px, 0, 0)`,
  transition: isSwiping.value ? 'none' : 'transform 220ms var(--player-ease)',
}))

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, [role="slider"], [data-player-no-swipe]'))
}
function onPlayerPointerDown(event: PointerEvent) {
  if (!useSettingsStore().gestures.swipePlayer) return
  if (isInteractiveTarget(event.target) || event.pointerType === 'mouse' && event.button !== 0) return
  swipeStartX = event.clientX
  swipeStartY = event.clientY
  swipePointerId = event.pointerId
  swipeAxis = 'pending'
  isSwiping.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function onPlayerPointerMove(event: PointerEvent) {
  if (event.pointerId !== swipePointerId) return
  const deltaX = event.clientX - swipeStartX
  const deltaY = event.clientY - swipeStartY
  if (swipeAxis === 'pending' && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 10) {
    swipeAxis = Math.abs(deltaX) > Math.abs(deltaY) * 1.25 ? 'horizontal' : 'vertical'
  }
  if (swipeAxis !== 'horizontal') return
  isSwiping.value = true
  swipeOffset.value = Math.max(-56, Math.min(56, deltaX * 0.32))
}
function onPlayerPointerEnd(event: PointerEvent) {
  if (event.pointerId !== swipePointerId) return
  const deltaX = event.clientX - swipeStartX
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  const shouldNavigate = swipeAxis === 'horizontal' && Math.abs(deltaX) >= 72
  swipePointerId = null
  isSwiping.value = false
  swipeOffset.value = 0
  if (shouldNavigate) {
    if (deltaX < 0) next()
    else prev()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (showSleepSheet.value || showAnalysisSheet.value || showMoreSheet.value || showQueueSheet.value || showPlaylistPicker.value) {
    showSleepSheet.value = false
    showAnalysisSheet.value = false
    showMoreSheet.value = false
    showQueueSheet.value = false
    showPlaylistPicker.value = false
    playlistTrackToAdd.value = null
    showCustomSleepInput.value = false
  } else if (ai.isAIMode.value || lyrics.isLyricsMode.value) {
    closeActiveSession()
  } else {
    closeFullPlayer()
  }
}

if (import.meta.client) {
  watch(fullPlayerOpen, open => {
    if (open) ensureFullPlayerNavigation()
    document.documentElement.classList.toggle('systema-player-open', open)
    document.body.classList.toggle('systema-player-open', open)
    if (open) document.addEventListener('keydown', onKeydown)
    else {
      document.removeEventListener('keydown', onKeydown)
      fullDragOffset.value = 0
      isFullDragging.value = false
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    document.documentElement.classList.remove('systema-player-open')
    document.body.classList.remove('systema-player-open')
  })
}
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
      >
        <PlayerBackground :src="cover" :alt="currentTrack.title" />

        <section
          class="player-sheet-main"
          :class="{ 'is-dragging': isFullDragging }"
          :style="fullSheetStyle"
        >
          <div
            class="player-mobile-handle"
            aria-label="Swipe down to minimize player"
            @pointerdown="onFullHandleDown"
            @pointermove="onFullHandleMove"
            @pointerup="onFullHandleEnd"
            @pointercancel="onFullHandleEnd"
          ><span /></div>

          <header class="player-topbar">
            <button class="player-topbar-btn" aria-label="Minimize player" @click="closeFullPlayer()">
              <UIcon name="lucide:chevron-down" class="w-5 h-5 md:hidden" />
              <UIcon name="lucide:x" class="w-4 h-4 hidden md:block" />
            </button>
            <span class="player-topbar-label">SYSTEMA</span>
            <button class="player-topbar-btn" aria-label="Open queue" @click="setQueueOpen(true)">
              <UIcon name="lucide:list-music" class="w-4 h-4" />
            </button>
          </header>

          <main class="player-content" :class="{ 'is-ai-session': visualMode === 'ai' }">
            <!-- EMO is intentionally mounted only inside the AI session. -->
            <section v-if="visualMode === 'ai'" class="player-ai-session" :style="sessionDragStyle">
              <div
                class="player-session-handle"
                aria-label="Swipe down to close AI session"
                @pointerdown="onSessionHandleDown"
                @pointermove="onSessionHandleMove"
                @pointerup="onSessionHandleEnd"
                @pointercancel="onSessionHandleEnd"
              ><span /></div>
              <div class="player-ai-emo-wrap">
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
              <PlayerAI
                :messages="ai.messages.value"
                :is-thinking="ai.isThinking.value"
                :is-typing="ai.isTyping.value"
                :input="ai.input.value"
                :prompts="ai.prompts"
                :track-title="currentTrack.title"
                :context-label="ai.contextLabel.value"
                :context="ai.sessionContext.value"
                @close="ai.closeAI()"
                @send="ai.sendMessage"
                @type-complete="ai.completeTyping"
                @update:input="value => ai.input.value = value"
              />
            </section>

            <section
              v-else
              class="player-normal-session"
              @pointerdown="onPlayerPointerDown"
              @pointermove="onPlayerPointerMove"
              @pointerup="onPlayerPointerEnd"
              @pointercancel="onPlayerPointerEnd"
            >
              <div
                v-if="visualMode === 'lyrics'"
                class="player-session-handle"
                aria-label="Swipe down to close lyrics"
                @pointerdown.stop="onSessionHandleDown"
                @pointermove.stop="onSessionHandleMove"
                @pointerup.stop="onSessionHandleEnd"
                @pointercancel.stop="onSessionHandleEnd"
              ><span /></div>

              <div
                class="player-visual"
                :class="{ 'is-lyrics': visualMode === 'lyrics' }"
                :style="swipeVisualStyle"
              >
                <Transition name="player-visual" mode="out-in">
                  <div v-if="visualMode === 'lyrics'" key="lyrics" class="player-visual-pane player-visual-pane--lyrics" :style="sessionDragStyle">
                    <PlayerLyrics
                      :lines="lyrics.displayLyrics.value"
                      :current-index="lyrics.currentLineIndex.value"
                      :track-title="currentTrack.title"
                      :artist="artistName"
                      :has-lyrics="lyrics.hasLyrics.value"
                      @close="lyrics.setLyricsMode(false)"
                    />
                  </div>

                  <div v-else key="artwork" class="player-visual-pane player-visual-pane--artwork" @dblclick="onArtworkDoubleClick">
                    <Transition name="player-artwork" mode="out-in">
                      <div :key="currentTrack.id" class="player-artwork-wrap">
                        <img
                          v-if="cover"
                          :src="cover"
                          :alt="`${currentTrack.title} artwork`"
                          class="player-artwork-img"
                          loading="eager"
                          decoding="async"
                        >
                        <div v-else class="player-artwork-fallback"><span>{{ currentTrack.title.slice(0, 2).toUpperCase() }}</span></div>
                        <div class="player-artwork-glow" aria-hidden="true" />
                      </div>
                    </Transition>
                  </div>
                </Transition>
              </div>

              <PlayerTrackInfo
                :title="currentTrack.title"
                :artist="artistName"
                :album="albumTitle"
                :is-lyrics-mode="lyrics.isLyricsMode.value"
              />

              <PlayerProgress :current-ms="progressMs" :duration-ms="durationMs" @seek="onSeek" />

              <PlayerActions
                :is-liked="isLiked"
                :sleep-active="sleepTimer.isActive.value"
                :sleep-label="sleepTimer.displayLabel.value"
                :is-ai-mode="false"
                :is-lyrics-mode="lyrics.isLyricsMode.value"
                :analysis-state="audioAnalysisState"
                @like="onLike"
                @sleep="showSleepSheet = true"
                @ai="onAiToggle"
                @lyrics="onLyricsToggle"
                @analyze="showAnalysisSheet = true"
                @queue="onQueueToggle"
                @more="showMoreSheet = true"
              />

              <PlayerControls
                :is-playing="isPlaying"
                :is-loading="false"
                @prev="prev"
                @next="next"
                @toggle="togglePlay"
                @seek-step="onSeekStep"
              />

              <div v-if="sleepTimer.isActive.value" class="player-sleep-indicator">
                <UIcon name="lucide:moon" class="w-3 h-3" />
                <span>SLEEP {{ sleepTimer.remainingFormatted.value }}</span>
              </div>
            </section>
          </main>
        </section>

        <PlayerQueue
          :open="showQueueSheet"
          @close="showQueueSheet = false"
          @add-to-playlist="onQueueAddToPlaylist"
        />

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
          @update:custom-minutes="value => sleepTimer.customMinutes.value = value"
          @set-custom="onCustomSleep"
          @clear="sleepTimer.clearTimer(); showSleepSheet = false"
        />
        <PlayerAnalysis
          :open="showAnalysisSheet"
          :state="audioAnalysisState"
          :analysis="audioAnalysisResult"
          :failure="audioAnalysisFailure"
          :track-title="currentTrack.title"
          @close="showAnalysisSheet = false"
          @analyze="onAnalyzeConfirm"
        >
          <!-- Experimental AI analysis, inside the existing sheet so
               the user never leaves the Full Player. -->
          <PlayerAiAnalysis
            :state="aiState"
            :result="aiResult"
            :failure="aiFailure"
            :save-warning="aiSaveWarning"
            :from-cache="aiFromCache"
            @analyze="onAiAnalyze"
          />
        </PlayerAnalysis>
        <PlayerMoreMenu :open="showMoreSheet" :track-title="currentTrack.title" @close="showMoreSheet = false" @action="onMoreAction" />
        <PlayerPlaylistPicker
          :open="showPlaylistPicker"
          :playlists="playlistOptions"
          :track-title="playlistTrackToAdd?.title ?? currentTrack.title"
          :added-to="addedToPlaylist"
          @close="showPlaylistPicker = false; playlistTrackToAdd = null"
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
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  overscroll-behavior: none;
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
  overflow: hidden;
  overscroll-behavior: none;
  transform-origin: center top;
}
.player-sheet-main.is-dragging { user-select: none; will-change: transform; }

@media (min-width: 768px) {
  .player-sheet-main {
    max-width: 520px;
    margin-inline: auto;
    border-inline: 1px solid var(--player-line);
  }
}
@media (min-width: 1024px) { .player-sheet-main { max-width: 560px; } }

.player-mobile-handle {
  position: relative;
  z-index: 20;
  display: grid;
  place-items: center;
  height: calc(28px + var(--player-safe-top));
  padding-top: var(--player-safe-top);
  flex-shrink: 0;
  background: linear-gradient(to bottom, var(--player-overlay-strong), transparent);
  cursor: grab;
  touch-action: none;
}
.player-mobile-handle:active { cursor: grabbing; }
.player-mobile-handle span,
.player-session-handle span { width: 36px; height: 3px; background: var(--player-fg-faint); border-radius: 999px; opacity: 0.72; }
@media (min-width: 768px) { .player-mobile-handle { display: none; } }

.player-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 3rem;
  padding-inline: 0.75rem;
  flex-shrink: 0;
}
.player-topbar-label { font-size: 0.6875rem; font-weight: 800; letter-spacing: 0.22em; color: var(--player-fg-faint); }
.player-topbar-btn { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1px solid transparent; background: transparent; color: var(--player-fg-muted); border-radius: 999px; cursor: pointer; transition: all 160ms var(--player-ease-smooth); }
.player-topbar-btn:hover { color: var(--player-fg); background: var(--player-control); border-color: var(--player-line); }

.player-content {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 0.25rem 0 calc(0.7rem + var(--player-safe-bottom));
}
.player-normal-session {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: clamp(0.45rem, 1.5dvh, 0.9rem);
  overflow: hidden;
  touch-action: pan-y;
}

.player-visual {
  position: relative;
  display: flex;
  min-height: 5rem;
  flex: 1 1 auto;
  overflow: hidden;
  justify-content: center;
  will-change: transform;
}
.player-visual.is-lyrics { min-height: 0; }
.player-visual-pane { width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
.player-visual-pane--artwork { padding-inline: var(--player-content-padding); }
.player-visual-pane--lyrics { align-items: stretch; }

.player-artwork-wrap {
  position: relative;
  width: min(var(--player-art-size), 82vw);
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--player-line-strong);
  background: var(--player-bg-soft);
  box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 12px 32px -12px rgba(0,0,0,0.6);
}
.player-artwork-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.player-artwork-fallback { display: grid; width: 100%; height: 100%; place-items: center; background: var(--player-bg-soft); color: var(--player-fg-faint); font-size: 2rem; font-weight: 700; letter-spacing: 0.1em; }
.player-artwork-glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(60% 60% at 50% 10%, rgba(237,240,244,0.08), transparent 70%); }

.player-sleep-indicator { display: flex; align-items: center; justify-content: center; gap: 0.375rem; margin-top: -0.25rem; font-size: 0.625rem; font-weight: 700; letter-spacing: 0.14em; color: var(--player-fg-faint); font-variant-numeric: tabular-nums; flex-shrink: 0; }

.player-session-handle { display: grid; height: 24px; flex-shrink: 0; place-items: center; cursor: grab; touch-action: none; }
.player-session-handle:active { cursor: grabbing; }

.player-ai-session { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }
.player-ai-emo-wrap { display: flex; height: 104px; flex: 0 0 104px; align-items: flex-start; justify-content: center; overflow: visible; }
.player-ai-emo-wrap :deep(.emo-companion) { width: 13rem; transform: scale(0.47); transform-origin: top center; }

.player-visual-enter-active,
.player-visual-leave-active,
.player-artwork-enter-active,
.player-artwork-leave-active { transition: opacity 280ms var(--player-ease), transform 280ms var(--player-ease); }
.player-visual-enter-from { opacity: 0; transform: translateY(10px) scale(0.99); }
.player-visual-leave-to { opacity: 0; transform: translateY(-6px) scale(1.01); }
.player-artwork-enter-from { opacity: 0; transform: translateX(14px) scale(0.985); }
.player-artwork-leave-to { opacity: 0; transform: translateX(-10px) scale(1.01); }

@media (max-height: 620px) {
  .player-content { padding-top: 0; padding-bottom: calc(0.4rem + var(--player-safe-bottom)); }
  .player-normal-session { gap: 0.4rem; }
  .player-topbar { height: 2.7rem; }
  .player-ai-emo-wrap { height: 82px; flex-basis: 82px; }
  .player-ai-emo-wrap :deep(.emo-companion) { transform: scale(0.37); }
}

@media (prefers-reduced-motion: reduce) {
  .player-visual-enter-active,
  .player-visual-leave-active,
  .player-artwork-enter-active,
  .player-artwork-leave-active { transition: opacity 120ms linear; }
  .player-visual-enter-from,
  .player-visual-leave-to,
  .player-artwork-enter-from,
  .player-artwork-leave-to { transform: none; }
}
</style>
