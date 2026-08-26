// ============================================================
// SYSTEMA — Shared type contracts
// ============================================================
// These interfaces define the boundary between the UI and
// future native systems (Capacitor, Media3, Room, AI engines).
// The UI consumes only these shapes — never implementation
// details of a backend.
// ============================================================

/** Visual theme — swaps --sys-* design tokens, never components. */
export type Theme = 'default' | 'premium' | 'dark' | 'midcentury' | 'bauhaus'

export * from './settings'
export * from './playlists'

export interface Genre {
  id: string
  name: string
  nameFa?: string
}

export interface Artist {
  id: string
  name: string
  origin: string
  genres: string[]
}

export interface Album {
  id: string
  title: string
  artistId: string
  year: number
  genreId: string
  cover: string
}

export type TrackMood = 'dark' | 'dreamy' | 'energetic' | 'calm' | 'focused' | 'melancholic'
export type TrackLang = 'en' | 'fa' | 'inst'

/** Local analysis shape. The native AI pipeline will hydrate this later. */
export interface TrackAI {
  analyzed: boolean
  mood: string[]
  genres: string[]
  /** 0–1 */
  energy: number
  bpm: number
  language: string
  themes: string[]
  confidence: number
}

export interface Track {
  id: string
  title: string
  artistId: string
  albumId: string
  genreId: string
  /** duration in seconds */
  duration: number
  year: number
  /** 0–100 */
  energy: number
  mood: TrackMood
  lang: TrackLang
  plays: number
  favorite: boolean
  addedAt: string
  /** Optional until the on-device analysis pipeline has completed. */
  ai?: TrackAI
  artist?: string
  album?: string
  artwork?: string
  /**
   * Playable content:// URI, present only for tracks that came from
   * the device MediaStore. Mock catalog tracks have none, which is
   * exactly how the player tells real audio from the demo catalog.
   */
  uri?: string
  /** Raw content:// artwork URI, for native player metadata. */
  artworkUri?: string
}

export type PlaylistKind = 'user' | 'system' | 'ai'

export interface Playlist {
  id: string
  title: string
  description?: string
  cover?: string
  trackIds: string[]
  kind: PlaylistKind
  createdAt: string
  updatedAt: string
  /** metadata produced by the (future) AI generator */
  aiMeta?: {
    mood?: string
    energy?: string
    concept?: string
  }
}

/** An entry in the playback queue. */
export interface QueueItem {
  track: Track
  /** where the track came from (playlist / album / search / library) */
  context: string
}

export type SearchResultType = 'track' | 'album' | 'artist' | 'playlist' | 'ai'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  subtitle: string
  /** relevance 0–100 (AI ranking) */
  match?: number
}

export interface AIInsight {
  id: string
  label: string
  value: string
  sub?: string
  /** 0–100 series (e.g. per-hour listening) */
  series?: number[]
}

export interface AIRecommendation {
  id: string
  title: string
  description: string
  trackCount: number
  tags: string[]
  cover?: string
}

export type RepeatMode = 'off' | 'all' | 'one'

/**
 * Contract for the global player.
 * The current implementation is a mock; a native Media3/ExoPlayer
 * adapter must satisfy the same shape.
 */
export interface PlayerState {
  queue: QueueItem[]
  index: number
  playing: boolean
  progressMs: number
  durationMs: number
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  muted: boolean
  favorites: string[]
}

export type LibrarySort = 'title' | 'artist' | 'album' | 'duration' | 'plays' | 'added'
export type ViewMode = 'list' | 'grid'

/** Playlist import state machine (frontend representation only). */
export type ImportStep = 'idle' | 'select' | 'reading' | 'matching' | 'resolve' | 'done'

export interface ImportedEntry {
  id: string
  title: string
  artist?: string
  status: 'matched' | 'missing'
  matchedTrackId?: string
}

export type AISearchPhase = 'idle' | 'understanding' | 'searching' | 'ranking' | 'done'

export interface AIGenerationForm {
  mood: string
  energy: string
  /** minutes */
  duration: number
  language: string
  genre: string
  concept: string
}

export type AIGenPhase = 'idle' | 'analyzing' | 'selecting' | 'ranking' | 'finalizing' | 'done'

export type AnalysisMode = 'charging' | 'charging-idle' | 'manual'

export interface AnalysisState {
  total: number
  analyzed: number
  progress: number
  running: boolean
  mode: AnalysisMode
}
