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
import { useLibraryStore } from '~/stores/library'

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
  // ---- Canonical queue model ---------------------------------
  // ONE flat ordered list plus an index into it, mirroring the Media3
  // playlist exactly. Previously the queue was a *consumed* array
  // (next() shifted tracks out, previous() pushed them back), which
  // meant the frontend order and the native order diverged the moment
  // playback moved: Media3 still held A,B,C,D at index 1 while Pinia
  // held [C,D] with A,B stranded in a separate history array.
  //
  // `queue` and `history` below are now derived views over this list,
  // so every existing consumer keeps working while the underlying
  // order can no longer drift from the engine's.
  const playbackOrder = ref<Track[]>(
    initialTrack ? [initialTrack, ...initialQueue] : [...initialQueue],
  )
  /** Index into `playbackOrder`. -1 when nothing is loaded. */
  const currentIndex = ref(initialTrack ? 0 : -1)

  /**
   * Deterministic shuffle order: a permutation of `playbackOrder`
   * indices, current track first. Never a re-randomised pick per Next,
   * so forward and backward navigation retrace the same path.
   */
  const shuffleOrder = ref<number[]>([])

  /**
   * Playback order as a list of `playbackOrder` indices.
   * Linear when shuffle is off, the shuffle permutation when on.
   */
  function orderPositions(): number[] {
    if (isShuffle.value && shuffleOrder.value.length === playbackOrder.value.length) {
      return shuffleOrder.value
    }
    return playbackOrder.value.map((_, i) => i)
  }

  /**
   * The playing track, derived from the order + index so it can never
   * disagree with the queue. Writable for the native mirror: assigning
   * a track moves the index to it rather than storing a second copy.
   */
  const currentTrack = computed<Track | null>({
    get: () => playbackOrder.value[currentIndex.value] ?? null,
    set: (track: Track | null) => {
      if (!track) {
        currentIndex.value = -1
        return
      }
      const idx = playbackOrder.value.findIndex(t => t.id === track.id)
      if (idx >= 0) {
        currentIndex.value = idx
        return
      }
      // The engine is playing something outside the known order (it
      // skipped an unplayable file, say). Splice it in after the
      // current position so ordering stays sensible.
      const at = Math.max(0, currentIndex.value + 1)
      playbackOrder.value = [
        ...playbackOrder.value.slice(0, at),
        track,
        ...playbackOrder.value.slice(at),
      ]
      currentIndex.value = at
    },
  })

  /**
   * UP NEXT — everything after the current track in playback order
   * (shuffle-aware). A derived view, so the Queue UI keeps rendering
   * the same shape while the data can no longer drift from native.
   */
  const queue = computed<Track[]>(() => {
    if (currentIndex.value < 0) return playbackOrder.value
    const positions = orderPositions()
    const at = positions.indexOf(currentIndex.value)
    if (at < 0) return []
    return positions.slice(at + 1).map(i => playbackOrder.value[i]!).filter(Boolean)
  })

  /** Tracks already passed in the current playback order. */
  const history = computed<Track[]>(() => {
    if (currentIndex.value < 0) return []
    const positions = orderPositions()
    const at = positions.indexOf(currentIndex.value)
    if (at <= 0) return []
    return positions.slice(0, at).map(i => playbackOrder.value[i]!).filter(Boolean)
  })

  const isPlaying = ref(false)
  const currentTime = ref(0) // seconds (e.g. 14.2)
  const duration = ref(initialTrack ? initialTrack.duration : 0) // seconds
  const volume = ref(0.82)
  const muted = ref(false)
  const isShuffle = ref(false)
  const repeatMode = ref<RepeatMode>('off')
  const sleepTimer = ref<PlayerSleepTimerState | null>(null)
  const isPlayerReady = ref(true)
  const isLoading = ref(false)

  // ---- Native playback mirror ---------------------------------
  // On Android the Media3 engine is the source of truth. These
  // fields mirror it for the UI; they are inert in the browser.
  /** True once the native engine has taken over playback. */
  const isNativePlayback = ref(false)
  /** Native buffering state, distinct from our own loading flag. */
  const buffering = ref(false)
  /** Last structured playback failure, or null. */
  const playerError = ref<{ code: string; message: string; trackId: string | null } | null>(null)

  /**
   * True while playback is paused by an audio-focus loss (a call, a
   * navigation prompt, another music app) rather than by the user.
   * Media3 owns the focus behaviour; this is the UI-facing mirror of
   * it, so a surface can say "paused by another app" instead of
   * implying the user did it. Cleared as soon as playback resumes.
   */
  const interrupted = ref(false)
  // `currentIndex` is declared with the queue model above: there is
  // exactly one index, shared by the UI and the native mirror.

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
  // ---- Navigation helpers ------------------------------------

  /**
   * Previous restarts the current track past this many seconds rather
   * than stepping back. Kept as a named constant so it is adjustable
   * in one place.
   */
  const RESTART_THRESHOLD_SECONDS = 3

  /**
   * Builds the deterministic shuffle permutation.
   *
   * The current track is pinned first so enabling shuffle never
   * interrupts what is playing, and the rest are shuffled once. The
   * permutation is then FIXED, which is what makes Next and Previous
   * retrace the same path instead of re-randomising per press.
   */
  function rebuildShuffleOrder() {
    const indices = playbackOrder.value.map((_, i) => i)
    const current = currentIndex.value

    const rest = indices.filter(i => i !== current)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = rest[i]!
      rest[i] = rest[j]!
      rest[j] = tmp
    }

    shuffleOrder.value = current >= 0 ? [current, ...rest] : rest
  }

  /** Moves to an index in `playbackOrder` and starts playback. */
  function moveTo(index: number) {
    const track = playbackOrder.value[index]
    if (!track) return
    currentIndex.value = index
    duration.value = track.duration
    currentTime.value = 0
    isPlaying.value = true
    notePlaybackStarted()
  }

  /**
   * RECENTS boundary.
   *
   * Recents record tracks that actually START playing. On native the
   * engine confirms this and useNativePlayer records it from the real
   * currentMediaItem, so recording here too would double-count and let
   * a track that never played (missing file) into the history.
   */
  function notePlaybackStarted() {
    if (isNativePlayback.value) return
    const track = currentTrack.value
    if (track) recordPlayed(track.id, track)
  }

  /**
   * PLAY(track) semantics — deliberately two distinct behaviours.
   *
   *   Track IS already in the playback order
   *     -> preserve the queue and jump to that item. Tapping a track
   *        in the queue, or re-tapping one in the list you are already
   *        playing from, must not destroy the context.
   *
   *   Track is NOT in the playback order
   *     -> this is a new single-track context; it becomes the order.
   *        Callers that want a fuller context (a playlist, an album,
   *        a filtered list) call playQueue() with the whole list —
   *        that is what Library/Search/Playlist do via playTracks().
   *
   * Either way the queue is never silently replaced just because a
   * card was tapped.
   */
  function playTrack(track: Track, _context = 'LIBRARY') {
    const existing = playbackOrder.value.findIndex(t => t.id === track.id)

    if (existing >= 0) {
      // Preserve the context; simply move to that item.
      currentIndex.value = existing
    } else {
      playbackOrder.value = [track]
      currentIndex.value = 0
      rebuildShuffleOrder()
    }

    duration.value = track.duration
    currentTime.value = 0
    isPlaying.value = true
    isLoading.value = false
    notePlaybackStarted()
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

  /**
   * Advance one item in the ACTUAL playback order.
   *
   * Walks the shuffle permutation when shuffle is on and the linear
   * order otherwise, so A->B->C->D is deterministic and never a random
   * pick. REPEAT_ONE applies to automatic track ends, not to a
   * deliberate skip, so an explicit Next still advances.
   */
  function next(options: { auto?: boolean } = {}) {
    if (currentIndex.value < 0) return

    // Automatic end-of-track under repeat-one: replay the same item.
    if (options.auto && repeatMode.value === 'one') {
      currentTime.value = 0
      isPlaying.value = true
      return
    }

    const positions = orderPositions()
    const at = positions.indexOf(currentIndex.value)
    if (at < 0) return

    if (at < positions.length - 1) {
      moveTo(positions[at + 1]!)
      return
    }

    // End of the order.
    if (repeatMode.value === 'all' && positions.length > 0) {
      moveTo(positions[0]!)
      return
    }

    if (shouldAutoplay()) {
      const related = relatedTracks(currentTrack.value)
      if (related.length) {
        // Extend the existing order rather than replacing it, so the
        // tracks already played stay reachable with Previous.
        const first = playbackOrder.value.length
        playbackOrder.value = [...playbackOrder.value, ...related]
        rebuildShuffleOrder()
        moveTo(first)
        return
      }
    }

    isPlaying.value = false
    currentTime.value = 0
  }

  /**
   * Step back one item in the actual playback order.
   *
   * Standard music-player behaviour: past RESTART_THRESHOLD_SECONDS
   * into a track, Previous restarts it instead of moving back.
   */
  function previous() {
    if (currentIndex.value < 0) return

    if (currentTime.value > RESTART_THRESHOLD_SECONDS) {
      currentTime.value = 0
      return
    }

    const positions = orderPositions()
    const at = positions.indexOf(currentIndex.value)
    if (at < 0) return

    if (at > 0) {
      moveTo(positions[at - 1]!)
      return
    }

    // Start of the order.
    if (repeatMode.value === 'all' && positions.length > 0) {
      moveTo(positions[positions.length - 1]!)
      return
    }

    currentTime.value = 0
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

  /**
   * Seeks to an absolute position, in seconds (milliseconds are
   * tolerated for backwards compatibility).
   *
   * The upper clamp only applies when the duration is actually known.
   * Clamping against a zero/unknown duration used to force every such
   * seek to 0:00 — which is what made seeking immediately after a
   * track change, or before the decoder had reported a duration, jump
   * back to the start. When the duration is unknown the request is
   * passed through and the native engine (or the audio element)
   * resolves it once the timeline lands.
   */
  function seek(timeInSecondsOrMs: number) {
    if (!Number.isFinite(timeInSecondsOrMs)) return

    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    // If the value is in milliseconds (greater than duration when duration > 0, or > 1000 when dur <= 0)
    const seconds = (dur > 0 && timeInSecondsOrMs > dur) || (dur <= 0 && timeInSecondsOrMs > 1000)
      ? timeInSecondsOrMs / 1000
      : timeInSecondsOrMs

    const floored = Math.max(0, seconds)
    currentTime.value = dur > 0 ? Math.min(floored, dur) : floored
  }

  function seekMs(timeInMs: number) {
    if (!Number.isFinite(timeInMs)) return
    const seconds = Math.max(0, timeInMs / 1000)
    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    currentTime.value = dur > 0 ? Math.min(seconds, dur) : seconds
  }

  function seekForward(seconds = 10) {
    seek(currentTime.value + seconds)
  }

  function seekBackward(seconds = 10) {
    seek(currentTime.value - seconds)
  }

  /**
   * Seeks by percentage of the track. A no-op while the duration is
   * unknown: without one, a percentage has nothing to resolve against
   * and would seek to 0.
   */
  function seekToPct(pct: number) {
    if (!Number.isFinite(pct)) return
    const dur = duration.value || (currentTrack.value?.duration ?? 0)
    if (dur <= 0) return
    seek((Math.max(0, Math.min(100, pct)) / 100) * dur)
  }

  // ---- Queue Operations --------------------------------------

  /**
   * Queue a track. `atStart` places it immediately after the current
   * item ("play next") rather than at the end of the order.
   */
  function addToQueue(track: Track, atStart = false) {
    const at = atStart
      ? Math.max(0, currentIndex.value + 1)
      : playbackOrder.value.length

    playbackOrder.value = [
      ...playbackOrder.value.slice(0, at),
      track,
      ...playbackOrder.value.slice(at),
    ]

    // Inserting before the current item would shift it.
    if (at <= currentIndex.value) currentIndex.value += 1
    rebuildShuffleOrder()
  }

  /**
   * Removes a track from the order.
   *
   * A numeric argument indexes the UP NEXT view (what the Queue UI
   * renders), not the raw order — that is the contract callers have
   * always used.
   */
  function removeFromQueue(trackIdOrIndex: string | number) {
    let orderIndex = -1

    if (typeof trackIdOrIndex === 'number') {
      const upNextTrack = queue.value[trackIdOrIndex]
      if (!upNextTrack) return
      orderIndex = playbackOrder.value.findIndex(t => t.id === upNextTrack.id)
    } else {
      orderIndex = playbackOrder.value.findIndex(t => t.id === trackIdOrIndex)
    }

    if (orderIndex < 0) return
    // Removing the playing item is not a queue edit; ignore it.
    if (orderIndex === currentIndex.value) return

    playbackOrder.value = playbackOrder.value.filter((_, i) => i !== orderIndex)
    if (orderIndex < currentIndex.value) currentIndex.value -= 1
    rebuildShuffleOrder()
  }

  /**
   * Reorders the REAL playback order.
   *
   * Indices address the UP NEXT view; they are translated to absolute
   * positions in `playbackOrder` so the change is a genuine playback
   * reorder rather than a cosmetic list shuffle. The currently playing
   * track keeps playing and its index is adjusted, never restarted.
   */
  function reorderQueue(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return

    const upNext = queue.value
    const moved = upNext[fromIndex]
    const target = upNext[toIndex]
    if (!moved || !target) return

    const from = playbackOrder.value.findIndex(t => t.id === moved.id)
    const to = playbackOrder.value.findIndex(t => t.id === target.id)
    if (from < 0 || to < 0) return

    const nextOrder = [...playbackOrder.value]
    const [item] = nextOrder.splice(from, 1)
    if (!item) return
    nextOrder.splice(to, 0, item)

    // Keep the index pointing at the same TRACK, not the same slot.
    const playing = currentTrack.value
    playbackOrder.value = nextOrder
    if (playing) {
      const idx = nextOrder.findIndex(t => t.id === playing.id)
      if (idx >= 0) currentIndex.value = idx
    }
    rebuildShuffleOrder()
  }

  /** Clears everything except the track currently playing. */
  function clearQueue() {
    const playing = currentTrack.value
    if (playing) {
      playbackOrder.value = [playing]
      currentIndex.value = 0
    } else {
      playbackOrder.value = []
      currentIndex.value = -1
    }
    rebuildShuffleOrder()
  }

  /** Plays an UP NEXT item by its index in that view. */
  function playQueueItem(queueIndex: number) {
    const picked = queue.value[queueIndex]
    if (!picked) return
    const orderIndex = playbackOrder.value.findIndex(t => t.id === picked.id)
    if (orderIndex < 0) return
    moveTo(orderIndex)
  }

  /** Regenerates the shuffle permutation, keeping the current track. */
  function shuffleQueue() {
    rebuildShuffleOrder()
  }

  /**
   * Toggle shuffle without interrupting playback.
   *
   * Enabling builds a permutation with the current track pinned first;
   * disabling simply stops consulting it, so the original order is
   * restored intact. The playing track is preserved either way — the
   * order is never destructively rewritten.
   */
  function toggleShuffle() {
    isShuffle.value = !isShuffle.value
    if (isShuffle.value) rebuildShuffleOrder()
    else shuffleOrder.value = []
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

  /**
   * Start a playback CONTEXT from a list.
   *
   * The whole list becomes the playback order and `startIndex` becomes
   * the current item, so tapping track C of A,B,C,D,E gives
   * Previous -> B and Next -> D. The tracks before the start point are
   * genuinely part of the order and reachable with Previous, rather
   * than being dropped as they were before.
   *
   * Used identically by Library, Search, Playlist, Album and Artist,
   * so all five surfaces behave the same.
   */
  function playQueue(tracks: Track[], startIndex = 0) {
    if (!tracks.length) return
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1))

    // "Append" mode: keep playing, add the list after the current item.
    if (queueMode() === 'append' && currentTrack.value) {
      const at = Math.max(0, currentIndex.value + 1)
      playbackOrder.value = [
        ...playbackOrder.value.slice(0, at),
        ...tracks,
        ...playbackOrder.value.slice(at),
      ]
      rebuildShuffleOrder()
      return
    }

    playbackOrder.value = [...tracks]
    currentIndex.value = safeIndex
    rebuildShuffleOrder()

    const start = tracks[safeIndex]!
    duration.value = start.duration
    currentTime.value = 0
    isPlaying.value = true
    notePlaybackStarted()
  }

  function playPlaylist(pl: Playlist, startIndex = 0) {
    // Resolve against the live library first so playlists of device
    // tracks work; the mock catalog remains the browser fallback.
    const resolve = (id: string): Track | undefined => {
      try {
        const fromLibrary = useLibraryStore().tracks.find(t => t.id === id)
        if (fromLibrary) return fromLibrary
      } catch {
        /* store unavailable (SSR) */
      }
      return catalog.find(t => t.id === id)
    }

    const playlistTracks = pl.trackIds
      .map(resolve)
      .filter((t): t is Track => Boolean(t))
    playQueue(playlistTracks, startIndex)
  }

  function playAlbum(_album: Album, albumTracks: Track[], startIndex = 0) {
    playQueue(albumTracks, startIndex)
  }

  /**
   * Demo affordance: give the browser mock player something to skip
   * to. Never runs on native, where the real queue is authoritative.
   */
  function ensureFullPlayerNavigation() {
    if (isNativePlayback.value) return
    if (!currentTrack.value || queue.value.length > 0) return
    const companionIds = ['tr-37', 'tr-39', 'tr-40']
    const companions = companionIds
      .filter(id => id !== currentTrack.value?.id)
      .map(id => catalog.find(t => t.id === id))
      .filter((t): t is Track => Boolean(t))
    if (companions.length) {
      playbackOrder.value = [...playbackOrder.value, ...companions]
      rebuildShuffleOrder()
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
    playbackOrder,
    shuffleOrder,
    isNativePlayback,
    buffering,
    playerError,
    interrupted,
    currentIndex,
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
    seekMs,
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
