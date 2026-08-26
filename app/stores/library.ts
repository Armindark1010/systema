// ============================================================
// SYSTEMA — Library Store (Pinia)
// ============================================================
// Controls Library UI state and catalog presentation.
// Completely separated from Player state.
// ============================================================

import { defineStore } from 'pinia'
import type { Album, Artist, Playlist, Track } from '~/types'
import { tracks as catalogTracks, albums as catalogAlbums, artists as catalogArtists } from '~/data/music'
import { usePlaybackHistory } from '~/composables/usePlaybackHistory'
import { usePlaylists } from '~/composables/usePlaylists'
import { useSettingsStore } from '~/stores/settings'
import {
  addScanListeners,
  cancelScan as nativeCancelScan,
  getLibraryCount as nativeGetLibraryCount,
  getScanStatus as nativeGetScanStatus,
  getTracksPage,
  hasPermission as nativeHasPermission,
  isNativeLibraryAvailable,
  requestPermission as nativeRequestPermission,
  startScan as nativeStartScan,
  toLibraryError,
  type LibraryError,
  type ScanProgress,
  type TrackSortKey as NativeSortKey,
} from '~/services/native/musicLibraryService'
import { libLog, libWarn } from '~/services/native/musicLibraryDebug'
import { nativePlatform } from '~/services/native/musicLibraryPlugin'

export type LibrarySection = 'tracks' | 'albums' | 'artists' | 'playlists'
export type LibrarySortKey =
  | 'recently-added'
  | 'recently-played'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'most-played'
  | 'ai-mood'
  | 'ai-energy'

export interface LibrarySortOption {
  id: LibrarySortKey
  label: string
}

export const librarySections: { id: LibrarySection; label: string }[] = [
  { id: 'tracks', label: 'TRACKS' },
  { id: 'albums', label: 'ALBUMS' },
  { id: 'artists', label: 'ARTISTS' },
  { id: 'playlists', label: 'PLAYLISTS' },
]

export const librarySortOptions: LibrarySortOption[] = [
  { id: 'recently-added', label: 'RECENTLY ADDED' },
  { id: 'recently-played', label: 'RECENTLY PLAYED' },
  { id: 'title', label: 'TITLE' },
  { id: 'artist', label: 'ARTIST' },
  { id: 'album', label: 'ALBUM' },
  { id: 'duration', label: 'DURATION' },
  { id: 'most-played', label: 'MOST PLAYED' },
  { id: 'ai-mood', label: 'AI MOOD' },
  { id: 'ai-energy', label: 'AI ENERGY' },
]

