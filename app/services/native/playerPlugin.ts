// ============================================================
// SYSTEMA — Player native plugin contract
// ============================================================
// TypeScript mirror of the Kotlin `PlayerPlugin`.
//
//   Vue -> Pinia player store -> playerService -> Capacitor
//        -> PlayerPlugin -> PlayerEngine -> Media3 ExoPlayer
//
// Vue components never reach this module; the store and its service
// are the only callers. In the browser the plugin is never touched at
// all — `isNativePlayerAvailable()` gates every call and the existing
// generative WebAudio engine keeps running unchanged.
// ============================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * One playable item as the native engine wants it: metadata plus a
 * `content://` URI. Never audio data, never a bitmap.
 */
export interface NativePlayerTrack {
  /** SYSTEMA identity, e.g. "ms:external_primary:1234". */
  id: string
  /** Playable content:// URI straight from MediaStore. */
  uri: string
  title: string
  artist?: string | null
  album?: string | null
  /** Raw content:// album-art URI. Passed by reference only. */
  artworkUri?: string | null
  /** Milliseconds. */
  duration?: number
}

/** Normalised playback lifecycle — no Media3 integers cross the bridge. */
export type NativePlaybackState = 'idle' | 'buffering' | 'ready' | 'ended'

export type NativeRepeatMode = 'off' | 'one' | 'all'

export type PlayerErrorCode =
  | 'INVALID_URI'
  | 'FILE_UNAVAILABLE'
  | 'DECODER_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'PLAYBACK_ERROR'
  | 'PERMISSION_DENIED'
  | 'INITIALIZATION_FAILED'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'UNKNOWN'

/** Complete native playback state. The store mirrors this. */
export interface PlayerSnapshot {
  state: NativePlaybackState
  isPlaying: boolean
  positionMs: number
  durationMs: number
  bufferedPositionMs: number
  /** -1 when the queue is empty. */
  currentIndex: number
  queueSize: number
  shuffle: boolean
  repeatMode: NativeRepeatMode
  currentTrackId: string | null
  /**
   * True when playback is paused because Media3 lost audio focus — a
   * phone call, a navigation prompt, another music app — rather than
   * because the user pressed pause. Media3 handles the focus itself;
   * this only lets the UI tell the two apart.
   */
  interrupted?: boolean
}

export interface PlayerErrorEvent {
  code: PlayerErrorCode
  message: string
  /** The track that failed, when it is known. */
  trackId: string | null
}

export interface CurrentTrackChangedEvent {
  trackId: string | null
  index: number
}

export interface PositionEvent {
  positionMs: number
  durationMs: number
}

export interface DurationEvent {
  durationMs: number
}

export interface BufferingEvent {
  buffering: boolean
}

export interface QueueChangedEvent {
  trackIds: string[]
  currentIndex: number
}

export interface SetQueueOptions {
  tracks: NativePlayerTrack[]
  /** Index to start from. Clamped natively. */
  startIndex?: number
  /** Start playing immediately. Defaults to true. */
  autoPlay?: boolean
  /** Start offset within the first track. */
  positionMs?: number
}

/**
 * The native surface.
 *
 * Position is deliberately NOT part of this contract as a stream: the
 * engine emits it on state changes only, and the store runs its own
 * local clock between events. Sending a position event every frame
 * would flood the bridge for no visible benefit.
 */
/**
 * Result of a notification-permission query or request (Phase 3).
 *
 * `required` is false below Android 13, where notifications need no
 * runtime grant. `granted` false only hides the media notification —
 * playback, lock-screen controls and Bluetooth buttons are unaffected.
 */
export interface NotificationPermissionState {
  granted: boolean
  required: boolean
}

/** Emitted by the native layer when the permission state is known. */
export interface NotificationPermissionEvent {
  granted: boolean
  required: boolean
}

