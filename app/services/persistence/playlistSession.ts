// ============================================================
// SYSTEMA — Playlist Listening Session persistence (Phase 29)
// ============================================================
// Tracks the user's progress through playlists so that in-progress
// playlists can be continued from the exact track and timestamp.
//
// Key principles:
//   - ONE updatable record per playlistId
//   - Actual Listening Progress is derived ONLY from the unique time ranges
//     actually listened to across tracks in the playlist.
//   - Jumping to Track 15 does NOT mark Tracks 1..14 as listened.
//   - Seeking forward without playing does NOT add fake listening time.
//   - Replaying the same section does NOT double count listening progress.
//   - Progress is always clamped strictly between 0% and 100%.
//   - Completed sessions (>= 95% or marked completed) are dropped from Continue Listening.
//   - Storage is persisted via Room SQLite on Android with local cache.
// ============================================================

import { readJSON, writeJSON, removeKey } from './storageAdapter'

export const PLAYLIST_SESSIONS_STORAGE_KEY = 'systema:playlist-sessions:v1'
export const PLAYLIST_SESSIONS_VERSION = 1
export const PLAYLIST_COMPLETION_THRESHOLD_PCT = 95
export const PLAYLIST_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export const LEGACY_MOCK_PLAYLIST_IDS = new Set([
  'pl-functional',
  'pl-night-drive',
  'pl-deep-focus',
  'pl-late-night',
  'pl-persian-nights',
  'pl-morning-grid',
  'pl-gym-protocol',
  'pl-first-take',
])

export type TimeRange = [number, number]

export interface PersistedPlaylistSession {
  playlistId: string
  trackId: string
  trackIndex: number
  positionSeconds: number
  durationSeconds: number
  lastPlayedAt: number
  updatedAt: string
  completed: boolean
  listenedRanges?: Record<string, TimeRange[]>
  totalListenedSeconds?: number
}

export interface PlaylistSessionsPayload {
  version: number
  sessions: Record<string, PersistedPlaylistSession>
  savedAt: number
}

// ---- Range Merging & Progress Math --------------------------

/**
 * Merges overlapping or adjacent time intervals.
 * E.g., [[0, 30], [20, 50], [80, 100]] => [[0, 50], [80, 100]]
 */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  if (!Array.isArray(ranges) || !ranges.length) return []
  const sorted = ranges
    .map(([s, e]) => [Math.max(0, Math.min(s, e)), Math.max(0, Math.max(s, e))] as TimeRange)
    .filter(([s, e]) => e > s && Number.isFinite(s) && Number.isFinite(e))
    .sort((a, b) => a[0] - b[0])

  if (!sorted.length) return []

  const merged: TimeRange[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!
    const prev = merged[merged.length - 1]!

    if (current[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], current[1])
    } else {
      merged.push(current)
    }
  }
  return merged
}

/**
 * Calculates total unique listened seconds for a single track.
 */
export function calculateTrackListenedSeconds(ranges: TimeRange[], trackDuration?: number): number {
  const merged = mergeRanges(ranges)
  const total = merged.reduce((sum, [s, e]) => sum + (e - s), 0)
  if (trackDuration && trackDuration > 0) {
    return Math.min(trackDuration, Math.round(total * 100) / 100)
  }
  return Math.round(total * 100) / 100
}

/**
 * Calculates total unique listened seconds across all tracks in a playlist.
 */
export function calculatePlaylistListenedSeconds(
  listenedRanges: Record<string, TimeRange[]> | undefined,
  trackDurationsMap?: Record<string, number>,
): number {
  if (!listenedRanges || typeof listenedRanges !== 'object') return 0
  let total = 0
  for (const [trackId, ranges] of Object.entries(listenedRanges)) {
    const trackDuration = trackDurationsMap?.[trackId]
    total += calculateTrackListenedSeconds(ranges, trackDuration)
  }
  return Math.round(total * 100) / 100
}

/**
 * Calculates actual playlist progress percentage (0 to 100).
 * Based strictly on unique listened time divided by total playlist duration.
 */
export function calculateActualPlaylistProgress(
  totalListenedSeconds: number,
  totalPlaylistDuration: number,
): number {
  if (!Number.isFinite(totalPlaylistDuration) || totalPlaylistDuration <= 0) {
    return 0
  }
  if (!Number.isFinite(totalListenedSeconds) || totalListenedSeconds <= 0) {
    return 0
  }
  const pct = (totalListenedSeconds / totalPlaylistDuration) * 100
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10))
}