export const useLibraryStore = defineStore('library', () => {
  // ---- State -------------------------------------------------
  const activeSection = ref<LibrarySection>('tracks')
  function defaultSortFromSettings(): LibrarySortKey {
    try {
      const sort = useSettingsStore().library.defaultSort
      if (sort === 'alphabetical') return 'title'
      if (sort === 'artist' || sort === 'album' || sort === 'duration' || sort === 'recently-added') return sort
    } catch {
      /* settings store not ready */
    }
    return 'recently-added'
  }

  const sortBy = ref<LibrarySortKey>(defaultSortFromSettings())

  // Seed the catalog per platform AT CONSTRUCTION.
  //
  // This must not wait for initNativeLibrary(): Nuxt mounts the Vue app
  // before the `app:mounted` hook fires, so a store seeded with mock
  // data would paint 40 demo tracks on Android for at least one frame —
  // and forever if anything downstream failed. On native we start empty
  // and let the real index fill in.
  const seedWithMock = !isNativeLibraryAvailable()
  const tracks = ref<Track[]>(seedWithMock ? catalogTracks : [])
  const albums = ref<Album[]>(seedWithMock ? catalogAlbums : [])
  const artists = ref<Artist[]>(seedWithMock ? catalogArtists : [])

  // Native starts in a loading state so the Library shows its skeleton
  // rather than an empty list while the first scan runs.
  const isLoading = ref(!seedWithMock)

  // ---- Native library state ----------------------------------
  // Deliberately platform-agnostic: no Android or Capacitor concept
  // appears here, only "is a device library available and what is it
  // doing". The service layer owns every platform detail.
  const isNativeLibrary = ref(false)
  const permissionStatus = ref<'unknown' | 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'>('unknown')
  const scanState = ref<ScanProgress['state']>('IDLE')
  const scanProgress = ref<ScanProgress | null>(null)
  const libraryError = ref<LibraryError | null>(null)

  // Pagination cursor over the native index.
  const pageSize = ref(100)
  const loadedOffset = ref(0)
  const nativeTotal = ref(0)
  const hasMoreTracks = ref(false)
  const isLoadingMore = ref(false)

  /**
   * True once a native page has actually been written into `tracks`.
   * Guards the mock-catalog purge so a re-init never wipes real data.
   */
  const nativeDataLoaded = ref(false)

  let disposeScanListeners: (() => void) | null = null

  const history = usePlaybackHistory()
  const playlistsStore = usePlaylists()

  // Dynamic playlists from the reactive playlist composable
  const playlists = computed<Playlist[]>(() => playlistsStore.playlists.value)

  // ---- Getters -----------------------------------------------
  // On a native library the authoritative count comes from the
  // database, not from however many rows we have paged in so far.
  const totalTracks = computed(() =>
    isNativeLibrary.value ? nativeTotal.value : tracks.value.length,
  )

  const isScanning = computed(() => scanState.value === 'SCANNING')

  const needsPermission = computed(
    () => isNativeLibrary.value && permissionStatus.value !== 'granted',
  )

  /** 0-100, or null while the scan total is unknown (indeterminate). */
  const scanPercent = computed<number | null>(() => {
    const progress = scanProgress.value
    if (!progress || !progress.total) return null
    return Math.min(100, Math.round((progress.processed / progress.total) * 100))
  })

  /** "128 / 642" style label for the Settings scan row. */
  const scanLabel = computed(() => {
    const progress = scanProgress.value
    if (!progress) return ''
    if (progress.state === 'ERROR') return progress.errorMessage ?? 'SCAN FAILED'
    if (progress.state === 'COMPLETED') return `${progress.discovered} TRACKS INDEXED`
    if (progress.state !== 'SCANNING') return ''
    return progress.total
      ? `${progress.processed} / ${progress.total}`
      : `${progress.processed} FOUND`
  })

  const activeSectionIndex = computed(() =>
    librarySections.findIndex(s => s.id === activeSection.value),
  )

  const selectedSortLabel = computed(() =>
    librarySortOptions.find(o => o.id === sortBy.value)?.label ?? 'RECENTLY ADDED',
  )

  const recentRank = computed(() =>
    new Map(history.recentTrackIds.value.map((id, index) => [id, index])),
  )

  const sortedTracks = computed<Track[]>(() => {
    const list = [...tracks.value]
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    const missingLast = (value?: string | number) => value === undefined || value === '' ? 1 : 0

    return list.sort((a, b) => {
      const artistA = artists.value.find(art => art.id === a.artistId)?.name ?? ''
      const artistB = artists.value.find(art => art.id === b.artistId)?.name ?? ''
      const albumA = albums.value.find(alb => alb.id === a.albumId)?.title ?? ''
      const albumB = albums.value.find(alb => alb.id === b.albumId)?.title ?? ''

      switch (sortBy.value) {
        case 'recently-added':
          return b.addedAt.localeCompare(a.addedAt)
        case 'recently-played': {
          const rankA = recentRank.value.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rankB = recentRank.value.get(b.id) ?? Number.MAX_SAFE_INTEGER
          return rankA - rankB || b.addedAt.localeCompare(a.addedAt)
        }
        case 'title':
          return byText(a.title, b.title)
        case 'artist':
          return byText(artistA, artistB) || byText(a.title, b.title)
        case 'album':
          return byText(albumA, albumB) || byText(a.title, b.title)
        case 'duration':
          return a.duration - b.duration
        case 'most-played':
          return b.plays - a.plays
        case 'ai-mood': {
          const moodA = a.ai?.analyzed ? a.ai.mood[0] : undefined
          const moodB = b.ai?.analyzed ? b.ai.mood[0] : undefined
          return missingLast(moodA) - missingLast(moodB) || byText(moodA ?? '', moodB ?? '') || byText(a.title, b.title)
        }
        case 'ai-energy': {
          const energyA = a.ai?.analyzed ? a.ai.energy : undefined
          const energyB = b.ai?.analyzed ? b.ai.energy : undefined
          return missingLast(energyA) - missingLast(energyB) || (energyB ?? -1) - (energyA ?? -1) || byText(a.title, b.title)
        }
      }
    })
  })

  // ---- Helpers & Actions -------------------------------------
  function setSection(section: LibrarySection) {
    activeSection.value = section
  }

  function nextSection(): boolean {
    const currentIndex = activeSectionIndex.value
    if (currentIndex < librarySections.length - 1) {
      activeSection.value = librarySections[currentIndex + 1]!.id
      return true
    }
    return false
  }

  function prevSection(): boolean {
    const currentIndex = activeSectionIndex.value
    if (currentIndex > 0) {
      activeSection.value = librarySections[currentIndex - 1]!.id
      return true
    }
    return false
  }

  function setSortBy(key: LibrarySortKey) {
    sortBy.value = key
  }

  function resetPresentation() {
    activeSection.value = 'tracks'
    sortBy.value = defaultSortFromSettings()
  }

  function getAlbum(id: string): Album | undefined {
    return albums.value.find(a => a.id === id)
  }

  function getArtist(id: string): Artist | undefined {
    return artists.value.find(a => a.id === id)
  }

  function trackCountForArtist(artistId: string) {
    return tracks.value.filter(track => track.artistId === artistId).length
  }

  function tracksForAlbum(albumId: string) {
    return tracks.value.filter(track => track.albumId === albumId)
  }

  function tracksForArtist(artistId: string) {
    return tracks.value.filter(track => track.artistId === artistId)
  }

  function tracksForPlaylist(playlist: Playlist) {
    const trackMap = new Map(tracks.value.map(track => [track.id, track]))
    return playlist.trackIds.map(id => trackMap.get(id)).filter((track): track is Track => Boolean(track))
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // ---- Native library actions --------------------------------

  /** Maps the UI sort key onto one the native index can serve. */
  function nativeSortKey(): NativeSortKey {
    switch (sortBy.value) {
      case 'title': return 'title'
      case 'artist': return 'artist'
      case 'album': return 'album'
      case 'duration': return 'duration'
      default: return 'dateAdded'
    }
  }

  function mergeUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
    if (incoming.length === 0) return current
    const seen = new Set(current.map(item => item.id))
    const merged = [...current]
    for (const item of incoming) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        merged.push(item)
      }
    }
    return merged
  }

  /**
   * Boots the device library. Safe to call anywhere: on the web it
   * returns immediately and the mock catalog stays untouched.
   */
  async function initNativeLibrary(): Promise<void> {
    try {
      await runNativeInit()
    } finally {
      // Never leave the Library stuck on its skeleton, whatever
      // happened above.
      isLoading.value = false
    }
  }

  async function runNativeInit(): Promise<void> {
    const available = isNativeLibraryAvailable()
    libLog('init: isNativeLibraryAvailable', {
      available,
      platform: nativePlatform(),
    })

    if (!available) {
      // WEB PATH — keep the mock catalog exactly as it is.
      isNativeLibrary.value = false
      return
    }

    isNativeLibrary.value = true

    // ANDROID PATH — the device is the only source of truth. The store
    // already seeded empty at construction; this is a safety net for
    // the case where the store was created before Capacitor finished
    // booting (guarded so it can never wipe real data).
    if (!nativeDataLoaded.value && tracks.value.length > 0) {
      tracks.value = []
      albums.value = []
      artists.value = []
      libLog('init: cleared stale mock catalog on native platform')
    }

    await attachScanListeners()

    try {
      const permission = await nativeHasPermission()
      permissionStatus.value = permission.status
      libLog('init: hasPermission', permission)

      const status = await nativeGetScanStatus()
      if (status) {
        scanState.value = status.state
        scanProgress.value = status
        libLog('init: getScanStatus', status)
      }

      // A missing grant is the normal first-launch state, not a dead
      // end: ask for it. Previously this branch was gated behind
      // `permission.granted`, so a fresh install never requested
      // access, never scanned, and silently kept the mock data.
      if (!permission.granted) {
        libLog('init: permission not granted, requesting')
        const granted = await requestLibraryPermission()
        libLog('init: requestPermission result', { granted })
        if (!granted) {
          // Leave the library empty and let the UI explain why.
          libWarn('init: permission denied, library stays empty')
          return
        }
      }

      const count = await nativeGetLibraryCount()
      libLog('init: getLibraryCount', { count })

      // A fresh install has an empty index — scan once so the user
      // sees their music without having to find the Settings action.
      if (count === 0) {
        libLog('init: empty index, starting first scan')
        await scanLibrary()
      } else {
        await loadFirstPage()
      }
    } catch (error) {
      const failure = toLibraryError(error)
      libWarn('init: failed', failure)
      libraryError.value = failure
    }
  }

  async function attachScanListeners(): Promise<void> {
    if (disposeScanListeners) return
    disposeScanListeners = await addScanListeners({
      onStarted: (progress) => {
        scanState.value = progress.state
        scanProgress.value = progress
        libraryError.value = null
        libLog('scanStarted', { total: progress.total })
      },
      onProgress: (progress) => {
        scanState.value = progress.state
        scanProgress.value = progress
      },
      onCompleted: (progress) => {
        scanState.value = 'COMPLETED'
        scanProgress.value = progress
        libLog('scanCompleted: native scan result', {
          discovered: progress.discovered,
          inserted: progress.inserted,
          updated: progress.updated,
          removed: progress.removed,
          unchanged: progress.unchanged,
        })
        // Re-read page one so the UI reflects the new index.
        void loadFirstPage()
      },
      onError: (progress) => {
        scanState.value = 'ERROR'
        scanProgress.value = progress
        libWarn('scanError', {
          code: progress.errorCode,
          message: progress.errorMessage,
        })
        libraryError.value = {
          code: progress.errorCode ?? 'UNKNOWN',
          message: progress.errorMessage ?? 'The library scan failed.',
        }
      },
    })
  }

  function disposeNativeLibrary(): void {
    disposeScanListeners?.()
    disposeScanListeners = null
  }

  /** Prompts for audio access. A denial is a state, never a crash. */
  async function requestLibraryPermission(): Promise<boolean> {
    if (!isNativeLibrary.value) return false
    scanState.value = 'REQUESTING_PERMISSION'
    try {
      const result = await nativeRequestPermission()
      permissionStatus.value = result.status
      scanState.value = 'IDLE'
      if (!result.granted) {
        libraryError.value = {
          code: 'PERMISSION_DENIED',
          message: 'SYSTEMA needs access to your audio files to build the library.',
        }
      }
      return result.granted
    } catch (error) {
      scanState.value = 'IDLE'
      libraryError.value = toLibraryError(error)
      return false
    }
  }

  /** Real rescan. Incremental: added / changed / removed only. */
  async function scanLibrary(): Promise<void> {
    if (!isNativeLibrary.value || isScanning.value) return

    if (permissionStatus.value !== 'granted') {
      const granted = await requestLibraryPermission()
      if (!granted) return
    }

    libraryError.value = null
    try {
      libLog('scanLibrary: invoking native scan()')
      await nativeStartScan()
      scanState.value = 'SCANNING'
    } catch (error) {
      const failure = toLibraryError(error)
      // An already-running scan is not an error worth surfacing.
      if (failure.code === 'SCAN_IN_PROGRESS') return
      scanState.value = 'ERROR'
      libraryError.value = failure
    }
  }

  async function cancelLibraryScan(): Promise<void> {
    if (!isNativeLibrary.value) return
    try {
      await nativeCancelScan()
      scanState.value = 'IDLE'
    } catch (error) {
      libraryError.value = toLibraryError(error)
    }
  }

  /** Replaces the catalog with the first page of device tracks. */
  async function loadFirstPage(): Promise<void> {
    if (!isNativeLibrary.value) return
    isLoading.value = true
    try {
      const page = await getTracksPage({
        offset: 0,
        limit: pageSize.value,
        sort: nativeSortKey(),
        order: sortBy.value === 'title' || sortBy.value === 'artist' || sortBy.value === 'album'
          ? 'asc'
          : 'desc',
      })

      tracks.value = page.tracks
      albums.value = page.albums
      artists.value = page.artists
      nativeTotal.value = page.total
      loadedOffset.value = page.tracks.length
      hasMoreTracks.value = page.hasMore
      nativeDataLoaded.value = true
      libraryError.value = null

      libLog('loadFirstPage: bridge returned', {
        received: page.tracks.length,
        totalInIndex: page.total,
        hasMore: page.hasMore,
      })
      libLog('loadFirstPage: pinia store now holds', {
        tracks: tracks.value.length,
        albums: albums.value.length,
        artists: artists.value.length,
      })
    } catch (error) {
      libraryError.value = toLibraryError(error)
    } finally {
      isLoading.value = false
    }
  }

  /** Appends the next page. The full library never ships at once. */
  async function loadMoreTracks(): Promise<void> {
    if (!isNativeLibrary.value || !hasMoreTracks.value || isLoadingMore.value) return
    isLoadingMore.value = true
    try {
      const page = await getTracksPage({
        offset: loadedOffset.value,
        limit: pageSize.value,
        sort: nativeSortKey(),
        order: sortBy.value === 'title' || sortBy.value === 'artist' || sortBy.value === 'album'
          ? 'asc'
          : 'desc',
      })

      tracks.value = mergeUnique(tracks.value, page.tracks)
      albums.value = mergeUnique(albums.value, page.albums)
      artists.value = mergeUnique(artists.value, page.artists)
      nativeTotal.value = page.total
      loadedOffset.value += page.tracks.length
      hasMoreTracks.value = page.hasMore
    } catch (error) {
      libraryError.value = toLibraryError(error)
    } finally {
      isLoadingMore.value = false
    }
  }

  function clearLibraryError(): void {
    libraryError.value = null
  }

  return {
    // state
    activeSection,
    sortBy,
    tracks,
    albums,
    artists,
    playlists,
    isLoading,

    // native library state
    isNativeLibrary,
    permissionStatus,
    scanState,
    scanProgress,
    libraryError,
    pageSize,
    loadedOffset,
    nativeTotal,
    hasMoreTracks,
    isLoadingMore,
    nativeDataLoaded,

    // getters
    totalTracks,
    activeSectionIndex,
    selectedSortLabel,
    sortedTracks,
    isScanning,
    needsPermission,
    scanPercent,
    scanLabel,

    // actions
    setSection,
    nextSection,
    prevSection,
    setSortBy,
    resetPresentation,
    getAlbum,
    getArtist,
    trackCountForArtist,
    tracksForAlbum,
    tracksForArtist,
    tracksForPlaylist,
    formatDuration,

    // native library actions
    initNativeLibrary,
    disposeNativeLibrary,
    requestLibraryPermission,
    scanLibrary,
    cancelLibraryScan,
    loadFirstPage,
    loadMoreTracks,
    clearLibraryError,
  }
})
