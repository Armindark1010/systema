import type { Playlist } from '~/types'

export type PlaylistGridColumns = 1 | 2 | 3 | 4

export type PlaylistSortKey =
  | 'updated'
  | 'created'
  | 'name-asc'
  | 'name-desc'
  | 'tracks-desc'
  | 'tracks-asc'

export const LIKED_PLAYLIST_ID = 'sys-liked'
export const RECENT_PLAYLIST_ID = 'sys-recent'

export const PLAYLIST_SORT_OPTIONS: { id: PlaylistSortKey; label: string }[] = [
  { id: 'updated', label: 'RECENTLY UPDATED' },
  { id: 'created', label: 'RECENTLY CREATED' },
  { id: 'name-asc', label: 'NAME A → Z' },
  { id: 'name-desc', label: 'NAME Z → A' },
  { id: 'tracks-desc', label: 'MOST TRACKS' },
  { id: 'tracks-asc', label: 'LEAST TRACKS' },
]

export interface SystemaPlaylistDocument {
  format: 'systema-playlist'
  version: 1
  playlist: {
    id?: string
    name: string
    description?: string
    trackIds: string[]
  }
}

export interface PlaylistImportPreview {
  name: string
  description?: string
  sourceId?: string
  trackIds: string[]
  availableIds: string[]
  missingIds: string[]
}

export interface PlaylistPersistState {
  version: 1
  playlists: Playlist[]
  sortBy: PlaylistSortKey
  gridColumns: PlaylistGridColumns
}

export function isSystemPlaylistId(id: string) {
  return id === LIKED_PLAYLIST_ID || id === RECENT_PLAYLIST_ID
}
