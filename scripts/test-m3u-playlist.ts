// ============================================================
// SYSTEMA — M3U Playlist Export & Import Test Suite
// ============================================================

import assert from 'node:assert'
import { exportPlaylistToM3U, parseM3U, matchM3UEntries } from '../app/services/playlists/m3u.ts'
import type { Playlist, Track } from '../app/types/index.ts'

console.log('--- TEST: M3U Playlist Export & Import ---')

const mockTracks: Track[] = [
  {
    id: 'tr-01',
    title: 'Nightcall',
    artist: 'Kavinsky',
    artistId: 'ar-kavinsky',
    albumId: 'al-01',
    genreId: 'g-synthwave',
    duration: 240,
    year: 2011,
    energy: 70,
    mood: 'dark',
    lang: 'en',
    plays: 100,
    favorite: true,
    addedAt: '2025-01-01T00:00:00Z',
    uri: 'content://media/external/audio/media/101',
  },
  {
    id: 'tr-02',
    title: 'Midnight City',
    artist: 'M83',
    artistId: 'ar-m83',
    albumId: 'al-02',
    genreId: 'g-synthwave',
    duration: 243,
    year: 2011,
    energy: 85,
    mood: 'energetic',
    lang: 'en',
    plays: 120,
    favorite: false,
    addedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'tr-03',
    title: 'Havaye Gham',
    artist: 'Moein',
    artistId: 'ar-moein',
    albumId: 'al-03',
    genreId: 'g-persian',
    duration: 284,
    year: 1992,
    energy: 60,
    mood: 'melancholic',
    lang: 'fa',
    plays: 50,
    favorite: true,
    addedAt: '2025-01-01T00:00:00Z',
  },
]

const mockPlaylist: Playlist = {
  id: 'pl-synth-mix',
  title: 'SYNTH & PERSIAN RETRO',
  description: 'A test mix of 80s synth and classic Persian music',
  kind: 'user',
  trackIds: ['tr-01', 'tr-02', 'tr-03'],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

// 1. Test Export to M3U
console.log('1. Testing M3U Export...')
const exportedM3U = exportPlaylistToM3U(mockPlaylist, mockTracks)
assert.ok(exportedM3U.startsWith('#EXTM3U'), 'Must start with #EXTM3U directive')
assert.ok(exportedM3U.includes('#PLAYLIST:SYNTH & PERSIAN RETRO'), 'Must include #PLAYLIST title directive')
assert.ok(exportedM3U.includes('#EXTINF:240,Kavinsky - Nightcall'), 'Must format #EXTINF with duration and Artist - Title')
assert.ok(exportedM3U.includes('content://media/external/audio/media/101'), 'Must include track URI if available')
assert.ok(exportedM3U.includes('M83 - Midnight City.mp3'), 'Must include fallback filename if no URI')
console.log('✔ M3U Export passed')

// 2. Test Parsing M3U
console.log('2. Testing M3U Parser...')
const parsed = parseM3U(exportedM3U)
assert.strictEqual(parsed.title, 'SYNTH & PERSIAN RETRO', 'Must extract playlist title')
assert.strictEqual(parsed.entries.length, 3, 'Must parse 3 entries')
assert.strictEqual(parsed.entries[0].title, 'Nightcall', 'First entry title must match')
assert.strictEqual(parsed.entries[0].artist, 'Kavinsky', 'First entry artist must match')
assert.strictEqual(parsed.entries[0].duration, 240, 'First entry duration must match')
assert.strictEqual(parsed.entries[0].uri, 'content://media/external/audio/media/101', 'First entry uri must match')
console.log('✔ M3U Parser passed')

// 3. Test Matching M3U Entries
console.log('3. Testing M3U Entry Matching against Catalog...')
const matched = matchM3UEntries(parsed.entries, mockTracks)
assert.strictEqual(matched.length, 3)
assert.strictEqual(matched[0].status, 'matched')
assert.strictEqual(matched[0].matchedTrackId, 'tr-01')
assert.strictEqual(matched[1].status, 'matched')
assert.strictEqual(matched[1].matchedTrackId, 'tr-02')
assert.strictEqual(matched[2].status, 'matched')
assert.strictEqual(matched[2].matchedTrackId, 'tr-03')
console.log('✔ Track matching passed')

// 4. Test Missing Track Handling
console.log('4. Testing Missing Track Parsing & Matching...')
const mixedM3U = `#EXTM3U
#PLAYLIST:Mixed Test
#EXTINF:200,Random Artist - NonExistent Song
random.mp3
#EXTINF:243,M83 - Midnight City
m83.mp3
`
const parsedMixed = parseM3U(mixedM3U)
const matchedMixed = matchM3UEntries(parsedMixed.entries, mockTracks)
assert.strictEqual(matchedMixed.length, 2)
assert.strictEqual(matchedMixed[0].status, 'missing')
assert.strictEqual(matchedMixed[0].matchedTrackId, undefined)
assert.strictEqual(matchedMixed[1].status, 'matched')
assert.strictEqual(matchedMixed[1].matchedTrackId, 'tr-02')
console.log('✔ Missing track detection passed')

console.log('\n--- ALL M3U TESTS PASSED! ---')
