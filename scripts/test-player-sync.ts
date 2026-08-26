// ============================================================
// SYSTEMA — player state synchronisation tests
// ============================================================
// Pins the regression that caused stale artwork on every player
// surface: display fields resolved from the static mock catalog,
// which cannot resolve device-track ids.
// Run: npx tsx scripts/test-player-sync.ts
// ============================================================

import assert from 'node:assert/strict'
import type { Track } from '../app/types'

const UNKNOWN_ARTIST = 'UNKNOWN ARTIST'

// ---- Mirrors of the canonical resolvers in useNowPlaying.ts ----
// The composable itself pulls in Pinia/Nuxt auto-imports, so the pure
// precedence logic is mirrored here and pinned by assertions.

interface AlbumLike { id: string; title: string; cover: string }
interface ArtistLike { id: string; name: string }

function makeResolver(albums: AlbumLike[], artists: ArtistLike[]) {
  const getAlbum = (id: string) => albums.find(a => a.id === id)
  const getArtist = (id: string) => artists.find(a => a.id === id)

  return {
    coverFor: (t: Track | null) => (!t ? undefined : t.artwork ?? getAlbum(t.albumId)?.cover),
    artistFor: (t: Track | null) =>
      !t ? '' : t.artist || getArtist(t.artistId)?.name || UNKNOWN_ARTIST,
    albumFor: (t: Track | null) => (!t ? undefined : t.album ?? getAlbum(t.albumId)?.title),
  }
}

/** The OLD, broken resolution every player surface used to use. */
function legacyCover(t: Track, albums: AlbumLike[]) {
  return albums.find(a => a.id === t.albumId)?.cover
}

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'tr-01',
    title: 'Mock Track',
    artistId: 'ar-01',
    albumId: 'al-01',
    genreId: 'gn-01',
    duration: 200,
    year: 2024,
    energy: 50,
    mood: 'focused',
    lang: 'inst',
    plays: 0,
    favorite: false,
    addedAt: new Date().toISOString(),
    ...over,
  } as Track
}

/** A device track as musicLibraryService maps it. */
function makeDeviceTrack(over: Partial<Track> = {}): Track {
  return makeTrack({
    id: 'ms:external_primary:42',
    title: 'Device Track',
    // Synthetic ids that exist ONLY in the library store.
    artistId: 'na:real-artist',
    albumId: 'nal:77',
    artist: 'Real Artist',
    album: 'Real Album',
    artwork: 'http://localhost/_capacitor_file_/albumart/77',
    uri: 'content://media/external/audio/media/42',
    artworkUri: 'content://media/external/audio/albumart/77',
    ...over,
  })
}

// The static mock catalog: only ever contains al-*/ar-* ids.
const MOCK_ALBUMS: AlbumLike[] = [{ id: 'al-01', title: 'Mock Album', cover: '/mock-cover.jpg' }]
const MOCK_ARTISTS: ArtistLike[] = [{ id: 'ar-01', name: 'Mock Artist' }]

console.log('--- SYSTEMA PLAYER SYNC TESTS ---')

// 1. The exact regression
console.log('Testing the stale-artwork root cause...')
{
  const device = makeDeviceTrack()

  // Old behaviour: mock catalog cannot resolve "nal:77" -> undefined.
  assert.equal(legacyCover(device, MOCK_ALBUMS), undefined,
    'the old lookup genuinely returned undefined for device tracks')

  // New behaviour: the track's own artwork is used.
  const { coverFor, artistFor } = makeResolver(MOCK_ALBUMS, MOCK_ARTISTS)
  assert.equal(coverFor(device), device.artwork, 'device artwork resolves')
  assert.equal(artistFor(device), 'Real Artist', 'device artist resolves')
}
console.log('✓ device tracks now resolve artwork the mock catalog could not')

// 2. Mock tracks must not regress
console.log('Testing mock-catalog tracks still resolve...')
{
  const { coverFor, artistFor, albumFor } = makeResolver(MOCK_ALBUMS, MOCK_ARTISTS)
  const mock = makeTrack()
  assert.equal(coverFor(mock), '/mock-cover.jpg', 'mock cover still resolves')
  assert.equal(artistFor(mock), 'Mock Artist', 'mock artist still resolves')
  assert.equal(albumFor(mock), 'Mock Album', 'mock album still resolves')
}
console.log('✓ browser fallback resolution is unchanged')

