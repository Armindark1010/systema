// ============================================================
// SYSTEMA — Native music library mapping tests
// ============================================================
// Exercises the pure logic of the native library service: identity
// derivation, unit conversion, null handling and album/artist
// grouping. Run with: npx tsx scripts/test-music-library.ts
//
// The Capacitor-dependent parts are stubbed, mirroring the browser
// path where no native plugin exists.
// ============================================================

import assert from 'node:assert/strict'

// The real @capacitor/core is imported here on purpose: running it
// under Node exercises exactly the browser fallback path, where
// isNativePlatform() is false and convertFileSrc() passes through.

const {
  toUiTrack,
  toUiAlbums,
  toUiArtists,
  artistIdFor,
  albumIdFor,
  toLibraryError,
  isNativeLibraryAvailable,
} = await import('../app/services/native/musicLibraryService')

type NativeTrack = Parameters<typeof toUiTrack>[0]

function makeTrack(overrides: Partial<NativeTrack> = {}): NativeTrack {
  return {
    id: 'ms:external_primary:1',
    mediaStoreId: 1,
    volumeName: 'external_primary',
    uri: 'content://media/external/audio/media/1',
    title: 'Structure & Rhythm',
    artist: 'Systema Ensemble',
    album: 'Blueprint',
    albumArtist: 'Systema Ensemble',
    duration: 232_000,
    trackNumber: 1,
    discNumber: 1,
    genre: 'Electronic',
    year: 2025,
    mimeType: 'audio/mpeg',
    fileSize: 8_100_000,
    dateAdded: 1_700_000_000,
    dateModified: 1_700_000_000,
    artworkUri: 'content://media/external/audio/albumart/42',
    albumId: 42,
    ...overrides,
  }
}

console.log('--- SYSTEMA NATIVE MUSIC LIBRARY TESTS ---')

// 1. Web fallback detection
console.log('Testing browser fallback...')
assert.equal(isNativeLibraryAvailable(), false, 'must report unavailable on web')
console.log('✓ browser reports no native library')

// 2. Duration conversion: native ms -> UI seconds
console.log('Testing duration conversion...')
{
  const ui = toUiTrack(makeTrack({ duration: 232_000 }))
  assert.equal(ui.duration, 232, 'ms must be converted to seconds')
  assert.equal(toUiTrack(makeTrack({ duration: 0 })).duration, 0)
  assert.equal(toUiTrack(makeTrack({ duration: 1_500 })).duration, 2, 'rounds to nearest second')
}
console.log('✓ milliseconds converted to seconds')

// 3. Stable identity
console.log('Testing stable identity...')
{
  const a = toUiTrack(makeTrack())
  const b = toUiTrack(makeTrack())
  assert.equal(a.id, b.id, 'same MediaStore row must yield the same id')
  assert.equal(a.id, 'ms:external_primary:1')

  // Same media id on a different volume must NOT collide.
  const sd = toUiTrack(makeTrack({ id: 'ms:sdcard:1', volumeName: 'sdcard' }))
  assert.notEqual(a.id, sd.id, 'volume must participate in identity')

  // Artist / album ids are derived and deterministic.
  assert.equal(artistIdFor('Systema Ensemble'), artistIdFor('systema ensemble'))
  assert.equal(albumIdFor('Blueprint', 'Systema Ensemble'), albumIdFor('blueprint', 'Systema Ensemble'))
  assert.notEqual(albumIdFor('Blueprint', 'A'), albumIdFor('Blueprint', 'B'), 'same album title by different artists must differ')
}
console.log('✓ ids are stable and collision-safe')

