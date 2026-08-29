// ============================================================
// useContinueListening — persistent Playlist Session tracking & resuming
// ============================================================
// Tracks the user's progress through playlists so that unfinished
// playlists (< 95%) appear in the Continue Listening horizontal slider.
//
// Key principles:
//   - ONE updatable record per playlistId stored in persistent storage
//   - Derived progress strictly from actual unique listened ranges (listenedSeconds / totalPlaylistDuration)
//   - Starting Track 15 does NOT assume Tracks 1..14 were listened to
//   - Seeking forward without playing does NOT count as listening
//   - Replaying the same section does NOT multiply listening progress
//   - Immediate save on pause, seek, track change, minimize full player,
//     and pagehide/visibilitychange
//   - Periodic snapshot (5-8s) during playback
//   - On tap: resumes exact playlist, track, and timestamp
// ============================================================

import { storeToRefs } from 'pinia'
import type { Playlist, Track } from '~/types'
import { tracks as fallbackCatalog, getArtist, formatDuration } from '~/data/music'
import { usePlayerStore } from '~/stores/player'
import { usePlaylistStore } from '~/stores/playlists'
import { useLibraryStore } from '~/stores/library'
import {
  buildPlaylistSession,
  loadPlaylistSessions,
  savePlaylistSessions,
  loadPlaylistSessionsNative,
  saveSinglePlaylistSessionNative,
  removePlaylistSessionNative,
  markSessionCompletedNative,
  calculatePlaylistProgress,
  calculateActualPlaylistProgress,
  calculatePlaylistListenedSeconds,
  mergeRanges,
  isSessionIncomplete,
  PLAYLIST_COMPLETION_THRESHOLD_PCT,
  type PersistedPlaylistSession,
  type TimeRange,
} from '~/services/persistence/playlistSession'
import {
  checkPlaylistSessionAvailability,
  isNativePlatform,
  type PlaylistSessionPluginAvailability,
} from '~/services/native/playlistSessionPlugin'

export interface ContinueListeningItem {
  playlist: Playlist
  track: Track
  artistName: string
  trackIndex: number
  totalTracks: number
  trackNumberDisplay: string
  positionSeconds: number
  durationSeconds: number
  progressPct: number
  listenedSeconds: number
  totalPlaylistDuration: number
  currentTimeFormatted: string
  durationFormatted: string
  lastPlayedAt: number
  isCurrentlyPlaying: boolean
}

const SAVE_DEBOUNCE_MS = 5000

let installed = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

// In-memory reactive copy of persisted sessions
const sessionsMap = ref<Record<string, PersistedPlaylistSession>>({})
const storageEngineInfo = ref<PlaylistSessionPluginAvailability | null>(null)
let hydrated = false

// Playback continuous range tracking state
let activeSegmentStart: number | null = null
let lastObservedPosition: number | null = null
let lastObservedTrackId: string | null = null

async function hydrateSessions() {
  if (hydrated || !import.meta.client) return
  hydrated = true

  // 1. Instant synchronous load from fast local cache
  sessionsMap.value = loadPlaylistSessions()

  // 2. Durable load from Android Room SQLite database
  try {
    const { sessions, info } = await loadPlaylistSessionsNative()
    storageEngineInfo.value = info
    sessionsMap.value = sessions

    if (isNativePlatform() && !info.available) {
      console.error(
        '[ContinueListening] CRITICAL: Android Room SQLite bridge "PlaylistSession" is NOT registered. ' +
        'Sessions will not survive app kill until plugin is registered in MainActivity.',
      )
    }
  } catch (err) {
    console.error('[ContinueListening] Error hydrating from Room SQLite:', err)
  }
}

