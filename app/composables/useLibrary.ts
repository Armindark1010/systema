// ============================================================
// useLibrary — presentation adapter for the SYSTEMA Library page
// ============================================================
// Backed by Pinia (useLibraryStore and usePlayerStore).
// Tapping a track plays it, updates MiniPlayer + EMO, but does NOT
// open the Full Screen Player. The user remains inside the Library.
// ============================================================

import { storeToRefs } from 'pinia'
import type { Album, Artist, Playlist, Track } from '~/types'
import { useLibraryStore, librarySections, librarySortOptions, type LibrarySection, type LibrarySortKey, type LibrarySortOption } from '~/stores/library'
import { usePlayerStore } from '~/stores/player'

export { librarySections, librarySortOptions, type LibrarySection, type LibrarySortKey, type LibrarySortOption }

export function useLibrary() {
  const libraryStore = useLibraryStore()
  const playerStore = usePlayerStore()

  const {
    activeSection,
    sortBy: sortKey,
    selectedSortLabel,
    isLoading,
    totalTracks,
    sortedTracks,
    albums,
    artists,
    playlists,
    // Native device library (all inert on the web).
    isNativeLibrary,
    permissionStatus,
    scanState,
    scanProgress,
    libraryError,
    hasMoreTracks,
    isLoadingMore,
    loadedCount,
    allTracksLoaded,
    searchQuery,
    isScanning,
    needsPermission,
    scanPercent,
    scanLabel,
  } = storeToRefs(libraryStore)

  const { favorites } = storeToRefs(playerStore)

  /**
   * CRITICAL REQUIREMENT:
   * Clicking a library track plays it, updates Pinia, Mini Player, and EMO,
   * but MUST NOT open the Full Screen Player. The user remains in the Library.
   */
  /**
   * Tapping a Library track starts a playback CONTEXT from the list
   * currently on screen, positioned at that track — so Previous and
   * Next walk the visible library order instead of dead-ending on a
   * one-item queue.
   *
   * Matches how Playlist, Search, Album and Artist behave.
   */
  function playTrack(track: Track) {
    const list = sortedTracks.value
    const index = list.findIndex(t => t.id === track.id)
    if (index >= 0) playerStore.playQueue(list, index)
    else playerStore.playTrack(track, 'LIBRARY')
  }

  function playTracks(tracksToPlay: Track[], _context: string, shuffle = false) {
    if (!tracksToPlay.length) return
    const items = shuffle ? [...tracksToPlay].sort(() => Math.random() - 0.5) : tracksToPlay
    playerStore.playQueue(items, 0)
  }

  /**
   * Shuffle the library: play the whole list as the context with
   * shuffle enabled, so Next/Previous follow one deterministic
   * shuffled order rather than re-randomising per press.
   * On native, ensures all device tracks are loaded before shuffling.
   */
  async function shuffleLibrary() {
    let list = sortedTracks.value
    if (isNativeLibrary.value && !allTracksLoaded.value) {
      await libraryStore.loadAllTracks()
      list = sortedTracks.value
    }
    if (!list.length) return
    const start = Math.floor(Math.random() * list.length)
    playerStore.playQueue(list, start)
    if (!playerStore.isShuffle) playerStore.toggleShuffle()
  }

  function addTrackToQueue(track: Track) {
    playerStore.addToQueue(track)
  }

  function setSection(section: LibrarySection) {
    libraryStore.setSection(section)
  }

  return {
    // state & getters
    activeSection,
    sortKey,
    selectedSortLabel,
    isLoading,
    totalTracks,
    sortedTracks,
    albums,
    artists,
    playlists,
    favorites,

    // native library state
    isNativeLibrary,
    permissionStatus,
    scanState,
    scanProgress,
    libraryError,
    hasMoreTracks,
    isLoadingMore,
    loadedCount,
    allTracksLoaded,
    searchQuery,
    isScanning,
    needsPermission,
    scanPercent,
    scanLabel,

    // methods from library store
    getAlbum: libraryStore.getAlbum,
    getArtist: libraryStore.getArtist,
    formatDuration: libraryStore.formatDuration,
    trackCountForArtist: libraryStore.trackCountForArtist,
    tracksForAlbum: libraryStore.tracksForAlbum,
    tracksForArtist: libraryStore.tracksForArtist,
    tracksForPlaylist: libraryStore.tracksForPlaylist,
    nextSection: libraryStore.nextSection,
    prevSection: libraryStore.prevSection,

    // actions
    playTrack,
    playTracks,
    shuffleLibrary,
    addTrackToQueue,
    setSection,
    setSortBy: libraryStore.setSortBy,
    resetPresentation: libraryStore.resetPresentation,

    // native library actions — no-ops in the browser
    initNativeLibrary: libraryStore.initNativeLibrary,
    disposeNativeLibrary: libraryStore.disposeNativeLibrary,
    requestLibraryPermission: libraryStore.requestLibraryPermission,
    scanLibrary: libraryStore.scanLibrary,
    cancelLibraryScan: libraryStore.cancelLibraryScan,
    loadMoreTracks: libraryStore.loadMoreTracks,
    resetPagination: libraryStore.resetPagination,
    setSearchQuery: libraryStore.setSearchQuery,
    clearLibraryError: libraryStore.clearLibraryError,
  }
}
