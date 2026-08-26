// ============================================================
// SYSTEMA — Phase 4.1: search over the real library
// ============================================================
// The bug:
//
//   The search store constructed `new LocalSearchEngine()` with no
//   arguments, and that constructor falls back to the bundled demo
//   catalog. On Android nothing ever supplied device data, so
//   searching a phone full of the user's own music returned mock
//   songs — and could return nothing else.
//
// The fix routes Android through NativeSearchEngine, which queries the
// Room index over the existing bridge instead of holding a copy of the
// library. These tests drive the real engine with a stubbed bridge, so
// they verify the actual shipping ranking and result shape.
//
// Covers §8: browser fallback intact; Android uses real library data;
// exact title / artist / album; partial; case differences; empty
// query; no results; and mock data NOT returned on Android.
// ============================================================

import type { Track, Album, Artist } from '../app/types'

// ---- Bridge stub (must precede the engine import) ------------
// NativeSearchEngine calls getTracksPage(). Rather than a device, it
// gets a tiny in-memory table that behaves like the DAO: substring
// match across title/artist/album, then LIMIT.

const deviceRows: Array<{ id: string, title: string, artist: string, album: string }> = [
  { id: 'device:1', title: 'Midnight Protocol', artist: 'Kavinsky', album: 'Outrun' },
  { id: 'device:2', title: 'Neon Skyline', artist: 'Kavinsky', album: 'Outrun' },
  { id: 'device:3', title: 'Tehran Nights', artist: 'Sohrab MJ', album: 'Shahr' },
  { id: 'device:4', title: 'Quiet Structure', artist: 'Rival Consoles', album: 'Persona' },
  { id: 'device:5', title: '100% Real', artist: 'Test Artist', album: 'Escapes' },
]

let bridgeCalls = 0
let lastOptions: Record<string, unknown> | null = null

function toTrack(row: typeof deviceRows[number]): Track {
  return {
    id: row.id,
    title: row.title,
    artistId: `artist:${row.artist}`,
    albumId: `album:${row.album}`,
    genreId: 'g1',
    duration: 200,
    year: 2024,
    energy: 50,
    mood: 'calm',
    lang: 'en',
    plays: 0,
    favorite: false,
    addedAt: '2024-01-01',
    artist: row.artist,
    album: row.album,
    uri: `content://media/external/audio/media/${row.id}`,
  }
}

const mockService = {
  async getTracksPage(options: { query?: string, limit?: number, offset?: number }) {
    bridgeCalls++
    lastOptions = options as Record<string, unknown>

    const q = (options.query ?? '').trim().toLowerCase()
    // Mirrors the DAO's LIKE across the three indexed columns.
    const matched = q
      ? deviceRows.filter(r =>
          r.title.toLowerCase().includes(q)
          || r.artist.toLowerCase().includes(q)
          || r.album.toLowerCase().includes(q))
      : deviceRows

    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const page = matched.slice(offset, offset + limit)
    const tracks = page.map(toTrack)

    const albums = new Map<string, Album>()
    const artists = new Map<string, Artist>()
    for (const row of page) {
      albums.set(`album:${row.album}`, {
        id: `album:${row.album}`,
        title: row.album,
        artistId: `artist:${row.artist}`,
        year: 2024,
        genreId: 'g1',
        cover: '',
      })
      artists.set(`artist:${row.artist}`, {
        id: `artist:${row.artist}`,
        name: row.artist,
        origin: '',
        genres: [],
      })
    }

    return {
      tracks,
      albums: [...albums.values()],
      artists: [...artists.values()],
      total: matched.length,
      offset,
      limit,
      hasMore: offset + page.length < matched.length,
    }
  },
}

import { NativeSearchEngine } from '../app/services/search/nativeSearchEngine.js'
import { LocalSearchEngine } from '../app/services/search/localSearch.js'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
  }
}

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(name, a === b)
  if (a !== b) {
    console.log(`      expected ${b}`)
    console.log(`      actual   ${a}`)
  }
}

console.log('\n\x1b[1mSYSTEMA — search over the real library\x1b[0m\n')

const local = new LocalSearchEngine()
// The stub stands in for the Capacitor bridge, so these tests exercise
// the real ranking and result shape without a device.
const native = new NativeSearchEngine(local, mockService.getTracksPage)

// ============================================================
console.log('Browser fallback (LocalSearchEngine) is untouched')
// ============================================================

const browserResult = local.searchSync('midnight', { limit: 40, fuzzy: true })
ok('browser search still returns results from the demo catalog', browserResult.tracks.length > 0)
ok('browser engine remains synchronous', typeof local.searchSync === 'function')
check('empty query returns nothing (browser)', local.searchSync('', {}).totalCount, 0)

// ============================================================
console.log('\nAndroid uses REAL library data')
// ============================================================

