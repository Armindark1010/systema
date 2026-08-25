// ============================================================
// SYSTEMA — Centralized Player Store (Pinia)
// ============================================================
// Single source of truth for music playback state across the
// entire application. Audio engine updates this state; UI components
// (Library, EMO, MiniPlayer, FullPlayer, Queue) consume it.
// ============================================================

import { defineStore } from 'pinia'
import type { Album, Playlist, RepeatMode, Track } from '~/types'
import { tracks as catalog } from '~/data/music'
import { recordPlayed } from '~/composables/usePlaybackHistory'
import { useSettingsStore } from '~/stores/settings'

export interface PlayerSleepTimerState {
  active: boolean
  minutes: number
  remainingSeconds: number
}

export const usePlayerStore = defineStore('player', () => {
  // ---- Initial tracks for pristine state ----------------------
  const initialTrack = catalog[0] ?? null
  const initialQueue = [
    catalog.find(t => t.id === 'tr-37'),
    catalog.find(t => t.id === 'tr-39'),
    catalog.find(t => t.id === 'tr-40'),
  ].filter((t): t is Track => Boolean(t))

  // ---- State -------------------------------------------------
  const currentTrack = ref<Track | null>(initialTrack)
  const isPlaying = ref(false)
  const currentTime = ref(0) // seconds (e.g. 14.2)
  const duration = ref(initialTrack ? initialTrack.duration : 0) // seconds
  const volume = ref(0.82)
  const muted = ref(false)
  const queue = ref<Track[]>(initialQueue)
  const history = ref<Track[]>([])
  const isShuffle = ref(false)
  const repeatMode = ref<RepeatMode>('off')
  const sleepTimer = ref<PlayerSleepTimerState | null>(null)
  const isPlayerReady = ref(true)
  const isLoading = ref(false)

  // UI modal / sheet state
  const fullPlayerOpen = ref(false)
  const queueOpen = ref(false)
  const favorites = ref<Set<string>>(new Set())

  // ---- Getters -----------------------------------------------
  const progressMs = computed({
    get: () => Math.round(currentTime.value * 1000),
    set: (ms: number) => { currentTime.value = ms / 1000 },
  })

  const durationMs = computed(() => Math.round((duration.value || (currentTrack.value?.duration ?? 0)) * 1000))

  const progressPct = computed(() => {
    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    if (dur <= 0) return 0
    return Math.max(0, Math.min(100, (currentTime.value / dur) * 100))
  })

  // Backwards-compatibility aliases
  const shuffle = computed({
    get: () => isShuffle.value,
    set: (val: boolean) => { isShuffle.value = val },
  })

  const repeat = computed({
    get: () => repeatMode.value,
    set: (val: RepeatMode) => { repeatMode.value = val },
  })

  const upNext = computed(() => queue.value)
  const queueCount = computed(() => queue.value.length)

  function isFavorite(id: string): boolean {
    return favorites.value.has(id)
  }

  // ---- Actions -----------------------------------------------

  /**
   * Start playing a track.
   * Updates state, clears currentTime, marks as playing.
   * Does NOT open full player — the caller or Mini Player decides UI navigation.
   */
  function playTrack(track: Track, _context = 'LIBRARY') {
    if (currentTrack.value && currentTrack.value.id !== track.id) {
      history.value.push(currentTrack.value)
    }
    // If track is in the upcoming queue, remove it from queue
    const inQueueIdx = queue.value.findIndex(t => t.id === track.id)
    if (inQueueIdx >= 0) {
      queue.value.splice(inQueueIdx, 1)
    }

    currentTrack.value = track
    duration.value = track.duration
    currentTime.value = 0
    isPlaying.value = true
    isLoading.value = false
    recordPlayed(track.id)
  }

  function pause() {
    isPlaying.value = false
  }

  function resume() {
    if (currentTrack.value) {
      isPlaying.value = true
    }
  }

  function togglePlay() {
    if (!currentTrack.value) return
    if (isPlaying.value) pause()
    else resume()
  }

  function next() {
    if (repeatMode.value === 'one') {
      currentTime.value = 0
      isPlaying.value = true
      return
    }

    if (queue.value.length > 0) {
      let nextTrack: Track
      if (isShuffle.value && queue.value.length > 1) {
        const randomIndex = Math.floor(Math.random() * queue.value.length)
        const [picked] = queue.value.splice(randomIndex, 1)
        nextTrack = picked!
      } else {
        nextTrack = queue.value.shift()!
      }

      if (currentTrack.value) {
        history.value.push(currentTrack.value)
        if (repeatMode.value === 'all') {
          queue.value.push(currentTrack.value)
        }
      }

      currentTrack.value = nextTrack
      duration.value = nextTrack.duration
      currentTime.value = 0
      isPlaying.value = true
      recordPlayed(nextTrack.id)
    } else if (repeatMode.value === 'all' && history.value.length > 0) {
      // Loop entire history back into queue
      const loopQueue = [...history.value]
      if (currentTrack.value) loopQueue.push(currentTrack.value)
      history.value = []
      const first = loopQueue.shift()!
      queue.value = loopQueue
      currentTrack.value = first
      duration.value = first.duration
      currentTime.value = 0
      isPlaying.value = true
      recordPlayed(first.id)
    } else if (shouldAutoplay()) {
      const related = relatedTracks(currentTrack.value)
      if (related.length) {
        queue.value = related.slice(1)
        const first = related[0]!
        if (currentTrack.value) history.value.push(currentTrack.value)
        currentTrack.value = first
        duration.value = first.duration
        currentTime.value = 0
        isPlaying.value = true
        recordPlayed(first.id)
      } else {
        isPlaying.value = false
        currentTime.value = 0
      }
    } else {
      isPlaying.value = false
      currentTime.value = 0
    }
  }

  function shouldAutoplay() {
    try {
      return useSettingsStore().playback.autoplay
    } catch {
      return false
    }
  }

  function relatedTracks(track: Track | null): Track[] {
    if (!track) return []
    return catalog
      .filter(item => item.id !== track.id && (item.artistId === track.artistId || item.genreId === track.genreId))
      .slice(0, 8)
  }

  function queueMode(): 'replace' | 'append' {
    try {
      return useSettingsStore().playback.queueAfterPlaylist
    } catch {
      return 'replace'
    }
  }

  function previous() {
    if (currentTime.value > 3) {
      currentTime.value = 0
      return
    }

    if (history.value.length > 0) {
      const prevTrack = history.value.pop()!
      if (currentTrack.value) {
        queue.value.unshift(currentTrack.value)
      }
      currentTrack.value = prevTrack
      duration.value = prevTrack.duration
      currentTime.value = 0
      isPlaying.value = true
      recordPlayed(prevTrack.id)
    } else {
      currentTime.value = 0
    }
  }

  function seek(timeInSecondsOrMs: number) {
    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    // If the value is in milliseconds (greater than duration when duration > 0)
    const seconds = dur > 0 && timeInSecondsOrMs > dur && timeInSecondsOrMs > 1000
      ? timeInSecondsOrMs / 1000
      : timeInSecondsOrMs
    currentTime.value = Math.max(0, Math.min(seconds, dur))
  }

  function seekForward(seconds = 10) {
    seek(currentTime.value + seconds)
  }

  function seekBackward(seconds = 10) {
    seek(currentTime.value - seconds)
  }

  function seekToPct(pct: number) {
    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    seek((pct / 100) * dur)
  }

  // ---- Queue Operations --------------------------------------

  function addToQueue(track: Track, atStart = false) {
    if (atStart) {
      queue.value.unshift(track)
    } else {
      queue.value.push(track)
    }
  }

  function removeFromQueue(trackIdOrIndex: string | number) {
    if (typeof trackIdOrIndex === 'number') {
      if (trackIdOrIndex >= 0 && trackIdOrIndex < queue.value.length) {
        queue.value.splice(trackIdOrIndex, 1)
      }
    } else {
      const idx = queue.value.findIndex(t => t.id === trackIdOrIndex)
      if (idx >= 0) {
        queue.value.splice(idx, 1)
      }
    }
  }

  /**
   * Reorders the real Pinia queue array.
   * Commits the new order immediately.
   */
  function reorderQueue(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= queue.value.length ||
      toIndex >= queue.value.length
    ) {
      return
    }

    const nextQueue = [...queue.value]
    const [moved] = nextQueue.splice(fromIndex, 1)
    if (!moved) return
    nextQueue.splice(toIndex, 0, moved)
    queue.value = nextQueue
  }

  function clearQueue() {
    queue.value = []
  }

  /**
   * Plays an upcoming queue item by its index in the queue.
   */
  function playQueueItem(queueIndex: number) {
    if (queueIndex < 0 || queueIndex >= queue.value.length) return
    const [picked] = queue.value.splice(queueIndex, 1)
    if (!picked) return

    if (currentTrack.value) {
      history.value.push(currentTrack.value)
    }

    currentTrack.value = picked
    duration.value = picked.duration
    currentTime.value = 0
    isPlaying.value = true
    recordPlayed(picked.id)
  }

  function shuffleQueue() {
    const array = [...queue.value]
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = array[i]!
      array[i] = array[j]!
      array[j] = temp
    }
    queue.value = array
  }

  function toggleShuffle() {
    isShuffle.value = !isShuffle.value
    if (isShuffle.value && queue.value.length > 1) {
      shuffleQueue()
    }
  }

  function cycleRepeat() {
    repeatMode.value = repeatMode.value === 'off' ? 'all' : repeatMode.value === 'all' ? 'one' : 'off'
  }

  function setVolume(v: number) {
    volume.value = Math.max(0, Math.min(1, v))
  }

  function toggleMute() {
    muted.value = !muted.value
  }

  function toggleFavoriteId(id: string) {
    const nextSet = new Set(favorites.value)
    if (nextSet.has(id)) nextSet.delete(id)
    else nextSet.add(id)
    favorites.value = nextSet
  }

  function toggleFavorite(trackId?: string) {
    const id = trackId ?? currentTrack.value?.id
    if (id) toggleFavoriteId(id)
  }

  function playQueue(tracks: Track[], startIndex = 0) {
    if (!tracks.length) return
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1))
    const start = tracks[safeIndex]!
    const rest = tracks.slice(safeIndex + 1)

    if (queueMode() === 'append' && currentTrack.value) {
      queue.value = [...queue.value, start, ...rest]
      return
    }

    history.value = tracks.slice(0, safeIndex)
    currentTrack.value = start
    duration.value = start.duration
    queue.value = rest
    currentTime.value = 0
    isPlaying.value = true
    recordPlayed(start.id)
  }

  function playPlaylist(pl: Playlist, startIndex = 0) {
    const playlistTracks = pl.trackIds
      .map(id => catalog.find(t => t.id === id))
      .filter((t): t is Track => Boolean(t))
    playQueue(playlistTracks, startIndex)
  }

  function playAlbum(_album: Album, albumTracks: Track[], startIndex = 0) {
    playQueue(albumTracks, startIndex)
  }

  function ensureFullPlayerNavigation() {
    if (!currentTrack.value || queue.value.length > 0) return
    const companionIds = ['tr-37', 'tr-39', 'tr-40']
    const companions = companionIds
      .filter(id => id !== currentTrack.value?.id)
      .map(id => catalog.find(t => t.id === id))
      .filter((t): t is Track => Boolean(t))
    if (companions.length) {
      queue.value = companions
    }
  }

  function openFullPlayer() {
    fullPlayerOpen.value = true
    queueOpen.value = false
  }

  function closeFullPlayer() {
    fullPlayerOpen.value = false
  }

  function setFullPlayerOpen(val: boolean) {
    fullPlayerOpen.value = val
    if (val) queueOpen.value = false
  }

  function openQueue() {
    queueOpen.value = true
  }

  function closeQueue() {
    queueOpen.value = false
  }

  function setQueueOpen(val: boolean) {
    queueOpen.value = val
  }

  return {
    // state
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    queue,
    history,
    isShuffle,
    repeatMode,
    sleepTimer,
    isPlayerReady,
    isLoading,
    fullPlayerOpen,
    queueOpen,
    favorites,

    // getters
    progressMs,
    durationMs,
    progressPct,
    shuffle,
    repeat,
    upNext,
    queueCount,
    isFavorite,

    // actions
    playTrack,
    pause,
    resume,
    togglePlay,
    next,
    previous,
    seek,
    seekForward,
    seekBackward,
    seekToPct,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    playQueueItem,
    shuffleQueue,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    toggleMute,
    toggleFavorite,
    toggleFavoriteId,
    playQueue,
    playPlaylist,
    playAlbum,
    ensureFullPlayerNavigation,
    openFullPlayer,
    closeFullPlayer,
    setFullPlayerOpen,
    openQueue,
    closeQueue,
    setQueueOpen,
  }
})
