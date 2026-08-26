// ============================================================
// usePlaybackHistory — RECENTS: what the user actually played
// ============================================================
// RECENTS AND THE QUEUE ARE DIFFERENT CONCEPTS.
//
//   Queue   = the ordered list of tracks intended to play (player store)
//   Recents = the historical record of tracks that actually started
//
// Neither is derived from the other. The queue lives in the player
// store; this module owns recents exclusively and is the single
// authority for them — there is no parallel Room or per-component copy.
//
// Two rules define what lands here:
//
//   1. A track is recorded only when playback genuinely STARTS. Being
//      queued, rendered, added to a playlist, or selected-but-failed
//      never counts.
//   2. Recording the same track repeatedly is idempotent. Media3 emits
//      several events per track (state changes, position updates,
//      duplicate transitions), and pause/resume must not reorder or
//      duplicate anything.
//
// Storage is frontend-only and persisted through the existing
// StorageAdapter, matching how the rest of SYSTEMA persists state. No
// new database is introduced.
// ============================================================

import { computed, readonly, ref } from 'vue'
import { tracks as catalog } from '~/data/music'
import type { Track } from '~/types'
import { createLocalStorageAdapter } from '~/services/persistence/storageAdapter'

const STORAGE_KEY = 'systema:recents:v1'
const MAX_RECENTS = 50

// A deterministic mock history keeps SSR and hydration identical. It
// is replaced the moment real playback is recorded on a device.
const initialHistory = [
  'tr-04',
  'tr-08',
  'tr-24',
  'tr-20',
  'tr-31',
  'tr-14',
  'tr-33',
  'tr-18',
  'tr-01',
  'tr-28',
  'tr-22',
  'tr-35',
]

const recentTrackIds = ref<string[]>(initialHistory)

/**
 * Resolved track metadata by id.
 *
 * Seeded with the mock catalog and extended at runtime with device
 * tracks. The previous implementation only ever consulted the mock
 * catalog, so every real MediaStore track was silently rejected and
 * recents on Android could never contain actual music.
 */
const trackById = new Map<string, Track>(catalog.map(track => [track.id, track]))

/**
 * The last id recorded, used to collapse repeat events for the same
 * track. Media3 can report the same current item several times.
 */
let lastRecordedId: string | null = null

const storage = createLocalStorageAdapter()
let hydrated = false

/** Loads persisted recents once, on the client. */
function hydrate() {
  if (hydrated || !import.meta.client) return
  hydrated = true
  try {
    const raw = storage.get(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const ids = parsed.filter((id): id is string => typeof id === 'string')
    if (ids.length) recentTrackIds.value = ids.slice(0, MAX_RECENTS)
  } catch {
    // Corrupt payload: keep the in-memory history rather than throwing.
  }
}

function persist() {
  if (!import.meta.client) return
  try {
    storage.set(STORAGE_KEY, JSON.stringify(recentTrackIds.value))
  } catch {
    /* quota / private mode */
  }
}

/**
 * Registers track metadata so recents can resolve device tracks.
 *
 * Called as pages of the native library load. Cheap and idempotent.
 */
export function registerTracksForHistory(tracks: Track[]) {
  for (const track of tracks) {
    if (track?.id) trackById.set(track.id, track)
  }
}

/**
 * Records one *actual* playback start.
 *
 * Idempotent for the track already at the head of the list, so
 * repeated native events, pause/resume cycles and position updates
 * cannot create duplicates or churn the ordering.
 *
 * Returns true only when the history actually changed.
 */
export function recordPlayed(trackId: string, track?: Track): boolean {
  if (!trackId) return false
  hydrate()

  // Learn the track if we have never seen it (device tracks).
  if (track && !trackById.has(trackId)) trackById.set(trackId, track)

  // Unknown track: refuse rather than silently recording a dangling id
  // that can never be rendered.
  if (!trackById.has(trackId)) return false

  // Already the most recent entry — a repeat event, not a new play.
  if (recentTrackIds.value[0] === trackId) {
    lastRecordedId = trackId
    return false
  }

  lastRecordedId = trackId
  recentTrackIds.value = [
    trackId,
    ...recentTrackIds.value.filter(id => id !== trackId),
  ].slice(0, MAX_RECENTS)

  persist()
  return true
}

/** Clears the dedupe latch, e.g. when the queue is replaced. */
export function resetHistoryLatch() {
  lastRecordedId = null
}

export function usePlaybackHistory() {
  hydrate()

  const recentTracks = computed<Track[]>(() =>
    recentTrackIds.value
      .map(id => trackById.get(id))
      .filter((track): track is Track => Boolean(track)),
  )

  function recentlyPlayed(limit = 12): Track[] {
    return recentTracks.value.slice(0, Math.max(0, limit))
  }

  return {
    recentTrackIds: readonly(recentTrackIds),
    recentTracks,
    recentlyPlayed,
    recordPlayed,
    registerTracksForHistory,
    lastRecordedId: () => lastRecordedId,
  }
}
