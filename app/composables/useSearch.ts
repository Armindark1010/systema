// ============================================================
// useSearch — Facade over Centralized Search Store (Pinia)
// ============================================================
// Single source of truth is useSearchStore().
// Decouples all UI entry points (Home QuickSearch, Mobile Dock,
// Library Search, Search Page) and maps them to one shared experience.
// ============================================================

import { storeToRefs } from 'pinia'
import { useSearchStore } from '~/stores/search'

export function useSearch() {
  const store = useSearchStore()
  const refs = storeToRefs(store)

  // Backwards-compatible aliases
  const semantic = computed(() => store.isSemantic)

  const grouped = computed(() => ({
    tracks: store.results.tracks.map(r => r.item),
    albums: store.results.albums.map(r => r.item),
    artists: store.results.artists.map(r => r.item),
    playlists: store.results.playlists.map(r => r.item),
    semantic: store.isSemantic,
  }))

  const paletteResults = computed(() => {
    const out: any[] = []
    store.results.tracks.slice(0, 5).forEach((t) =>
      out.push({ id: t.item.id, type: 'track', title: t.item.title, subtitle: (t.item as any).artist ?? '' }),
    )
    store.results.artists.slice(0, 3).forEach((a) =>
      out.push({ id: a.item.id, type: 'artist', title: a.item.name, subtitle: a.item.origin }),
    )
    store.results.albums.slice(0, 3).forEach((al) =>
      out.push({ id: al.item.id, type: 'album', title: al.item.title, subtitle: (al.item as any).artist ?? '' }),
    )
    store.results.playlists.slice(0, 3).forEach((p) =>
      out.push({ id: p.item.id, type: 'playlist', title: p.item.title, subtitle: p.item.description ?? '' }),
    )
    return out
  })

  function submit(q?: string) {
    store.submitSearch(q)
  }

  return {
    ...refs,
    store,
    semantic,
    grouped,
    paletteResults,
    submit,
    setQuery: store.setQuery,
    executeSearch: store.executeSearch,
    clearQuery: store.clearQuery,
    addRecentSearch: store.addRecentSearch,
    removeRecentSearch: store.removeRecentSearch,
    clearRecentSearches: store.clearRecentSearches,
    setFilter: store.setFilter,
    setSearchMode: store.setSearchMode,
  }
}
