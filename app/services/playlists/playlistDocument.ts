import type { Playlist } from '../../types'
import type { PlaylistImportPreview, SystemaPlaylistDocument } from '../../types/playlists'

const FORMAT = 'systema-playlist' as const
const VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function toPlaylistDocument(playlist: Playlist): SystemaPlaylistDocument {
  return {
    format: FORMAT,
    version: VERSION,
    playlist: {
      id: playlist.id,
      name: playlist.title,
      description: playlist.description,
      trackIds: [...playlist.trackIds],
    },
  }
}

export function parsePlaylistDocument(raw: unknown, knownTrackIds: Set<string>): PlaylistImportPreview {
  if (!isRecord(raw)) throw new Error('Invalid playlist file')
  if (raw.format !== FORMAT) throw new Error('Unsupported playlist format')
  if (raw.version !== VERSION) throw new Error(`Unsupported playlist version: ${String(raw.version)}`)
  if (!isRecord(raw.playlist)) throw new Error('Missing playlist payload')

  const payload = raw.playlist
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!name) throw new Error('Playlist name is required')

  const description = typeof payload.description === 'string' ? payload.description : undefined
  const sourceId = typeof payload.id === 'string' ? payload.id : undefined
  const trackIds = Array.isArray(payload.trackIds)
    ? payload.trackIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  const seen = new Set<string>()
  const availableIds: string[] = []
  const missingIds: string[] = []
  for (const id of trackIds) {
    if (seen.has(id)) continue
    seen.add(id)
    if (knownTrackIds.has(id)) availableIds.push(id)
    else missingIds.push(id)
  }

  return {
    name,
    description,
    sourceId,
    trackIds,
    availableIds,
    missingIds,
  }
}

export function sortPlaylists<T extends { title: string; createdAt: string; updatedAt: string; trackIds: string[] }>(
  list: T[],
  sortBy: 'updated' | 'created' | 'name-asc' | 'name-desc' | 'tracks-desc' | 'tracks-asc',
): T[] {
  const next = [...list]
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  next.sort((a, b) => {
    switch (sortBy) {
      case 'created':
        return b.createdAt.localeCompare(a.createdAt)
      case 'name-asc':
        return byText(a.title, b.title)
      case 'name-desc':
        return byText(b.title, a.title)
      case 'tracks-desc':
        return b.trackIds.length - a.trackIds.length || byText(a.title, b.title)
      case 'tracks-asc':
        return a.trackIds.length - b.trackIds.length || byText(a.title, b.title)
      default:
        return b.updatedAt.localeCompare(a.updatedAt)
    }
  })
  return next
}
