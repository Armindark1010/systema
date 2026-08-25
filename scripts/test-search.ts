// ============================================================
// SYSTEMA Search Engine Verification Test Suite
// ============================================================

import assert from 'node:assert'
import {
  normalizePersian,
  normalizeQuery,
  levenshtein,
  fuzzyScore,
  detectLanguage,
} from '../app/services/search/normalization.js'
import { LocalSearchEngine } from '../app/services/search/localSearch.js'
import type { Track, Album, Artist, Playlist } from '../app/types/index.js'

console.log('--- SYSTEMA SEARCH TEST SUITE STARTING ---')

// -------------------------------------------------------------
// 1. Normalization Tests
// -------------------------------------------------------------
console.log('Testing Normalization...')

// Persian/Arabic yeh & kaf
assert.strictEqual(normalizePersian('موسيقى'), 'موسیقی')
assert.strictEqual(normalizePersian('كتاب'), 'کتاب')

// Arabic diacritics removal
assert.strictEqual(normalizePersian('مُوسِیقِی'), 'موسیقی')

// Teh Marbuta & Heh with Yeh
assert.strictEqual(normalizePersian('خانۀ دل'), 'خانه دل')

// Query normalization: lowercase, collapse spaces, punctuation, alef with madda to alef
assert.strictEqual(normalizeQuery('  Synth-Wave!   Classic?  '), 'synth wave classic')
assert.strictEqual(normalizeQuery('موسیقیِ آرام...'), 'موسیقی ارام')

// Language detection
assert.strictEqual(detectLanguage('hello world'), 'en')
assert.strictEqual(detectLanguage('موسیقی شبانه'), 'fa')
assert.strictEqual(detectLanguage('chill شبانه'), 'mixed')

console.log('✓ Normalization tests passed')

// -------------------------------------------------------------
// 2. Levenshtein & Fuzzy Scoring Tests
// -------------------------------------------------------------
console.log('Testing Fuzzy Scoring...')

assert.strictEqual(levenshtein('kitten', 'sitting'), 3)
assert.strictEqual(levenshtein('ambient', 'ambiet'), 1)
assert.strictEqual(levenshtein('same', 'same'), 0)

// Exact match score
const exact = fuzzyScore('ambient', 'ambient')
assert(exact === 1.0, `Expected exact match === 1.0, got ${exact}`)

// Prefix match score
const prefix = fuzzyScore('ambi', 'ambient music')
assert(prefix >= 0.85, `Expected prefix match >= 0.85, got ${prefix}`)

// Typo match score
const typo = fuzzyScore('elctronic', 'electronic')
assert(typo > 0.6, `Expected typo score > 0.6, got ${typo}`)

console.log('✓ Fuzzy scoring tests passed')

// -------------------------------------------------------------
// 3. AI Intent Extraction Tests
// -------------------------------------------------------------
console.log('Testing Intent Extraction...')

const engine = new LocalSearchEngine()

const intent1 = engine.detectIntent('music for deep focus study')
assert(intent1.contexts?.includes('study'))
assert(intent1.moods?.includes('focused'))

const intent2 = engine.detectIntent('calm night drive techno')
assert(intent2.moods?.includes('calm'))
assert(intent2.contexts?.includes('night'))
assert(intent2.genres?.includes('techno'))

const intentPersian = engine.detectIntent('آهنگ آرامش بخش برای خواب')
assert(intentPersian.moods?.includes('calm'))
assert(intentPersian.contexts?.includes('sleep'))

console.log('✓ Intent extraction tests passed')

// -------------------------------------------------------------
// 4. LocalSearchEngine Search Execution Tests
// -------------------------------------------------------------
console.log('Testing LocalSearchEngine against Mock Catalog...')

