// ============================================================
// SYSTEMA — Playlist Store (Pinia + Room SQLite Persistence)
// ============================================================
// Normalized playlists (trackIds only). Virtual system lists
// (Liked / Recently Played) are derived, never duplicated.
//
// Guaranteed durable on device via Room SQLite (systema-music-library.db).
// ZERO fake data: only real user-created or imported playlists exist.
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
import { tracks as catalog } from '~/data/music'
import { PLAYLISTS_STORAGE_KEY, readJSON, writeJSON } from '~/services/persistence/storageAdapter'
import { sortPlaylists } from '~/services/playlists/playlistDocument'
import { usePlayerStore } from '~/stores/player'
import { usePlaybackHistory } from '~/composables/usePlaybackHistory'
import {
  PlaylistsNative,
  checkPlaylistsAvailability,
  isNativePlatform,
  type PlaylistsPluginAvailability,
} from '~/services/native/playlistPlugin'

const LEGACY_MOCK_PLAYLIST_IDS = new Set([
  'pl-functional',
  'pl-night-drive',
  'pl-deep-focus',
  'pl-late-night',
  'pl-persian-nights',
  'pl-morning-grid',
  'pl-gym-protocol',
  'pl-first-take',
])

function sanitizePlaylist(raw: unknown): Playlist | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Playlist>
  if (typeof item.id !== 'string' || !item.id) return null
  if (isSystemPlaylistId(item.id) || LEGACY_MOCK_PLAYLIST_IDS.has(item.id)) return null
  if (typeof item.title !== 'string' || !item.title.trim()) return null

  // Accepts any non-empty string trackId from live library or catalog
  const trackIds = Array.isArray(item.trackIds)
    ? item.trackIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
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
    : []
  const sortBy: PlaylistSortKey = stored?.sortBy && [
    'updated', 'created', 'name-asc', 'name-desc', 'tracks-desc', 'tracks-asc',
  ].includes(stored.sortBy)
    ? stored.sortBy
    : 'updated'
  const gridColumns = ([1, 2, 3, 4] as const).includes(stored?.gridColumns as PlaylistGridColumns)
    ? stored!.gridColumns as PlaylistGridColumns
    : 2
  return { version: 1, playlists, sortBy, gridColumns }
}

export const usePlaylistStore = defineStore('playlists', () => {
  const persisted = readPersisted()
  const items = ref<Playlist[]>(persisted.playlists)
  const sortBy = ref<PlaylistSortKey>(persisted.sortBy)
  const gridColumns = ref<PlaylistGridColumns>(persisted.gridColumns)
  const storageEngineInfo = ref<PlaylistsPluginAvailability | null>(null)
  const isDurableRoom = computed(() => storageEngineInfo.value?.durable === true)

  const player = usePlayerStore()
  const history = usePlaybackHistory()

  let hydrated = false

  async function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true

    console.info('[SystemaPlaylists] HYDRATION_START')

    try {
      const info = await checkPlaylistsAvailability()
      storageEngineInfo.value = info

      if (info.available && isNativePlatform()) {
        const res = await PlaylistsNative.getAllPlaylists()
        if (res && Array.isArray(res.playlists)) {
          const sanitized = res.playlists
            .map(sanitizePlaylist)
            .filter((item): item is Playlist => Boolean(item))

          items.value = sanitized
          console.info(`[SystemaPlaylists] HYDRATION_COMPLETE source=room-sqlite count=${sanitized.length}`)
          persistLocal()
          return
        }
      }
    } catch (err) {
      console.error('[SystemaPlaylists] Error hydrating playlists from Room:', err)
    }

    console.info(`[SystemaPlaylists] HYDRATION_COMPLETE source=localstorage count=${items.value.length}`)
  }

  function persistLocal() {
    writeJSON(PLAYLISTS_STORAGE_KEY, {
      version: 1,
      playlists: items.value,
      sortBy: sortBy.value,
      gridColumns: gridColumns.value,
    } satisfies PlaylistPersistState)
  }

  async function persistToRoom(playlist: Playlist) {
    if (!import.meta.client || !isNativePlatform()) return
    try {
      await PlaylistsNative.savePlaylist(playlist)
    } catch (err) {
      console.error(`[SystemaPlaylists] PLAYLIST_WRITE_FAILED id=${playlist.id}`, err)
    }
  }

  async function deleteFromRoom(id: string) {
    if (!import.meta.client || !isNativePlatform()) return
    try {
      await PlaylistsNative.deletePlaylist({ id })
    } catch (err) {
      console.error(`[SystemaPlaylists] PLAYLIST_DELETE_FAILED id=${id}`, err)
    }
  }

  if (import.meta.client) {
    hydrate()
    watch([sortBy, gridColumns], persistLocal, { deep: true })
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
    const validTrackIds = trackIds.filter(id => typeof id === 'string' && id.trim().length > 0)
    const playlist: Playlist = {
      id: `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      description: description?.trim() || undefined,
      kind: 'user',
      trackIds: validTrackIds,
      createdAt: now,
      updatedAt: now,
    }
    items.value = [playlist, ...items.value]
    persistLocal()
    persistToRoom(playlist)
    console.info(`[SystemaPlaylists] PLAYLIST_WRITE id=${playlist.id} tracks=${validTrackIds.length}`)
    console.info(`[SystemaPlaylists] PLAYLIST_COUNT count=${items.value.length}`)
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
    persistLocal()
    persistToRoom(playlist)
  }

  function deletePlaylist(id: string) {
    if (isSystemPlaylistId(id)) return
    items.value = items.value.filter(item => item.id !== id)
    persistLocal()
    deleteFromRoom(id)
    console.info(`[SystemaPlaylists] PLAYLIST_DELETE id=${id}`)
    console.info(`[SystemaPlaylists] PLAYLIST_COUNT count=${items.value.length}`)
  }

  function addTrackToPlaylist(id: string, trackId: string) {
    addTracksToPlaylist(id, [trackId])
  }

  function addTracksToPlaylist(id: string, trackIds: string[]) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist) return
    const existing = new Set(playlist.trackIds)
    const next = trackIds.filter(trackId => typeof trackId === 'string' && trackId.trim().length > 0 && !existing.has(trackId))
    if (!next.length) return
    playlist.trackIds = [...playlist.trackIds, ...next]
    playlist.updatedAt = new Date().toISOString()
    persistLocal()
    persistToRoom(playlist)
    console.info(`[SystemaPlaylists] PLAYLIST_WRITE id=${playlist.id} added=${next.length} totalTracks=${playlist.trackIds.length}`)
  }

  function removeTrackFromPlaylist(id: string, trackId: string) {
    if (isSystemPlaylistId(id)) return
    const playlist = items.value.find(item => item.id === id)
    if (!playlist) return
    playlist.trackIds = playlist.trackIds.filter(item => item !== trackId)
    playlist.updatedAt = new Date().toISOString()
    persistLocal()
    persistToRoom(playlist)
    console.info(`[SystemaPlaylists] PLAYLIST_WRITE id=${playlist.id} removedTrack=${trackId} totalTracks=${playlist.trackIds.length}`)
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
    persistLocal()
    persistToRoom(playlist)
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
    storageEngineInfo,
    isDurableRoom,
    likedSongs,
    recentlyPlayed,
    userPlaylists,
    hydrate,
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
