// ============================================================
// usePlayerEngine — Bridges Audio Engine to Centralized Pinia Store
// ============================================================
// Architecture:
//
//   Audio Engine (WebAudio / generative synth / future Media3)
//               ↓
//          Player Store (Pinia)
//               ↓
//       ┌───────┼───────┐
//       ↓       ↓       ↓
//    Library   EMO  FullPlayer / MiniPlayer
//
// The audio engine drives state in Pinia; components never maintain
// independent timers or duplicate audio state.
// ============================================================

import { usePlayerStore } from '~/stores/player'
import { useAudioEngine } from '~/composables/useAudioEngine'
import { useNativePlayer } from '~/composables/useNativePlayer'

let engineInitialized = false
let playbackTimer: ReturnType<typeof setInterval> | null = null
let lastClockTime = 0

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function usePlayerEngine() {
  const player = usePlayerStore()
  const engine = useAudioEngine()

  function startClock() {
    if (playbackTimer) return
    lastClockTime = nowMs()
    playbackTimer = setInterval(() => {
      if (!player.isPlaying || !player.currentTrack) {
        stopClock()
        return
      }

      const now = nowMs()
      const elapsedMs = Math.max(0, now - lastClockTime)
      lastClockTime = now

      const elapsedSec = elapsedMs / 1000
      const trackDuration = player.duration || player.currentTrack.duration

      if (trackDuration > 0 && player.currentTime + elapsedSec >= trackDuration) {
        if (player.repeatMode === 'one') {
          player.currentTime = 0
        } else {
          player.next()
        }
      } else {
        player.currentTime += elapsedSec
      }
    }, 200)
  }

  function stopClock() {
    if (playbackTimer) {
      clearInterval(playbackTimer)
      playbackTimer = null
    }
    lastClockTime = 0
  }

  /**
   * Connects the store to whichever engine this platform has.
   *
   * On Android the Media3 engine takes over completely: the generative
   * WebAudio synth is never started and the local clock below is not
   * used, because the native engine owns both audio and position.
   * Everywhere else the existing browser behaviour is untouched.
   */
  async function init() {
    if (!import.meta.client || engineInitialized) return
    engineInitialized = true

    player.isPlayerReady = true

    const nativeReady = await useNativePlayer().init()
    if (nativeReady) return

    // Synchronize track changes with audio synth
    watch(
      () => player.currentTrack,
      (track) => {
        if (track) {
          engine.start(track)
          if (player.isPlaying) {
            startClock()
          }
        } else {
          engine.stop()
          stopClock()
        }
      },
      { immediate: false },
    )

    // Synchronize play / pause
    watch(
      () => player.isPlaying,
      (playing) => {
        engine.setPaused(!playing)
        if (playing) {
          startClock()
        } else {
          stopClock()
        }
      },
      { immediate: true },
    )

    // Synchronize volume and mute
    watch(
      [() => player.volume, () => player.muted],
      ([v, m]) => {
        engine.setLevel(m ? 0 : v)
      },
      { immediate: true },
    )
  }

  return {
    init,
    startClock,
    stopClock,
  }
}
