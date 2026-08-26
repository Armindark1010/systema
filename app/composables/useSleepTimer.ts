// ============================================================
// useSleepTimer — one sleep timer, wired to the real player
// ============================================================
// Phase 4 rewrite. The previous version could not work on a device:
//
//   1. It stopped nothing. `stopPlaybackCompletely()` assigned
//      `player.isPlaying.value = false` directly. That is a ref write,
//      not a store action, so the `$onAction` bridge in useNativePlayer
//      never fired and Media3 was never told to pause. The audio kept
//      playing while the UI claimed it had stopped.
//
//   2. It could not survive the background. A `setInterval` in the
//      WebView is frozen or heavily throttled once Android backgrounds
//      the app or the screen locks — precisely the situation a sleep
//      timer exists for. Being decrement-based, every skipped tick was
//      time lost for good.
//
// The rewrite keeps the public shape (the existing modal binds to it
// unchanged) and changes where the time is kept:
//
//   Android : the deadline lives in PlayerEngine, next to the player it
//             has to pause. It keeps running while the WebView sleeps,
//             and expiry pauses the real ExoPlayer, which MediaSession
//             then publishes to the notification and lock screen.
//   Browser : the same deadline logic runs here against the web engine.
//
// Both paths derive the countdown from an absolute deadline rather than
// decrementing a counter, so a suspended CPU cannot make the timer
// drift. The visible ticker is one interval, owned here, and it only
// renders — it never decides when the timer ends.
// ============================================================

import { usePlayerStore } from '~/stores/player'
import {
  isNativePlayerAvailable,
  setSleepTimerNative,
  cancelSleepTimerNative,
  getSleepTimerNative,
} from '~/services/native/playerService'

export type SleepTimerOption = {
  label: string
  value: number // minutes, 0 = OFF
  custom?: boolean
}

export const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [
  { label: 'OFF', value: 0 },
  { label: '5 MIN', value: 5 },
  { label: '10 MIN', value: 10 },
  { label: '15 MIN', value: 15 },
  { label: '30 MIN', value: 30 },
  { label: '45 MIN', value: 45 },
  { label: '60 MIN', value: 60 },
  { label: 'CUSTOM', value: -1, custom: true },
]

/** Guard rails for a custom duration, in minutes. */
export const SLEEP_TIMER_MIN_MINUTES = 1
export const SLEEP_TIMER_MAX_MINUTES = 480

/** How often the *display* refreshes. Not what decides expiry. */
const TICK_INTERVAL_MS = 1000

// ---- Module-scoped state -------------------------------------
// One timer for the whole app: the state must not be tied to any
// component being mounted, and the modal may be unmounted while the
// timer runs.

const selectedMinutes = ref<number>(0) // 0 = OFF, -1 = custom pending
const customMinutes = ref<number>(20)
const remainingMs = ref<number>(0)
const isActive = ref<boolean>(false)
const isCustomSheetOpen = ref<boolean>(false)

/** Absolute wall-clock instant the timer fires. Null when inactive. */
let deadlineAt: number | null = null
/** Display ticker only. */
let ticker: ReturnType<typeof setInterval> | null = null
/** Browser-only fallback: fires expiry when there is no native timer. */
let fallbackTimeout: ReturnType<typeof setTimeout> | null = null
/** Installed once, so re-entering the composable cannot duplicate it. */
let lifecycleInstalled = false

function clearTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function clearFallback() {
  if (fallbackTimeout) {
    clearTimeout(fallbackTimeout)
    fallbackTimeout = null
  }
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00'
  const totalSec = Math.ceil(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  // Durations can legitimately exceed an hour (custom up to 8h), so
  // show hours rather than letting the minutes field run past 60.
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Recomputes the visible remainder from the deadline. */
function refreshRemaining(): number {
  if (deadlineAt === null) {
    remainingMs.value = 0
    return 0
  }
  const left = Math.max(0, deadlineAt - Date.now())
  remainingMs.value = left
  return left
}

export function useSleepTimer() {
  const player = usePlayerStore()

  const remainingFormatted = computed(() => formatRemaining(remainingMs.value))
  const displayLabel = computed(() => (isActive.value ? remainingFormatted.value : null))
  const activeOption = computed(
    () => SLEEP_TIMER_OPTIONS.find(o => o.value === selectedMinutes.value) ?? null,
  )

  /**
   * Stops the real audio.
   *
   * Goes through the store ACTION, never a ref write. That is the whole
   * fix for cause (1): `player.pause()` is intercepted by the
   * `$onAction` bridge in useNativePlayer, which forwards it to Media3.
   * On the web the same action drives the WebAudio engine. One call,
   * correct on both platforms, and every mirror (mini player, full
   * player, notification, lock screen) follows from it.
   */
  function stopPlayback() {
    if (player.isPlaying) player.pause()
  }

  function onExpired() {
    clearTicker()
    clearFallback()
    deadlineAt = null
    isActive.value = false
    remainingMs.value = 0
    selectedMinutes.value = 0
    player.sleepTimer = null

    stopPlayback()

    if (import.meta.client) {
      window.dispatchEvent(new CustomEvent('systema:sleep-timer-end'))
    }
  }

  /** Mirrors the timer into the store so any surface can read it. */
  function syncStore() {
    player.sleepTimer = isActive.value
      ? {
          active: true,
          minutes: selectedMinutes.value,
          remainingSeconds: Math.ceil(remainingMs.value / 1000),
        }
      : null
  }

  function startTicker() {
    clearTicker()
    if (!import.meta.client) return
    ticker = setInterval(() => {
      const left = refreshRemaining()
      syncStore()
      // The ticker only *renders*. Expiry is owned natively (or by the
      // fallback timeout in the browser); this is a safety net for the
      // case where the app was frozen straight through the deadline and
      // comes back to find the time already gone.
      if (left <= 0 && isActive.value) onExpired()
    }, TICK_INTERVAL_MS)
  }

  /** Adopts native timer state as the truth. */
  function adopt(state: { active: boolean; deadlineAt: number | null; remainingMs: number }) {
    if (!state.active || state.deadlineAt === null) {
      clearTicker()
      clearFallback()
      deadlineAt = null
      isActive.value = false
      remainingMs.value = 0
      selectedMinutes.value = 0
      syncStore()
      return
    }
    deadlineAt = state.deadlineAt
    isActive.value = true
    refreshRemaining()
    syncStore()
    startTicker()
  }

  /**
   * Arms the timer for `minutes`. A non-positive value cancels.
   *
   * Deliberately NOT bound to the current track: the deadline is
   * absolute, so Next/Previous cannot reset it (§16).
   */
  function setTimer(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      clearTimer()
      return
    }

    const durationMs = Math.round(minutes * 60 * 1000)
    selectedMinutes.value = minutes
    deadlineAt = Date.now() + durationMs
    isActive.value = true
    refreshRemaining()
    syncStore()
    startTicker()

    if (isNativePlayerAvailable()) {
      // Native owns expiry. Adopt its deadline when it answers so both
      // sides agree on the exact instant.
      void setSleepTimerNative(durationMs).then((state) => {
        if (state) adopt(state)
      })
    } else {
      // Browser: a single timeout, not a per-second countdown.
      clearFallback()
      fallbackTimeout = setTimeout(onExpired, durationMs)
    }
  }

  function setCustomTimer(minutes: number) {
    const m = Math.max(
      SLEEP_TIMER_MIN_MINUTES,
      Math.min(SLEEP_TIMER_MAX_MINUTES, Math.round(minutes)),
    )
    customMinutes.value = m
    setTimer(m)
    isCustomSheetOpen.value = false
  }

  function clearTimer() {
    clearTicker()
    clearFallback()
    deadlineAt = null
    isActive.value = false
    remainingMs.value = 0
    selectedMinutes.value = 0
    syncStore()
    if (isNativePlayerAvailable()) void cancelSleepTimerNative()
  }

  function openCustom() {
    isCustomSheetOpen.value = true
  }

  /**
   * Re-reads the native timer when the UI comes back to the foreground.
   *
   * While SYSTEMA is backgrounded the WebView is frozen, so the ticker
   * above stops and events can be missed entirely. Asking the engine on
   * resume is what makes the countdown correct after the phone has been
   * in a pocket — and what catches a timer that expired while away.
   */
  async function syncFromNative() {
    if (!isNativePlayerAvailable()) return
    const state = await getSleepTimerNative()
    if (!state) return
    const wasActive = isActive.value
    adopt(state)
    // Expired while we were frozen: reconcile the UI. The audio is
    // already paused natively, so this only catches the mirrors up.
    if (wasActive && !state.active) {
      selectedMinutes.value = 0
      if (import.meta.client) {
        window.dispatchEvent(new CustomEvent('systema:sleep-timer-end'))
      }
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') void syncFromNative()
  }

  // Installed once per app session, never per component instance.
  if (import.meta.client && !lifecycleInstalled) {
    lifecycleInstalled = true
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    window.addEventListener('beforeunload', () => {
      clearTicker()
      clearFallback()
    })
    // Adopt a timer that was already armed before this WebView existed
    // (Activity recreated, or the app reopened while one was running).
    void syncFromNative()
  }

  return {
    options: SLEEP_TIMER_OPTIONS,
    selectedMinutes: readonly(selectedMinutes),
    customMinutes,
    remainingMs: readonly(remainingMs),
    isActive: readonly(isActive),
    remainingFormatted,
    displayLabel,
    activeOption,
    isCustomSheetOpen,
    setTimer,
    setCustomTimer,
    clearTimer,
    openCustom,
    formatRemaining,
    /** Exposed for the native expiry event in useNativePlayer. */
    handleNativeExpiry: onExpired,
    adoptNativeState: adopt,
  }
}
