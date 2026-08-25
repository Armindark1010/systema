// ============================================================
// useSearch — search architecture (normal + AI semantic)
// ============================================================
// Normal search matches the catalog; AI semantic search is
// represented by mock states that a future inference engine
// will fill in.
// ============================================================

import type { Album, Artist, Playlist, SearchResult, Track } from '~/types'
import { isSemanticQuery } from '~/data/search'
import { useMusicLibrary } from './useMusicLibrary'
import { usePlaylists } from './usePlaylists'

const query = ref('')

export function useSearch() {
  const { tracks, albums, artists, getAlbum, getArtist } = useMusicLibrary()
  const { playlists } = usePlaylists()

  const semantic = computed(() => isSemanticQuery(query.value))

  const trackResults = computed<Track[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!q || semantic.value) return []
    return tracks.value
      .filter((t) => t.title.toLowerCase().includes(q) || (getArtist(t.artistId)?.name.toLowerCase() ?? '').includes(q))
      .slice(0, 8)
  })

  const albumResults = computed<Album[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!q || semantic.value) return []
    return albums.value.filter((a) => a.title.toLowerCase().includes(q)).slice(0, 4)
  })

  const artistResults = computed<Artist[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!q || semantic.value) return []
    return artists.value.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 4)
  })

  const playlistResults = computed<Playlist[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!q || semantic.value) return []
    return playlists.value.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 3)
  })

  /** grouped results for the results page */
  const grouped = computed(() => ({
    tracks: trackResults.value,
    albums: albumResults.value,
    artists: artistResults.value,
    playlists: playlistResults.value,
    semantic: semantic.value,
  }))

  /** flat results for the command palette */
  const paletteResults = computed<SearchResult[]>(() => {
    const out: SearchResult[] = []
    trackResults.value.slice(0, 5).forEach((t) =>
      out.push({ id: t.id, type: 'track', title: t.title, subtitle: getArtist(t.artistId)?.name ?? '' }),
    )
    artistResults.value.slice(0, 3).forEach((a) =>
      out.push({ id: a.id, type: 'artist', title: a.name, subtitle: a.origin }),
    )
    albumResults.value.slice(0, 3).forEach((al) =>
      out.push({ id: al.id, type: 'album', title: al.title, subtitle: getArtist(al.artistId)?.name ?? '' }),
    )
    playlistResults.value.slice(0, 3).forEach((p) =>
      out.push({ id: p.id, type: 'playlist', title: p.title, subtitle: p.description ?? '' }),
    )
    return out
  })

  function submit(q?: string) {
    if (q !== undefined) query.value = q
    navigateTo(semantic.value ? `/ai/search?q=${encodeURIComponent(query.value.trim())}` : `/search?q=${encodeURIComponent(query.value.trim())}`)
  }

  return { query, semantic, grouped, paletteResults, submit }
}
