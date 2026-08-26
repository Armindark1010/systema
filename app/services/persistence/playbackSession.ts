// ============================================================
// SYSTEMA — playback session persistence (Phase 4)
// ============================================================
// Remembers *what* was playing so reopening the app lands the user back
// where they left off. Deliberately small:
//
//   stored      : track ids, index, position, shuffle, repeat
//   NOT stored  : audio, artwork bitmaps, metadata, MediaStore rows
//
// Tracks are referenced by their stable SYSTEMA id ("ms:volume:12345")
// and re-resolved against the live library on restore. That is what
// makes a deleted track a non-event rather than a crash: it simply
// fails to resolve and is dropped.
//
// Media3 indexes are never stored. An index only means something
// against the exact list that produced it, and the library rescans
// between sessions; resolving by id and *recomputing* the index is the
// only version that survives a track disappearing from the middle of
// the queue.
//
// Pure functions, no Vue and no platform APIs, so the restore rules are
// unit-testable without a device.
// ============================================================

import type { RepeatMode, Track } from '~/types'
import { readJSON, writeJSON, removeKey } from './storageAdapter'

export const PLAYBACK_SESSION_STORAGE_KEY = 'systema:playback-session'

/** Bump when the shape changes; older payloads are then ignored. */
export const PLAYBACK_SESSION_VERSION = 1

/**
 * Sessions older than this are not restored. A queue from last week is
 * noise, not context — and the underlying files are far more likely to
 * have moved.
 */
export const PLAYBACK_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface PersistedPlaybackSession {
  version: number
  /** Stable SYSTEMA track ids, in playback order. */
  trackIds: string[]
  /** Index into `trackIds`. */
  currentIndex: number
  /** Seconds into the current track. */
  positionSeconds: number
  shuffle: boolean
  repeat: RepeatMode
  /** Epoch ms, used only to expire stale sessions. */
  savedAt: number
}

export interface RestoredPlaybackSession {
  tracks: Track[]
  currentIndex: number
  positionSeconds: number
  shuffle: boolean
  repeat: RepeatMode
  /** Ids that no longer resolve. Purely informational. */
  droppedTrackIds: string[]
}

const VALID_REPEATS: RepeatMode[] = ['off', 'one', 'all']

function isRepeatMode(value: unknown): value is RepeatMode {
  return typeof value === 'string' && (VALID_REPEATS as string[]).includes(value)
}

/**
 * Builds the payload for the current playback context.
 *
 * Returns null when there is nothing worth restoring, so callers can
 * treat "no session" and "empty session" identically.
 */
export function buildPlaybackSession(input: {
  tracks: Track[]
  currentIndex: number
  positionSeconds: number
  shuffle: boolean
  repeat: RepeatMode
  now?: number
}): PersistedPlaybackSession | null {
  const ids = input.tracks.map(t => t?.id).filter((id): id is string => Boolean(id))
  if (!ids.length) return null

  const index = Number.isFinite(input.currentIndex)
    ? Math.min(Math.max(0, Math.trunc(input.currentIndex)), ids.length - 1)
    : 0

  const position = Number.isFinite(input.positionSeconds)
    ? Math.max(0, input.positionSeconds)
    : 0

  return {
    version: PLAYBACK_SESSION_VERSION,
    trackIds: ids,
    currentIndex: index,
    positionSeconds: Math.round(position * 100) / 100,
    shuffle: Boolean(input.shuffle),
    repeat: isRepeatMode(input.repeat) ? input.repeat : 'off',
    savedAt: input.now ?? Date.now(),
  }
}

/**
 * Validates an unknown payload read back from storage.
 *
 * Everything is checked: storage is user-writable, survives app
 * upgrades, and a malformed entry must degrade to "no session" rather
 * than throwing on startup.
 */
export function parsePlaybackSession(
  raw: unknown,
  now: number = Date.now(),
): PersistedPlaybackSession | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<PersistedPlaybackSession>

  if (value.version !== PLAYBACK_SESSION_VERSION) return null
  if (!Array.isArray(value.trackIds)) return null

  const trackIds = value.trackIds.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  if (!trackIds.length) return null

  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
    ? value.savedAt
    : 0
  // A future timestamp means the clock moved; treat it as "now" rather
  // than discarding a session that is probably fine.
  const age = Math.max(0, now - savedAt)
  if (age > PLAYBACK_SESSION_MAX_AGE_MS) return null

  const rawIndex = typeof value.currentIndex === 'number' && Number.isFinite(value.currentIndex)
    ? Math.trunc(value.currentIndex)
    : 0

  const position = typeof value.positionSeconds === 'number'
    && Number.isFinite(value.positionSeconds)
    && value.positionSeconds >= 0
    ? value.positionSeconds
    : 0

  return {
    version: PLAYBACK_SESSION_VERSION,
    trackIds,
    currentIndex: Math.min(Math.max(0, rawIndex), trackIds.length - 1),
    positionSeconds: position,
    shuffle: value.shuffle === true,
    repeat: isRepeatMode(value.repeat) ? value.repeat : 'off',
    savedAt,
  }
}

/**
 * Re-resolves a stored session against the tracks that actually exist.
 *
 * The rules the phase spec asks for, in one place:
 *
 *   - resolve by stable id, never by stored index
 *   - drop ids that no longer exist (deleted from the device)
 *   - if the whole queue is gone, there is no session
 *   - if the *current* track is gone, fall to the next surviving track
 *     rather than resetting to the start
 *   - clamp the position into the restored track's duration
 */