const sampleTracks: Track[] = [
  {
    id: 't-01',
    title: 'Midnight Horizon',
    artist: 'Aura',
    artistId: 'ar-01',
    albumId: 'al-01',
    genreId: 'ambient',
    duration: 240,
    year: 2024,
    energy: 25,
    mood: 'calm',
    lang: 'en',
    plays: 1200,
    favorite: true,
    addedAt: '2025-01-01',
    ai: {
      analyzed: true,
      mood: ['calm', 'night', 'chill'],
      genres: ['ambient'],
      energy: 0.25,
      bpm: 90,
      language: 'en',
      themes: ['night', 'relaxation'],
      confidence: 0.95,
    },
  },
  {
    id: 't-02',
    title: 'Neon Pulse',
    artist: 'Cyberwave',
    artistId: 'ar-02',
    albumId: 'al-02',
    genreId: 'electronic',
    duration: 210,
    year: 2025,
    energy: 90,
    mood: 'energetic',
    lang: 'en',
    plays: 3500,
    favorite: false,
    addedAt: '2025-02-01',
    ai: {
      analyzed: true,
      mood: ['energetic', 'fast'],
      genres: ['electronic', 'synth'],
      energy: 0.9,
      bpm: 128,
      language: 'en',
      themes: ['workout', 'drive'],
      confidence: 0.98,
    },
  },
  {
    id: 't-03',
    title: 'باران شبانه',
    artist: 'حافظ ناظری',
    artistId: 'ar-03',
    albumId: 'al-03',
    genreId: 'traditional',
    duration: 320,
    year: 2023,
    energy: 30,
    mood: 'melancholic',
    lang: 'fa',
    plays: 850,
    favorite: true,
    addedAt: '2025-03-01',
    ai: {
      analyzed: true,
      mood: ['melancholic', 'calm'],
      genres: ['traditional'],
      energy: 0.3,
      bpm: 75,
      language: 'fa',
      themes: ['باران', 'شب', 'آرامش'],
      confidence: 0.92,
    },
  },
]

const sampleAlbums: Album[] = [
  {
    id: 'al-01',
    title: 'Horizon Odyssey',
    artistId: 'ar-01',
    year: 2024,
    cover: '/covers/1.jpg',
    genreId: 'ambient',
  },
  {
    id: 'al-02',
    title: 'Cyber Pulse',
    artistId: 'ar-02',
    year: 2025,
    cover: '/covers/2.jpg',
    genreId: 'electronic',
  },
]

const sampleArtists: Artist[] = [
  { id: 'ar-01', name: 'Aura', origin: 'Berlin', genres: ['ambient'] },
  { id: 'ar-02', name: 'Cyberwave', origin: 'Tokyo', genres: ['electronic'] },
  { id: 'ar-03', name: 'حافظ ناظری', origin: 'Tehran', genres: ['traditional'] },
]

const samplePlaylists: Playlist[] = [
  {
    id: 'pl-01',
    title: 'Late Night Focus',
    description: 'Ambient sounds for deep thought',
    cover: '/covers/p1.jpg',
    trackIds: ['t-01'],
    kind: 'user',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
]

const customEngine = new LocalSearchEngine({
  tracks: sampleTracks,
  albums: sampleAlbums,
  artists: sampleArtists,
  playlists: samplePlaylists,
})

// Exact track search
const res1 = await customEngine.search('Midnight')
assert(res1.tracks.length > 0, 'Should find Midnight Horizon')
assert.strictEqual(res1.tracks[0].item.id, 't-01')

// Typo search ("Midnght" -> "Midnight")
const resTypo = await customEngine.search('Midnght')
assert(resTypo.tracks.length > 0, 'Should find Midnight Horizon via fuzzy match')
assert.strictEqual(resTypo.tracks[0].item.id, 't-01')

// Persian search with Arabic Yeh ("باران شبانه")
const resPersian = await customEngine.search('باران')
assert(resPersian.tracks.length > 0, 'Should find Persian track')
assert.strictEqual(resPersian.tracks[0].item.id, 't-03')

// Arabic yeh normalization search ("حافظ" -> "حافظ ناظری")
const resYeh = await customEngine.search('حافظ')
assert(resYeh.artists.length > 0, 'Should find artist حافظ ناظری')
assert.strictEqual(resYeh.artists[0].item.id, 'ar-03')

// AI Semantic Intent search ("workout music")
const resSemantic = await customEngine.search('workout music')
assert(resSemantic.tracks.length > 0, 'Should find workout track via AI intent')
assert.strictEqual(resSemantic.tracks[0].item.id, 't-02')

console.log('✓ LocalSearchEngine tests passed')

console.log('--- ALL SEARCH ENGINE TESTS PASSED! ---')
