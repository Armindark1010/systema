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
// Phase 4.1 — THE INITIALISATION RACE.
//
// This used to run once, immediately after the native player was
// asked what it was doing, and resolve the saved ids against
// `library.tracks`. On an Android cold start that array is still
// empty: the store seeds empty on native and initNativeLibrary() is
// away awaiting the permission grant and the first Room page. Every
// saved id therefore failed to resolve, which took the
// "all tracks missing" branch — and that branch CLEARS STORAGE. The
// user's session was destroyed by the very first startup, and a latch
// meant the populated library never got a second chance.
//
// The fix is to stop treating "library not loaded" as "track deleted".
// Readiness is classified explicitly (loading / ready / failed) and
// only a READY library is allowed to reach a destructive conclusion.
// Restoration now waits for readiness and retries.
//
// A second, quieter bug came out of the same investigation: the store
// only holds the FIRST PAGE (100 rows), so even a fully loaded library
// could not resolve a track saved from deeper in the list. Ids the
// page does not contain are now fetched individually over the existing
// native getTrack(id) bridge — bounded, and only for the ids actually
// needed.
// ============================================================

import { storeToRefs } from 'pinia'
import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'
import { useLibraryStore } from '~/stores/library'
import { getTrack as getTrackNative } from '~/services/native/musicLibraryService'
import { isNativeLibraryAvailable } from '~/services/native/musicLibraryPlugin'
import {
  buildPlaybackSession,
  loadPlaybackSession,
  savePlaybackSession,
  clearPlaybackSession,
  decideRestore,
  type PersistedPlaybackSession,
} from '~/services/persistence/playbackSession'
import { classifyLibraryReadiness } from '~/services/persistence/libraryReadiness'

/**
 * Writes are debounced: position changes several times a second and
 * localStorage is synchronous. One write every few seconds is plenty
 * for a crash-recovery snapshot.
 */
const SAVE_DEBOUNCE_MS = 4000

/**
 * Upper bound on individual track lookups during a restore.
 *
 * A saved queue can be the whole library. Resolving 10k ids one bridge
 * call at a time would be absurd, so only this many misses are chased;
 * beyond it we restore what the page already gave us. The queue is
 * still correct, just shorter — far better than a stall on startup.
 */
const MAX_TRACK_LOOKUPS = 60

let installed = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Set once a restore has genuinely concluded — never on a wait. */
let restoreSettled = false
/** Guards against two overlapping async restore attempts. */
let restoreInFlight = false
let stopReadinessWatch: (() => void) | null = null

/** Test seam: lets the suite drive the state machine deterministically. */
export function __resetPlaybackRestoreForTests() {
  installed = false
  restoreSettled = false
  restoreInFlight = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  stopReadinessWatch?.()
  stopReadinessWatch = null
}

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
    // Never overwrite a stored session with an empty one before the
    // restore has had its chance — that would lose the session just as
    // effectively as clearing it.
    if (!restoreSettled && !player.playbackOrder.length) return
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

  /** How much the library's answers can be trusted right now. */
  function readiness() {
    return classifyLibraryReadiness({
      isNativeLibrary: library.isNativeLibrary,
      isLoading: library.isLoading,
      nativeDataLoaded: library.nativeDataLoaded,
      hasError: Boolean(library.libraryError),
      // Verbatim store value ('unknown' | 'granted' | 'denied' | ...);
      // irrelevant in the browser.
      permissionStatus: library.isNativeLibrary ? library.permissionStatus : null,
    })
  }

  /**
   * Builds the id -> Track lookup a restore resolves against.
   *
   * Starts from what is already in memory (free) and only then asks
   * the native index about ids that are genuinely missing, which is
   * what makes a track saved from beyond the first page restorable.
   */
  async function buildLookup(session: PersistedPlaybackSession) {
    const lookup = new Map<string, Track>()
    for (const track of library.tracks) lookup.set(track.id, track)
    for (const track of player.playbackOrder) lookup.set(track.id, track)

    if (!isNativeLibraryAvailable()) return lookup

    const missing = session.trackIds.filter(id => !lookup.has(id))
    if (!missing.length) return lookup

    // Bounded, and sequential on purpose: a burst of parallel bridge
    // calls during startup competes with the library's own first page.
    for (const id of missing.slice(0, MAX_TRACK_LOOKUPS)) {
      try {
        const track = await getTrackNative(id)
        if (track) lookup.set(id, track)
      } catch {
        // A lookup failure is not proof of deletion; leave the id
        // unresolved and let the caller's rules handle it.
      }
    }
    return lookup
  }

  /**
   * Attempts a restore.
   *
   * Returns true only when the matter is settled (restored, skipped or
   * legitimately discarded). Returns false while waiting, so the
   * caller keeps the watcher armed.
   */
  async function tryRestore(): Promise<boolean> {
    if (!import.meta.client || restoreSettled || restoreInFlight) return restoreSettled

    const session = loadPlaybackSession()

    // Never restore over a queue the user has already started.
    if (session && player.playbackOrder.length && player.isPlaying) {
      restoreSettled = true
      return true
    }

    const state = readiness()

    // Cheap pre-check so we do not run the bridge lookups just to be
    // told to wait.
    const preflight = decideRestore({
      session,
      libraryReadiness: state,
      available: [],
    })

    if (preflight.action === 'skip') {
      restoreSettled = true
      return true
    }
    if (preflight.action === 'wait') return false
    if (preflight.action === 'defer') {
      // The library failed or access was denied. The session stays on
      // disk untouched, ready for a launch that works.
      console.info(
        '[SYSTEMA/PLAYER] Library unavailable; the saved playback session '
        + 'was kept for the next launch.',
      )
      restoreSettled = true
      return true
    }

    // READY. Resolve properly, then decide for real.
    restoreInFlight = true
    try {
      const lookup = await buildLookup(session!)
      const decision = decideRestore({
        session,
        libraryReadiness: 'ready',
        available: lookup,
      })

      if (decision.action === 'discard') {
        // Only reachable with an authoritative library: the files are
        // genuinely gone, so the session is worthless.
        console.info('[SYSTEMA/PLAYER] Saved session dropped: none of its tracks still exist.')
        clearPlaybackSession()
        restoreSettled = true
        return true
      }

      if (decision.action !== 'restore') {
        restoreSettled = true
        return true
      }

      const resolved = decision.session

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

      restoreSettled = true
      // Re-persist: the queue may have shrunk, and the stored copy
      // should match what the user can actually see.
      saveNow()
      return true
    } finally {
      restoreInFlight = false
    }
  }

  /**
   * Restores as soon as the library can be trusted.
   *
   * Tries immediately (the browser is ready synchronously) and
   * otherwise watches readiness until it resolves. The watcher stops
   * itself once the matter is settled, so nothing lingers.
   */
  function restoreWhenReady() {
    if (!import.meta.client || restoreSettled) return

    void tryRestore().then((settled) => {
      if (settled || stopReadinessWatch) return

      stopReadinessWatch = watch(
        () => [
          library.isNativeLibrary,
          library.isLoading,
          library.nativeDataLoaded,
          library.permissionStatus,
          Boolean(library.libraryError),
        ],
        () => {
          void tryRestore().then((done) => {
            if (done) {
              stopReadinessWatch?.()
              stopReadinessWatch = null
            }
          })
        },
      )
    })
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

  return { install, restoreWhenReady, tryRestore, saveNow, scheduleSave }
}
