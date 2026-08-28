// ============================================================
// usePlayer — Facade over Centralized Pinia Player Store
// ============================================================
// Single source of truth is Pinia (usePlayerStore).
// This composable provides backwards-compatible access so that
// existing components can destructure refs or invoke actions.
// ============================================================

import { storeToRefs } from 'pinia'
import { usePlayerStore } from '~/stores/player'

export function usePlayer() {
  const store = usePlayerStore()
  const refs = storeToRefs(store)

  // Virtual index for backwards compatibility (current track is at 0, queue follows)
  const index = computed(() => 0)

  return {
    // Reactive refs for destructuring (currentTrack, isPlaying, queue, progressMs, etc.)
    ...refs,
    index,

    // Store instance
    store,

    // Actions
    playTrack: store.playTrack,
    pause: store.pause,
    resume: store.resume,
    togglePlay: store.togglePlay,
    next: store.next,
    prev: store.previous,
    previous: store.previous,
    seek: store.seek,
    seekMs: store.seekMs,
    seekForward: store.seekForward,
    seekBackward: store.seekBackward,
    seekToPct: store.seekToPct,
    addToQueue: store.addToQueue,
    removeFromQueue: store.removeFromQueue,
    reorderQueue: store.reorderQueue,
    clearQueue: store.clearQueue,
    playQueueItem: store.playQueueItem,
    shuffleQueue: store.shuffleQueue,
    toggleShuffle: store.toggleShuffle,
    cycleRepeat: store.cycleRepeat,
    setVolume: store.setVolume,
    toggleMute: store.toggleMute,
    toggleFavorite: store.toggleFavorite,
    toggleFavoriteId: store.toggleFavoriteId,
    isFavorite: store.isFavorite,
    playQueue: store.playQueue,
    playPlaylist: store.playPlaylist,
    playAlbum: store.playAlbum,
    ensureFullPlayerNavigation: store.ensureFullPlayerNavigation,
    openFullPlayer: store.openFullPlayer,
    closeFullPlayer: store.closeFullPlayer,
    setFullPlayerOpen: store.setFullPlayerOpen,
    openQueue: store.openQueue,
    closeQueue: store.closeQueue,
    setQueueOpen: store.setQueueOpen,
  }
}
