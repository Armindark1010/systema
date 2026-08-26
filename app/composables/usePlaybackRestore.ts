// ============================================================
// usePlaybackRestore — remember and restore the playback context
// ============================================================
// Phase 4. Reopening SYSTEMA should land the user back where they left
// off: same queue, same track, same position, same shuffle and repeat.
//
// Two rules shape the whole thing:
//
//   1. RESTORE, DO NOT PLAY. State is put back and the player stays
//      paused. Opening a music app must never start blasting audio on
//      its own — the user presses Play. (§7)
//
//   2. RECENTS ARE UNTOUCHED. Restoration is not playback, so nothing
//      here calls recordPlayed(). Only real playback writes history,
//      which is why reopening the app cannot pollute Recents with an
//      entry the user never actually played. (§10)
//
// Persistence is debounced and id-based; see playbackSession.ts for the
// storage shape and the resolution rules.
// ============================================================

import { storeToRefs } from 'pinia'
import { usePlayerStore } from '~/stores/player'
import { useLibraryStore } from '~/stores/library'
import {
  buildPlaybackSession,
  loadPlaybackSession,
  savePlaybackSession,
  clearPlaybackSession,
  resolvePlaybackSession,
} from '~/services/persistence/playbackSession'

/**
 * Writes are debounced: position changes several times a second and
 * localStorage is synchronous. One write every few seconds is plenty
 * for a crash-recovery snapshot.
 */
const SAVE_DEBOUNCE_MS = 4000

let installed = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let restored = false

export function usePlaybackRestore() {
  const player = usePlayerStore()
  const library = useLibraryStore()

  function snapshotNow() {
    return buildPlaybackSession({
      tracks: player.playbackOrder,
      currentIndex: player.currentIndex,
      positionSeconds: player.currentTime,
      shuffle: player.isShuffle,
      repeat: player.repeatMode,
    })
  }

  /** Persists immediately. Used on pause and page hide. */
  function saveNow() {
    if (!import.meta.client) return
    savePlaybackSession(snapshotNow())
  }

  function scheduleSave() {
    if (!import.meta.client) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Restores the last session into the store.
   *
   * Returns true when something was restored. Safe to call more than
   * once — only the first call can restore, so a late library load
   * cannot overwrite a queue the user has since built.
   */
  function restore(): boolean {
    if (!import.meta.client || restored) return false

    const session = loadPlaybackSession()
    if (!session) return false

    // Never restore over a queue the user has already started.
    if (player.playbackOrder.length && player.isPlaying) {
      restored = true
      return false
    }

    // Resolve against the live library. Mock catalog tracks are
    // included so the browser build restores too.
    const resolved = resolvePlaybackSession(session, library.tracks)

    if (!resolved) {
      // Every track is gone (library wiped, SD card removed). Drop the
      // session rather than leaving a queue of ghosts behind.
      clearPlaybackSession()
      restored = true
      return false
    }

    restored = true

    if (resolved.droppedTrackIds.length) {
      console.info(
        `[SYSTEMA/PLAYER] Restored session without ${resolved.droppedTrackIds.length} `
        + 'track(s) that no longer exist.',
      )
    }

    // Applied as plain state, NOT through playTrack()/playQueue():
    // those are actions, and the native bridge would forward them to
    // Media3 with autoPlay. Restoration must be silent.
    player.playbackOrder = resolved.tracks
    player.currentIndex = resolved.currentIndex
    player.currentTime = resolved.positionSeconds
    player.isShuffle = resolved.shuffle
    player.repeatMode = resolved.repeat
    player.isPlaying = false

    const track = resolved.tracks[resolved.currentIndex]
    if (track) player.duration = track.duration

    // Re-persist: the queue may have shrunk, and the stored copy should
    // match what the user can actually see.
    saveNow()
    return true
  }

  /**
   * Starts watching playback state and persisting it.
   * Idempotent — a second call does nothing.
   */
  function install() {
    if (!import.meta.client || installed) return
    installed = true

    const { currentIndex, currentTime, isShuffle, repeatMode, isPlaying, playbackOrder }
      = storeToRefs(player)

    // Queue/track/mode changes are worth saving promptly; position is
    // the only high-frequency one and the debounce absorbs it.
    watch([playbackOrder, currentIndex, isShuffle, repeatMode], () => scheduleSave(), { deep: false })
    watch(currentTime, () => scheduleSave())

    // Pausing is the natural checkpoint: it is what happens right
    // before the user puts the phone down.
    watch(isPlaying, (playing) => {
      if (!playing) saveNow()
    })

    // Backgrounding may be the last moment we get. `pagehide` and the
    // hidden state both fire on Android when the WebView goes away,
    // and `visibilitychange` is the reliable one there.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow()
    })
    window.addEventListener('pagehide', saveNow)
  }

  return { install, restore, saveNow, scheduleSave }
}
