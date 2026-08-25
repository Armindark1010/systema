// ============================================================
// SYSTEMA — Local Search Engine Implementation
// ============================================================
// Production-grade search engine implementing:
// - Multilingual normalization (English, Persian, mixed)
// - Deterministic ranking (exact, prefix, substring, metadata, fuzzy)
// - Fuzzy matching for typos ("Strcture", "archtecture")
// - Structured AI intent detection (mood, energy, context, genre)
// - Fast in-memory search across tracks, albums, artists, playlists
// - Future-ready ISearchEngine interface
// ============================================================

import type { Album, Artist, Playlist, Track } from '../../types'
import { tracks as catalogTracks, albums as catalogAlbums, artists as catalogArtists, genres as catalogGenres } from '../../data/music'
import { normalizeQuery, detectLanguage, fuzzyScore } from './normalization'
import type {
  ISearchEngine,
  ScoredSearchResult,
  SearchFilters,
  SearchGroupedResults,
  SearchIntent,
  SearchOptions,
} from './searchTypes'

export class LocalSearchEngine implements ISearchEngine {
  private tracks: Track[]
  private albums: Album[]
  private artists: Artist[]
  private playlists: Playlist[]

  constructor(customData?: { tracks?: Track[]; albums?: Album[]; artists?: Artist[]; playlists?: Playlist[] }) {
    this.tracks = customData?.tracks ?? catalogTracks
    this.albums = customData?.albums ?? catalogAlbums
    this.artists = customData?.artists ?? catalogArtists
    this.playlists = customData?.playlists ?? []
  }

  public updatePlaylists(playlists: Playlist[]) {
    this.playlists = playlists
  }

  /**
   * Detects structured intent from user queries (multilingual & semantic).
   * Works on-device without sending queries to an external model.
   */
  public detectIntent(rawQuery: string): SearchIntent {
    const originalQuery = rawQuery
    const normalized = normalizeQuery(rawQuery)
    const language = detectLanguage(rawQuery)

    const intent: SearchIntent = {
      query: rawQuery,
      originalQuery,
      normalizedQuery: normalized,
      language,
      isSemantic: false,
      moods: [],
      genres: [],
      contexts: [],
    }

    const words = normalized.split(/\s+/)

    // Moods mapping (English & Persian)
    const moodKeywords: Record<string, string> = {
      calm: 'calm',
      peaceful: 'calm',
      relaxed: 'calm',
      quiet: 'calm',
      آروم: 'calm',
      آرام: 'calm',
      ملایم: 'calm',
      آرامش: 'calm',

      focused: 'focused',
      focus: 'focused',
      study: 'focused',
      concentration: 'focused',
      تمرکز: 'focused',
      کدنویسی: 'focused',
      درس: 'focused',

      energetic: 'energetic',
      energy: 'energetic',
      fast: 'energetic',
      gym: 'energetic',
      workout: 'energetic',
      انرژی: 'energetic',
      ورزش: 'energetic',
      باشگاه: 'energetic',
      تند: 'energetic',

      dark: 'dark',
      night: 'dark',
      noir: 'dark',
      تاریک: 'dark',
      شب: 'dark',

      dreamy: 'dreamy',
      رویا: 'dreamy',
      رویایی: 'dreamy',

      melancholic: 'melancholic',
      sad: 'melancholic',
      غمگین: 'melancholic',
      دلتنگ: 'melancholic',
    }

    // Context keywords
    const contextKeywords: Record<string, string> = {
      coding: 'coding',
      code: 'coding',
      برنامه_نویسی: 'coding',
      کدنویسی: 'coding',
      کد: 'coding',

      workout: 'workout',
      gym: 'workout',
      fitness: 'workout',
      ورزش: 'workout',
      تمرین: 'workout',

      night: 'night',
      drive: 'night',
      شب: 'night',

      study: 'study',
      work: 'work',
      کار: 'work',

      sleep: 'sleep',
      خواب: 'sleep',
      استراحت: 'sleep',
      relax: 'relax',
      آرامش: 'relax',
    }

    // Genre keywords
    const genreKeywords: Record<string, string> = {
      electronic: 'electronic',
      الکترونیک: 'electronic',
      synthwave: 'synthwave',
      سینت: 'synthwave',
      ambient: 'ambient',
      امبینت: 'ambient',
      techno: 'techno',
      تکنو: 'techno',
      persian: 'persian',
      فارسی: 'persian',
      ایرانی: 'persian',
      neoclassical: 'neoclassical',
      کلاسیک: 'neoclassical',
      soundtrack: 'score',
      score: 'score',
      موسیقی_متن: 'score',
    }

    for (const [rawKw, mood] of Object.entries(moodKeywords)) {
      const kw = normalizeQuery(rawKw)
      if (normalized.includes(kw)) {
        if (!intent.moods!.includes(mood)) intent.moods!.push(mood)
        intent.isSemantic = true
      }
    }

    for (const [rawKw, ctx] of Object.entries(contextKeywords)) {
      const kw = normalizeQuery(rawKw)
      if (normalized.includes(kw)) {
        if (!intent.contexts!.includes(ctx)) intent.contexts!.push(ctx)
        intent.isSemantic = true
      }
    }

    for (const [rawKw, gen] of Object.entries(genreKeywords)) {
      const kw = normalizeQuery(rawKw)
      if (normalized.includes(kw)) {
        if (!intent.genres!.includes(gen)) intent.genres!.push(gen)
      }
    }

    // Energy bounds heuristic
    if (intent.moods!.includes('energetic') || intent.contexts!.includes('workout')) {
      intent.energy = { min: 0.65, max: 1.0 }
      intent.bpm = { min: 110, max: 150 }
    } else if (intent.moods!.includes('calm') || intent.contexts!.includes('night')) {
      intent.energy = { min: 0.1, max: 0.55 }
      intent.bpm = { min: 60, max: 100 }
    }

    // Construct friendly explanation
    if (intent.isSemantic) {
      const parts: string[] = []
      if (intent.moods!.length) parts.push(`Mood: ${intent.moods!.join(', ')}`)
      if (intent.contexts!.length) parts.push(`Context: ${intent.contexts!.join(', ')}`)
      if (intent.genres!.length) parts.push(`Genre: ${intent.genres!.join(', ')}`)
      intent.explanation = parts.join(' · ')
    }

    return intent
  }