export function useContinueListening() {
  hydrateSessions()

  const player = usePlayerStore()
  const playlistStore = usePlaylistStore()
  const libraryStore = useLibraryStore()

  /** Resolves a track from live library or fallback catalog */
  function resolveTrack(trackId: string): Track | undefined {
    return libraryStore.tracks.find(t => t.id === trackId)
      || fallbackCatalog.find(t => t.id === trackId)
  }

  /** Resolves artist name for a track */
  function resolveArtistName(track: Track): string {
    if (track.artist) return track.artist
    const artist = getArtist(track.artistId)
    return artist?.name || 'Unknown Artist'
  }

  /** Gets ordered track durations for a playlist */
  function getPlaylistTrackDurations(playlist: Playlist): number[] {
    return playlist.trackIds.map(id => {
      const track = resolveTrack(id)
      return track?.duration ?? 0
    })
  }

  /** Commit continuous playback segment to in-memory ranges */
  function commitCurrentSegment(playlistId: string, trackId: string, start: number, end: number) {
    if (end <= start || !trackId) return
    const session = sessionsMap.value[playlistId]
    const ranges: Record<string, TimeRange[]> = session?.listenedRanges
      ? { ...session.listenedRanges }
      : {}

    const existing = ranges[trackId] || []
    ranges[trackId] = mergeRanges([...existing, [start, end]])

    if (session) {
      session.listenedRanges = ranges
      session.totalListenedSeconds = calculatePlaylistListenedSeconds(ranges)
    }
  }

  /** Saves current snapshot immediately for active playlist */
  function saveActiveSessionNow() {
    if (!import.meta.client) return
    const plId = player.activePlaylistId
    if (!plId) return

    const playlist = playlistStore.getPlaylistById(plId)
    if (!playlist || !playlist.trackIds.length) return

    const currentTrack = player.currentTrack
    if (!currentTrack) return

    const trackIndex = playlist.trackIds.findIndex(id => id === currentTrack.id)
    const safeIndex = trackIndex >= 0 ? trackIndex : Math.max(0, player.currentIndex)
    const position = Math.max(0, player.currentTime)
    const duration = player.duration || currentTrack.duration || 0

    // Flush any pending active listening segment
    if (activeSegmentStart !== null && lastObservedPosition !== null && lastObservedTrackId === currentTrack.id) {
      if (lastObservedPosition > activeSegmentStart) {
        commitCurrentSegment(plId, currentTrack.id, activeSegmentStart, lastObservedPosition)
      }
      activeSegmentStart = position
      lastObservedPosition = position
    }

    const existingSession = sessionsMap.value[plId]
    const currentRanges = existingSession?.listenedRanges ? { ...existingSession.listenedRanges } : {}

    // Include current position range if nothing recorded yet
    if (!currentRanges[currentTrack.id] && position > 0) {
      currentRanges[currentTrack.id] = [[0, position]]
    }

    const totalPlaylistDuration = getPlaylistTrackDurations(playlist).reduce((acc, d) => acc + (d > 0 ? d : 0), 0)
    const totalListenedSeconds = calculatePlaylistListenedSeconds(currentRanges)
    const progressPct = calculateActualPlaylistProgress(totalListenedSeconds, totalPlaylistDuration)
    const isCompleted = progressPct >= PLAYLIST_COMPLETION_THRESHOLD_PCT

    const session = buildPlaylistSession({
      playlistId: plId,
      trackId: currentTrack.id,
      trackIndex: safeIndex,
      positionSeconds: position,
      durationSeconds: duration,
      completed: isCompleted,
      listenedRanges: currentRanges,
      totalListenedSeconds,
    })

    if (session) {
      sessionsMap.value = {
        ...sessionsMap.value,
        [plId]: session,
      }
      // Saves to local cache + writes directly to Room SQLite (Phase 29)
      saveSinglePlaylistSessionNative(session)
    }
  }

  /** Schedules debounced periodic save during playback */
  function scheduleSave() {
    if (!import.meta.client) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveActiveSessionNow()
    }, SAVE_DEBOUNCE_MS)
  }

  /** Sets up watchers for automatic persistence */
  function install() {
    if (!import.meta.client || installed) return
    installed = true

    const {
      isPlaying,
      currentTime,
      currentIndex,
      activePlaylistId,
      fullPlayerOpen,
      currentTrack,
    } = storeToRefs(player)

    // Periodic tracking of continuous playback
    watch(currentTime, (newTime) => {
      if (isPlaying.value && activePlaylistId.value && currentTrack.value) {
        const tid = currentTrack.value.id
        if (activeSegmentStart === null || lastObservedTrackId !== tid) {
          activeSegmentStart = newTime
          lastObservedPosition = newTime
          lastObservedTrackId = tid
        } else {
          // Detect seek: if position jumped unexpectedly (> 2s difference from linear playback)
          const delta = Math.abs(newTime - (lastObservedPosition ?? newTime))
          if (delta > 2.0) {
            // Commit previous segment before seek
            if (lastObservedPosition !== null && lastObservedPosition > activeSegmentStart) {
              commitCurrentSegment(activePlaylistId.value, tid, activeSegmentStart, lastObservedPosition)
            }
            activeSegmentStart = newTime
          }
          lastObservedPosition = newTime
        }
        scheduleSave()
      }
    })

    // Immediate save on pause
    watch(isPlaying, (playing) => {
      if (!playing) {
        if (saveTimer) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        if (activePlaylistId.value && currentTrack.value && activeSegmentStart !== null && lastObservedPosition !== null) {
          if (lastObservedPosition > activeSegmentStart) {
            commitCurrentSegment(activePlaylistId.value, currentTrack.value.id, activeSegmentStart, lastObservedPosition)
          }
          activeSegmentStart = null
          lastObservedPosition = null
        }
        saveActiveSessionNow()
      } else {
        activeSegmentStart = currentTime.value
        lastObservedPosition = currentTime.value
        lastObservedTrackId = currentTrack.value?.id || null
      }
    })

    // Immediate save on track change
    watch(currentIndex, () => {
      if (activePlaylistId.value) {
        if (lastObservedTrackId && activeSegmentStart !== null && lastObservedPosition !== null) {
          if (lastObservedPosition > activeSegmentStart) {
            commitCurrentSegment(activePlaylistId.value, lastObservedTrackId, activeSegmentStart, lastObservedPosition)
          }
        }
        activeSegmentStart = currentTime.value
        lastObservedPosition = currentTime.value
        lastObservedTrackId = currentTrack.value?.id || null
        saveActiveSessionNow()
      }
    })

    // Immediate save on active playlist change
    watch(activePlaylistId, (newId, oldId) => {
      if (oldId && sessionsMap.value[oldId]) {
        saveActiveSessionNow()
      }
      activeSegmentStart = currentTime.value
      lastObservedPosition = currentTime.value
      lastObservedTrackId = currentTrack.value?.id || null
    })

    // Immediate save when full player is closed/minimized
    watch(fullPlayerOpen, (open) => {
      if (!open && activePlaylistId.value) {
        saveActiveSessionNow()
      }
    })

    // Pagehide & visibilitychange immediate save
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveActiveSessionNow()
      }
    })
    window.addEventListener('pagehide', () => {
      saveActiveSessionNow()
    })

    // Synchronize seek actions
    player.$onAction(({ name, after }) => {
      if (name === 'seek' || name === 'seekMs' || name === 'seekToPct' || name === 'seekForward' || name === 'seekBackward') {
        after(() => {
          if (activePlaylistId.value) {
            saveActiveSessionNow()
          }
        })
      }
    })
  }

  // Auto-install on client
  if (import.meta.client) {
    install()
  }

  /**
   * Computed list of unfinished continue listening items,
   * sorted by lastPlayedAt descending.
   */
  const items = computed<ContinueListeningItem[]>(() => {
    const rawSessions = Object.values(sessionsMap.value)
    if (!rawSessions.length) return []

    const currentPlId = player.activePlaylistId
    const currentIsPlaying = player.isPlaying

    const list: ContinueListeningItem[] = []

    for (const session of rawSessions) {
      // Lookup playlist
      const playlist = playlistStore.getPlaylistById(session.playlistId)
      if (!playlist || !playlist.trackIds.length) continue

      const durations = getPlaylistTrackDurations(playlist)
      const totalPlaylistDuration = durations.reduce((acc, d) => acc + (d > 0 ? d : 0), 0)

      // If active playlist is currently playing, use live player time/index
      const isCurrentActive = currentPlId === playlist.id
      const trackIndex = isCurrentActive
        ? Math.max(0, player.currentIndex)
        : Math.min(session.trackIndex, playlist.trackIds.length - 1)

      const trackId = isCurrentActive && player.currentTrack
        ? player.currentTrack.id
        : playlist.trackIds[trackIndex] || session.trackId

      const track = resolveTrack(trackId)
      if (!track) continue

      const positionSeconds = isCurrentActive
        ? Math.max(0, player.currentTime)
        : session.positionSeconds

      const durationSeconds = isCurrentActive
        ? (player.duration || track.duration || 0)
        : (session.durationSeconds || track.duration || 0)

      // Actual listening progress: strictly based on listened seconds vs total playlist duration
      const totalListened = session.totalListenedSeconds
        || calculatePlaylistListenedSeconds(session.listenedRanges)
        || positionSeconds

      const progressPct = calculateActualPlaylistProgress(totalListened, totalPlaylistDuration)

      // Only show incomplete sessions (< 95%)
      if (session.completed || progressPct >= PLAYLIST_COMPLETION_THRESHOLD_PCT) {
        continue
      }

      const totalTracks = playlist.trackIds.length
      const trackNumberDisplay = `TRACK ${String(trackIndex + 1).padStart(2, '0')} / ${String(totalTracks).padStart(2, '0')}`

      list.push({
        playlist,
        track,
        artistName: resolveArtistName(track),
        trackIndex,
        totalTracks,
        trackNumberDisplay,
        positionSeconds,
        durationSeconds,
        progressPct,
        listenedSeconds: totalListened,
        totalPlaylistDuration,
        currentTimeFormatted: formatDuration(positionSeconds),
        durationFormatted: formatDuration(durationSeconds),
        lastPlayedAt: isCurrentActive ? Date.now() : session.lastPlayedAt,
        isCurrentlyPlaying: isCurrentActive && currentIsPlaying,
      })
    }

    // Sort by most recent activity
    return list.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  })

  const hasItems = computed(() => items.value.length > 0)
  const showViewAll = computed(() => items.value.length > 3)

  /**
   * Resumes a playlist from the exact track and timestamp.
   */
  function resumeSession(item: ContinueListeningItem) {
    player.activePlaylistId = item.playlist.id
    player.playPlaylist(item.playlist, item.trackIndex)
    if (item.positionSeconds > 0) {
      player.seek(item.positionSeconds)
    }
    player.isPlaying = true
    saveActiveSessionNow()
  }

  function removeSession(playlistId: string) {
    const updated = { ...sessionsMap.value }
    delete updated[playlistId]
    sessionsMap.value = updated
    removePlaylistSessionNative(playlistId)
  }

  const isDurableRoom = computed(() => storageEngineInfo.value?.durable === true)

  return {
    items,
    hasItems,
    showViewAll,
    storageEngineInfo,
    isDurableRoom,
    resumeSession,
    removeSession,
    saveActiveSessionNow,
    install,
  }
}
