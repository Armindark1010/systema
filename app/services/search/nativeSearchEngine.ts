// ============================================================
// SYSTEMA — Native Search Engine
// ============================================================
// Phase 4.1. On Android, search must find the user's OWN music.
//
// The search store used to construct a LocalSearchEngine with no
// arguments, which makes it fall back to the bundled demo catalog.
// Nothing ever handed it device data, so on a phone holding thousands
// of real tracks, searching returned mock songs — and only mock songs.
//
// The obvious fix — copy the library into the search engine — is the
// wrong one. It would mean a second full array of every track in
// JavaScript memory, kept in sync with the store, on a device that may
// hold 10k+ rows. The library is deliberately paginated (100 rows at a
// time) precisely to avoid that.
//
// So this engine does not hold a catalog at all. It asks the native
// index the question directly:
//
//     Native Room DAO  ->  MusicLibrary bridge  ->  this engine  ->  UI
//
// SQLite already does the matching (indexed LIKE with ESCAPE), already
// does the pagination (LIMIT/OFFSET), and already does the sorting.
// The wildcard escaping lives in MusicLibraryRepository, so a literal
// % or _ typed by the user stays literal. Nothing is duplicated, and
// the only thing crossing the bridge is the page actually shown.
//
// Ranking still happens here: SQL returns matching rows, not *ranked*
// rows, and the ordering the UI expects (exact title, then prefix,
// then artist, then album) is a product decision, not a database one.
// It runs over one page, not the library.
//
// Playlists are user data living in the browser layer, so they are
// matched in memory exactly as before.
// ============================================================

import type { Album, Artist, Playlist, Track } from '../../types'
import { getTracksPage } from '../native/musicLibraryService'
import type { GetTracksOptions } from '../native/musicLibraryPlugin'
import { normalizeQuery, fuzzyScore } from './normalization'
import type {
  ISearchEngine,
  ScoredSearchResult,
  SearchGroupedResults,
  SearchIntent,
  SearchOptions,
} from './searchTypes'

/** The slice of a library page this engine consumes. */
export interface LibraryQueryPage {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
}

/** Empty result shape, so callers never have to null-check. */
function emptyResults(intent: SearchIntent | null = null): SearchGroupedResults {
  return {
    tracks: [],
    albums: [],
    artists: [],
    playlists: [],
    totalCount: 0,
    hasResults: false,
    intent,
  }
}

export class NativeSearchEngine implements ISearchEngine {
  private playlists: Playlist[] = []

  /**
   * Titles/artists seen in recent results, used for inline
   * suggestions.
   *
   * suggest() is synchronous by contract (the UI calls it on every
   * keystroke) and a bridge call cannot be. Rather than block typing
   * or fabricate suggestions from mock data, suggestions come from
   * what the user's own library has already returned. Bounded, so it
   * cannot grow into a shadow copy of the library.
   */
  private suggestionPool: string[] = []
  private static readonly SUGGESTION_POOL_MAX = 300

  /**
   * @param intentSource intent detection is shared with the local
   *   engine: it is pure text analysis over the query and has nothing
   *   to do with the catalog.
   * @param fetchPage the paged library query. Defaults to the real
   *   Capacitor bridge; overridable so the search rules can be tested
   *   without a device.
   */
  constructor(
    private readonly intentSource: Pick<ISearchEngine, 'detectIntent'>,
    private readonly fetchPage: (options: GetTracksOptions) => Promise<LibraryQueryPage> = getTracksPage,
  ) {}

  public updatePlaylists(playlists: Playlist[]) {
    this.playlists = playlists
  }

  public detectIntent(query: string): SearchIntent {
    return this.intentSource.detectIntent(query)
  }

  public async search(rawQuery: string, options: SearchOptions = {}): Promise<SearchGroupedResults> {
    const query = rawQuery.trim()
    const norm = normalizeQuery(query)
    if (!norm) return emptyResults()

    const intent = this.detectIntent(query)
    const filterType = options.filters?.type ?? 'all'
    const limit = options.limit ?? 50

    // One bridge call, one page. `query` is what makes the DAO filter
    // in SQL instead of us pulling rows over to filter in JS.
    const page = await this.fetchPage({
      query,
      limit,
      offset: 0,
      sort: 'title',
      order: 'asc',
    })

    this.rememberSuggestions(page.tracks)

    const tracks = filterType === 'all' || filterType === 'tracks'
      ? this.rankTracks(page.tracks, norm, options)
      : []

    // Albums and artists are derived from the matched rows, which is
    // how the library screens build them too. No extra queries.
    const albums = filterType === 'all' || filterType === 'albums'
      ? this.rankAlbums(page.albums, norm, options)
      : []

    const artists = filterType === 'all' || filterType === 'artists'
      ? this.rankArtists(page.artists, norm, options)
      : []

    const playlists = filterType === 'all' || filterType === 'playlists'
      ? this.rankPlaylists(norm, options)
      : []

    const totalCount = tracks.length + albums.length + artists.length + playlists.length

    return {
      tracks,
      albums,
      artists,
      playlists,
      totalCount,
      hasResults: totalCount > 0,
      intent,
    }
  }

  // ---- Ranking -------------------------------------------------
  // Same ladder the local engine uses, so results feel identical
  // whichever engine answered.

