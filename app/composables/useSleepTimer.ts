// ============================================================
// useSleepTimer — global sleep timer logic
// ============================================================
// Survives component re-renders via module-scoped state.
// When timer reaches zero: stop playback, set EMO sleepy, clear.
// ============================================================

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

const selectedMinutes = ref<number>(0) // 0 = OFF, -1 = custom pending
const customMinutes = ref<number>(20)
const remainingMs = ref<number>(0)
const isActive = ref<boolean>(false)
const isCustomSheetOpen = ref<boolean>(false)

let interval: ReturnType<typeof setInterval> | null = null

function clearIntervalSafe() {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function useSleepTimer() {
  const { isPlaying, togglePlay } = usePlayer()

  const remainingFormatted = computed(() => formatRemaining(remainingMs.value))
  const displayLabel = computed(() => {
    if (!isActive.value) return null
    return remainingFormatted.value
  })

  const activeOption = computed(() =>
    SLEEP_TIMER_OPTIONS.find(o => o.value === selectedMinutes.value) ?? null,
  )

  function stopPlaybackCompletely() {
    if (isPlaying.value) {
      // togglePlay will pause; we want stop -> pause is enough for mock engine
      // In real engine, would stop and release.
      const player = usePlayer()
      player.isPlaying.value = false
    }
  }

  function onTimerEnd() {
    clearIntervalSafe()
    isActive.value = false
    remainingMs.value = 0
    selectedMinutes.value = 0
    stopPlaybackCompletely()
    // EMO state will be handled by parent via watching isActive / timerEnd event
    // Emit a custom event for EMO to go sleepy
    if (import.meta.client) {
      window.dispatchEvent(new CustomEvent('systema:sleep-timer-end'))
    }
  }

  function startInterval() {
    clearIntervalSafe()
    interval = setInterval(() => {
      remainingMs.value -= 1000
      if (remainingMs.value <= 0) {
        onTimerEnd()
      }
    }, 1000)
  }

  function setTimer(minutes: number) {
    if (minutes <= 0) {
      clearTimer()
      return
    }
    selectedMinutes.value = minutes
    remainingMs.value = minutes * 60 * 1000
    isActive.value = true
    startInterval()
  }

  function setCustomTimer(minutes: number) {
    const m = Math.max(1, Math.min(480, Math.round(minutes)))
    customMinutes.value = m
    setTimer(m)
    isCustomSheetOpen.value = false
  }

  function clearTimer() {
    clearIntervalSafe()
    isActive.value = false
    remainingMs.value = 0
    selectedMinutes.value = 0
  }

  function openCustom() {
    isCustomSheetOpen.value = true
  }

  // Cleanup on HMR / unmount not needed due to global, but provide
  if (import.meta.client) {
    // ensure interval cleared on page unload
    window.addEventListener('beforeunload', clearIntervalSafe)
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
  }
}
