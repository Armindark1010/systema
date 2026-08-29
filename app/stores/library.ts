// ============================================================
// SYSTEMA — Library Store (Pinia)
// ============================================================
// Controls Library UI state and catalog presentation.
// Completely separated from Player state.
// ============================================================

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Album, Artist, Playlist, Track } from '~/types'
import { tracks as catalogTracks, albums as catalogAlbums, artists as catalogArtists } from '~/data/music'
import { usePlaybackHistory, registerTracksForHistory } from '~/composables/usePlaybackHistory'
import { usePlaylists } from '~/composables/usePlaylists'
import { useSettingsStore } from '~/stores/settings'
import {
  addScanListeners,
  cancelScan as nativeCancelScan,
  fetchAllDeviceTracks,
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
  // { id: 'albums', label: 'ALBUMS' },
  // { id: 'artists', label: 'ARTISTS' },
  // { id: 'playlists', label: 'PLAYLISTS' },
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
  /** Library search term. Changing it restarts pagination. */
  const searchQuery = ref('')

  /**
   * Incremented on every pagination reset. Responses tagged with an
   * older generation are discarded, which is what keeps a re-sort or a
   * new search from mixing datasets or corrupting the offset.
   */
  let pageGeneration = 0

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

  /** How many rows are actually held client-side right now. */
  const loadedCount = computed(() => tracks.value.length)

  /** True once every row in the native index has been paged in. */
  const allTracksLoaded = computed(
    () => isNativeLibrary.value && !hasMoreTracks.value && loadedCount.value > 0,
  )

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

  const recentRank = computed<Map<string, number>>(() =>
    new Map(history.recentTrackIds.value.map((id: string, index: number) => [id, index])),
  )

  /** Sorts the native index can serve itself, in global order. */
  const NATIVE_SORTS: LibrarySortKey[] = ['title', 'artist', 'album', 'duration', 'recently-added']

  const sortedTracks = computed<Track[]>(() => {
    // On native the database already ordered the whole library and we
    // hold a prefix of that order. Re-sorting client-side would only
    // reorder the loaded rows, making tracks jump between positions as
    // each new page arrives — so the server order is preserved as-is.
    if (isNativeLibrary.value && NATIVE_SORTS.includes(sortBy.value)) {
      return tracks.value
    }

    const list = [...tracks.value]
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    const missingLast = (value?: string | number) => (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value)) ? 1 : 0)

    return list.sort((a: Track, b: Track) => {
      const artistA = artists.value.find((art: Artist) => art.id === a.artistId)?.name ?? a.artist ?? ''
      const artistB = artists.value.find((art: Artist) => art.id === b.artistId)?.name ?? b.artist ?? ''
      const albumA = albums.value.find((alb: Album) => alb.id === a.albumId)?.title ?? a.album ?? ''
      const albumB = albums.value.find((alb: Album) => alb.id === b.albumId)?.title ?? b.album ?? ''

      switch (sortBy.value) {
        case 'recently-added': {
          const dateA = a.addedAt || ''
          const dateB = b.addedAt || ''
          return dateB.localeCompare(dateA) || byText(a.title || '', b.title || '')
        }
        case 'recently-played': {
          const rankA: number = recentRank.value.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rankB: number = recentRank.value.get(b.id) ?? Number.MAX_SAFE_INTEGER
          if (rankA !== rankB) return rankA - rankB
          const dateA = a.addedAt || ''
          const dateB = b.addedAt || ''
          return dateB.localeCompare(dateA) || byText(a.title || '', b.title || '')
        }
        case 'title':
          return byText(a.title || '', b.title || '')
        case 'artist':
          return byText(artistA, artistB) || byText(a.title || '', b.title || '')
        case 'album':
          return byText(albumA, albumB) || byText(a.title || '', b.title || '')
        case 'duration':
          return (a.duration || 0) - (b.duration || 0) || byText(a.title || '', b.title || '')
        case 'most-played':
          return (b.plays || 0) - (a.plays || 0) || byText(a.title || '', b.title || '')
        case 'ai-mood': {
          const moodA = a.ai?.analyzed && a.ai.mood?.length ? a.ai.mood[0] : (a.mood || undefined)
          const moodB = b.ai?.analyzed && b.ai.mood?.length ? b.ai.mood[0] : (b.mood || undefined)
          return missingLast(moodA) - missingLast(moodB) || byText(moodA ?? '', moodB ?? '') || byText(a.title || '', b.title || '')
        }
        case 'ai-energy': {
          const energyA = a.ai?.analyzed && typeof a.ai.energy === 'number' ? a.ai.energy : (a.energy != null ? a.energy / 100 : undefined)
          const energyB = b.ai?.analyzed && typeof b.ai.energy === 'number' ? b.ai.energy : (b.energy != null ? b.energy / 100 : undefined)
          return missingLast(energyA) - missingLast(energyB) || (energyB ?? -1) - (energyA ?? -1) || byText(a.title || '', b.title || '')
        }
      }
    })
  })

  // Keep pagination in sync with sortBy changes on native devices
  watch(sortBy, () => {
    if (isNativeLibrary.value) {
      void resetPagination()
    }
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
    if (sortBy.value === key) return
    sortBy.value = key
    // The native index does the ordering, so a new sort is a different
    // dataset: restart from offset 0 rather than appending to the old
    // one. On the web this is a no-op and the client sort applies.
    if (isNativeLibrary.value) void resetPagination()
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

  /**
   * Sort/order/query actually sent to the native index.
   *
   * Only the sorts the native layer can serve are forwarded. The
   * remaining UI sorts (recently-played, most-played, ai-*) have no
   * native equivalent yet, so the index is read in a stable order and
   * those are applied client-side over the loaded rows.
   */
  function nativeQueryArgs() {
    return {
      sort: nativeSortKey(),
      order: (sortBy.value === 'title' || sortBy.value === 'artist' || sortBy.value === 'album' || sortBy.value === 'duration'
        ? 'asc'
        : 'desc') as 'asc' | 'desc',
      query: searchQuery.value.trim() || undefined,
    }
  }

  /**
   * Loads page one and resets pagination.
   *
   * Every call takes a fresh generation token. A response belonging to
   * an older generation (the user re-sorted or retyped while it was in
   * flight) is discarded instead of being merged, which is what would
   * otherwise corrupt the offset or mix two datasets.
   */
  async function loadFirstPage(): Promise<void> {
    if (!isNativeLibrary.value) return

    const generation = ++pageGeneration
    isLoading.value = true
    // Any in-flight "load more" from the previous generation is now
    // irrelevant; releasing the flag lets the observer re-arm cleanly.
    isLoadingMore.value = false

    try {
      const args = nativeQueryArgs()
      const page = await getTracksPage({ offset: 0, limit: pageSize.value, ...args })

      if (generation !== pageGeneration) {
        libLog('loadFirstPage: stale response discarded', { generation })
        return
      }

      tracks.value = page.tracks
      // Let recents resolve device tracks, which the mock catalog
      // cannot. Cheap and idempotent.
      registerTracksForHistory(page.tracks)
      albums.value = page.albums
      artists.value = page.artists
      nativeTotal.value = page.total
      loadedOffset.value = page.tracks.length
      // Trust the row count we actually hold, not just the native flag:
      // if a page comes back short we must not keep asking forever.
      hasMoreTracks.value = page.hasMore && page.tracks.length > 0
      nativeDataLoaded.value = true
      libraryError.value = null

      libLog('loadFirstPage: bridge returned', {
        received: page.tracks.length,
        totalInIndex: page.total,
        hasMore: hasMoreTracks.value,
      })
      libLog('loadFirstPage: pinia store now holds', {
        tracks: tracks.value.length,
        albums: albums.value.length,
        artists: artists.value.length,
      })
    } catch (error) {
      if (generation !== pageGeneration) return
      libraryError.value = toLibraryError(error)
    } finally {
      if (generation === pageGeneration) isLoading.value = false
    }
  }

  /**
   * Appends the next page.
   *
   * Guarded so overlapping triggers (fast scrolling, observer firing
   * repeatedly) can only ever produce one in-flight request.
   */
  async function loadMoreTracks(): Promise<void> {
    if (!isNativeLibrary.value) return
    if (!hasMoreTracks.value || isLoadingMore.value || isLoading.value) return

    const generation = pageGeneration
    const offset = loadedOffset.value
    isLoadingMore.value = true

    try {
      const args = nativeQueryArgs()
      const page = await getTracksPage({ offset, limit: pageSize.value, ...args })

      // Dataset changed while this page was in flight (re-sort, new
      // search). Dropping it prevents mixing two result sets.
      if (generation !== pageGeneration) {
        libLog('loadMoreTracks: stale page discarded', { generation, offset })
        return
      }

      // A page that returns nothing means we are done, regardless of
      // what the total claimed.
      if (page.tracks.length === 0) {
        hasMoreTracks.value = false
        return
      }

      tracks.value = mergeUnique(tracks.value, page.tracks)
      registerTracksForHistory(page.tracks)
      albums.value = mergeUnique(albums.value, page.albums)
      artists.value = mergeUnique(artists.value, page.artists)
      nativeTotal.value = page.total
      // Advance by the page we requested, so a duplicate row filtered
      // out by mergeUnique can never stall the cursor.
      loadedOffset.value = offset + page.tracks.length
      hasMoreTracks.value = page.hasMore && loadedOffset.value < page.total

      libLog('loadMoreTracks: appended page', {
        offset,
        received: page.tracks.length,
        loaded: loadedOffset.value,
        total: page.total,
        hasMore: hasMoreTracks.value,
      })
    } catch (error) {
      if (generation !== pageGeneration) return
      libraryError.value = toLibraryError(error)
    } finally {
      if (generation === pageGeneration) isLoadingMore.value = false
    }
  }

  /**
   * Re-reads the library from offset 0 with the current sort/query.
   * Used whenever the dataset definition changes.
   */
  async function resetPagination(): Promise<void> {
    if (!isNativeLibrary.value) return
    loadedOffset.value = 0
    hasMoreTracks.value = false
    await loadFirstPage()
  }

  /** Library search. Changing the term restarts pagination. */
  function setSearchQuery(value: string): void {
    if (searchQuery.value === value) return
    searchQuery.value = value
    void resetPagination()
  }

  async function loadAllTracks(): Promise<Track[]> {
    if (!isNativeLibrary.value) {
      return tracks.value
    }
    if (allTracksLoaded.value || (nativeTotal.value > 0 && tracks.value.length >= nativeTotal.value)) {
      return tracks.value
    }
    try {
      const all = await fetchAllDeviceTracks()
      if (all.length > 0) {
        tracks.value = mergeUnique(tracks.value, all)
        registerTracksForHistory(all)
        nativeTotal.value = all.length
        loadedOffset.value = all.length
        hasMoreTracks.value = false
        nativeDataLoaded.value = true
      }
    } catch (err) {
      libWarn('loadAllTracks failed', err)
    }
    return tracks.value
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
    searchQuery,

    // getters
    totalTracks,
    activeSectionIndex,
    selectedSortLabel,
    sortedTracks,
    isScanning,
    loadedCount,
    allTracksLoaded,
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
    loadAllTracks,
    resetPagination,
    setSearchQuery,
    clearLibraryError,
  }
})
