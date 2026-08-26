// ============================================================
// useNowPlaying — the canonical "what is playing" projection
// ============================================================
// Every surface that renders the current track (Mini Player, Full
// Player, Queue, EMO, Home/Search/Playlist indicators) must derive
// from this, so there is exactly one place where a Track becomes
// display artwork/title/artist.
//
// Why this exists
// ---------------
// Player surfaces used to resolve artwork with
// `getAlbum(track.albumId)?.cover` from `useMusicLibrary()`, which
// reads the *static mock catalog*. Device tracks carry synthetic ids
// ("nal:123", "na:artist-slug") that exist only in the library store,
// so every lookup returned undefined and the artwork silently fell
// back — or worse, kept the previous track's value. The Library was
// correct only because it passes `track.artwork` directly.
//
// A Track already carries everything needed:
//   - `artwork`  WebView-safe src, produced once via convertFileSrc()
//   - `artist` / `album`  denormalised names from the native scan
//
// So the resolution order below is: use what the track itself knows,
// then the live library store, and only then the mock catalog. That
// works identically for device tracks and demo tracks.
// ============================================================

import { storeToRefs } from 'pinia'
import type { Track } from '~/types'
import { usePlayerStore } from '~/stores/player'
import { useLibraryStore } from '~/stores/library'

/** Shown when a track genuinely has no artist metadata. */
const UNKNOWN_ARTIST = 'UNKNOWN ARTIST'

/**
 * Display fields for one track, resolved the same way everywhere.
 *
 * Not a store and not cached: these are plain computeds over the
 * player store, so a track change propagates to every consumer in the
 * same tick. Nothing here duplicates playback state.
 */
export function useTrackDisplay(track: Ref<Track | null | undefined>) {
  const library = useLibraryStore()

  /**
   * Artwork source for a track.
   *
   * `track.artwork` is already a WebView-safe URL: the native service
   * ran the content:// URI through Capacitor.convertFileSrc() when the
   * track was mapped. It is a plain string on the track object, so it
   * re-evaluates whenever `track` changes — no mount-time snapshot, no
   * separate artwork state, no Base64, and no extra fetch.
   */
  const artwork = computed<string | undefined>(() => {
    const value = track.value
    if (!value) return undefined
    // 1. The track's own artwork (device tracks, always correct).
    if (value.artwork) return value.artwork
    // 2. The live library store (mock catalog albums, and any album
    //    the native scan grouped).
    const album = library.getAlbum(value.albumId)
    return album?.cover
  })

  const title = computed(() => track.value?.title ?? '')

  /**
   * Artist name. The denormalised `artist` field wins because device
   * tracks carry it directly; the store lookup covers mock tracks,
   * whose artistId does resolve there.
   */
  const artist = computed(() => {
    const value = track.value
    if (!value) return ''
    if (value.artist) return value.artist
    return library.getArtist(value.artistId)?.name ?? UNKNOWN_ARTIST
  })

  const album = computed(() => {
    const value = track.value
    if (!value) return undefined
    if (value.album) return value.album
    return library.getAlbum(value.albumId)?.title
  })

  /**
   * Stable identity for `:key` and the artwork fallback `seed`.
   * Always the track id — never an array index — so Vue cannot reuse
   * one track's <img> element for another track.
   */
  const seed = computed(() => track.value?.id ?? 'sys')

  return { artwork, title, artist, album, seed }
}

/**
 * The globally current track, projected for display.
 *
 * Every player surface should call this instead of resolving artwork
 * or artist names itself.
 */
export function useNowPlaying() {
  const player = usePlayerStore()
  const { currentTrack, isPlaying, buffering } = storeToRefs(player)

  const display = useTrackDisplay(currentTrack)

  return {
    currentTrack,
    isPlaying,
    buffering,
    ...display,
  }
}

/**
 * Non-reactive helpers for resolving fields of an *arbitrary* track
 * (queue rows, search results, playlist rows) using the exact same
 * precedence as the now-playing projection.
 *
 * Functions rather than computeds because callers pass a different
 * track per row; they still read reactive store state, so a template
 * calling them re-evaluates when the library store changes.
 */
export function useTrackFields() {
  const library = useLibraryStore()

  function coverFor(track: Track | null | undefined): string | undefined {
    if (!track) return undefined
    return track.artwork ?? library.getAlbum(track.albumId)?.cover
  }

  function artistFor(track: Track | null | undefined): string {
    if (!track) return ''
    return track.artist || library.getArtist(track.artistId)?.name || UNKNOWN_ARTIST
  }

  function albumFor(track: Track | null | undefined): string | undefined {
    if (!track) return undefined
    return track.album ?? library.getAlbum(track.albumId)?.title
  }

  return { coverFor, artistFor, albumFor }
}

/**
 * Whether a given track id is the one currently playing.
 *
 * Compares stable ids, never object references: the native layer can
 * hand back a structurally different object for the same track.
 */
export function useIsCurrentTrack() {
  const player = usePlayerStore()
  const { currentTrack, isPlaying } = storeToRefs(player)

  return {
    /** True when this id is loaded in the player, playing or paused. */
    isCurrent: (trackId: string) => currentTrack.value?.id === trackId,
    /** True only while it is actually producing sound. */
    isPlayingTrack: (trackId: string) =>
      currentTrack.value?.id === trackId && isPlaying.value,
    currentTrackId: computed(() => currentTrack.value?.id ?? null),
    isPlaying,
  }
}
