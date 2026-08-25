// ============================================================
// useLibrary — presentation adapter for the SYSTEMA Library page
// ============================================================
// This only shapes the local catalog for the Library UI. Its boundaries map
// directly to a future native MediaStore / Capacitor source without creating
// another playback store.

import type { Album, Artist, Playlist, Track } from '~/types'

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

export function useLibrary() {
  const catalog = useMusicLibrary()
  const playlistsStore = usePlaylists()
  const player = usePlayer()
  const history = usePlaybackHistory()

  const activeSection = ref<LibrarySection>('tracks')
  const sortKey = ref<LibrarySortKey>('recently-added')
  const isLoading = ref(true)

  const totalTracks = computed(() => catalog.tracks.value.length)
  const selectedSortLabel = computed(() =>
    librarySortOptions.find(option => option.id === sortKey.value)?.label ?? 'RECENTLY ADDED',
  )

  const recentRank = computed(() => new Map(history.recentTrackIds.value.map((id, index) => [id, index])))

  const sortedTracks = computed<Track[]>(() => {
    const tracks = [...catalog.tracks.value]
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    const missingLast = (value?: string | number) => value === undefined || value === '' ? 1 : 0

    return tracks.sort((a, b) => {
      const artistA = catalog.getArtist(a.artistId)?.name ?? ''
      const artistB = catalog.getArtist(b.artistId)?.name ?? ''
      const albumA = catalog.getAlbum(a.albumId)?.title ?? ''
      const albumB = catalog.getAlbum(b.albumId)?.title ?? ''

      switch (sortKey.value) {
        case 'recently-added': return b.addedAt.localeCompare(a.addedAt)
        case 'recently-played': {
          const rankA = recentRank.value.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rankB = recentRank.value.get(b.id) ?? Number.MAX_SAFE_INTEGER
          return rankA - rankB || b.addedAt.localeCompare(a.addedAt)
        }
        case 'title': return byText(a.title, b.title)
        case 'artist': return byText(artistA, artistB) || byText(a.title, b.title)
        case 'album': return byText(albumA, albumB) || byText(a.title, b.title)
        case 'duration': return a.duration - b.duration
        case 'most-played': return b.plays - a.plays
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

  const albums = computed<Album[]>(() => catalog.albums.value)
  const artists = computed<Artist[]>(() => catalog.artists.value)
  const playlists = computed<Playlist[]>(() => playlistsStore.playlists.value)

  function trackCountForArtist(artistId: string) {
    return catalog.tracks.value.filter(track => track.artistId === artistId).length
  }

  function tracksForAlbum(albumId: string) {
    return catalog.tracks.value.filter(track => track.albumId === albumId)
  }

  function tracksForArtist(artistId: string) {
    return catalog.tracks.value.filter(track => track.artistId === artistId)
  }

  function tracksForPlaylist(playlist: Playlist) {
    const trackMap = new Map(catalog.tracks.value.map(track => [track.id, track]))
    return playlist.trackIds.map(id => trackMap.get(id)).filter((track): track is Track => Boolean(track))
  }

  function playTrack(track: Track) {
    player.playTrack(track, 'LIBRARY')
    player.openFullPlayer()
  }

  function playTracks(tracks: Track[], context: string, shuffle = false) {
    if (!tracks.length) return
    const items = (shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks)
      .map(track => ({ track, context }))
    player.playQueue(items, 0)
    player.openFullPlayer()
  }

  function shuffleLibrary() {
    const tracks = sortedTracks.value
    if (!tracks.length) return
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]
    if (randomTrack) playTrack(randomTrack)
  }

  function addTrackToQueue(track: Track) {
    player.queue.value = [...player.queue.value, { track, context: 'LIBRARY QUEUE' }]
  }

  function setSection(section: LibrarySection) {
    activeSection.value = section
  }

  onMounted(() => {
    // Preserve the final structure during the very short local-catalog load.
    window.setTimeout(() => { isLoading.value = false }, 160)
  })

  return {
    activeSection,
    sortKey,
    selectedSortLabel,
    isLoading,
    totalTracks,
    sortedTracks,
    albums,
    artists,
    playlists,
    favorites: player.favorites,
    getAlbum: catalog.getAlbum,
    getArtist: catalog.getArtist,
    formatDuration: catalog.formatDuration,
    trackCountForArtist,
    tracksForAlbum,
    tracksForArtist,
    tracksForPlaylist,
    playTrack,
    playTracks,
    shuffleLibrary,
    addTrackToQueue,
    setSection,
  }
}