// 4. Missing metadata must not fabricate values in a harmful way
console.log('Testing missing metadata...')
{
  const bare = toUiTrack(makeTrack({
    artist: null,
    album: null,
    albumArtist: null,
    genre: null,
    year: null,
    trackNumber: null,
    discNumber: null,
    mimeType: null,
    artworkUri: null,
    albumId: null,
  }))
  assert.equal(bare.artist, 'Unknown Artist', 'UI fallback label, not stored metadata')
  assert.equal(bare.album, 'Unknown Album')
  assert.equal(bare.year, 0)
  assert.equal(bare.artwork, undefined, 'missing artwork must be undefined, not a placeholder path')
  assert.equal(bare.energy, 0, 'no analysis has run, so energy is neutral')
  assert.equal(bare.plays, 0)
  assert.equal(bare.favorite, false)
  assert.ok(bare.artistId.startsWith('na:'))
}
console.log('✓ absent metadata degrades safely')

// 5. Artwork is a URI reference, never Base64 or raw bytes
console.log('Testing artwork strategy...')
{
  const ui = toUiTrack(makeTrack())
  assert.ok(ui.artwork, 'artwork src expected')
  assert.ok(!ui.artwork!.startsWith('data:'), 'artwork must never be Base64')
  assert.ok(ui.artwork!.length < 256, 'artwork must be a short reference, not embedded image data')
  // Off-device, convertFileSrc() is the identity function; inside the
  // Android WebView the same call rewrites it to a loadable
  // /_capacitor_content_ URL. Either way nothing is decoded here.
  assert.ok(
    ui.artwork!.includes('albumart'),
    'artwork must still point at the MediaStore album-art entry',
  )
  assert.equal(toUiTrack(makeTrack({ artworkUri: null })).artwork, undefined)
}
console.log('✓ artwork is a lazy URI reference')

// 6. Album / artist grouping over a page
console.log('Testing album and artist grouping...')
{
  const page = [
    makeTrack({ id: 'ms:v:1', mediaStoreId: 1 }),
    makeTrack({ id: 'ms:v:2', mediaStoreId: 2, title: 'Signal Grid' }),
    makeTrack({ id: 'ms:v:3', mediaStoreId: 3, title: 'Nightcall', artist: 'Kavinsky', albumArtist: 'Kavinsky', album: 'OutRun' }),
  ]
  const albums = toUiAlbums(page)
  const artists = toUiArtists(page)
  assert.equal(albums.length, 2, 'two distinct albums')
  assert.equal(artists.length, 2, 'two distinct artists')
  assert.equal(new Set(albums.map(a => a.id)).size, albums.length, 'album ids unique')
  assert.equal(new Set(artists.map(a => a.id)).size, artists.length, 'artist ids unique')

  // Grouping must reference the same artist id the tracks use.
  const nightcall = toUiTrack(page[2]!)
  assert.ok(artists.some(a => a.id === nightcall.artistId), 'artist id must resolve')
  assert.ok(albums.some(a => a.id === nightcall.albumId), 'album id must resolve')
}
console.log('✓ page grouping is consistent and duplicate-free')

// 7. Structured errors
console.log('Testing structured errors...')
{
  assert.equal(toLibraryError({ code: 'PERMISSION_DENIED', message: 'nope' }).code, 'PERMISSION_DENIED')
  assert.equal(toLibraryError({ code: 'SOMETHING_ELSE', message: 'x' }).code, 'UNKNOWN', 'unknown codes normalise')
  assert.equal(toLibraryError(undefined).code, 'UNKNOWN')
  assert.ok(toLibraryError(new Error('boom')).message.length > 0, 'always has a message')
}
console.log('✓ errors normalise to a stable shape')

// 8. addedAt must be a sortable ISO string (UI sorts on it)
console.log('Testing addedAt formatting...')
{
  const older = toUiTrack(makeTrack({ dateAdded: 1_600_000_000 }))
  const newer = toUiTrack(makeTrack({ dateAdded: 1_700_000_000 }))
  assert.ok(newer.addedAt.localeCompare(older.addedAt) > 0, 'ISO strings must sort chronologically')
  assert.ok(!Number.isNaN(Date.parse(newer.addedAt)), 'must be a valid date')
}
console.log('✓ addedAt is a sortable ISO timestamp')

console.log('--- ALL NATIVE MUSIC LIBRARY TESTS PASSED! ---')