  private rankTracks(rows: Track[], norm: string, options: SearchOptions): ScoredSearchResult<Track>[] {
    const scored: ScoredSearchResult<Track>[] = []

    for (const track of rows) {
      const normTitle = normalizeQuery(track.title)
      const normArtist = normalizeQuery(track.artist ?? '')
      const normAlbum = normalizeQuery(track.album ?? '')

      let score = 0
      let matchedField: ScoredSearchResult['matchedField'] = 'title'

      if (normTitle === norm) {
        score = 1.0
      } else if (normTitle.startsWith(norm)) {
        score = 0.92
      } else if (normTitle.includes(norm)) {
        score = 0.84
      } else if (normArtist === norm) {
        score = 0.78
        matchedField = 'artist'
      } else if (normArtist.startsWith(norm) || normArtist.includes(norm)) {
        score = 0.72
        matchedField = 'artist'
      } else if (normAlbum.includes(norm)) {
        score = 0.66
        matchedField = 'album'
      } else if (options.fuzzy !== false) {
        // SQL matched this row on a field we have not scored (or the
        // normalizers disagree about spacing/diacritics). Keep it, but
        // rank it below every literal match.
        const best = Math.max(fuzzyScore(norm, normTitle), fuzzyScore(norm, normArtist))
        if (best >= 0.65) {
          score = 0.45 * best
          matchedField = 'fuzzy'
        }
      }

      if (score > 0) {
        scored.push({
          type: 'track',
          id: track.id,
          score: Math.round(score * 100) / 100,
          matchedField,
          item: track,
        })
      }
    }

    return scored.sort((a, b) => b.score - a.score)
  }

  private rankAlbums(rows: Album[], norm: string, options: SearchOptions): ScoredSearchResult<Album>[] {
    const scored: ScoredSearchResult<Album>[] = []

    for (const album of rows) {
      const normTitle = normalizeQuery(album.title)
      let score = 0
      let matchedField: ScoredSearchResult['matchedField'] = 'album'

      if (normTitle === norm) score = 1.0
      else if (normTitle.startsWith(norm)) score = 0.9
      else if (normTitle.includes(norm)) score = 0.8
      else if (options.fuzzy !== false) {
        const f = fuzzyScore(norm, normTitle)
        if (f >= 0.7) {
          score = 0.4 * f
          matchedField = 'fuzzy'
        }
      }

      if (score > 0) {
        scored.push({ type: 'album', id: album.id, score: Math.round(score * 100) / 100, matchedField, item: album })
      }
    }

    return scored.sort((a, b) => b.score - a.score)
  }

  private rankArtists(rows: Artist[], norm: string, options: SearchOptions): ScoredSearchResult<Artist>[] {
    const scored: ScoredSearchResult<Artist>[] = []

    for (const artist of rows) {
      const normName = normalizeQuery(artist.name)
      let score = 0
      let matchedField: ScoredSearchResult['matchedField'] = 'artist'

      if (normName === norm) score = 1.0
      else if (normName.startsWith(norm)) score = 0.9
      else if (normName.includes(norm)) score = 0.8
      else if (options.fuzzy !== false) {
        const f = fuzzyScore(norm, normName)
        if (f >= 0.7) {
          score = 0.4 * f
          matchedField = 'fuzzy'
        }
      }

      if (score > 0) {
        scored.push({ type: 'artist', id: artist.id, score: Math.round(score * 100) / 100, matchedField, item: artist })
      }
    }

    return scored.sort((a, b) => b.score - a.score)
  }

  private rankPlaylists(norm: string, options: SearchOptions): ScoredSearchResult<Playlist>[] {
    const scored: ScoredSearchResult<Playlist>[] = []

    for (const playlist of this.playlists) {
      const normName = normalizeQuery(playlist.name)
      let score = 0
      let matchedField: ScoredSearchResult['matchedField'] = 'playlist'

      if (normName === norm) score = 1.0
      else if (normName.startsWith(norm)) score = 0.9
      else if (normName.includes(norm)) score = 0.8
      else if (options.fuzzy !== false) {
        const f = fuzzyScore(norm, normName)
        if (f >= 0.7) {
          score = 0.4 * f
          matchedField = 'fuzzy'
        }
      }

      if (score > 0) {
        scored.push({ type: 'playlist', id: playlist.id, score: Math.round(score * 100) / 100, matchedField, item: playlist })
      }
    }

    return scored.sort((a, b) => b.score - a.score)
  }

  // ---- Suggestions ---------------------------------------------

  private rememberSuggestions(tracks: Track[]) {
    for (const track of tracks) {
      if (track.title) this.suggestionPool.push(track.title)
      if (track.artist) this.suggestionPool.push(track.artist)
    }
    // Deduplicate and cap, newest first.
    this.suggestionPool = [...new Set(this.suggestionPool.reverse())]
      .slice(0, NativeSearchEngine.SUGGESTION_POOL_MAX)
  }

  public suggest(rawQuery: string, limit = 6): string[] {
    const norm = normalizeQuery(rawQuery)
    if (!norm) return []

    const out = new Set<string>()
    for (const candidate of this.suggestionPool) {
      const n = normalizeQuery(candidate)
      if (n.startsWith(norm) || n.includes(norm)) out.add(candidate)
      if (out.size >= limit) break
    }

    if (out.size < limit) {
      for (const playlist of this.playlists) {
        if (normalizeQuery(playlist.name).includes(norm)) out.add(playlist.name)
        if (out.size >= limit) break
      }
    }

    return [...out].slice(0, limit)
  }
}
