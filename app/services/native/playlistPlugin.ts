// ============================================================
// SYSTEMA — Native Playlists Plugin Bridge (Phase 29)
// ============================================================
// Talks to the Android Room SQLite database for durable playlist
// and playlist_tracks storage across force-closes, reboots, and updates.
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Playlist } from '~/types'

export interface PlaylistsPluginAvailability {
  available: boolean
  durable: boolean
  engine: string
  database: string
  table: string
  version: number
}

export interface NativePlaylistsPlugin {
  isAvailable(): Promise<PlaylistsPluginAvailability>
  getAllPlaylists(): Promise<{ playlists: Playlist[]; count: number }>
  getPlaylistById(options: { id: string }): Promise<{ playlist: Playlist | null }>
  savePlaylist(playlist: Playlist): Promise<{ saved: boolean; id: string }>
  deletePlaylist(options: { id: string }): Promise<{ deleted: boolean }>
  count(): Promise<{ count: number }>
}

export const PLAYLISTS_PLUGIN_NAME = 'Playlists'

export const PlaylistsNative = registerPlugin<NativePlaylistsPlugin>(PLAYLISTS_PLUGIN_NAME)

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

let cachedAvailability: PlaylistsPluginAvailability | null = null

export async function checkPlaylistsAvailability(): Promise<PlaylistsPluginAvailability> {
  if (cachedAvailability) return cachedAvailability
  if (!isNativePlatform()) {
    cachedAvailability = {
      available: false,
      durable: false,
      engine: 'web-localstorage',
      database: 'localStorage',
      table: 'systema:playlists',
      version: 1,
    }
    console.info(`[SystemaPersistence] PERSISTENCE_BACKEND backend=${cachedAvailability.engine}`)
    return cachedAvailability
  }

  try {
    const res = await PlaylistsNative.isAvailable()
    cachedAvailability = res
    console.info(`[SystemaPersistence] PERSISTENCE_BACKEND backend=${res.engine} db=${res.database} version=${res.version}`)
    return res
  } catch (err) {
    console.warn('[PlaylistsNative] Plugin not available:', err)
    cachedAvailability = {
      available: false,
      durable: false,
      engine: 'web-localstorage-fallback',
      database: 'localStorage',
      table: 'systema:playlists',
      version: 1,
    }
    console.info(`[SystemaPersistence] PERSISTENCE_BACKEND backend=${cachedAvailability.engine}`)
    return cachedAvailability
  }
}
