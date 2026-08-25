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
  } = storeToRefs(libraryStore)

  const { favorites } = storeToRefs(playerStore)

  /**
   * CRITICAL REQUIREMENT:
   * Clicking a library track plays it, updates Pinia, Mini Player, and EMO,
   * but MUST NOT open the Full Screen Player. The user remains in the Library.
   */
  function playTrack(track: Track) {
    playerStore.playTrack(track, 'LIBRARY')
  }

  function playTracks(tracksToPlay: Track[], _context: string, shuffle = false) {
    if (!tracksToPlay.length) return
    const items = shuffle ? [...tracksToPlay].sort(() => Math.random() - 0.5) : tracksToPlay
    playerStore.playQueue(items, 0)
  }

  function shuffleLibrary() {
    const list = sortedTracks.value
    if (!list.length) return
    const randomTrack = list[Math.floor(Math.random() * list.length)]
    if (randomTrack) playTrack(randomTrack)
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
  }
}
