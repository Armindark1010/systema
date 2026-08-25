// ============================================================
// useLyrics — fake lyrics with timestamp sync
// ============================================================

export interface LyricLine {
  time: number // seconds
  text: string
}

export interface TrackLyrics {
  trackId: string
  lines: LyricLine[]
  language: string
}

// Fake lyrics database for prototype
const LYRICS_DB: Record<string, TrackLyrics> = {
  'tr-01': {
    trackId: 'tr-01',
    language: 'en',
    lines: [
      { time: 0, text: 'Structure holds' },
      { time: 4, text: 'Rhythm moves through steel and light' },
      { time: 9, text: 'Blueprint in the quiet' },
      { time: 14, text: 'Lines that never break' },
      { time: 19, text: 'Measured breath' },
      { time: 24, text: 'In the system, we awake' },
      { time: 30, text: 'Form follows function' },
      { time: 35, text: 'Function follows form' },
      { time: 41, text: 'In between, the music lives' },
      { time: 48, text: 'Structure & rhythm' },
      { time: 54, text: 'Structure & rhythm' },
      { time: 62, text: 'Hold the line' },
      { time: 68, text: 'Let it go' },
      { time: 74, text: 'Hold the line' },
      { time: 80, text: 'Let it flow' },
      { time: 92, text: 'Systema — listening' },
      { time: 110, text: 'Systema — breathing' },
      { time: 130, text: 'Structure holds' },
      { time: 150, text: 'Rhythm remains' },
    ],
  },
  'tr-04': {
    trackId: 'tr-04',
    language: 'en',
    lines: [
      { time: 0, text: 'A nightcall' },
      { time: 5, text: 'City lights fade to black' },
      { time: 11, text: 'Engine hums low' },
      { time: 17, text: 'Down an empty track' },
      { time: 24, text: 'You never know' },
      { time: 30, text: 'Where the road will take you' },
      { time: 38, text: 'But you keep driving' },
      { time: 44, text: 'Through the neon rain' },
      { time: 52, text: 'Nightcall — answer' },
      { time: 60, text: 'Nightcall — after dark' },
    ],
  },
  'tr-08': {
    trackId: 'tr-08',
    language: 'en',
    lines: [
      { time: 0, text: 'The city is my church' },
      { time: 6, text: 'It wraps me in its blinding lights' },
      { time: 13, text: 'Midnight city' },
      { time: 19, text: 'We’re running on the same line' },
      { time: 26, text: 'Waiting for the sunrise' },
      { time: 33, text: 'In the midnight city' },
      { time: 40, text: 'Oh, oh' },
      { time: 48, text: 'Lights are fading' },
      { time: 55, text: 'But we’re still glowing' },
    ],
  },
  'tr-24': {
    trackId: 'tr-24',
    language: 'fa',
    lines: [
      { time: 0, text: 'هوای غم' },
      { time: 5, text: 'دلم گرفته از این شب' },
      { time: 12, text: 'تو نیستی و' },
      { time: 18, text: 'صدای تو در باد' },
      { time: 25, text: 'هوای غم' },
      { time: 32, text: 'پر از سکوت و ترانه' },
      { time: 40, text: 'بیا که بی‌تو' },
      { time: 47, text: 'دلم نمی‌خوانه' },
    ],
  },
}

const FALLBACK_LYRICS: TrackLyrics = {
  trackId: 'fallback',
  language: 'en',
  lines: [
    { time: 0, text: 'Listening to the signal' },
    { time: 5, text: 'In the quiet between beats' },
    { time: 12, text: 'Architecture of sound' },
    { time: 18, text: 'Where memory meets' },
    { time: 25, text: 'Hold — and release' },
    { time: 32, text: 'Hold — and release' },
    { time: 40, text: 'Systema plays' },
    { time: 48, text: 'Systema stays' },
  ],
}

// Global state for lyrics mode
const lyricsMode = ref(false)

export function useLyrics() {
  const { currentTrack, progressMs } = usePlayer()

  const currentLyrics = computed<TrackLyrics | null>(() => {
    if (!currentTrack.value) return null
    return LYRICS_DB[currentTrack.value.id] ?? null
  })

  const hasLyrics = computed(() => {
    if (!currentTrack.value) return false
    // For prototype, every track has at least fallback
    return true
  })

  const displayLyrics = computed<LyricLine[]>(() => {
    if (!currentTrack.value) return []
    const db = LYRICS_DB[currentTrack.value.id]
    if (db) return db.lines
    return FALLBACK_LYRICS.lines
  })

  const currentLineIndex = computed(() => {
    const ms = progressMs.value
    const sec = ms / 1000
    const lines = displayLyrics.value
    if (!lines.length) return -1
    let idx = 0
    for (let i = 0; i < lines.length; i++) {
      if (sec >= lines[i]!.time) idx = i
      else break
    }
    return idx
  })

  const currentLine = computed(() => {
    const idx = currentLineIndex.value
    if (idx < 0) return null
    return displayLyrics.value[idx] ?? null
  })

  function toggleLyricsMode() {
    lyricsMode.value = !lyricsMode.value
  }

  function setLyricsMode(v: boolean) {
    lyricsMode.value = v
  }

  return {
    currentLyrics,
    displayLyrics,
    hasLyrics,
    currentLineIndex,
    currentLine,
    progressMs,
    isLyricsMode: readonly(lyricsMode),
    toggleLyricsMode,
    setLyricsMode,
  }
}
