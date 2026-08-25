// ============================================================
// SYSTEMA — Playlist Store (Pinia)
// ============================================================
// Normalized playlists (trackIds only). Virtual system lists
// (Liked / Recently Played) are derived, never duplicated.
// ============================================================

import { defineStore } from 'pinia'
import type { Playlist } from '~/types'
import {
  LIKED_PLAYLIST_ID,
  RECENT_PLAYLIST_ID,
  isSystemPlaylistId,
  type PlaylistGridColumns,
  type PlaylistPersistState,
  type PlaylistSortKey,
} from '~/types/playlists'
import { playlists as seed } from '~/data/playlists'
import { tracks as catalog } from '~/data/music'
import { PLAYLISTS_STORAGE_KEY, readJSON, writeJSON } from '~/services/persistence/storageAdapter'
import { sortPlaylists } from '~/services/playlists/playlistDocument'
import { usePlayerStore } from '~/stores/player'
import { usePlaybackHistory } from '~/composables/usePlaybackHistory'

const knownIds = new Set(catalog.map(track => track.id))

function cloneSeed(): Playlist[] {
  return seed.map(item => ({ ...item, trackIds: [...item.trackIds] }))
}

function sanitizePlaylist(raw: unknown): Playlist | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Playlist>
  if (typeof item.id !== 'string' || !item.id) return null
  if (isSystemPlaylistId(item.id)) return null
  if (typeof item.title !== 'string' || !item.title.trim()) return null
  const trackIds = Array.isArray(item.trackIds)
    ? item.trackIds.filter((id): id is string => typeof id === 'string' && knownIds.has(id))
    : []
  const now = new Date().toISOString()
  return {
    id: item.id,
    title: item.title.trim(),
    description: typeof item.description === 'string' ? item.description : undefined,
    cover: typeof item.cover === 'string' ? item.cover : undefined,
    kind: item.kind === 'ai' || item.kind === 'system' ? item.kind : 'user',
    trackIds,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
    aiMeta: item.aiMeta,
  }
}

function readPersisted(): PlaylistPersistState {
  const stored = readJSON<Partial<PlaylistPersistState>>(PLAYLISTS_STORAGE_KEY)
  const playlists = Array.isArray(stored?.playlists)
    ? stored.playlists.map(sanitizePlaylist).filter((item): item is Playlist => Boolean(item))
    : cloneSeed()
  const sortBy: PlaylistSortKey = stored?.sortBy && [
    'updated', 'created', 'name-asc', 'name-desc', 'tracks-desc', 'tracks-asc',
  ].includes(stored.sortBy)
    ? stored.sortBy
    : 'updated'
  const gridColumns = ([1, 2, 3, 4] as const).includes(stored?.gridColumns as PlaylistGridColumns)
    ? stored!.gridColumns as PlaylistGridColumns
    : 2
  return { version: 1, playlists: playlists.length ? playlists : cloneSeed(), sortBy, gridColumns }
}

export const usePlaylistStore = defineStore('playlists', () => {
  const persisted = readPersisted()
  const items = ref<Playlist[]>(persisted.playlists)
  const sortBy = ref<PlaylistSortKey>(persisted.sortBy)
  const gridColumns = ref<PlaylistGridColumns>(persisted.gridColumns)

  const player = usePlayerStore()
  const history = usePlaybackHistory()

  function persist() {
    writeJSON(PLAYLISTS_STORAGE_KEY, {
      version: 1,
      playlists: items.value,
      sortBy: sortBy.value,
      gridColumns: gridColumns.value,
    } satisfies PlaylistPersistState)
  }

  if (import.meta.client) {
    watch([items, sortBy, gridColumns], persist, { deep: true })
  }

  const likedSongs = computed<Playlist>(() => ({
    id: LIKED_PLAYLIST_ID,
    title: 'LIKED SONGS',
    description: 'Tracks you marked as liked.',
    kind: 'system',
    trackIds: [...player.favorites],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
  }))

  const recentlyPlayed = computed<Playlist>(() => ({
    id: RECENT_PLAYLIST_ID,
    title: 'RECENTLY PLAYED',
    description: 'Derived from actual playback history.',
    kind: 'system',
    trackIds: [...history.recentTrackIds.value],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
  }))

  const userPlaylists = computed(() => sortPlaylists(items.value, sortBy.value))

  function getPlaylistById(id: string): Playlist | undefined {
    if (id === LIKED_PLAYLIST_ID) return likedSongs.value
    if (id === RECENT_PLAYLIST_ID) return recentlyPlayed.value
    return items.value.find(item => item.id === id)
  }

  function resolveTracks(trackIds: string[]) {
    return trackIds
      .map(id => catalog.find(track => track.id === id))
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
  }

  function createPlaylist(title: string, description?: string, trackIds: string[] = []): Playlist {
    const now = new Date().toISOString()
    const playlist: Playlist = {
      id: `pl-${Date.now().toString(36)}`,
      title: title.trim(),
      description: description?.trim() || undefined,
      kind: 'user',
      trackIds: trackIds.filter(id => knownIds.has(id)),
      createdAt: now,
      updatedAt: now,
    }
    items.value = [playlist, ...items.value]
    return playlist
  }

  function updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'title' | 'description' | 'cover'>>) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist) return
    if (patch.title !== undefined) {
      const next = patch.title.trim()
      if (!next) return
      playlist.title = next
    }
    if (patch.description !== undefined) playlist.description = patch.description.trim() || undefined
    if (patch.cover !== undefined) playlist.cover = patch.cover || undefined
    playlist.updatedAt = new Date().toISOString()
  }

  function deletePlaylist(id: string) {
    if (isSystemPlaylistId(id)) return
    items.value = items.value.filter(item => item.id !== id)
  }

  function addTrackToPlaylist(id: string, trackId: string) {
    addTracksToPlaylist(id, [trackId])
  }

  function addTracksToPlaylist(id: string, trackIds: string[]) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist) return
    const existing = new Set(playlist.trackIds)
    const next = trackIds.filter(trackId => knownIds.has(trackId) && !existing.has(trackId))
    if (!next.length) return
    playlist.trackIds = [...playlist.trackIds, ...next]
    playlist.updatedAt = new Date().toISOString()
  }

  function removeTrackFromPlaylist(id: string, trackId: string) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist) return
    playlist.trackIds = playlist.trackIds.filter(item => item !== trackId)
    playlist.updatedAt = new Date().toISOString()
  }

  function reorderPlaylistTracks(id: string, from: number, to: number) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist || from === to) return
    if (from < 0 || to < 0 || from >= playlist.trackIds.length || to >= playlist.trackIds.length) return
    const next = [...playlist.trackIds]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    playlist.trackIds = next
    playlist.updatedAt = new Date().toISOString()
  }

  function setSortBy(key: PlaylistSortKey) {
    sortBy.value = key
  }

  function setGridColumns(columns: PlaylistGridColumns) {
    gridColumns.value = columns
  }

  function importPreview(preview: { name: string; description?: string; availableIds: string[] }) {
    return createPlaylist(preview.name, preview.description, preview.availableIds)
  }

  return {
    items,
    sortBy,
    gridColumns,
    likedSongs,
    recentlyPlayed,
    userPlaylists,
    getPlaylistById,
    resolveTracks,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylistTracks,
    setSortBy,
    setGridColumns,
    importPreview,
  }
})