/**
 * Normalizes and calculates progress for session given track durations and session state.
 * Never assumes previous tracks were listened to!
 */
export function calculatePlaylistProgress(
  trackDurations: number[],
  currentIndex: number,
  positionSeconds: number,
  listenedRanges?: Record<string, TimeRange[]>,
  totalListenedSeconds?: number,
): number {
  const totalPlaylistDuration = trackDurations.reduce((acc, d) => acc + (d > 0 ? d : 0), 0)
  if (totalPlaylistDuration <= 0) return 0

  // 1. If explicit totalListenedSeconds or listenedRanges are available, use them directly
  if (typeof totalListenedSeconds === 'number' && totalListenedSeconds > 0) {
    return calculateActualPlaylistProgress(totalListenedSeconds, totalPlaylistDuration)
  }

  if (listenedRanges && Object.keys(listenedRanges).length > 0) {
    const listened = calculatePlaylistListenedSeconds(listenedRanges)
    return calculateActualPlaylistProgress(listened, totalPlaylistDuration)
  }

  // 2. Fallback for single active track without full range map:
  // ONLY counts the current track's listened seconds (positionSeconds), NEVER preceding tracks!
  const safeIndex = Math.max(0, Math.min(currentIndex, trackDurations.length - 1))
  const currentTrackDuration = trackDurations[safeIndex] ?? 0
  const currentTrackListened = currentTrackDuration > 0
    ? Math.min(positionSeconds, currentTrackDuration)
    : positionSeconds

  return calculateActualPlaylistProgress(currentTrackListened, totalPlaylistDuration)
}

/**
 * Builds a validated, normalized session record.
 */
export function buildPlaylistSession(input: {
  playlistId: string
  trackId: string
  trackIndex: number
  positionSeconds: number
  durationSeconds: number
  completed?: boolean
  now?: number
  listenedRanges?: Record<string, TimeRange[]>
  totalListenedSeconds?: number
  newRangeSegment?: { trackId: string; range: TimeRange }
}): PersistedPlaylistSession | null {
  if (!input.playlistId || typeof input.playlistId !== 'string') return null
  if (!input.trackId || typeof input.trackId !== 'string') return null

  const trackIndex = Number.isFinite(input.trackIndex) ? Math.max(0, Math.trunc(input.trackIndex)) : 0
  const positionSeconds = Number.isFinite(input.positionSeconds) ? Math.max(0, Math.round(input.positionSeconds * 100) / 100) : 0
  const durationSeconds = Number.isFinite(input.durationSeconds) ? Math.max(0, Math.round(input.durationSeconds * 100) / 100) : 0
  const now = input.now ?? Date.now()

  // Copy or initialize listened ranges
  const ranges: Record<string, TimeRange[]> = {}
  if (input.listenedRanges && typeof input.listenedRanges === 'object') {
    for (const [tid, rList] of Object.entries(input.listenedRanges)) {
      if (Array.isArray(rList)) {
        ranges[tid] = mergeRanges(rList)
      }
    }
  }

  // Append new segment if provided
  if (input.newRangeSegment && input.newRangeSegment.trackId) {
    const tid = input.newRangeSegment.trackId
    const existing = ranges[tid] || []
    ranges[tid] = mergeRanges([...existing, input.newRangeSegment.range])
  } else if (!ranges[input.trackId] && positionSeconds > 0) {
    // If no ranges existed for current track yet, initialize with [0, positionSeconds]
    ranges[input.trackId] = [[0, positionSeconds]]
  }

  const calculatedListened = calculatePlaylistListenedSeconds(ranges)
  const totalListenedSeconds = Math.max(
    calculatedListened,
    Number.isFinite(input.totalListenedSeconds) ? (input.totalListenedSeconds ?? 0) : 0,
  )

  return {
    playlistId: input.playlistId,
    trackId: input.trackId,
    trackIndex,
    positionSeconds,
    durationSeconds,
    lastPlayedAt: now,
    updatedAt: new Date(now).toISOString(),
    completed: Boolean(input.completed),
    listenedRanges: ranges,
    totalListenedSeconds: Math.round(totalListenedSeconds * 100) / 100,
  }
}

