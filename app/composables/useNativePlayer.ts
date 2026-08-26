// ============================================================
// useNativePlayer — binds the Pinia player store to Media3
// ============================================================
// Architecture:
//
//   Vue components
//        ↓ (actions only — never touch Kotlin directly)
//   Pinia player store
//        ↓ $onAction intents          ↑ native events
//   playerService  ──────────────────────────────────
//        ↓ Capacitor bridge
//   PlayerPlugin → PlayerEngine → Media3 ExoPlayer
//
// Two rules define this module:
//
//   1. Native is the source of truth. Every native event overwrites
//      the corresponding store field. The store's own optimistic
//      updates are allowed to run first (so the UI feels instant),
//      but any divergence is corrected by the next snapshot.
//
//   2. Intents flow one way. Store actions are intercepted with
//      `$onAction` and forwarded to the engine. Components keep
//      calling the same store actions they always have, so no UI code
//      changes and there is no second playback API to keep in sync.
//
// Position is NOT streamed from native. A local clock ticks the
// progress bar and is re-anchored from the engine periodically, which
// keeps the bar smooth without a bridge message per frame.
// ============================================================

import { usePlayerStore } from '~/stores/player'
import { useLibraryStore } from '~/stores/library'
import {
  addPlayerListeners,
  addToQueueNative,
  clearQueueNative,
  getPositionNative,
  getStateNative,
  isNativePlayerAvailable,
  isPlayableNatively,
  moveInQueueNative,
  nextNative,
  pauseNative,
  previousNative,
  removeFromQueueNative,
  resumeNative,
  seekByNative,
  seekToNative,
  setQueueNative,
  setRepeatNative,
  setShuffleNative,
  setVolumeNative,
  fromNativeRepeat,
  type PlayerSnapshot,
} from '~/services/native/playerService'

/**
 * UI tick for the progress bar. 250ms is four updates a second: below
 * the threshold where a listener perceives the bar as stepping, and
 * cheap because it only advances a local number — no bridge call.
 */
const CLOCK_INTERVAL_MS = 250

/**
 * How often the local clock is re-anchored to the real engine
 * position. Decoding jitter and seeks make a purely local clock drift;
 * one bridge read every 5 seconds removes that drift at negligible
 * cost, instead of ~240 reads over the same period.
 */
const RESYNC_INTERVAL_MS = 5_000

/**
 * Seek requests are coalesced over this window. A drag emits far more
 * pointermove events than the engine needs; the UI still shows every
 * intermediate position because the store updates optimistically.
 */
const SEEK_THROTTLE_MS = 120

let installed = false

