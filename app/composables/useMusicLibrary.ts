// ============================================================
// useMusicLibrary — catalog queries & local UI state
// ============================================================
// Mock layer over the static catalog; the same contract will
// later be backed by MediaStore / Room (via Capacitor).
// ============================================================

import type { Album, Artist, Genre, LibrarySort, Track, ViewMode } from '~/types'
import {
  albums as albumData,
  artists as artistData,
  genres as genreData,
  tracks as trackData,
  getAlbum,
  getArtist,
  getGenre,
  continueListening,
  libraryStats,
} from '~/data/music'

const tracks = ref<Track[]>([...trackData])
const albums = ref<Album[]>([...albumData])
const artists = ref<Artist[]>([...artistData])
const genres = ref<Genre[]>([...genreData])

const query = ref('')
const sortBy = ref<LibrarySort>('title')
const sortDesc = ref(false)
const viewMode = ref<ViewMode>('list')

export function useMusicLibrary() {
  const { recentlyPlayed } = usePlaybackHistory()

  const sortedTracks = computed<Track[]>(() => {
    const q = query.value.trim().toLowerCase()
    let list = tracks.value.filter((t) => {
      if (!q) return true
      const artist = getArtist(t.artistId)?.name.toLowerCase() ?? ''
      const album = getAlbum(t.albumId)?.title.toLowerCase() ?? ''
      return (
        t.title.toLowerCase().includes(q) ||
        artist.includes(q) ||
        album.includes(q) ||
        getGenre(t.genreId)?.name.toLowerCase().includes(q)
      )
    })
    const dir = sortDesc.value ? -1 : 1
    list = [...list].sort((a, b) => {
      switch (sortBy.value) {
        case 'artist': return getArtist(a.artistId)!.name.localeCompare(getArtist(b.artistId)!.name) * dir
        case 'album': return (getAlbum(a.albumId)?.title ?? '').localeCompare(getAlbum(b.albumId)?.title ?? '') * dir
        case 'duration': return (a.duration - b.duration) * dir
        case 'plays': return (a.plays - b.plays) * dir
        case 'added': return a.addedAt.localeCompare(b.addedAt) * dir
        default: return a.title.localeCompare(b.title) * dir
      }
    })
    return list
  })

  const sortedAlbums = computed(() =>
    [...albums.value].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title)),
  )

  const sortedArtists = computed(() =>
    [...artists.value].sort((a, b) => a.name.localeCompare(b.name)),
  )

  const genreCatalog = computed(() =>
    genres.value.map((g) => ({
      genre: g,
      albums: albums.value.filter((a) => a.genreId === g.id),
      tracks: tracks.value.filter((t) => t.genreId === g.id),
    })),
  )

  function toggleFavorite(trackId: string) {
    const t = tracks.value.find((x) => x.id === trackId)
    if (t) t.favorite = !t.favorite
  }

  return {
    tracks: sortedTracks,
    albums: sortedAlbums,
    artists: sortedArtists,
    genres,
    genreCatalog,
    query,
    sortBy,
    sortDesc,
    viewMode,
    setViewMode: (v: ViewMode) => (viewMode.value = v),
    toggleSort: (key: LibrarySort) => {
      if (sortBy.value === key) sortDesc.value = !sortDesc.value
      else {
        sortBy.value = key
        sortDesc.value = false
      }
    },
    toggleFavorite,
    getAlbum,
    getArtist,
    getGenre,
    stats: libraryStats,
    continueListening,
    recentlyPlayed,
    formatDuration: (s: number) => {
      const m = Math.floor(s / 60)
      return `${m}:${(s % 60).toString().padStart(2, '0')}`
    },
  }
}
