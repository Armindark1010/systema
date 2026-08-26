// ============================================================
// SYSTEMA — native player facade
// ============================================================
// The only module that talks to the Player plugin. Everything here is
// safe to call in the browser: when no native player is present each
// function is a no-op (or returns null) and the caller keeps using the
// existing WebAudio engine.
//
// Mapping between the UI `Track` and the native contract also lives
// here, so neither the store nor any component has to know that the
// native layer speaks milliseconds and content:// URIs.
// ============================================================

import type { Track, RepeatMode } from '~/types'
import {
  NativePlayer,
  isNativePlayerAvailable,
  type NativePlayerTrack,
  type NativeRepeatMode,
  type PlayerErrorCode,
  type PlayerSnapshot,
  type PlayerErrorEvent,
  type CurrentTrackChangedEvent,
  type QueueChangedEvent,
  type BufferingEvent,
  type DurationEvent,
  type NotificationPermissionState,
  type NotificationPermissionEvent,
  type SleepTimerState,
} from './playerPlugin'

export type {
  PlayerSnapshot,
  PlayerErrorEvent,
  PlayerErrorCode,
  NativePlaybackState,
  QueueChangedEvent,
  NotificationPermissionState,
  NotificationPermissionEvent,
  SleepTimerState,
} from './playerPlugin'

/** Structured playback failure, shaped like LibraryError. */
export interface PlayerError {
  code: PlayerErrorCode
  message: string
  trackId: string | null
}

export { isNativePlayerAvailable }

// ---- Mapping -------------------------------------------------

/**
 * True when a track can actually be played natively.
 *
 * Mock catalog tracks have no `uri`, so this is also what keeps the
 * demo catalog on the synthesised engine even on a real device.
 */
export function isPlayableNatively(track: Track | null | undefined): boolean {
  return Boolean(track?.uri)
}

/** UI track -> native contract. Duration converts seconds -> ms. */
export function toNativeTrack(track: Track): NativePlayerTrack | null {
  if (!track.uri) return null
  return {
    id: track.id,
    uri: track.uri,
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    // Raw content:// URI: Media3 resolves it itself, and the WebView
    // form produced by convertFileSrc() would be meaningless natively.
    artworkUri: track.artworkUri ?? null,
    duration: Math.max(0, Math.round((track.duration || 0) * 1000)),
  }
}

/** Drops anything unplayable rather than failing the whole queue. */
export function toNativeTracks(tracks: Track[]): NativePlayerTrack[] {
  const out: NativePlayerTrack[] = []
  for (const track of tracks) {
    const mapped = toNativeTrack(track)
    if (mapped) out.push(mapped)
  }
  return out
}

export function toNativeRepeat(mode: RepeatMode): NativeRepeatMode {
  return mode === 'one' ? 'one' : mode === 'all' ? 'all' : 'off'
}

export function fromNativeRepeat(mode: NativeRepeatMode): RepeatMode {
  return mode === 'one' ? 'one' : mode === 'all' ? 'all' : 'off'
}

// ---- Guarded calls -------------------------------------------

/**
 * Runs `fn` only when the native player exists, swallowing bridge
 * failures. A player command that fails must never break the UI —
 * genuine playback problems arrive through the `playerError` event
 * instead, with a structured code.
 */
async function guarded<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  if (!isNativePlayerAvailable()) return null
  try {
    return await fn()
  } catch (error) {
    console.warn(`[SYSTEMA/PLAYER] ${label} failed`, error)
    return null
  }
}

/**
 * Media-notification permission (Phase 3, Android 13+).
 *
 * Returns a granted-looking result on web and on older Android, where
 * no runtime grant exists. Playback NEVER depends on this: a denial
 * only hides the notification, so callers must not gate audio on it.
 */
export async function getNotificationPermissionNative(): Promise<NotificationPermissionState> {
  const result = await guarded(
    () => NativePlayer.getNotificationPermission(),
    'getNotificationPermission',
  )
  return result ?? { granted: true, required: false }
}

export async function requestNotificationPermissionNative(): Promise<NotificationPermissionState> {
  const result = await guarded(
    () => NativePlayer.requestNotificationPermission(),
    'requestNotificationPermission',
  )
  return result ?? { granted: true, required: false }
}

export function playTrackNative(track: Track) {
  const native = toNativeTrack(track)
  if (!native) return Promise.resolve(null)
  return guarded(() => NativePlayer.play({ track: native }), 'play')
}

export function setQueueNative(
  tracks: Track[],
  startIndex = 0,
  options: { autoPlay?: boolean; positionMs?: number } = {},
) {
  const native = toNativeTracks(tracks)
  return guarded(
    () => NativePlayer.setQueue({
      tracks: native,
      startIndex,
      autoPlay: options.autoPlay ?? true,
      positionMs: options.positionMs ?? 0,
    }),
    'setQueue',
  )
}

export const pauseNative = () => guarded(() => NativePlayer.pause(), 'pause')
export const resumeNative = () => guarded(() => NativePlayer.resume(), 'resume')
export const stopNative = () => guarded(() => NativePlayer.stop(), 'stop')
export const nextNative = () => guarded(() => NativePlayer.next(), 'next')
export const previousNative = () => guarded(() => NativePlayer.previous(), 'previous')

export const seekToNative = (positionMs: number) =>
  guarded(() => NativePlayer.seekTo({ positionMs: Math.max(0, Math.round(positionMs)) }), 'seekTo')