export function useNativePlayer() {
  const player = usePlayerStore()

  let clockTimer: ReturnType<typeof setInterval> | null = null
  let disposeListeners: (() => void) | null = null
  let disposeActions: (() => void) | null = null

  /** Last track id Media3 reported. Guards against stale events. */
  let nativeTrackId: string | null = null
  let lastResyncAt = 0
  let seekTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSeekMs: number | null = null

  /**
   * Set while a native event is being applied to the store, so the
   * `$onAction` interceptor can tell a user intent apart from an echo
   * of native state and avoid sending it straight back.
   */
  let applyingNativeState = false

  function applyNative(mutate: () => void) {
    applyingNativeState = true
    try {
      mutate()
    } finally {
      applyingNativeState = false
    }
  }

  // ---- Native -> store ---------------------------------------

  function applySnapshot(snapshot: PlayerSnapshot) {
    // A snapshot naming a track the engine has already moved past is
    // stale — apply only its transport fields, never let it drag the
    // UI back to a superseded track.
    const stale = Boolean(
      snapshot.currentTrackId
      && nativeTrackId
      && snapshot.currentTrackId !== nativeTrackId,
    )
    if (!stale && snapshot.currentTrackId) {
      applyTrackChange(snapshot.currentTrackId)
    }

    applyNative(() => {
      player.isPlaying = snapshot.isPlaying
      player.buffering = snapshot.state === 'buffering'
      player.currentIndex = snapshot.currentIndex
      player.isShuffle = snapshot.shuffle
      player.repeatMode = fromNativeRepeat(snapshot.repeatMode)

      // Duration comes from the decoder, which is more trustworthy
      // than the MediaStore metadata the track was created with.
      if (snapshot.durationMs > 0) {
        player.duration = snapshot.durationMs / 1000
      }

      // Only re-anchor position on non-playing snapshots. While
      // playing, the local clock is smoother than sporadic events.
      if (!snapshot.isPlaying) {
        player.currentTime = snapshot.positionMs / 1000
      }
    })

    if (snapshot.isPlaying) startClock()
    else stopClock()
  }

  /**
   * Aligns the store's current track with the engine's.
   *
   * The store already moved itself optimistically when the user acted;
   * this corrects the cases it cannot know about — a track ending on
   * its own, or an unplayable file being skipped by the engine.
   *
   * Media3's current MediaItem is authoritative. `nativeTrackId` below
   * records the last id the engine reported so that a late-arriving
   * snapshot for a superseded track (Next pressed three times quickly)
   * cannot resurrect it.
   */
  function applyTrackChange(trackId: string | null) {
    if (!trackId) return
    nativeTrackId = trackId
    if (player.currentTrack?.id === trackId) return

    const fromQueue = player.queue.find(t => t.id === trackId)
    const fromHistory = player.history.find(t => t.id === trackId)
    const next = fromQueue ?? fromHistory

    // The engine is playing something the local queue does not know
    // about. Rather than leaving the UI stale, resolve it from the
    // library store — the native queue is the truth, not our mirror.
    if (!next) {
      const resolved = useLibraryStore().tracks.find(t => t.id === trackId)
      if (!resolved) return
      applyNative(() => {
        if (player.currentTrack) player.history.push(player.currentTrack)
        player.currentTrack = resolved
        player.currentTime = 0
        player.duration = resolved.duration
      })
      return
    }

    applyNative(() => {
      if (fromQueue) {
        // Advanced into the queue: mirror that move locally.
        const idx = player.queue.findIndex(t => t.id === trackId)
        if (idx >= 0) {
          if (player.currentTrack) player.history.push(player.currentTrack)
          player.queue.splice(0, idx + 1)
        }
      } else {
        // Stepped back into history.
        const idx = player.history.findIndex(t => t.id === trackId)
        if (idx >= 0) {
          if (player.currentTrack) player.queue.unshift(player.currentTrack)
          player.history.splice(idx, 1)
        }
      }
      player.currentTrack = next
      player.currentTime = 0
      player.duration = next.duration
    })
  }

  // ---- Local progress clock ----------------------------------

  function startClock() {
    if (clockTimer) return
    let last = performance.now()
    lastResyncAt = performance.now()

    clockTimer = setInterval(() => {
      if (!player.isPlaying) {
        stopClock()
        return
      }

      const now = performance.now()
      const elapsed = (now - last) / 1000
      last = now

      // Advance locally: no bridge traffic on the common path.
      const duration = player.duration || 0
      const next = player.currentTime + elapsed
      player.currentTime = duration > 0 ? Math.min(next, duration) : next

      // Periodic truth check against the engine.
      if (now - lastResyncAt >= RESYNC_INTERVAL_MS) {
        lastResyncAt = now
        void getPositionNative().then((result) => {
          if (!result || !player.isPlaying) return
          const actual = result.positionMs / 1000
          // Only correct a visible discrepancy; small differences are
          // invisible and rewriting them would make the bar stutter.
          if (Math.abs(actual - player.currentTime) > 0.75) {
            player.currentTime = actual
          }
        })
      }
    }, CLOCK_INTERVAL_MS)
  }

  function stopClock() {
    if (clockTimer) clearInterval(clockTimer)
    clockTimer = null
  }

  // ---- Store -> native ---------------------------------------

  /** Native queue = current track followed by the upcoming queue. */
  function pushQueue(autoPlay: boolean, positionMs = 0) {
    const current = player.currentTrack
    if (!current) return
    const tracks = [current, ...player.queue]
    void setQueueNative(tracks, 0, { autoPlay, positionMs })
  }

  function flushSeek() {
    if (pendingSeekMs === null) return
    void seekToNative(pendingSeekMs)
    pendingSeekMs = null
  }

  function throttledSeek(positionMs: number) {
    pendingSeekMs = positionMs
    if (seekTimer) return
    // Leading edge: the first seek of a drag goes out immediately so a
    // simple tap feels instant.
    flushSeek()
    seekTimer = setTimeout(() => {
      seekTimer = null
      flushSeek()
    }, SEEK_THROTTLE_MS)
  }

  /**
   * Forwards store actions to the engine.
   *
   * `after` is used so the store has already applied its optimistic
   * update: reading `player.currentTrack` here gives the track the
   * user just selected, and the engine is told to match.
   */
  function installActionBridge() {
    return player.$onAction(({ name, args, after }) => {
      if (applyingNativeState) return

      after(() => {
        switch (name) {
          case 'playTrack': {
            const track = args[0] as { id: string } | undefined
            // Mock catalog tracks have no URI; leave them to the
            // synthesised engine rather than failing natively.
            if (!isPlayableNatively(player.currentTrack)) return
            if (track && player.currentTrack?.id !== track.id) return
            pushQueue(true)
            break
          }

          case 'playQueue':
          case 'playPlaylist':
          case 'playAlbum':
          case 'playQueueItem':
            if (!isPlayableNatively(player.currentTrack)) return
            pushQueue(true)
            break

          case 'pause':
            void pauseNative()
            break

          case 'resume':
            void resumeNative()
            break

          case 'togglePlay':
            // The store already flipped isPlaying.
            if (player.isPlaying) void resumeNative()
            else void pauseNative()
            break

          case 'next':
            void nextNative()
            break

          case 'previous':
            void previousNative()
            break

          case 'seek':
          case 'seekToPct':
            throttledSeek(player.currentTime * 1000)
            break

          case 'seekForward':
          case 'seekBackward': {
            // Relative seeks go native as deltas so the engine clamps
            // against the real duration rather than our metadata copy.
            const seconds = (args[0] as number | undefined) ?? 10
            const delta = name === 'seekForward' ? seconds : -seconds
            void seekByNative(delta * 1000)
            break
          }

          case 'addToQueue': {
            const track = args[0] as { id: string } | undefined
            const atStart = args[1] === true
            const added = player.queue.find(t => t.id === track?.id)
            if (!added || !isPlayableNatively(added)) return
            // Native indices include the current track at 0.
            void addToQueueNative(added, atStart ? 1 : undefined)
            break
          }

          case 'removeFromQueue': {
            const arg = args[0]
            const id = typeof arg === 'string' ? arg : undefined
            if (id) void removeFromQueueNative(id)
            // Index-based removals are rarer; re-push to stay exact.
            else pushQueue(false)
            break
          }

          case 'reorderQueue': {
            const from = args[0] as number
            const to = args[1] as number
            // +1 for the current track occupying native index 0.
            void moveInQueueNative(from + 1, to + 1)
            break
          }

          case 'clearQueue':
            void clearQueueNative()
            break

          case 'shuffleQueue':
            // The store reordered its own array; mirror it wholesale.
            pushQueue(false)
            break

          case 'toggleShuffle':
            void setShuffleNative(player.isShuffle)
            break

          case 'cycleRepeat':
            void setRepeatNative(player.repeatMode)
            break

          case 'setVolume':
          case 'toggleMute':
            void setVolumeNative(player.muted ? 0 : player.volume)
            break
        }
      })
    })
  }

  // ---- Lifecycle ---------------------------------------------

  async function init() {
    if (!import.meta.client || installed) return false
    if (!isNativePlayerAvailable()) return false

    installed = true
    player.isNativePlayback = true

    disposeListeners = addPlayerListeners({
      onSnapshot: applySnapshot,
      onTrackChanged: event => applyTrackChange(event.trackId),
      onBuffering: event => applyNative(() => { player.buffering = event.buffering }),
      onDuration: (event) => {
        if (event.durationMs > 0) {
          applyNative(() => { player.duration = event.durationMs / 1000 })
        }
      },
      onError: (error) => {
        // Surfaced, never thrown: one unplayable file must not break
        // the session. The engine has already skipped past it.
        console.warn(`[SYSTEMA/PLAYER] ${error.code}: ${error.message}`)
        applyNative(() => {
          player.playerError = error
          player.buffering = false
        })
      },
    })

    disposeActions = installActionBridge()

    // Adopt whatever the engine is already doing — after an Activity
    // recreation playback continues while the WebView restarts.
    const snapshot = await getStateNative()
    if (snapshot) applySnapshot(snapshot)

    return true
  }

  function dispose() {
    stopClock()
    nativeTrackId = null
    if (seekTimer) clearTimeout(seekTimer)
    seekTimer = null
    disposeListeners?.()
    disposeActions?.()
    disposeListeners = null
    disposeActions = null
    installed = false
  }

  return { init, dispose }
}