  /**
   * Main search method executing search synchronously across in-memory catalog.
   */
  public searchSync(rawQuery: string, options: SearchOptions = {}): SearchGroupedResults {
    const query = rawQuery.trim()
    const norm = normalizeQuery(query)

    if (!norm) {
      return {
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        totalCount: 0,
        hasResults: false,
        intent: null,
      }
    }

    const intent = this.detectIntent(query)
    const filters: SearchFilters = options.filters ?? {}
    const limit = options.limit ?? 50
    const filterType = filters.type ?? 'all'

    const scoredTracks: ScoredSearchResult<Track>[] = []
    const scoredAlbums: ScoredSearchResult<Album>[] = []
    const scoredArtists: ScoredSearchResult<Artist>[] = []
    const scoredPlaylists: ScoredSearchResult<Playlist>[] = []

    // Helper lookup caches
    const artistMap = new Map(this.artists.map(a => [a.id, a]))
    const albumMap = new Map(this.albums.map(a => [a.id, a]))
    const genreMap = new Map(catalogGenres.map(g => [g.id, g]))

    // 1. Search Tracks
    if (filterType === 'all' || filterType === 'tracks') {
      for (const track of this.tracks) {
        const normTitle = normalizeQuery(track.title)
        const artist = artistMap.get(track.artistId)
        const album = albumMap.get(track.albumId)
        const genre = genreMap.get(track.genreId)

        const normArtist = artist ? normalizeQuery(artist.name) : ''
        const normAlbum = album ? normalizeQuery(album.title) : ''
        const normGenre = genre ? normalizeQuery(`${genre.name} ${genre.nameFa ?? ''}`) : ''

        let score = 0
        let matchedField: ScoredSearchResult['matchedField'] = 'title'
        let aiExplanation: string | undefined

        // Title ranking
        if (normTitle === norm) {
          score = 1.0
          matchedField = 'title'
        } else if (normTitle.startsWith(norm)) {
          score = 0.92
          matchedField = 'title'
        } else if (normTitle.includes(norm)) {
          score = 0.84
          matchedField = 'title'
        } else if (normArtist === norm) {
          score = 0.78
          matchedField = 'artist'
        } else if (normArtist.startsWith(norm) || normArtist.includes(norm)) {
          score = 0.72
          matchedField = 'artist'
        } else if (normAlbum.includes(norm)) {
          score = 0.66
          matchedField = 'album'
        } else if (normGenre.includes(norm)) {
          score = 0.60
          matchedField = 'ai-metadata'
        } else {
          // Check semantic intent metadata
          let semanticScore = 0
          if (intent.isSemantic) {
            const trackMoods = [track.mood, ...(track.ai?.mood ?? [])].map(m => m.toLowerCase())
            const trackGenres = [genre?.name.toLowerCase() ?? '', ...(track.ai?.genres ?? [])]
            const trackThemes = track.ai?.themes ?? []

            let matchedCount = 0
            if (intent.moods?.some(m => trackMoods.includes(m))) matchedCount += 2
            if (intent.genres?.some(g => trackGenres.some(tg => tg.includes(g)))) matchedCount += 2
            if (intent.contexts?.some(c => trackThemes.includes(c) || trackMoods.includes(c))) matchedCount += 2

            if (intent.energy) {
              const energyNormalized = track.energy > 1 ? track.energy / 100 : track.energy
              if (
                (intent.energy.min === undefined || energyNormalized >= intent.energy.min) &&
                (intent.energy.max === undefined || energyNormalized <= intent.energy.max)
              ) {
                matchedCount += 1
              }
            }

            if (matchedCount > 0) {
              semanticScore = 0.55 + matchedCount * 0.05
              matchedField = 'ai-metadata'
              aiExplanation = `Matches ${intent.explanation || 'mood & energy profile'}`
            }
          }

          if (semanticScore > 0) {
            score = semanticScore
          } else if (options.fuzzy !== false) {
            // Fuzzy match fallback
            const fScoreTitle = fuzzyScore(norm, normTitle)
            const fScoreArtist = fuzzyScore(norm, normArtist)
            const bestFuzzy = Math.max(fScoreTitle, fScoreArtist)

            if (bestFuzzy >= 0.65) {
              score = 0.45 * bestFuzzy
              matchedField = 'fuzzy'
            }
          }
        }

        if (score > 0) {
          scoredTracks.push({
            type: 'track',
            id: track.id,
            score: Math.round(score * 100) / 100,
            matchedField,
            item: track,
            aiExplanation,
          })
        }
      }
    }

    // 2. Search Albums
    if (filterType === 'all' || filterType === 'albums') {
      for (const album of this.albums) {
        const normTitle = normalizeQuery(album.title)
        const artist = artistMap.get(album.artistId)
        const normArtist = artist ? normalizeQuery(artist.name) : ''

        let score = 0
        let matchedField: ScoredSearchResult['matchedField'] = 'album'

        if (normTitle === norm) {
          score = 0.95
        } else if (normTitle.startsWith(norm)) {
          score = 0.85
        } else if (normTitle.includes(norm)) {
          score = 0.75
        } else if (normArtist.includes(norm)) {
          score = 0.65
          matchedField = 'artist'
        } else if (options.fuzzy !== false) {
          const f = fuzzyScore(norm, normTitle)
          if (f >= 0.7) {
            score = 0.42 * f
            matchedField = 'fuzzy'
          }
        }

        if (score > 0) {
          scoredAlbums.push({
            type: 'album',
            id: album.id,
            score: Math.round(score * 100) / 100,
            matchedField,
            item: album,
          })
        }
      }
    }

    // 3. Search Artists
    if (filterType === 'all' || filterType === 'artists') {
      for (const artist of this.artists) {
        const normName = normalizeQuery(artist.name)
        const normOrigin = normalizeQuery(artist.origin)

        let score = 0
        let matchedField: ScoredSearchResult['matchedField'] = 'artist'

        if (normName === norm) {
          score = 0.98
        } else if (normName.startsWith(norm)) {
          score = 0.88
        } else if (normName.includes(norm)) {
          score = 0.78
        } else if (normOrigin.includes(norm)) {
          score = 0.60
        } else if (options.fuzzy !== false) {
          const f = fuzzyScore(norm, normName)
          if (f >= 0.7) {
            score = 0.44 * f
            matchedField = 'fuzzy'
          }
        }

        if (score > 0) {
          scoredArtists.push({
            type: 'artist',
            id: artist.id,
            score: Math.round(score * 100) / 100,
            matchedField,
            item: artist,
          })
        }
      }
    }

    // 4. Search Playlists
    if (filterType === 'all' || filterType === 'playlists') {
      for (const playlist of this.playlists) {
        const normTitle = normalizeQuery(playlist.title)
        const normDesc = playlist.description ? normalizeQuery(playlist.description) : ''

        let score = 0
        let matchedField: ScoredSearchResult['matchedField'] = 'playlist'

        if (normTitle === norm) {
          score = 0.94
        } else if (normTitle.startsWith(norm)) {
          score = 0.84
        } else if (normTitle.includes(norm)) {
          score = 0.74
        } else if (normDesc.includes(norm)) {
          score = 0.62
        } else if (options.fuzzy !== false) {
          const f = fuzzyScore(norm, normTitle)
          if (f >= 0.7) {
            score = 0.40 * f
            matchedField = 'fuzzy'
          }
        }

        if (score > 0) {
          scoredPlaylists.push({
            type: 'playlist',
            id: playlist.id,
            score: Math.round(score * 100) / 100,
            matchedField,
            item: playlist,
          })
        }
      }
    }

    // Sort all groups by descending score
    scoredTracks.sort((a, b) => b.score - a.score)
    scoredAlbums.sort((a, b) => b.score - a.score)
    scoredArtists.sort((a, b) => b.score - a.score)
    scoredPlaylists.sort((a, b) => b.score - a.score)

    const slicedTracks = scoredTracks.slice(0, limit)
    const slicedAlbums = scoredAlbums.slice(0, Math.min(limit, 12))
    const slicedArtists = scoredArtists.slice(0, Math.min(limit, 12))
    const slicedPlaylists = scoredPlaylists.slice(0, Math.min(limit, 8))

    const totalCount =
      slicedTracks.length + slicedAlbums.length + slicedArtists.length + slicedPlaylists.length

    return {
      tracks: slicedTracks,
      albums: slicedAlbums,
      artists: slicedArtists,
      playlists: slicedPlaylists,
      totalCount,
      hasResults: totalCount > 0,
      intent,
    }
  }