/**
 * Parses raw JSON storage payload safely.
 */
export function parsePlaylistSessions(
  raw: unknown,
  now: number = Date.now(),
): Record<string, PersistedPlaylistSession> {
  if (!raw || typeof raw !== 'object') return {}
  const payload = raw as Partial<PlaylistSessionsPayload>

  if (payload.version !== PLAYLIST_SESSIONS_VERSION) return {}
  if (!payload.sessions || typeof payload.sessions !== 'object') return {}

  const result: Record<string, PersistedPlaylistSession> = {}

  for (const [key, item] of Object.entries(payload.sessions)) {
    if (!item || typeof item !== 'object') continue
    const s = item as Partial<PersistedPlaylistSession>

    if (typeof s.playlistId !== 'string' || !s.playlistId) continue
    if (LEGACY_MOCK_PLAYLIST_IDS.has(s.playlistId)) continue
    if (typeof s.trackId !== 'string' || !s.trackId) continue

    const lastPlayedAt = typeof s.lastPlayedAt === 'number' && Number.isFinite(s.lastPlayedAt)
      ? s.lastPlayedAt
      : now

    // Stale sessions older than 30 days are purged
    const age = Math.max(0, now - lastPlayedAt)
    if (age > PLAYLIST_SESSION_MAX_AGE_MS) continue

    const trackIndex = typeof s.trackIndex === 'number' && Number.isFinite(s.trackIndex)
      ? Math.max(0, Math.trunc(s.trackIndex))
      : 0

    const positionSeconds = typeof s.positionSeconds === 'number' && Number.isFinite(s.positionSeconds)
      ? Math.max(0, s.positionSeconds)
      : 0

    const durationSeconds = typeof s.durationSeconds === 'number' && Number.isFinite(s.durationSeconds)
      ? Math.max(0, s.durationSeconds)
      : 0

    // Parse listened ranges
    const listenedRanges: Record<string, TimeRange[]> = {}
    if (s.listenedRanges && typeof s.listenedRanges === 'object') {
      for (const [tid, rList] of Object.entries(s.listenedRanges)) {
        if (Array.isArray(rList)) {
          listenedRanges[tid] = mergeRanges(rList as TimeRange[])
        }
      }
    }

    const calculatedListened = calculatePlaylistListenedSeconds(listenedRanges)
    const totalListenedSeconds = Math.max(
      calculatedListened,
      typeof s.totalListenedSeconds === 'number' && Number.isFinite(s.totalListenedSeconds)
        ? s.totalListenedSeconds
        : 0,
    )

    result[s.playlistId] = {
      playlistId: s.playlistId,
      trackId: s.trackId,
      trackIndex,
      positionSeconds,
      durationSeconds,
      lastPlayedAt,
      updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date(lastPlayedAt).toISOString(),
      completed: s.completed === true,
      listenedRanges,
      totalListenedSeconds: Math.round(totalListenedSeconds * 100) / 100,
    }
  }

  return result
}

/**
 * Determines whether a session is incomplete and should be displayed in Continue Listening.
 */
export function isSessionIncomplete(
  session: PersistedPlaylistSession,
  trackDurations: number[],
): boolean {
  if (session.completed) return false
  const progress = calculatePlaylistProgress(
    trackDurations,
    session.trackIndex,
    session.positionSeconds,
    session.listenedRanges,
    session.totalListenedSeconds,
  )
  return progress < PLAYLIST_COMPLETION_THRESHOLD_PCT
}

// ---- Storage IO (Local Cache & Room SQLite Bridge) -----------

import {
  PlaylistSessionNative,
  checkPlaylistSessionAvailability,
  isNativePlatform,
  type PlaylistSessionPluginAvailability,
} from '../native/playlistSessionPlugin'

export function loadPlaylistSessions(now: number = Date.now()): Record<string, PersistedPlaylistSession> {
  const raw = readJSON(PLAYLIST_SESSIONS_STORAGE_KEY)
  return parsePlaylistSessions(raw, now)
}

export function savePlaylistSessions(sessions: Record<string, PersistedPlaylistSession>) {
  const payload: PlaylistSessionsPayload = {
    version: PLAYLIST_SESSIONS_VERSION,
    sessions,
    savedAt: Date.now(),
  }
  writeJSON(PLAYLIST_SESSIONS_STORAGE_KEY, payload)
}

