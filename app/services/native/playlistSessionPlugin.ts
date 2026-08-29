// ============================================================
// SYSTEMA — Native Playlist Session Plugin Bridge
// ============================================================
// Talks to the Android Room SQLite database for durable session
// persistence across force-closes, app restarts and reboots.
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PersistedPlaylistSession } from '../persistence/playlistSession'

export interface PlaylistSessionPluginAvailability {
  available: boolean
  durable: boolean
  engine: string
  database: string
  table: string
  version: number
}

export interface NativePlaylistSessionPlugin {
  isAvailable(): Promise<PlaylistSessionPluginAvailability>
  saveSession(session: PersistedPlaylistSession): Promise<{ saved: boolean, session: PersistedPlaylistSession }>
  getSession(options: { playlistId: string }): Promise<{ session: PersistedPlaylistSession | null }>
  getAllSessions(): Promise<{ sessions: PersistedPlaylistSession[] }>
  getIncompleteSessions(): Promise<{ sessions: PersistedPlaylistSession[] }>
  deleteSession(options: { playlistId: string }): Promise<{ deleted: boolean }>
  markCompleted(options: { playlistId: string }): Promise<{ completed: boolean }>
}

export const PLAYLIST_SESSION_PLUGIN_NAME = 'PlaylistSession'

export const PlaylistSessionNative = registerPlugin<NativePlaylistSessionPlugin>(PLAYLIST_SESSION_PLUGIN_NAME)

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

let cachedAvailability: PlaylistSessionPluginAvailability | null = null

export async function checkPlaylistSessionAvailability(): Promise<PlaylistSessionPluginAvailability> {
  if (cachedAvailability) return cachedAvailability
  if (!isNativePlatform()) {
    cachedAvailability = {
      available: false,
      durable: false,
      engine: 'web-localstorage',
      database: 'localStorage',
      table: 'systema:playlist-sessions:v1',
      version: 1,
    }
    return cachedAvailability
  }

  try {
    const res = await PlaylistSessionNative.isAvailable()
    cachedAvailability = res
    return res
  } catch (err) {
    console.warn('[PlaylistSessionNative] Plugin not available:', err)
    cachedAvailability = {
      available: false,
      durable: false,
      engine: 'web-localstorage-fallback',
      database: 'localStorage',
      table: 'systema:playlist-sessions:v1',
      version: 1,
    }
    return cachedAvailability
  }
}
