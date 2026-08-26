// ============================================================
// SYSTEMA — Native music library service
// ============================================================
// The one place that translates between the native MusicTrack
// contract and SYSTEMA's UI-facing Track / Album / Artist types.
//
//   Pinia store  ->  this service  ->  MusicLibrary plugin
//
// The store never imports @capacitor/core directly and never sees
// an Android concept. In a browser every function here degrades to
// a safe no-op so `npm run dev` keeps rendering the mock catalog.
// ============================================================

import type { Album, Artist, Track } from '~/types'
import {
  MusicLibrary,
  isNativeLibraryAvailable,
  toArtworkSrc,
  type GetTracksOptions,
  type MusicLibraryErrorCode,
  type MusicTrack,
  type PermissionStatus,
  type ScanProgress,
  type ScanStatus,
} from './musicLibraryPlugin'
import { libLog } from './musicLibraryDebug'

export type {
  GetTracksOptions,
  MusicTrack,
  PermissionStatus,
  ScanProgress,
  ScanState,
  ScanStatus,
  SortOrder,
  TrackSortKey,
} from './musicLibraryPlugin'

export { isNativeLibraryAvailable, toArtworkSrc, nativePlatform } from './musicLibraryPlugin'

/** A page of catalog entities derived from one native page. */
export interface LibraryPage {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  nextOffset?: number
}

/** Structured error surfaced to the store — never a raw exception. */
export interface LibraryError {
  code: MusicLibraryErrorCode
  message: string
}

const UNKNOWN_ARTIST = 'Unknown Artist'
const UNKNOWN_ALBUM = 'Unknown Album'

/**
 * Normalises whatever Capacitor rejected with into a stable shape.
 * Native already strips stack traces; this guards against anything
 * else (bridge failures, plugin missing) reaching the UI raw.
 */
export function toLibraryError(error: unknown): LibraryError {
  const candidate = error as { code?: string; message?: string } | undefined
  const code = candidate?.code
  const known: MusicLibraryErrorCode[] = [
    'PERMISSION_DENIED',
    'MEDIASTORE_UNAVAILABLE',
    'MEDIASTORE_QUERY_FAILED',
    'DATABASE_ERROR',
    'INVALID_ARGUMENT',
    'SCAN_IN_PROGRESS',
    'NOT_FOUND',
    'UNKNOWN',
  ]
  return {
    code: known.includes(code as MusicLibraryErrorCode) ? (code as MusicLibraryErrorCode) : 'UNKNOWN',
    message: candidate?.message || 'The music library is unavailable.',
  }
}

// ------------------------------------------------------------
// Identity helpers
// ------------------------------------------------------------
// Derived, deterministic ids. Same input string always yields the
// same id, so albums and artists stay stable across scans and
// across pages without any extra native queries.

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'unknown'
}

export function artistIdFor(name: string | null): string {
  return `na:${slug(name ?? UNKNOWN_ARTIST)}`
}

/**
 * Album identity.
 *
 * MediaStore's own `albumId` is authoritative and is what album art is
 * keyed by, so it is used whenever present. Two distinct albums that
 * merely share a title (compilations, live vs studio, "Greatest Hits")
 * therefore stay separate — collapsing them by name made unrelated
 * tracks share one cover.
 *
 * The name-based form is only a fallback for rows where MediaStore
 * reports no albumId at all.
 */
export function albumIdFor(
  album: string | null,
  artist: string | null,
  mediaStoreAlbumId?: number | null,
): string {
  if (mediaStoreAlbumId != null) return `nal:${mediaStoreAlbumId}`
  return `nal:${slug(album ?? UNKNOWN_ALBUM)}:${slug(artist ?? UNKNOWN_ARTIST)}`
}

function genreIdFor(genre: string | null): string {
  return genre ? `ng:${slug(genre)}` : 'ng:unknown'
}

// ------------------------------------------------------------
// Mapping
// ------------------------------------------------------------

/**
 * Native MusicTrack -> UI Track.
 *
 * Two conversions matter:
 *  - duration: native reports milliseconds, `Track.duration` is seconds.
 *  - artwork: a content:// URI is only loadable after convertFileSrc().
 *
 * Fields SYSTEMA's UI requires but Android cannot supply (mood, energy,
 * language, play count) get neutral placeholders here, in the view
 * adapter — never written to Room. Phase 5's on-device analysis fills
 * them with real values; until then they are honestly empty, not
 * invented taste data.
 */
export function toUiTrack(track: MusicTrack): Track {
  const artistName = track.artist ?? UNKNOWN_ARTIST
  const albumName = track.album ?? UNKNOWN_ALBUM

  return {
    id: track.id,
    title: track.title,
    artistId: artistIdFor(track.artist),
    albumId: albumIdFor(track.album, track.albumArtist ?? track.artist, track.albumId),
    genreId: genreIdFor(track.genre),
    duration: Math.max(0, Math.round(track.duration / 1000)),
    year: track.year ?? 0,
    // Neutral, not fabricated: no analysis has run yet.
    energy: 0,
    mood: 'focused',
    lang: 'inst',
    plays: 0,
    favorite: false,
    // MediaStore reports epoch seconds; the UI sorts on ISO strings.
    addedAt: new Date((track.dateAdded || 0) * 1000).toISOString(),
    artist: artistName,
    album: albumName,
    artwork: toArtworkSrc(track.artworkUri),
  }
}