export function saveSinglePlaylistSession(session: PersistedPlaylistSession, now: number = Date.now()) {
  const existing = loadPlaylistSessions(now)
  existing[session.playlistId] = session
  savePlaylistSessions(existing)
}

export function removePlaylistSession(playlistId: string, now: number = Date.now()) {
  const existing = loadPlaylistSessions(now)
  if (existing[playlistId]) {
    delete existing[playlistId]
    savePlaylistSessions(existing)
  }
}

export function clearPlaylistSessions() {
  removeKey(PLAYLIST_SESSIONS_STORAGE_KEY)
}

export async function loadPlaylistSessionsNative(
  now: number = Date.now(),
): Promise<{ sessions: Record<string, PersistedPlaylistSession>; info: PlaylistSessionPluginAvailability }> {
  const info = await checkPlaylistSessionAvailability()
  if (!info.available || !isNativePlatform()) {
    return { sessions: loadPlaylistSessions(now), info }
  }

  try {
    const res = await PlaylistSessionNative.getAllSessions()
    const result: Record<string, PersistedPlaylistSession> = {}

    if (res && Array.isArray(res.sessions)) {
      for (const item of res.sessions) {
        if (!item || typeof item !== 'object') continue
        const raw = item as any
        if (LEGACY_MOCK_PLAYLIST_IDS.has(raw.playlistId)) continue

        let ranges: Record<string, TimeRange[]> = {}
        if (raw.listenedRanges && typeof raw.listenedRanges === 'object') {
          for (const [tid, rList] of Object.entries(raw.listenedRanges)) {
            if (Array.isArray(rList)) {
              ranges[tid] = mergeRanges(rList as TimeRange[])
            }
          }
        } else if (raw.listenedRangesJson && typeof raw.listenedRangesJson === 'string') {
          try {
            const parsed = JSON.parse(raw.listenedRangesJson)
            for (const [tid, rList] of Object.entries(parsed)) {
              if (Array.isArray(rList)) {
                ranges[tid] = mergeRanges(rList as TimeRange[])
              }
            }
          } catch {}
        }

        const calculated = calculatePlaylistListenedSeconds(ranges)
        const total = Math.max(calculated, raw.totalListenedSeconds || 0)

        result[raw.playlistId] = {
          playlistId: raw.playlistId,
          trackId: raw.trackId,
          trackIndex: raw.trackIndex,
          positionSeconds: raw.positionSeconds,
          durationSeconds: raw.durationSeconds,
          lastPlayedAt: raw.lastPlayedAt,
          updatedAt: raw.updatedAt,
          completed: raw.completed,
          listenedRanges: ranges,
          totalListenedSeconds: Math.round(total * 100) / 100,
        }
      }
    }

    savePlaylistSessions(result)
    return { sessions: result, info }
  } catch (err) {
    console.error('[PlaylistSessionNative] getAllSessions failed:', err)
    return { sessions: loadPlaylistSessions(now), info }
  }
}

export async function saveSinglePlaylistSessionNative(session: PersistedPlaylistSession): Promise<void> {
  saveSinglePlaylistSession(session)
  if (!isNativePlatform()) return

  try {
    const rawToSave: any = {
      ...session,
      listenedRanges: session.listenedRanges || {},
      totalListenedSeconds: session.totalListenedSeconds || 0,
    }
    await PlaylistSessionNative.saveSession(rawToSave)
  } catch (err) {
    console.error(`[PlaylistSessionNative] saveSession failed for ${session.playlistId}:`, err)
  }
}

export async function removePlaylistSessionNative(playlistId: string): Promise<void> {
  removePlaylistSession(playlistId)
  if (!isNativePlatform()) return

  try {
    await PlaylistSessionNative.deleteSession({ playlistId })
  } catch (err) {
    console.error(`[PlaylistSessionNative] deleteSession failed for ${playlistId}:`, err)
  }
}

export async function markSessionCompletedNative(playlistId: string): Promise<void> {
  const existing = loadPlaylistSessions()
  if (existing[playlistId]) {
    existing[playlistId].completed = true
    savePlaylistSessions(existing)
  }
  if (!isNativePlatform()) return

  try {
    await PlaylistSessionNative.markCompleted({ playlistId })
  } catch (err) {
    console.error(`[PlaylistSessionNative] markCompleted failed for ${playlistId}:`, err)
  }
}
