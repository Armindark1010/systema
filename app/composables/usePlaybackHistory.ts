// ============================================================
// usePlaybackHistory — reactive, session-level listening history
// ============================================================
// Kept separate from the catalog so "recently played" reflects
// playback order rather than the all-time play count. This state
// can later be replaced by a Room / MediaStore history adapter.
// ============================================================

import { computed, readonly, ref } from 'vue'
import { tracks as catalog } from '~/data/music'
import type { Track } from '~/types'

// A deterministic mock history keeps SSR and hydration identical.
// New playback is moved to the front for the rest of the session.
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
const trackById = new Map(catalog.map((track) => [track.id, track]))

/** Record one playback, de-duplicating the history by track. */
export function recordPlayed(trackId: string) {
  if (!trackById.has(trackId)) return
  recentTrackIds.value = [
    trackId,
    ...recentTrackIds.value.filter((id) => id !== trackId),
  ].slice(0, 50)
}

export function usePlaybackHistory() {
  const recentTracks = computed<Track[]>(() =>
    recentTrackIds.value
      .map((id) => trackById.get(id))
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
  }
}
