// ============================================================
// useAICompanion — view helpers for the AI companion page
// ============================================================
// Resolves the store's lightweight AIMatch references (trackId +
// match) into real catalog rows for rendering, and bridges
// playback intents to the shared player store.
//
// It deliberately reads the catalog directly instead of
// useMusicLibrary(), whose `tracks` are filtered by the shared
// library query — recommendations must never disappear because
// a filter is active elsewhere in the app.
// ============================================================

import type { Track } from '~/types'
import type { AIMatch } from '~/types/ai'
import { getAlbum, getArtist, tracks as catalog } from '~/data/music'
import { usePlayerStore } from '~/stores/player'

export interface AIResolvedResult {
  track: Track
  artist: string
  cover?: string
  match: number
}

const byId = new Map(catalog.map(t => [t.id, t]))

export function useAICompanion() {
  const player = usePlayerStore()

  function trackById(id: string): Track | undefined {
    return byId.get(id)
  }

  function artistFor(track: Track): string {
    return track.artist || getArtist(track.artistId)?.name || 'SYSTEMA'
  }

  function coverFor(track: Track): string | undefined {
    return track.artwork || getAlbum(track.albumId)?.cover
  }

  /** Turn mock match references into renderable rows. */
  function resolve(matches: readonly AIMatch[] | undefined): AIResolvedResult[] {
    if (!matches?.length) return []
    return matches.flatMap((m) => {
      const track = trackById(m.trackId)
      if (!track) return []
      return [{ track, artist: artistFor(track), cover: coverFor(track), match: m.match }]
    })
  }

  /**
   * Play a recommendation through the ONE shared player store.
   * The AI page never owns playback state.
   */
  function playRecommendation(track: Track) {
    player.playTrack(track, 'AI')
  }

  function queueRecommendation(track: Track) {
    player.addToQueue(track)
  }

  return {
    trackById,
    artistFor,
    coverFor,
    resolve,
    playRecommendation,
    queueRecommendation,
  }
}
