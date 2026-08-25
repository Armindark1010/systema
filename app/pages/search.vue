<script setup lang="ts">
// ============================================================
// SEARCH — Focused, architectural search experience
// ============================================================
// Unified entry point for:
// - Text & natural-language queries (English, Persian, mixed)
// - Structured AI intent detection
// - Local catalog matching across Tracks, Albums, Artists, Playlists
// - Fuzzy matching for typos
// - Recent search persistence
// - Integrated EMO reaction
// ============================================================

import type { EmoExpression } from '~/types/emo'
import { useSearchStore } from '~/stores/search'

useHead({ title: 'Search' })
definePageMeta({ hideMobileHeader: true })

const route = useRoute()
const search = useSearchStore()

// URL query parameter synchronization & initial SSR resolution
if (typeof route.query.q === 'string' && route.query.q) {
  search.setQuery(route.query.q)
  search.executeSearch(route.query.q)
}

watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q !== search.query) {
      search.setQuery(q)
      search.executeSearch(q)
    }
  },
)

// Dynamic subtle EMO expression based on search lifecycle
const emoExpression = computed<EmoExpression>(() => {
  if (!search.hasQuery) return 'curious'
  if (search.isSearching) return 'thinking'
  if (search.isSemantic) return 'excited'
  if (search.hasResults) return 'happy'
  return 'thinking'
})

const emoMessage = computed(() => {
  if (!search.hasQuery) return 'READY TO SEARCH'
  if (search.isSearching) return 'SEARCHING ARCHIVE'
  if (search.isSemantic) return 'AI INTENT DETECTED'
  if (search.hasResults) return `${search.totalCount} MATCHES`
  return 'NO MATCHES FOUND'
})

function onSelectQuery(term: string) {
  search.submitSearch(term)
}
</script>

<template>
  <div class="min-h-[100dvh] w-full bg-base pb-[calc(4.5rem+var(--sys-safe-bottom))] text-fg">
    <div class="mx-auto flex w-full max-w-3xl flex-col">
      <SearchHeader :expression="emoExpression" :message="emoMessage" />
      <div class="px-4 pt-5 sm:px-6">
        <h2 class="m-0 text-h2 font-bold tracking-[-0.02em] text-fg">SEARCH</h2>
        <p class="mt-1 text-small text-fg-muted">Find music with clarity and precision.</p>
      </div>

      <!-- Primary search input -->
      <SearchInput
        :model-value="search.query"
        :is-searching="search.isSearching"
        :is-semantic="search.isSemantic"
        @update:model-value="v => search.setQuery(v)"
        @clear="search.clearQuery"
        @submit="search.submitSearch()"
      />

      <!-- When user is searching / query active -->
      <template v-if="search.hasQuery">
        <!-- Filter pills: ALL | TRACKS | ALBUMS | ARTISTS | PLAYLISTS -->
        <SearchFilters
          v-if="search.hasResults"
          :active-filter="search.selectedFilter"
          :counts="{
            tracks: search.results.tracks.length,
            albums: search.results.albums.length,
            artists: search.results.artists.length,
            playlists: search.results.playlists.length,
          }"
          @select="f => search.setFilter(f)"
        />

        <!-- Live query suggestions (if available while typing) -->
        <SearchSuggestions
          v-if="search.liveSuggestions.length && !search.hasResults"
          :suggested-queries="search.suggestedQueries"
          :live-suggestions="search.liveSuggestions"
          :has-query="true"
          @select="onSelectQuery"
        />

        <!-- Search results list -->
        <SearchResults />
      </template>

      <!-- Idle state: RECENT SEARCHES & SUGGESTED DISCOVER -->
      <template v-else>
        <SearchRecent
          :searches="search.recentSearches"
          @select="onSelectQuery"
          @remove="t => search.removeRecentSearch(t)"
          @clear-all="search.clearRecentSearches()"
        />

        <SearchSuggestions
          :suggested-queries="search.suggestedQueries"
          :has-query="false"
          @select="onSelectQuery"
        />
      </template>
    </div>
  </div>
</template>
