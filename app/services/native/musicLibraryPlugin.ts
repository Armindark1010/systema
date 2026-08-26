// ============================================================
// SYSTEMA — MusicLibrary native plugin contract
// ============================================================
// TypeScript mirror of the Kotlin `MusicLibraryPlugin`.
//
//   Vue -> Pinia -> this service -> Capacitor -> Kotlin
//        -> MusicLibraryRepository -> Room / MediaStore
//
// Nothing here is Android-specific beyond the type contract; the
// registration below resolves to a web stub in the browser.
// ============================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** One local audio item, exactly as the native layer reports it. */
export interface MusicTrack {
  /** Stable identity, e.g. "ms:external_primary:1234". */
  id: string
  mediaStoreId: number
  volumeName: string
  /** Playable content:// URI. Consumed by Media3 in Phase 2. */
  uri: string
  title: string
  /** Null fields are genuinely absent on the device — never faked. */
  artist: string | null
  album: string | null
  albumArtist: string | null
  /** Milliseconds. */
  duration: number
  trackNumber: number | null
  discNumber: number | null
  genre: string | null
  year: number | null
  mimeType: string | null
  /** Bytes. */
  fileSize: number
  /** Epoch seconds. */
  dateAdded: number
  /** Epoch seconds. */
  dateModified: number
  /** Raw content:// album-art URI, or null. Resolve via toArtworkSrc(). */
  artworkUri: string | null
  albumId: number | null
}

export type ScanState = 'IDLE' | 'REQUESTING_PERMISSION' | 'SCANNING' | 'COMPLETED' | 'ERROR'

export type MusicLibraryErrorCode =
  | 'PERMISSION_DENIED'
  | 'MEDIASTORE_UNAVAILABLE'
  | 'MEDIASTORE_QUERY_FAILED'
  | 'DATABASE_ERROR'
  | 'INVALID_ARGUMENT'
  | 'SCAN_IN_PROGRESS'
  | 'NOT_FOUND'
  | 'UNKNOWN'

/** Real scan telemetry. Every counter reflects work that happened. */
export interface ScanProgress {
  state: ScanState
  discovered: number
  processed: number
  inserted: number
  updated: number
  removed: number
  unchanged: number
  /** True when MediaStore could not report an exact total. */
  indeterminate: boolean
  /** Exact item count, or null for an indeterminate scan. */
  total: number | null
  errorCode: MusicLibraryErrorCode | null
  errorMessage: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface ScanStatus extends ScanProgress {
  scanning: boolean
}

export type PermissionStatusValue = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

export interface PermissionStatus {
  granted: boolean
  status: PermissionStatusValue
}

export type TrackSortKey = 'title' | 'artist' | 'album' | 'dateAdded' | 'duration'
export type SortOrder = 'asc' | 'desc'

export interface GetTracksOptions {
  /** Row offset. Defaults to 0. */
  offset?: number
  /** Page size. Defaults to 50, capped natively at 500. */
  limit?: number
  sort?: TrackSortKey
  order?: SortOrder
  /** Optional substring filter across title / artist / album. */
  query?: string
}

export interface GetTracksResult {
  tracks: MusicTrack[]
  /** Total rows matching the query, not the page length. */
  total: number
  offset: number
  limit: number
  hasMore: boolean
  /** Offset to pass for the next page, absent on the last page. */
  nextOffset?: number
}

export interface GetTrackResult {
  track: MusicTrack
}

export interface ScanStartedResult {
  started: boolean
  state: ScanState
}

export interface LibraryCountResult {
  count: number
}

/**
 * The native surface. Long scans are event-driven: `scan()` resolves as
 * soon as the scan is accepted, and results arrive through listeners so
 * a 10k-track library never travels in one bridge call.
 */
export interface MusicLibraryPlugin {
  hasPermission(): Promise<PermissionStatus>
  requestPermission(): Promise<PermissionStatus>

  scan(): Promise<ScanStartedResult>
  cancelScan(): Promise<{ cancelled: boolean }>
  getScanStatus(): Promise<ScanStatus>

  getTracks(options?: GetTracksOptions): Promise<GetTracksResult>
  getTrack(options: { id: string }): Promise<GetTrackResult>
  getLibraryCount(): Promise<LibraryCountResult>
  clearLibrary(): Promise<{ cleared: boolean }>

  addListener(eventName: 'scanStarted', handler: (progress: ScanProgress) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'scanProgress', handler: (progress: ScanProgress) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'scanCompleted', handler: (progress: ScanProgress) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'scanError', handler: (progress: ScanProgress) => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

/**
 * Registered without a web implementation on purpose. In the browser we
 * never reach the plugin at all — `isNativeLibraryAvailable()` gates
 * every call, and the store falls back to the existing mock catalog.
 */
/**
 * Must match `@CapacitorPlugin(name = "MusicLibrary")` in
 * MusicLibraryPlugin.kt exactly — the bridge resolves plugins by this
 * string.
 */
export const PLUGIN_NAME = 'MusicLibrary'

export const MusicLibrary = registerPlugin<MusicLibraryPlugin>(PLUGIN_NAME)

/** Current Capacitor platform, or 'unknown' when Capacitor is absent. */
export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'unknown'
  }
}

/**
 * True only on a native Android build that actually registered the
 * plugin.
 *
 * `isPluginAvailable` checks `window.Capacitor.PluginHeaders`, which
 * the native bridge injects from the plugins registered on the
 * Bridge.Builder. If MainActivity ever stops calling
 * `registerPlugin(MusicLibraryPlugin.class)` this returns false and
 * the app silently falls back to mock data — so the result is logged.
 */
export function isNativeLibraryAvailable(): boolean {
  try {
    const native = Capacitor.isNativePlatform()
    const platform = Capacitor.getPlatform()
    const registered = Capacitor.isPluginAvailable(PLUGIN_NAME)

    if (native && platform === 'android' && !registered) {
      console.warn(
        `[SYSTEMA/LIB] Running on Android but the "${PLUGIN_NAME}" plugin is not `
        + 'registered. Check registerPlugin(MusicLibraryPlugin.class) in MainActivity.',
      )
    }

    return native && platform === 'android' && registered
  } catch {
    // Capacitor absent entirely (SSR, plain browser).
    return false
  }
}

/**
 * Turn a native `content://` artwork URI into something the WebView can
 * load. Returns undefined when there is no artwork, so the existing
 * SYSTEMA <Artwork> fallback renders instead.
 *
 * Loading stays lazy: this only builds a URL string. No bytes are read
 * until an <img> requests it.
 */
export function toArtworkSrc(artworkUri: string | null | undefined): string | undefined {
  if (!artworkUri) return undefined
  try {
    return Capacitor.convertFileSrc(artworkUri)
  } catch {
    return undefined
  }
}