/** Distinct artists present in a page of native tracks. */
export function toUiArtists(tracks: MusicTrack[]): Artist[] {
  const map = new Map<string, Artist>()
  for (const track of tracks) {
    const id = artistIdFor(track.artist)
    if (map.has(id)) continue
    map.set(id, {
      id,
      name: track.artist ?? UNKNOWN_ARTIST,
      origin: 'ON DEVICE',
      genres: track.genre ? [genreIdFor(track.genre)] : [],
    })
  }
  return [...map.values()]
}

/** Distinct albums present in a page of native tracks. */
export function toUiAlbums(tracks: MusicTrack[]): Album[] {
  const map = new Map<string, Album>()
  for (const track of tracks) {
    const primaryArtist = track.albumArtist ?? track.artist
    const id = albumIdFor(track.album, primaryArtist, track.albumId)
    if (map.has(id)) continue
    map.set(id, {
      id,
      title: track.album ?? UNKNOWN_ALBUM,
      artistId: artistIdFor(primaryArtist),
      year: track.year ?? 0,
      genreId: genreIdFor(track.genre),
      cover: toArtworkSrc(track.artworkUri) ?? '',
    })
  }
  return [...map.values()]
}

// ------------------------------------------------------------
// Plugin surface (browser-safe)
// ------------------------------------------------------------

export async function hasPermission(): Promise<PermissionStatus> {
  if (!isNativeLibraryAvailable()) return { granted: false, status: 'denied' }
  return MusicLibrary.hasPermission()
}

export async function requestPermission(): Promise<PermissionStatus> {
  if (!isNativeLibraryAvailable()) return { granted: false, status: 'denied' }
  const result = await MusicLibrary.requestPermission()
  libLog('bridge requestPermission', result)
  return result
}

export async function getLibraryCount(): Promise<number> {
  if (!isNativeLibraryAvailable()) return 0
  const { count } = await MusicLibrary.getLibraryCount()
  libLog('bridge getLibraryCount', { count })
  return count
}

export async function getScanStatus(): Promise<ScanStatus | null> {
  if (!isNativeLibraryAvailable()) return null
  return MusicLibrary.getScanStatus()
}

/** Starts a scan. Results arrive through the listeners below. */
export async function startScan(): Promise<void> {
  if (!isNativeLibraryAvailable()) {
    libLog('startScan skipped: not a native platform')
    return
  }
  const result = await MusicLibrary.scan()
  libLog('bridge scan() accepted', result)
}

export async function cancelScan(): Promise<void> {
  if (!isNativeLibraryAvailable()) return
  await MusicLibrary.cancelScan()
}

/**
 * One page of the library, already mapped to UI entities.
 * Pagination is mandatory — nothing ever requests "everything".
 */
export async function getTracksPage(options: GetTracksOptions = {}): Promise<LibraryPage> {
  if (!isNativeLibraryAvailable()) {
    return {
      tracks: [],
      albums: [],
      artists: [],
      total: 0,
      offset: options.offset ?? 0,
      limit: options.limit ?? 0,
      hasMore: false,
    }
  }

  const result = await MusicLibrary.getTracks(options)
  libLog('bridge getTracks', {
    requested: options,
    receivedFromNative: result.tracks?.length ?? 0,
    totalInIndex: result.total,
  })

  return {
    tracks: result.tracks.map(toUiTrack),
    albums: toUiAlbums(result.tracks),
    artists: toUiArtists(result.tracks),
    total: result.total,
    offset: result.offset,
    limit: result.limit,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
  }
}

export async function getTrack(id: string): Promise<Track | null> {
  if (!isNativeLibraryAvailable()) return null
  try {
    const { track } = await MusicLibrary.getTrack({ id })
    return toUiTrack(track)
  } catch (error) {
    if (toLibraryError(error).code === 'NOT_FOUND') return null
    throw error
  }
}

export interface ScanListeners {
  onStarted?: (progress: ScanProgress) => void
  onProgress?: (progress: ScanProgress) => void
  onCompleted?: (progress: ScanProgress) => void
  onError?: (progress: ScanProgress) => void
}

/**
 * Subscribes to native scan events.
 * Returns a disposer; a no-op disposer in the browser.
 */
export async function addScanListeners(listeners: ScanListeners): Promise<() => void> {
  if (!isNativeLibraryAvailable()) return () => {}

  const handles = await Promise.all([
    MusicLibrary.addListener('scanStarted', p => listeners.onStarted?.(p)),
    MusicLibrary.addListener('scanProgress', p => listeners.onProgress?.(p)),
    MusicLibrary.addListener('scanCompleted', p => listeners.onCompleted?.(p)),
    MusicLibrary.addListener('scanError', p => listeners.onError?.(p)),
  ])

  return () => {
    for (const handle of handles) void handle.remove()
  }
}