bridgeCalls = 0
const exactTitle = await native.search('Midnight Protocol', { limit: 40, fuzzy: true })
check('exact title match found', exactTitle.tracks[0]?.item.title, 'Midnight Protocol')
check('exact title scores 1.0', exactTitle.tracks[0]?.score, 1)
check('matched on title', exactTitle.tracks[0]?.matchedField, 'title')
ok('result is a device track', exactTitle.tracks[0]?.item.id.startsWith('device:') === true)
check('one bridge call per search', bridgeCalls, 1)

// Pagination and sorting are the DAO's job and must be passed through.
ok('limit forwarded to the native query', lastOptions?.limit === 40)
ok('offset forwarded to the native query', lastOptions?.offset === 0)
ok('sort forwarded to the native query', lastOptions?.sort === 'title')
ok('query forwarded to the native query (SQL does the filtering)', lastOptions?.query === 'Midnight Protocol')

const byArtist = await native.search('Kavinsky', { limit: 40 })
check('artist search returns that artist\'s tracks', byArtist.tracks.length, 2)
ok('artist match reported as artist field',
  byArtist.tracks.every(t => t.matchedField === 'artist'))
ok('artist entity returned', byArtist.artists.some(a => a.item.name === 'Kavinsky'))

const byAlbum = await native.search('Outrun', { limit: 40 })
ok('album search returns the album', byAlbum.albums.some(a => a.item.title === 'Outrun'))
ok('album search returns its tracks', byAlbum.tracks.length === 2)

const partial = await native.search('Teh', { limit: 40 })
check('partial query matches', partial.tracks[0]?.item.title, 'Tehran Nights')

const upper = await native.search('NEON', { limit: 40 })
const lower = await native.search('neon', { limit: 40 })
check('case difference does not change the result',
  upper.tracks.map(t => t.item.id), lower.tracks.map(t => t.item.id))
check('case-insensitive match found', upper.tracks[0]?.item.title, 'Neon Skyline')

bridgeCalls = 0
const empty = await native.search('   ', { limit: 40 })
check('empty query returns no results', empty.totalCount, 0)
check('empty query does not hit the bridge', bridgeCalls, 0)

const none = await native.search('zzzzzzzz-not-a-song', { limit: 40 })
check('no matches -> empty result set', none.tracks.length, 0)
check('no matches -> hasResults false', none.hasResults, false)

// A literal % must be searched for, not treated as a wildcard. The
// escaping itself lives in MusicLibraryRepository; what matters here
// is that the raw term reaches it untouched.
const literal = await native.search('100%', { limit: 40 })
ok('wildcard characters are passed through verbatim for native escaping',
  lastOptions?.query === '100%')
ok('literal % query still matches its track',
  literal.tracks.some(t => t.item.title === '100% Real'))

// ============================================================
console.log('\nMock catalog data is NOT returned on Android')
// ============================================================
// The regression test for the actual bug. These terms exist only in
// the bundled demo catalog, never on the stub device.

const mockCatalog = new LocalSearchEngine()
const mockOnlyTerms = ['ambient architecture', 'synth', 'structure']

for (const term of mockOnlyTerms) {
  const fromMock = mockCatalog.searchSync(term, { limit: 40, fuzzy: true })
  const fromNative = await native.search(term, { limit: 40, fuzzy: true })

  const mockIds = new Set(fromMock.tracks.map(t => t.item.id))
  const leaked = fromNative.tracks.filter(t => mockIds.has(t.item.id))

  ok(`"${term}": no demo-catalog track leaks into native results`, leaked.length === 0)
  ok(`"${term}": every native result is a device track`,
    fromNative.tracks.every(t => t.item.id.startsWith('device:')))
}

// And the positive half: a term that exists ONLY on the device must be
// findable, which the old mock-only engine could never do.
const deviceOnly = await native.search('Sohrab MJ', { limit: 40 })
ok('a device-only artist is findable on Android', deviceOnly.tracks.length === 1)
check('device-only track resolved', deviceOnly.tracks[0]?.item.title, 'Tehran Nights')

const mockSameTerm = mockCatalog.searchSync('Sohrab MJ', { limit: 40, fuzzy: false })
ok('the demo catalog genuinely lacks that artist (control)',
  mockSameTerm.tracks.every(t => t.item.title !== 'Tehran Nights'))

// ============================================================
console.log('\nNo duplicate library copy')
// ============================================================
// §5/§9: the engine must not accumulate the library in memory.

const engineFields = Object.keys(native as unknown as Record<string, unknown>)
ok('engine holds no track array', !engineFields.includes('tracks'))
ok('engine holds no album array', !engineFields.includes('albums'))
ok('engine holds no artist array', !engineFields.includes('artists'))

bridgeCalls = 0
await native.search('Kavinsky', { limit: 40 })
await native.search('Kavinsky', { limit: 40 })
check('each search is exactly one bridge call (no full-library scans)', bridgeCalls, 2)

// ============================================================
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`)
if (failed > 0) process.exit(1)
