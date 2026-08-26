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

import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'
import { useLibraryStore } from '~/stores/library'
import { recordPlayed } from '~/composables/usePlaybackHistory'
import {
  addPlayerListeners,
  addToQueueNative,
  clearQueueNative,
  getPositionNative,
  getQueueNative,
  getStateNative,
  isNativePlayerAvailable,
  isPlayableNatively,
  moveInQueueNative,
  nextNative,
  pauseNative,
  previousNative,
  getNotificationPermissionNative,
  requestNotificationPermissionNative,
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
  /** Last id written to recents, so repeat events do not duplicate. */
  let recordedTrackId: string | null = null
  /** One-shot latch for the notification permission prompt. */
  let notificationPermissionAsked = false
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

  /**
   * @param authoritative Treat the snapshot as ground truth rather
   *   than a possibly-out-of-order event. Used when we ASKED the
   *   engine for its state (startup, returning to foreground), where
   *   the reply is by definition current and the stale-event guard
   *   would wrongly reject a track changed while backgrounded.
   */
  function applySnapshot(snapshot: PlayerSnapshot, authoritative = false) {
    // A snapshot naming a track the engine has already moved past is
    // stale — apply only its transport fields, never let it drag the
    // UI back to a superseded track.
    const stale = !authoritative && Boolean(
      snapshot.currentTrackId
      && nativeTrackId
      && snapshot.currentTrackId !== nativeTrackId,
    )
    if (authoritative) {
      // Accept the engine's answer wholesale: drop the guard latch so
      // a track advanced from the notification is not mistaken for a
      // stale event.
      nativeTrackId = snapshot.currentTrackId ?? null
    }
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

    // Media3's current MediaItem carries the SYSTEMA track id as its
    // mediaId, so resolution is by stable id — never by index.
    const orderIndex = player.playbackOrder.findIndex(t => t.id === trackId)

    if (orderIndex >= 0) {
      // Move the index; the order itself is untouched, so the frontend
      // order and the native playlist stay identical.
      applyNative(() => {
        player.currentIndex = orderIndex
        const track = player.playbackOrder[orderIndex]
        if (track) {
          player.currentTime = 0
          player.duration = track.duration
        }
      })
      noteNativePlayback(trackId)
      return
    }

    // The engine is playing something our mirror does not contain.
    // Resolve it from the library rather than leaving the UI stale.
    const resolved = useLibraryStore().tracks.find(t => t.id === trackId)
    if (!resolved) {
      // Structured, visible, and non-destructive: we do NOT silently
      // substitute a different track.
      console.warn(
        `[SYSTEMA/PLAYER] Media3 reported unknown track "${trackId}"; `
        + 'the UI cannot resolve it.',
      )
      applyNative(() => {
        player.playerError = {
          code: 'NOT_FOUND',
          message: 'The playing track could not be resolved.',
          trackId,
        }
      })
      return
    }

    applyNative(() => {
      // The writable currentTrack setter splices it in after the
      // current position and moves the index there.
      player.currentTrack = resolved
      player.currentTime = 0
      player.duration = resolved.duration
    })
    noteNativePlayback(trackId)
  }

  /**
   * RECENTS on native.
   *
   * Recorded here, from the engine's real current item, and only once
   * playback is genuinely under way. Repeat events for the same track
   * collapse in recordPlayed(), so pause/resume and duplicate
   * transitions cannot create duplicates.
   */
  function noteNativePlayback(trackId: string) {
    // Playback is genuinely under way: a good moment to ask about the
    // notification, and the only place we do.
    void ensureNotificationPermission()
    if (recordedTrackId === trackId) return
    const track = player.playbackOrder.find(t => t.id === trackId)
      ?? useLibraryStore().tracks.find(t => t.id === trackId)
    if (!track) return
    recordedTrackId = trackId
    recordPlayed(trackId, track)
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

  /**
   * Pushes the WHOLE playback order to Media3, with the current index.
   *
   * The frontend order and the native playlist are now the same list,
   * so the engine receives tracks that were played before the current
   * one too — which is what makes native Previous able to step back
   * through them instead of dead-ending.
   */
  function pushQueue(autoPlay: boolean, positionMs = 0) {
    const order = player.playbackOrder
    if (!order.length) return
    const index = Math.max(0, player.currentIndex)
    void setQueueNative(order, index, { autoPlay, positionMs })
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
  // ---- Navigation serialization -------------------------------
  // Rapid Next/Next/Next (or Previous/Previous/Next) fires overlapping
  // async bridge calls. Without ordering, an earlier reply can land
  // after a later one and leave the UI on a track the engine already
  // moved past. Commands are therefore chained: each waits for the
  // previous to settle, so the final state always reflects the last
  // command issued.
  let navigationChain: Promise<unknown> = Promise.resolve()

  function enqueueNavigation(command: () => Promise<unknown>) {
    navigationChain = navigationChain
      .catch(() => undefined)
      .then(() => command())
      .catch((error) => {
        console.warn('[SYSTEMA/PLAYER] Navigation command failed', error)
      })
    return navigationChain
  }

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
            // The store either jumped within the existing context or
            // started a new one. Pushing the whole order with the
            // current index covers both without special-casing.
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
            enqueueNavigation(nextNative)
            break

          case 'previous':
            enqueueNavigation(previousNative)
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
            const added = player.playbackOrder.find(t => t.id === track?.id)
            if (!added || !isPlayableNatively(added)) return
            // The store already inserted it; mirror the same absolute
            // position so both lists stay identical.
            const at = player.playbackOrder.findIndex(t => t.id === added.id)
            void addToQueueNative(added, at >= 0 ? at : undefined)
            break
          }

          case 'removeFromQueue': {
            const arg = args[0]
            if (typeof arg === 'string') void removeFromQueueNative(arg)
            // Index-based removals addressed the UP NEXT view, which
            // the store has already resolved; re-push to stay exact.
            else pushQueue(false)
            break
          }

          case 'reorderQueue': {
            // The store translated the UP NEXT indices into absolute
            // positions and committed them. Re-push the resulting
            // order so Media3 holds exactly the same list; its own
            // current item keeps playing across the update.
            pushQueue(false)
            break
          }

          case 'clearQueue':
            void clearQueueNative()
            break

          case 'shuffleQueue':
            // Regenerating the permutation does not change the
            // underlying order, so nothing needs re-pushing; Media3
            // keeps its own shuffle order for the same playlist.
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
    await reconcileWithNative()

    // Re-sync every time the UI becomes visible again. While SYSTEMA is
    // backgrounded the WebView is throttled or frozen, so events sent
    // from the service can be missed entirely: the user may have hit
    // Next on the notification or the lock screen and the frontend
    // would never have heard about it. Asking the engine on resume is
    // the only reliable way to converge, and it costs one bridge call
    // per foreground rather than any polling.
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)

    return true
  }

  /**
   * Pulls authoritative state from the engine and adopts it.
   *
   * Native is the source of truth; this never pushes the frontend's
   * idea of playback down to the engine. Deliberately does NOT reset
   * currentTrack/position/duration/queue when the engine has nothing
   * to say — an Activity lifecycle change alone must not clear the UI.
   */
  async function reconcileWithNative() {
    const snapshot = await getStateNative()
    if (!snapshot) return

    applySnapshot(snapshot, /* authoritative */ true)

    // The queue can also have moved on (repeat wrapped, an unplayable
    // file was skipped). Realign the order and index with the engine's.
    const native = await getQueueNative()
    if (!native?.trackIds?.length) return

    const known = new Map(
      [...player.playbackOrder, ...useLibraryStore().tracks].map(t => [t.id, t]),
    )
    const resolved = native.trackIds
      .map(id => known.get(id))
      .filter((t): t is Track => Boolean(t))

    // Only adopt a fully resolvable queue: a partial list would silently
    // drop tracks the user still has queued.
    if (resolved.length !== native.trackIds.length) return

    applyNative(() => {
      player.playbackOrder = resolved
      if (native.currentIndex >= 0 && native.currentIndex < resolved.length) {
        player.currentIndex = native.currentIndex
      }
    })
  }

  /**
   * Asks for POST_NOTIFICATIONS once, the first time audio actually
   * starts — the moment the prompt is self-explanatory, rather than at
   * app launch before the user has done anything.
   *
   * Best-effort by design: playback is already under way and a denial
   * changes nothing about it, so the result is only logged.
   */
  async function ensureNotificationPermission() {
    if (notificationPermissionAsked) return
    notificationPermissionAsked = true
    try {
      const state = await getNotificationPermissionNative()
      if (!state.required || state.granted) return
      const result = await requestNotificationPermissionNative()
      if (!result.granted) {
        console.info(
          '[SYSTEMA/PLAYER] Notification permission denied; playback and '
          + 'lock-screen controls are unaffected, only the media '
          + 'notification is hidden.',
        )
      }
    } catch (error) {
      console.warn('[SYSTEMA/PLAYER] Notification permission check failed', error)
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    void reconcileWithNative()
  }

  function dispose() {
    if (import.meta.client) {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onVisibilityChange)
    }
    stopClock()
    nativeTrackId = null
    recordedTrackId = null
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
