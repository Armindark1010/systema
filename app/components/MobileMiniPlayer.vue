<script setup lang="ts">
// Compact mobile playback strip. Horizontal swipes move through the queue;
// an upward swipe or metadata tap opens the full player.
import { useSettingsStore } from '~/stores/settings'

const {
  currentTrack,
  isPlaying,
  progressPct,
  togglePlay,
  openFullPlayer,
  next,
  prev,
} = usePlayer()
// Canonical projection of the globally current track: artwork and
// artist resolve identically here, in the Full Player and in the
// Library, so all three can never disagree.
const { artwork: cover, artist: artistName } = useNowPlaying()

let gestureStart: { x: number; y: number } | null = null

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (touch) gestureStart = { x: touch.clientX, y: touch.clientY }
}

function onTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (!touch || !gestureStart) return

  const deltaX = touch.clientX - gestureStart.x
  const deltaY = touch.clientY - gestureStart.y
  gestureStart = null

  if (deltaY < -48 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
    event.preventDefault()
    openFullPlayer()
  } else if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
    const swipeEnabled = useSettingsStore().gestures.swipePlayer
    if (!swipeEnabled) return
    event.preventDefault()
    if (deltaX < 0) next()
    else prev()
  }
}

function cancelGesture() {
  gestureStart = null
}
</script>

<template>
  <section
    v-if="currentTrack"
    class="mobile-mini-player"
    aria-label="Now playing. Swipe left or right to change track, or swipe up to expand."
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
    @touchcancel.passive="cancelGesture"
  >
    <div class="mobile-mini-player__row">
      <button
        type="button"
        class="mobile-mini-player__details focus-ring"
        :aria-label="`Open now playing: ${currentTrack.title} by ${artistName}`"
        @click="openFullPlayer()"
      >
        <Artwork
          :src="cover"
          :alt="currentTrack.title"
          :seed="currentTrack.id"
          class="mobile-mini-player__art"
        />
        <span class="min-w-0 text-left">
          <span class="mobile-mini-player__title">{{ currentTrack.title }}</span>
          <span class="mobile-mini-player__artist">{{ artistName }}</span>
        </span>
      </button>

      <button
        type="button"
        class="mobile-mini-player__toggle pressable focus-ring"
        :aria-label="isPlaying ? `Pause ${currentTrack.title}` : `Play ${currentTrack.title}`"
        @click.stop="togglePlay()"
      >
        <UIcon :name="isPlaying ? 'lucide:pause' : 'lucide:play'" class="mobile-mini-player__toggle-icon" />
      </button>
    </div>

    <div class="mobile-mini-player__progress" aria-hidden="true">
      <span :style="{ width: `${progressPct}%` }" />
    </div>
  </section>
</template>
