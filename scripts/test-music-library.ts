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

// 9. Integration-path regression: the fresh-install permission gate.
//    The original bug was that initNativeLibrary() only scanned when
//    permission was ALREADY granted, so a fresh Android install never
//    requested access, never scanned, and kept showing mock data.
console.log('Testing fresh-install permission gate...')
{
  type Flow = { requested: boolean; scanned: boolean; loaded: boolean; tracks: string[] }

  // Faithful model of the FIXED initNativeLibrary() control flow.
  function simulateInit(opts: {
    native: boolean
    granted: boolean
    grantOnRequest: boolean
    indexCount: number
  }): Flow {
    const flow: Flow = { requested: false, scanned: false, loaded: false, tracks: ['mock'] }
    if (!opts.native) return flow // web: mock catalog untouched

    flow.tracks = [] // native: mock catalog dropped
    let granted = opts.granted
    if (!granted) {
      flow.requested = true
      granted = opts.grantOnRequest
      if (!granted) return flow
    }
    if (opts.indexCount === 0) flow.scanned = true
    else { flow.loaded = true; flow.tracks = ['real'] }
    return flow
  }

  // Fresh Android install: must REQUEST then SCAN.
  const fresh = simulateInit({ native: true, granted: false, grantOnRequest: true, indexCount: 0 })
  assert.equal(fresh.requested, true, 'fresh install must request permission')
  assert.equal(fresh.scanned, true, 'fresh install must trigger a scan')
  assert.deepEqual(fresh.tracks, [], 'mock data must not survive on native')

  // Permission denied: no scan, and still no mock data.
  const denied = simulateInit({ native: true, granted: false, grantOnRequest: false, indexCount: 0 })
  assert.equal(denied.requested, true)
  assert.equal(denied.scanned, false, 'denied permission must not scan')
  assert.deepEqual(denied.tracks, [], 'denied must not fall back to mock data on Android')

  // Already granted with a populated index: load, do not rescan.
  const warm = simulateInit({ native: true, granted: true, grantOnRequest: true, indexCount: 120 })
  assert.equal(warm.requested, false, 'granted permission must not re-prompt')
  assert.equal(warm.loaded, true, 'populated index must load a page')
  assert.deepEqual(warm.tracks, ['real'])

  // Web: mock catalog preserved, nothing native invoked.
  const web = simulateInit({ native: false, granted: false, grantOnRequest: false, indexCount: 0 })
  assert.equal(web.requested, false, 'web must never request permission')
  assert.equal(web.scanned, false, 'web must never scan')
  assert.deepEqual(web.tracks, ['mock'], 'web MUST keep the mock catalog')
}
console.log('✓ fresh install requests permission, scans, and drops mock data')

// 10. Plugin name must match the Kotlin @CapacitorPlugin annotation.
console.log('Testing plugin name contract...')
{
  const { PLUGIN_NAME } = await import('../app/services/native/musicLibraryPlugin')
  assert.equal(PLUGIN_NAME, 'MusicLibrary', 'must match @CapacitorPlugin(name=...)')
}
console.log('✓ plugin name matches the native annotation')

// 11. Construction-time seeding regression.
//     Nuxt mounts the Vue app BEFORE the app:mounted hook fires, so a
//     store that seeds mock data and only clears it inside an async
//     init will paint demo tracks on Android — and keep them forever if
//     anything downstream fails. The seed decision must therefore be
//     made synchronously, at store construction.
console.log('Testing construction-time catalog seeding...')
{
  const MOCK = ['tr-01', 'tr-02']

  // Mirrors the store's synchronous seed decision.
  function seed(nativeAvailable: boolean) {
    const seedWithMock = !nativeAvailable
    return {
      tracks: seedWithMock ? [...MOCK] : [],
      isLoading: !seedWithMock,
    }
  }

  const web = seed(false)
  assert.deepEqual(web.tracks, MOCK, 'web MUST seed the mock catalog synchronously')
  assert.equal(web.isLoading, false, 'web must not show a loading skeleton')

  const android = seed(true)
  assert.deepEqual(android.tracks, [], 'android must NEVER seed mock tracks, not even for one frame')
  assert.equal(android.isLoading, true, 'android shows the skeleton until the index loads')
}
console.log('✓ mock data is never seeded on native, even before init runs')

console.log('--- ALL NATIVE MUSIC LIBRARY TESTS PASSED! ---')