/**
 * Sleep-timer state, as reported by the native timer.
 *
 * `deadlineAt` is a wall-clock epoch in milliseconds. The countdown is
 * derived from it rather than decremented locally, so a WebView that
 * was frozen while the phone slept catches up instead of showing time
 * that never actually elapsed.
 */
export interface SleepTimerState {
  active: boolean
  deadlineAt: number | null
  remainingMs: number
}

export interface PlayerPlugin {
  play(options?: { track?: NativePlayerTrack }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>

  seekTo(options: { positionMs: number }): Promise<void>
  /** Relative seek, used by the ±15s hold controls. */
  seekBy(options: { deltaMs: number }): Promise<void>

  getCurrentPosition(): Promise<{ positionMs: number }>
  getDuration(): Promise<{ durationMs: number }>
  getState(): Promise<PlayerSnapshot>

  setQueue(options: SetQueueOptions): Promise<void>
  addToQueue(options: { track: NativePlayerTrack; index?: number }): Promise<void>
  removeFromQueue(options: { trackId: string }): Promise<void>
  moveInQueue(options: { fromIndex: number; toIndex: number }): Promise<void>
  clearQueue(): Promise<void>
  skipToIndex(options: { index: number }): Promise<void>
  getQueue(): Promise<QueueChangedEvent>

  setShuffle(options: { enabled: boolean }): Promise<void>
  setRepeatMode(options: { mode: NativeRepeatMode }): Promise<void>
  setVolume(options: { volume: number }): Promise<void>

  /**
   * Sleep timer. Lives natively, beside the player it must pause, so
   * it keeps running while the app is backgrounded and the WebView is
   * frozen. A duration of 0 or less cancels.
   */
  setSleepTimer(options: { durationMs: number }): Promise<SleepTimerState>
  cancelSleepTimer(): Promise<SleepTimerState>
  getSleepTimer(): Promise<SleepTimerState>

  /** Media-notification visibility only; never gates playback. */
  getNotificationPermission(): Promise<NotificationPermissionState>
  requestNotificationPermission(): Promise<NotificationPermissionState>

  addListener(eventName: 'playbackStateChanged', handler: (snapshot: PlayerSnapshot) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'currentTrackChanged', handler: (event: CurrentTrackChangedEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'positionChanged', handler: (event: PositionEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'durationChanged', handler: (event: DurationEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'bufferingChanged', handler: (event: BufferingEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'queueChanged', handler: (event: QueueChangedEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'playerError', handler: (event: PlayerErrorEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'notificationPermissionChanged', handler: (event: NotificationPermissionEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'sleepTimerChanged', handler: (event: SleepTimerState) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'sleepTimerExpired', handler: () => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

/**
 * Must match `@CapacitorPlugin(name = "Player")` in PlayerPlugin.kt
 * exactly — the bridge resolves plugins by this string.
 */
export const PLAYER_PLUGIN_NAME = 'Player'

export const NativePlayer = registerPlugin<PlayerPlugin>(PLAYER_PLUGIN_NAME)

/**
 * True only on a native Android build that actually registered the
 * plugin. Mirrors `isNativeLibraryAvailable()`, including the loud
 * warning when registration silently failed — otherwise the app would
 * quietly fall back to synthesised audio on a real device.
 */
export function isNativePlayerAvailable(): boolean {
  try {
    const native = Capacitor.isNativePlatform()
    const platform = Capacitor.getPlatform()
    const registered = Capacitor.isPluginAvailable(PLAYER_PLUGIN_NAME)

    if (native && platform === 'android' && !registered) {
      console.warn(
        `[SYSTEMA/PLAYER] Running on Android but the "${PLAYER_PLUGIN_NAME}" plugin is not `
        + 'registered. Check registerPlugin(PlayerPlugin.class) in MainActivity.',
      )
    }

    return native && platform === 'android' && registered
  } catch {
    // Capacitor absent entirely (SSR, plain browser).
    return false
  }
}