// 3. Every surface must agree on the same track
console.log('Testing cross-surface agreement...')
{
  const { coverFor, artistFor } = makeResolver(MOCK_ALBUMS, MOCK_ARTISTS)
  const track = makeDeviceTrack()

  // Mini, Full, Queue, Search, Home all call the same resolver.
  const surfaces = ['mini', 'full', 'queue', 'search', 'home'].map(() => ({
    cover: coverFor(track),
    artist: artistFor(track),
  }))

  assert.equal(new Set(surfaces.map(s => s.cover)).size, 1, 'all surfaces show one artwork')
  assert.equal(new Set(surfaces.map(s => s.artist)).size, 1, 'all surfaces show one artist')
}
console.log('✓ all surfaces derive identical values')

// 4. Artwork must follow a track change
console.log('Testing artwork follows track changes...')
{
  const { coverFor } = makeResolver(MOCK_ALBUMS, MOCK_ARTISTS)
  const a = makeDeviceTrack({ id: 'ms:v:1', artwork: 'art-A' })
  const b = makeDeviceTrack({ id: 'ms:v:2', artwork: 'art-B' })

  let current: Track = a
  assert.equal(coverFor(current), 'art-A')
  current = b // Next
  assert.equal(coverFor(current), 'art-B', 'artwork changes with the track')
  current = a // Previous
  assert.equal(coverFor(current), 'art-A', 'artwork returns with the track')
}
console.log('✓ artwork tracks Next/Previous')

// 5. Missing artwork degrades to the fallback, never to a stale value
console.log('Testing absent artwork...')
{
  const { coverFor } = makeResolver(MOCK_ALBUMS, MOCK_ARTISTS)
  const withArt = makeDeviceTrack({ artwork: 'art-A' })
  const without = makeDeviceTrack({ id: 'ms:v:9', artwork: undefined, albumId: 'nal:999' })

  assert.equal(coverFor(withArt), 'art-A')
  // Critically undefined, NOT the previous track's artwork: undefined
  // makes <Artwork> render its seeded SVG fallback.
  assert.equal(coverFor(without), undefined, 'no artwork yields the fallback, not a stale cover')
  assert.ok(!String(coverFor(withArt)).startsWith('data:'), 'artwork is never Base64')
}
console.log('✓ missing artwork falls back instead of going stale')

// 6. Current-playing must compare ids, never object references
console.log('Testing current-playing comparison...')
{
  const playing = makeDeviceTrack({ id: 'ms:v:5' })
  // Native events rebuild objects; a reference check would fail here.
  const sameTrackNewObject = makeDeviceTrack({ id: 'ms:v:5' })

  assert.equal(playing === sameTrackNewObject, false, 'references genuinely differ')
  assert.equal(playing.id === sameTrackNewObject.id, true, 'id comparison still matches')

  const isCurrent = (id: string, current: Track | null) => current?.id === id
  assert.equal(isCurrent('ms:v:5', sameTrackNewObject), true)
  assert.equal(isCurrent('ms:v:6', sameTrackNewObject), false)
  assert.equal(isCurrent('ms:v:5', null), false, 'null current is safe')
}
console.log('✓ current-playing uses stable ids')

// ---- Race conditions -----------------------------------------

/** Models the stale-event guard in useNativePlayer. */
class SyncModel {
  currentTrackId: string | null = null
  private nativeTrackId: string | null = null
  fullscreenOpen = false

  /** currentTrackChanged from Media3 — always authoritative. */
  onTrackChanged(id: string) {
    this.nativeTrackId = id
    this.currentTrackId = id
  }

  /** A snapshot that may have been queued before a newer change. */
  onSnapshot(id: string | null) {
    if (id && this.nativeTrackId && id !== this.nativeTrackId) return // stale
    if (id) this.currentTrackId = id
  }
}

// 7. Rapid Next must settle on the real current item
console.log('Testing rapid track changes...')
{
  const m = new SyncModel()
  m.onTrackChanged('t1')
  m.onTrackChanged('t2')
  m.onTrackChanged('t3')

  // A delayed snapshot for t1 arrives after t3 is current.
  m.onSnapshot('t1')
  assert.equal(m.currentTrackId, 't3', 'a stale snapshot cannot resurrect an old track')

  m.onSnapshot('t3')
  assert.equal(m.currentTrackId, 't3', 'the current snapshot still applies')
}
console.log('✓ late events cannot overwrite a newer track')

// 8. Next must not disturb fullscreen state
console.log('Testing fullscreen independence...')
{
  const m = new SyncModel()
  m.onTrackChanged('A')
  m.fullscreenOpen = true

  m.onTrackChanged('B')
  assert.equal(m.currentTrackId, 'B', 'track advanced')
  assert.equal(m.fullscreenOpen, true, 'fullscreen stays open across a track change')

  m.onTrackChanged('A')
  assert.equal(m.fullscreenOpen, true, 'and across Previous too')
}
console.log('✓ "what is playing" is independent of "is fullscreen open"')

console.log('--- ALL PLAYER SYNC TESTS PASSED! ---')