export function resolvePlaybackSession(
  session: PersistedPlaybackSession,
  available: ReadonlyMap<string, Track> | Track[],
): RestoredPlaybackSession | null {
  // `instanceof Map` does not narrow a ReadonlyMap union, so branch on
  // the array shape instead.
  const lookup: ReadonlyMap<string, Track> = Array.isArray(available)
    ? new Map(available.map(t => [t.id, t]))
    : available

  const tracks: Track[] = []
  const droppedTrackIds: string[] = []

  // Index of the previously current track within the SURVIVING list,
  // computed as we go so deletions before it shift it correctly.
  let restoredIndex = -1

  session.trackIds.forEach((id, originalIndex) => {
    const track = lookup.get(id)
    if (!track) {
      droppedTrackIds.push(id)
      return
    }
    if (originalIndex === session.currentIndex) restoredIndex = tracks.length
    tracks.push(track)
  })

  // Everything is gone: reset rather than restore an empty player.
  if (!tracks.length) return null

  let positionSeconds = session.positionSeconds

  if (restoredIndex < 0) {
    // The track that was playing has been deleted. Land on the next
    // surviving track instead — and start it from the beginning, since
    // the stored position belonged to a different track.
    const survivorsBefore = session.trackIds
      .slice(0, session.currentIndex)
      .filter(id => lookup.has(id)).length
    restoredIndex = Math.min(survivorsBefore, tracks.length - 1)
    positionSeconds = 0
  }

  return {
    tracks,
    currentIndex: restoredIndex,
    positionSeconds: clampPosition(positionSeconds, tracks[restoredIndex]?.duration),
    shuffle: session.shuffle,
    repeat: session.repeat,
    droppedTrackIds,
  }
}

/**
 * Clamps a position into [0, duration].
 *
 * An unknown or non-positive duration means the decoder has not
 * reported one yet; the position is then passed through unchanged and
 * resolved later, once metadata lands. Clamping against a zero duration
 * was what silently rewound every restore to 0:00.
 */
export function clampPosition(
  positionSeconds: number,
  durationSeconds: number | undefined | null,
): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return 0
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return positionSeconds
  }
  // Landing exactly on the end would immediately fire a track change,
  // so a position within the last moment restarts the track instead.
  if (positionSeconds >= durationSeconds - 1) return 0
  return Math.min(positionSeconds, durationSeconds)
}

// ---- Restore decision (Phase 4.1) ----------------------------
//
// resolvePlaybackSession() answers "which of these tracks still
// exist?". It cannot answer "is it safe to act on that?", because a
// library that has not finished loading yields exactly the same empty
// result as a library whose files were all deleted.
//
// Conflating those two destroyed real user sessions: on an Android
// cold start the restore ran before the first page landed, resolved
// nothing, and took the "everything is gone" branch — which clears
// storage. The decision below makes the difference explicit so no
// caller can collapse it again by accident.

export type RestoreDecision =
  /** Library still initialising. Do nothing, stay armed, ask again. */
  | { action: 'wait', reason: 'library-loading' }
  /** Library unavailable (error, denied permission). Keep the session. */
  | { action: 'defer', reason: 'library-unavailable' }
  /** Nothing stored, or the payload failed validation. */
  | { action: 'skip', reason: 'no-session' | 'invalid-session' }
  /** Library is authoritative and every saved track is genuinely gone. */
  | { action: 'discard', reason: 'all-tracks-missing' }
  /** Restore this. */
  | { action: 'restore', session: RestoredPlaybackSession }

/**
 * Decides what to do with a stored session, given how trustworthy the
 * library currently is.
 *
 * `libraryReadiness` is the caller's classification (see
 * libraryReadiness.ts). Only `'ready'` permits a destructive outcome.
 */
export function decideRestore(input: {
  session: PersistedPlaybackSession | null
  libraryReadiness: 'loading' | 'ready' | 'failed'
  available: ReadonlyMap<string, Track> | Track[]
}): RestoreDecision {
  if (!input.session) return { action: 'skip', reason: 'no-session' }

  // A stored session exists, so the library's state now decides
  // everything. These two branches are the fix: neither may delete.
  if (input.libraryReadiness === 'loading') {
    return { action: 'wait', reason: 'library-loading' }
  }
  if (input.libraryReadiness === 'failed') {
    return { action: 'defer', reason: 'library-unavailable' }
  }

  const resolved = resolvePlaybackSession(input.session, input.available)

  // Only reachable with a READY library, so this genuinely means the
  // files are gone rather than "not loaded yet".
  if (!resolved) return { action: 'discard', reason: 'all-tracks-missing' }

  return { action: 'restore', session: resolved }
}

// ---- Storage IO ----------------------------------------------
// Thin, and never throwing: a persistence failure must not be able to
// stop the app from starting.

export function savePlaybackSession(session: PersistedPlaybackSession | null) {
  if (!session) {
    clearPlaybackSession()
    return
  }
  writeJSON(PLAYBACK_SESSION_STORAGE_KEY, session)
}

export function loadPlaybackSession(now: number = Date.now()): PersistedPlaybackSession | null {
  return parsePlaybackSession(readJSON(PLAYBACK_SESSION_STORAGE_KEY), now)
}

export function clearPlaybackSession() {
  removeKey(PLAYBACK_SESSION_STORAGE_KEY)
}