  /**
   * Asynchronous interface wrapper around searchSync
   */
  public async search(rawQuery: string, options: SearchOptions = {}): Promise<SearchGroupedResults> {
    return Promise.resolve(this.searchSync(rawQuery, options))
  }

  /**
   * Fast inline suggestions as the user types.
   */
  public suggest(rawQuery: string, limit = 6): string[] {
    const norm = normalizeQuery(rawQuery)
    if (!norm) return []

    const candidates = new Set<string>()

    // Track titles
    for (const t of this.tracks) {
      const n = normalizeQuery(t.title)
      if (n.startsWith(norm) || n.includes(norm)) {
        candidates.add(t.title)
      }
      if (candidates.size >= limit) break
    }

    // Artist names
    if (candidates.size < limit) {
      for (const a of this.artists) {
        const n = normalizeQuery(a.name)
        if (n.startsWith(norm) || n.includes(norm)) {
          candidates.add(a.name)
        }
        if (candidates.size >= limit) break
      }
    }

    // Album titles
    if (candidates.size < limit) {
      for (const al of this.albums) {
        const n = normalizeQuery(al.title)
        if (n.startsWith(norm) || n.includes(norm)) {
          candidates.add(al.title)
        }
        if (candidates.size >= limit) break
      }
    }

    return Array.from(candidates).slice(0, limit)
  }
}