export const seekByNative = (deltaMs: number) =>
  guarded(() => NativePlayer.seekBy({ deltaMs: Math.round(deltaMs) }), 'seekBy')

export const addToQueueNative = (track: Track, index?: number) => {
  const native = toNativeTrack(track)
  if (!native) return Promise.resolve(null)
  return guarded(() => NativePlayer.addToQueue({ track: native, index }), 'addToQueue')
}

export const removeFromQueueNative = (trackId: string) =>
  guarded(() => NativePlayer.removeFromQueue({ trackId }), 'removeFromQueue')

export const moveInQueueNative = (fromIndex: number, toIndex: number) =>
  guarded(() => NativePlayer.moveInQueue({ fromIndex, toIndex }), 'moveInQueue')

export const clearQueueNative = () => guarded(() => NativePlayer.clearQueue(), 'clearQueue')

export const skipToIndexNative = (index: number) =>
  guarded(() => NativePlayer.skipToIndex({ index }), 'skipToIndex')

export const setShuffleNative = (enabled: boolean) =>
  guarded(() => NativePlayer.setShuffle({ enabled }), 'setShuffle')

export const setRepeatNative = (mode: RepeatMode) =>
  guarded(() => NativePlayer.setRepeatMode({ mode: toNativeRepeat(mode) }), 'setRepeatMode')

export const setVolumeNative = (volume: number) =>
  guarded(() => NativePlayer.setVolume({ volume: Math.max(0, Math.min(1, volume)) }), 'setVolume')

export const getPositionNative = () =>
  guarded(() => NativePlayer.getCurrentPosition(), 'getCurrentPosition')

export const getStateNative = (): Promise<PlayerSnapshot | null> =>
  guarded(() => NativePlayer.getState(), 'getState')

// ---- Sleep timer ---------------------------------------------
//
// Thin passthrough: the timer itself is native, because only the
// native side keeps running when the WebView is frozen. In the browser
// these resolve to null and useSleepTimer falls back to its own timer.

export const setSleepTimerNative = (durationMs: number): Promise<SleepTimerState | null> =>
  guarded(() => NativePlayer.setSleepTimer({ durationMs }), 'setSleepTimer')

export const cancelSleepTimerNative = (): Promise<SleepTimerState | null> =>
  guarded(() => NativePlayer.cancelSleepTimer(), 'cancelSleepTimer')

export const getSleepTimerNative = (): Promise<SleepTimerState | null> =>
  guarded(() => NativePlayer.getSleepTimer(), 'getSleepTimer')

/** The engine's real queue: track ids in playback order + its index. */
export const getQueueNative = (): Promise<QueueChangedEvent | null> =>
  guarded(() => NativePlayer.getQueue(), 'getQueue')

// ---- Events --------------------------------------------------

export interface NativePlayerHandlers {
  onSnapshot?: (snapshot: PlayerSnapshot) => void
  onTrackChanged?: (event: CurrentTrackChangedEvent) => void
  onBuffering?: (event: BufferingEvent) => void
  onDuration?: (event: DurationEvent) => void
  onQueueChanged?: (event: QueueChangedEvent) => void
  onError?: (error: PlayerError) => void
  onNotificationPermission?: (event: NotificationPermissionEvent) => void
  onSleepTimerChanged?: (event: SleepTimerState) => void
  onSleepTimerExpired?: () => void
}

/**
 * Subscribes to native playback events.
 * Returns a disposer; a no-op in the browser.
 */
export function addPlayerListeners(handlers: NativePlayerHandlers): () => void {
  if (!isNativePlayerAvailable()) return () => {}

  const pending: Promise<{ remove: () => Promise<void> }>[] = []

  if (handlers.onSnapshot) {
    pending.push(NativePlayer.addListener('playbackStateChanged', handlers.onSnapshot))
  }
  if (handlers.onTrackChanged) {
    pending.push(NativePlayer.addListener('currentTrackChanged', handlers.onTrackChanged))
  }
  if (handlers.onBuffering) {
    pending.push(NativePlayer.addListener('bufferingChanged', handlers.onBuffering))
  }
  if (handlers.onDuration) {
    pending.push(NativePlayer.addListener('durationChanged', handlers.onDuration))
  }
  if (handlers.onQueueChanged) {
    pending.push(NativePlayer.addListener('queueChanged', handlers.onQueueChanged))
  }
  if (handlers.onNotificationPermission) {
    pending.push(
      NativePlayer.addListener(
        'notificationPermissionChanged',
        handlers.onNotificationPermission,
      ),
    )
  }
  if (handlers.onSleepTimerChanged) {
    pending.push(NativePlayer.addListener('sleepTimerChanged', handlers.onSleepTimerChanged))
  }
  if (handlers.onSleepTimerExpired) {
    pending.push(NativePlayer.addListener('sleepTimerExpired', handlers.onSleepTimerExpired))
  }
  if (handlers.onError) {
    const onError = handlers.onError
    pending.push(
      NativePlayer.addListener('playerError', (event: PlayerErrorEvent) => {
        onError({
          code: event.code ?? 'UNKNOWN',
          message: event.message ?? 'Playback failed.',
          trackId: event.trackId ?? null,
        })
      }),
    )
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const handle of pending) {
      // Listeners resolve asynchronously; remove whenever each lands.
      handle.then(h => h.remove()).catch(() => { /* already gone */ })
    }
  }
}
