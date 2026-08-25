// ============================================================
// usePlayer — global player architecture (mock)
// ============================================================
// UI consumes this contract only. A future native adapter
// (Media3 / ExoPlayer / MediaSession via Capacitor) must
// satisfy the same shape — no frontend rewrite required.
// ============================================================

import type { Album, Playlist, QueueItem, RepeatMode, Track } from '~/types'
import { tracks as catalog } from '~/data/music'

const queue = ref<QueueItem[]>([])
const index = ref(-1)
const isPlaying = ref(false)
const progressMs = ref(0)
const shuffle = ref(false)
const repeat = ref<RepeatMode>('off')
const volume = ref(0.82)
const muted = ref(false)
const queueOpen = ref(false)
const fullPlayerOpen = ref(false)
const favorites = ref<Set<string>>(new Set())

// --- ticker: simulates playback time (no audio engine) ------------
let ticker: ReturnType<typeof setInterval> | null = null

function startTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    const current = queue.value[index.value]
    if (!current) return
    progressMs.value += 1000
    if (progressMs.value >= current.track.duration * 1000) {
      if (repeat.value === 'one') {
        progressMs.value = 0
      } else {
        next()
      }
    }
  }, 1000)
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

export function usePlayer() {
  const currentTrack = computed<Track | null>(() => queue.value[index.value]?.track ?? null)
  const durationMs = computed(() => (currentTrack.value ? currentTrack.value.duration * 1000 : 0))
  const progressPct = computed(() =>
    durationMs.value ? Math.min(100, (progressMs.value / durationMs.value) * 100) : 0,
  )

  function playQueue(items: QueueItem[], startIndex = 0) {
    queue.value = items
    index.value = startIndex
    progressMs.value = 0
    isPlaying.value = true
    startTicker()
  }

  function playTrack(track: Track, context = 'LIBRARY') {
    const existing = queue.value.findIndex((q) => q.track.id === track.id)
    if (existing >= 0) {
      index.value = existing
    } else {
      queue.value = [...queue.value, { track, context }]
      index.value = queue.value.length - 1
    }
    progressMs.value = 0
    isPlaying.value = true
    startTicker()
  }

  function playPlaylist(pl: Playlist, startIndex = 0) {
    const items: QueueItem[] = pl.trackIds
      .map((id) => catalog.find((t) => t.id === id))
      .filter((t): t is Track => Boolean(t))
      .map((track) => ({ track, context: pl.title }))
    playQueue(items, startIndex)
  }

  function playAlbum(album: Album, albumTracks: Track[], startIndex = 0) {
    playQueue(
      albumTracks.map((track) => ({ track, context: album.title })),
      startIndex,
    )
  }

  function togglePlay() {
    if (!currentTrack.value) return
    isPlaying.value = !isPlaying.value
    if (isPlaying.value) startTicker()
    else stopTicker()
  }

  function seek(ms: number) {
    progressMs.value = Math.max(0, Math.min(ms, durationMs.value))
  }

  function seekToPct(pct: number) {
    seek((pct / 100) * durationMs.value)
  }

  function next() {
    if (!queue.value.length) return
    if (shuffle.value && queue.value.length > 1) {
      let n = index.value
      while (n === index.value) n = Math.floor(Math.random() * queue.value.length)
      index.value = n
    } else if (index.value < queue.value.length - 1) {
      index.value += 1
    } else if (repeat.value === 'all') {
      index.value = 0
    } else {
      isPlaying.value = false
      stopTicker()
      return
    }
    progressMs.value = 0
  }

  function prev() {
    if (!queue.value.length) return
    // restart current track if > 3s in
    if (progressMs.value > 3000) {
      progressMs.value = 0
      return
    }
    if (index.value > 0) {
      index.value -= 1
      progressMs.value = 0
    }
  }

  function toggleFavorite() {
    const t = currentTrack.value
    if (!t) return
    toggleFavoriteId(t.id)
  }

  function toggleFavoriteId(id: string) {
    const nextSet = new Set(favorites.value)
    if (nextSet.has(id)) nextSet.delete(id)
    else nextSet.add(id)
    favorites.value = nextSet
  }

  function isFavorite(id: string): boolean {
    return favorites.value.has(id)
  }

  function cycleRepeat() {
    repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off'
  }

  function removeFromQueue(i: number) {
    if (i < 0 || i >= queue.value.length) return
    queue.value.splice(i, 1)
    if (i < index.value) index.value -= 1
    else if (i === index.value) {
      index.value = Math.min(index.value, queue.value.length - 1)
      progressMs.value = 0
      if (queue.value.length === 0) isPlaying.value = false
    }
  }

  function clearQueue() {
    queue.value = []
    index.value = -1
    progressMs.value = 0
    isPlaying.value = false
    stopTicker()
  }

  function openFullPlayer() {
    fullPlayerOpen.value = true
    queueOpen.value = false
  }

  return {
    queue,
    index,
    currentTrack,
    isPlaying,
    progressMs,
    durationMs,
    progressPct,
    shuffle,
    repeat,
    volume,
    muted,
    favorites,
    queueOpen,
    fullPlayerOpen,
    playQueue,
    playTrack,
    playPlaylist,
    playAlbum,
    togglePlay,
    seek,
    seekToPct,
    next,
    prev,
    toggleFavorite,
    toggleFavoriteId,
    isFavorite,
    cycleRepeat,
    toggleShuffle: () => (shuffle.value = !shuffle.value),
    setVolume: (v: number) => (volume.value = Math.max(0, Math.min(1, v))),
    toggleMute: () => (muted.value = !muted.value),
    removeFromQueue,
    clearQueue,
    openFullPlayer,
    setQueueOpen: (v: boolean) => (queueOpen.value = v),
    setFullPlayerOpen: (v: boolean) => (fullPlayerOpen.value = v),
  }
}
