// ============================================================
// SYSTEMA — Centralized Search Store (Pinia)
// ============================================================
// Single source of truth for music search state across the app.
// Integrates local search, fuzzy matching, AI intent extraction,
// recent search persistence, and modular filter pills.
// ============================================================

import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { LocalSearchEngine } from '~/services/search/localSearch'
import type {
  SearchFilterType,
  SearchGroupedResults,
  SearchIntent,
  SearchMode,
  SearchOptions,
} from '~/services/search/searchTypes'
import { usePlaylists } from '~/composables/usePlaylists'

const DEFAULT_RECENT = [
  'late night',
  'workout',
  'coding',
  'calm electronic',
]

const DEFAULT_SUGGESTIONS = [
  'Music for deep focus',
  'Night drive',
  'High energy workout',
  'Ambient architecture',
  'آهنگ آروم برای شب',
  'کدنویسی تمرکز',
]

export const useSearchStore = defineStore('search', () => {
  // ---- Engine instance ---------------------------------------
  const engine = new LocalSearchEngine()
  const playlistsStore = usePlaylists()

  // Keep engine playlists in sync
  watch(
    () => playlistsStore.playlists.value,
    (pl) => {
      engine.updatePlaylists(pl)
    },
    { immediate: true },
  )

  // ---- State -------------------------------------------------
  const query = ref('')
  const isSearching = ref(false)
  const searchMode = ref<SearchMode>('local')
  const selectedFilter = ref<SearchFilterType>('all')
  const error = ref<string | null>(null)

  // Recent searches persisted in localStorage
  const recentSearches = useLocalStorage<string[]>('systema:recent-searches', DEFAULT_RECENT)
  const searchHistory = ref<string[]>([])

  const results = ref<SearchGroupedResults>({
    tracks: [],
    albums: [],
    artists: [],
    playlists: [],
    totalCount: 0,
    hasResults: false,
    intent: null,
  })

  const searchIntent = computed(() => results.value.intent ?? null)
  const liveSuggestions = ref<string[]>([])

  // ---- Getters -----------------------------------------------
  const hasQuery = computed(() => query.value.trim().length > 0)
  const hasResults = computed(() => results.value.hasResults)
  const totalCount = computed(() => results.value.totalCount)

  const isSemantic = computed(() => results.value.intent?.isSemantic ?? false)

  const suggestedQueries = computed(() => DEFAULT_SUGGESTIONS)

  // Filtered view according to selectedFilter pill
  const visibleTracks = computed(() =>
    selectedFilter.value === 'all' || selectedFilter.value === 'tracks' ? results.value.tracks : [],
  )
  const visibleAlbums = computed(() =>
    selectedFilter.value === 'all' || selectedFilter.value === 'albums' ? results.value.albums : [],
  )
  const visibleArtists = computed(() =>
    selectedFilter.value === 'all' || selectedFilter.value === 'artists' ? results.value.artists : [],
  )
  const visiblePlaylists = computed(() =>
    selectedFilter.value === 'all' || selectedFilter.value === 'playlists' ? results.value.playlists : [],
  )

  // ---- Actions -----------------------------------------------

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function setQuery(val: string) {
    query.value = val

    if (!val.trim()) {
      clearResults()
      return
    }

    // Live inline suggestions
    liveSuggestions.value = engine.suggest(val, 5)

    // Debounced search (180ms for responsive, flicker-free typing)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      executeSearch()
    }, 180)
  }

  function executeSearch(customQuery?: string) {
    const q = (customQuery !== undefined ? customQuery : query.value).trim()
    if (!q) {
      clearResults()
      return
    }

    if (customQuery !== undefined) {
      query.value = customQuery
    }

    isSearching.value = true
    error.value = null

    try {
      const options: SearchOptions = {
        mode: searchMode.value,
        filters: { type: selectedFilter.value },
        limit: 40,
        fuzzy: true,
      }

      const res = engine.searchSync ? engine.searchSync(q, options) : results.value
      results.value = res

      // Update mode reflection
      if (res.intent?.isSemantic && searchMode.value === 'local') {
        searchMode.value = 'semantic'
      } else if (!res.intent?.isSemantic && searchMode.value === 'semantic') {
        searchMode.value = 'local'
      }

      // Record in session history
      if (!searchHistory.value.includes(q)) {
        searchHistory.value.unshift(q)
      }
    } catch (e: any) {
      error.value = e?.message || 'Search error'
    } finally {
      isSearching.value = false
    }
  }

  function submitSearch(term?: string) {
    const target = (term ?? query.value).trim()
    if (!target) return
    query.value = target
    addRecentSearch(target)
    executeSearch(target)
  }

  function clearQuery() {
    query.value = ''
    clearResults()
  }

  function clearResults() {
    if (debounceTimer) clearTimeout(debounceTimer)
    results.value = {
      tracks: [],
      albums: [],
      artists: [],
      playlists: [],
      totalCount: 0,
      hasResults: false,
      intent: null,
    }
    liveSuggestions.value = []
    isSearching.value = false
    error.value = null
  }

  function addRecentSearch(term: string) {
    const clean = term.trim()
    if (!clean) return
    const list = recentSearches.value.filter(item => item.toLowerCase() !== clean.toLowerCase())
    list.unshift(clean)
    recentSearches.value = list.slice(0, 10)
  }

  function removeRecentSearch(term: string) {
    recentSearches.value = recentSearches.value.filter(item => item !== term)
  }

  function clearRecentSearches() {
    recentSearches.value = []
  }

  function setFilter(filter: SearchFilterType) {
    selectedFilter.value = filter
    if (hasQuery.value) {
      executeSearch()
    }
  }

  function setSearchMode(mode: SearchMode) {
    searchMode.value = mode
    if (hasQuery.value) {
      executeSearch()
    }
  }

  return {
    // state
    query,
    isSearching,
    searchMode,
    selectedFilter,
    recentSearches,
    searchHistory,
    results,
    searchIntent,
    liveSuggestions,
    error,

    // getters
    hasQuery,
    hasResults,
    totalCount,
    isSemantic,
    suggestedQueries,
    visibleTracks,
    visibleAlbums,
    visibleArtists,
    visiblePlaylists,

    // actions
    setQuery,
    executeSearch,
    submitSearch,
    clearQuery,
    clearResults,
    addRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    setFilter,
    setSearchMode,
  }
})
