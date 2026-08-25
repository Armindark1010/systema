// ============================================================
// SYSTEMA — Library Store (Pinia)
// ============================================================
// Controls Library UI state and catalog presentation.
// Completely separated from Player state.
// ============================================================

import { defineStore } from 'pinia'
import type { Album, Artist, Playlist, Track } from '~/types'
import { tracks as catalogTracks, albums as catalogAlbums, artists as catalogArtists } from '~/data/music'
import { usePlaybackHistory } from '~/composables/usePlaybackHistory'
import { usePlaylists } from '~/composables/usePlaylists'
import { useSettingsStore } from '~/stores/settings'

export type LibrarySection = 'tracks' | 'albums' | 'artists' | 'playlists'
export type LibrarySortKey =
  | 'recently-added'
  | 'recently-played'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'most-played'
  | 'ai-mood'
  | 'ai-energy'

export interface LibrarySortOption {
  id: LibrarySortKey
  label: string
}

export const librarySections: { id: LibrarySection; label: string }[] = [
  { id: 'tracks', label: 'TRACKS' },
  { id: 'albums', label: 'ALBUMS' },
  { id: 'artists', label: 'ARTISTS' },
  { id: 'playlists', label: 'PLAYLISTS' },
]

export const librarySortOptions: LibrarySortOption[] = [
  { id: 'recently-added', label: 'RECENTLY ADDED' },
  { id: 'recently-played', label: 'RECENTLY PLAYED' },
  { id: 'title', label: 'TITLE' },
  { id: 'artist', label: 'ARTIST' },
  { id: 'album', label: 'ALBUM' },
  { id: 'duration', label: 'DURATION' },
  { id: 'most-played', label: 'MOST PLAYED' },
  { id: 'ai-mood', label: 'AI MOOD' },
  { id: 'ai-energy', label: 'AI ENERGY' },
]

export const useLibraryStore = defineStore('library', () => {
  // ---- State -------------------------------------------------
  const activeSection = ref<LibrarySection>('tracks')
  function defaultSortFromSettings(): LibrarySortKey {
    try {
      const sort = useSettingsStore().library.defaultSort
      if (sort === 'alphabetical') return 'title'
      if (sort === 'artist' || sort === 'album' || sort === 'duration' || sort === 'recently-added') return sort
    } catch {
      /* settings store not ready */
    }
    return 'recently-added'
  }

  const sortBy = ref<LibrarySortKey>(defaultSortFromSettings())
  const tracks = ref<Track[]>(catalogTracks)
  const albums = ref<Album[]>(catalogAlbums)
  const artists = ref<Artist[]>(catalogArtists)
  const isLoading = ref(false)

  const history = usePlaybackHistory()
  const playlistsStore = usePlaylists()

  // Dynamic playlists from the reactive playlist composable
  const playlists = computed<Playlist[]>(() => playlistsStore.playlists.value)

  // ---- Getters -----------------------------------------------
  const totalTracks = computed(() => tracks.value.length)

  const activeSectionIndex = computed(() =>
    librarySections.findIndex(s => s.id === activeSection.value),
  )

  const selectedSortLabel = computed(() =>
    librarySortOptions.find(o => o.id === sortBy.value)?.label ?? 'RECENTLY ADDED',
  )

  const recentRank = computed(() =>
    new Map(history.recentTrackIds.value.map((id, index) => [id, index])),
  )

  const sortedTracks = computed<Track[]>(() => {
    const list = [...tracks.value]
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    const missingLast = (value?: string | number) => value === undefined || value === '' ? 1 : 0

    return list.sort((a, b) => {
      const artistA = artists.value.find(art => art.id === a.artistId)?.name ?? ''
      const artistB = artists.value.find(art => art.id === b.artistId)?.name ?? ''
      const albumA = albums.value.find(alb => alb.id === a.albumId)?.title ?? ''
      const albumB = albums.value.find(alb => alb.id === b.albumId)?.title ?? ''

      switch (sortBy.value) {
        case 'recently-added':
          return b.addedAt.localeCompare(a.addedAt)
        case 'recently-played': {
          const rankA = recentRank.value.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rankB = recentRank.value.get(b.id) ?? Number.MAX_SAFE_INTEGER
          return rankA - rankB || b.addedAt.localeCompare(a.addedAt)
        }
        case 'title':
          return byText(a.title, b.title)
        case 'artist':
          return byText(artistA, artistB) || byText(a.title, b.title)
        case 'album':
          return byText(albumA, albumB) || byText(a.title, b.title)
        case 'duration':
          return a.duration - b.duration
        case 'most-played':
          return b.plays - a.plays
        case 'ai-mood': {
          const moodA = a.ai?.analyzed ? a.ai.mood[0] : undefined
          const moodB = b.ai?.analyzed ? b.ai.mood[0] : undefined
          return missingLast(moodA) - missingLast(moodB) || byText(moodA ?? '', moodB ?? '') || byText(a.title, b.title)
        }
        case 'ai-energy': {
          const energyA = a.ai?.analyzed ? a.ai.energy : undefined
          const energyB = b.ai?.analyzed ? b.ai.energy : undefined
          return missingLast(energyA) - missingLast(energyB) || (energyB ?? -1) - (energyA ?? -1) || byText(a.title, b.title)
        }
      }
    })
  })

  // ---- Helpers & Actions -------------------------------------
  function setSection(section: LibrarySection) {
    activeSection.value = section
  }

  function nextSection(): boolean {
    const currentIndex = activeSectionIndex.value
    if (currentIndex < librarySections.length - 1) {
      activeSection.value = librarySections[currentIndex + 1]!.id
      return true
    }
    return false
  }

  function prevSection(): boolean {
    const currentIndex = activeSectionIndex.value
    if (currentIndex > 0) {
      activeSection.value = librarySections[currentIndex - 1]!.id
      return true
    }
    return false
  }

  function setSortBy(key: LibrarySortKey) {
    sortBy.value = key
  }

  function resetPresentation() {
    activeSection.value = 'tracks'
    sortBy.value = defaultSortFromSettings()
  }

  function getAlbum(id: string): Album | undefined {
    return albums.value.find(a => a.id === id)
  }

  function getArtist(id: string): Artist | undefined {
    return artists.value.find(a => a.id === id)
  }

  function trackCountForArtist(artistId: string) {
    return tracks.value.filter(track => track.artistId === artistId).length
  }

  function tracksForAlbum(albumId: string) {
    return tracks.value.filter(track => track.albumId === albumId)
  }

  function tracksForArtist(artistId: string) {
    return tracks.value.filter(track => track.artistId === artistId)
  }

  function tracksForPlaylist(playlist: Playlist) {
    const trackMap = new Map(tracks.value.map(track => [track.id, track]))
    return playlist.trackIds.map(id => trackMap.get(id)).filter((track): track is Track => Boolean(track))
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return {
    // state
    activeSection,
    sortBy,
    tracks,
    albums,
    artists,
    playlists,
    isLoading,

    // getters
    totalTracks,
    activeSectionIndex,
    selectedSortLabel,
    sortedTracks,

    // actions
    setSection,
    nextSection,
    prevSection,
    setSortBy,
    resetPresentation,
    getAlbum,
    getArtist,
    trackCountForArtist,
    tracksForAlbum,
    tracksForArtist,
    tracksForPlaylist,
    formatDuration,
  }
})
