// ============================================================
// SYSTEMA — Search Architecture Type Definitions
// ============================================================
// Future-ready contracts decoupling the UI from local, vector,
// Android SQLite, Room, or Capacitor search implementations.
// ============================================================

import type { Album, Artist, Playlist, Track } from '~/types'

export type SearchResultType = 'track' | 'album' | 'artist' | 'playlist'

export type SearchMode = 'local' | 'semantic' | 'ai'

export type SearchFilterType = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists'

export interface SearchFilters {
  type?: SearchFilterType
  genreId?: string
  mood?: string
  minEnergy?: number
  maxEnergy?: number
  minBpm?: number
  maxBpm?: number
  language?: string
}

export interface SearchIntent {
  query: string
  originalQuery: string
  normalizedQuery: string
  language: 'en' | 'fa' | 'mixed'
  isSemantic: boolean
  moods?: string[]
  genres?: string[]
  contexts?: string[]
  energy?: {
    min?: number
    max?: number
  }
  bpm?: {
    min?: number
    max?: number
  }
  explanation?: string
}

export interface ScoredSearchResult<T = Track | Album | Artist | Playlist> {
  type: SearchResultType
  id: string
  score: number
  matchedField: 'title' | 'artist' | 'album' | 'playlist' | 'ai-metadata' | 'fuzzy'
  item: T
  aiExplanation?: string
}

export interface SearchGroupedResults {
  tracks: ScoredSearchResult<Track>[]
  albums: ScoredSearchResult<Album>[]
  artists: ScoredSearchResult<Artist>[]
  playlists: ScoredSearchResult<Playlist>[]
  totalCount: number
  hasResults: boolean
  intent?: SearchIntent | null
}

export interface SearchOptions {
  mode?: SearchMode
  filters?: SearchFilters
  limit?: number
  fuzzy?: boolean
}

/** Abstract search engine contract */
export interface ISearchEngine {
  search(query: string, options?: SearchOptions): Promise<SearchGroupedResults>
  searchSync?(query: string, options?: SearchOptions): SearchGroupedResults
  suggest(query: string, limit?: number): string[]
  detectIntent(query: string): SearchIntent
}
