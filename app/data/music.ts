// ============================================================
// SYSTEMA — Mock music catalog
// ============================================================
// Realistic mock data standing in for the future native
// MediaStore / Room layer. The UI never depends on this file
// directly — it consumes composables (useMusicLibrary).
// ============================================================

import type { Album, Artist, Genre, Track } from '~/types'

// ------------------------------------------------------------
// GENRES
// ------------------------------------------------------------
export const genres: Genre[] = [
  { id: 'g-electronic', name: 'Electronic' },
  { id: 'g-synthwave', name: 'Synthwave' },
  { id: 'g-darksynth', name: 'Dark Synth' },
  { id: 'g-ambient', name: 'Ambient' },
  { id: 'g-neoclassical', name: 'Neoclassical' },
  { id: 'g-techno', name: 'Techno' },
  { id: 'g-score', name: 'Soundtrack' },
  { id: 'g-persian', name: 'Persian', nameFa: 'فارسی' },
]

// ------------------------------------------------------------
// ARTISTS
// ------------------------------------------------------------
export const artists: Artist[] = [
  { id: 'a-sys', name: 'Systema Ensemble', origin: 'IN-HOUSE', genres: ['g-electronic'] },
  { id: 'a-kavinsky', name: 'Kavinsky', origin: 'FRANCE', genres: ['g-synthwave'] },
  { id: 'a-daftpunk', name: 'Daft Punk', origin: 'FRANCE', genres: ['g-electronic', 'g-techno'] },
  { id: 'a-m83', name: 'M83', origin: 'FRANCE', genres: ['g-synthwave', 'g-electronic'] },
  { id: 'a-midnight', name: 'The Midnight', origin: 'USA', genres: ['g-synthwave'] },
  { id: 'a-chromatics', name: 'Chromatics', origin: 'USA', genres: ['g-synthwave'] },
  { id: 'a-carpenter', name: 'Carpenter Brut', origin: 'FRANCE', genres: ['g-darksynth'] },
  { id: 'a-perturbator', name: 'Perturbator', origin: 'FRANCE', genres: ['g-darksynth'] },
  { id: 'a-vangelis', name: 'Vangelis', origin: 'GREECE', genres: ['g-score'] },
  { id: 'a-richter', name: 'Max Richter', origin: 'GERMANY', genres: ['g-neoclassical'] },
  { id: 'a-hopkins', name: 'Jon Hopkins', origin: 'UK', genres: ['g-techno', 'g-ambient'] },
  { id: 'a-moein', name: 'Moein', origin: 'IRAN', genres: ['g-persian'] },
  { id: 'a-ebi', name: 'Ebi', origin: 'IRAN', genres: ['g-persian'] },
  { id: 'a-googoosh', name: 'Googoosh', origin: 'IRAN', genres: ['g-persian'] },
  { id: 'a-kraftwerk', name: 'Kraftwerk', origin: 'GERMANY', genres: ['g-electronic'] },
  { id: 'a-neworder', name: 'New Order', origin: 'UK', genres: ['g-electronic'] },
  { id: 'a-boc', name: 'Boards of Canada', origin: 'UK', genres: ['g-ambient'] },
  { id: 'a-lorn', name: 'Lorn', origin: 'USA', genres: ['g-darksynth', 'g-ambient'] },
]

// ------------------------------------------------------------
// ALBUMS
// ------------------------------------------------------------
export const albums: Album[] = [
  { id: 'al-blueprint', title: 'Blueprint 01', artistId: 'a-sys', year: 2025, genreId: 'g-electronic', cover: '/art/blueprint-01.jpg' },
  { id: 'al-systema-night', title: 'Night Drive', artistId: 'a-sys', year: 2025, genreId: 'g-electronic', cover: '/art/night-drive.jpg' },
  { id: 'al-systema-echoes', title: 'Architectural Echoes', artistId: 'a-sys', year: 2025, genreId: 'g-electronic', cover: '/art/deep-focus.jpg' },
  { id: 'al-outrun', title: 'OutRun', artistId: 'a-kavinsky', year: 2013, genreId: 'g-synthwave', cover: '/art/outrun.jpg' },
  { id: 'al-ram', title: 'Random Access Memories', artistId: 'a-daftpunk', year: 2013, genreId: 'g-electronic', cover: '/art/random-access-memories.jpg' },
  { id: 'al-huwd', title: "Hurry Up, We're Dreaming", artistId: 'a-m83', year: 2011, genreId: 'g-synthwave', cover: '/art/hurry-up-were-dreaming.jpg' },
  { id: 'al-dot', title: 'Days of Thunder', artistId: 'a-midnight', year: 2014, genreId: 'g-synthwave', cover: '/art/days-of-thunder.jpg' },
  { id: 'al-nd', title: 'Night Drive', artistId: 'a-chromatics', year: 2007, genreId: 'g-synthwave', cover: '/art/night-drive.jpg' },
  { id: 'al-trilogy', title: 'Trilogy', artistId: 'a-carpenter', year: 2015, genreId: 'g-darksynth', cover: '/art/trilogy.jpg' },
  { id: 'al-dd', title: 'Dangerous Days', artistId: 'a-perturbator', year: 2014, genreId: 'g-darksynth', cover: '/art/dangerous-days.jpg' },
  { id: 'al-br', title: 'Blade Runner (OST)', artistId: 'a-vangelis', year: 1982, genreId: 'g-score', cover: '/art/blade-runner-ost.jpg' },
  { id: 'al-tbn', title: 'The Blue Notebooks', artistId: 'a-richter', year: 2004, genreId: 'g-neoclassical', cover: '/art/blue-notebooks.jpg' },
  { id: 'al-immunity', title: 'Immunity', artistId: 'a-hopkins', year: 2013, genreId: 'g-techno', cover: '/art/immunity.jpg' },
  { id: 'al-hg', title: 'Havaye Gham', artistId: 'a-moein', year: 1998, genreId: 'g-persian', cover: '/art/havaye-gham.jpg' },
  { id: 'al-sh', title: 'Shab-e Hojoom', artistId: 'a-ebi', year: 1996, genreId: 'g-persian', cover: '/art/shab-e-hojom.jpg' },
  { id: 'al-tee', title: 'Trans-Europe Express', artistId: 'a-kraftwerk', year: 1977, genreId: 'g-electronic', cover: '/art/trans-europe-express.jpg' },
  { id: 'al-pcl', title: 'Power, Corruption & Lies', artistId: 'a-neworder', year: 1983, genreId: 'g-electronic', cover: '/art/power-corruption-lies.jpg' },
  { id: 'al-boc', title: 'Music Has the Right to Children', artistId: 'a-boc', year: 1998, genreId: 'g-ambient', cover: '/art/boc-children.jpg' },
  { id: 'al-lorn', title: 'Ask the Dust', artistId: 'a-lorn', year: 2012, genreId: 'g-darksynth', cover: '/art/ask-the-dust.jpg' },
  { id: 'al-pole', title: 'Pole', artistId: 'a-googoosh', year: 1977, genreId: 'g-persian', cover: '/art/persian-nights.jpg' },
]

// ------------------------------------------------------------
// TRACKS
// ------------------------------------------------------------
type TrackSeed = [id: string, title: string, artistId: string, albumId: string, genreId: string, duration: number, year: number, energy: number, mood: Track['mood'], lang: Track['lang'], plays: number, favorite: boolean]

const seeds: TrackSeed[] = [
  ['tr-01', 'Structure & Rhythm', 'a-sys', 'al-blueprint', 'g-electronic', 232, 2025, 74, 'focused', 'inst', 1842, true],
  ['tr-02', 'Signal Grid', 'a-sys', 'al-blueprint', 'g-electronic', 252, 2025, 68, 'focused', 'inst', 1210, false],
  ['tr-03', 'Linear Motion', 'a-sys', 'al-blueprint', 'g-electronic', 214, 2025, 81, 'energetic', 'inst', 908, false],
  ['tr-04', 'Nightcall', 'a-kavinsky', 'al-outrun', 'g-synthwave', 258, 2013, 66, 'dark', 'en', 3201, true],
  ['tr-05', 'Odd Look', 'a-kavinsky', 'al-outrun', 'g-synthwave', 245, 2013, 62, 'dark', 'en', 1455, false],
  ['tr-06', 'Contact', 'a-daftpunk', 'al-ram', 'g-electronic', 383, 2013, 88, 'energetic', 'inst', 2301, false],
  ['tr-07', 'Giorgio by Moroder', 'a-daftpunk', 'al-ram', 'g-electronic', 545, 2013, 42, 'calm', 'en', 1890, false],
  ['tr-08', 'Midnight City', 'a-m83', 'al-huwd', 'g-synthwave', 243, 2011, 78, 'dreamy', 'en', 2876, true],
  ['tr-09', 'Wait', 'a-m83', 'al-huwd', 'g-synthwave', 309, 2011, 35, 'melancholic', 'en', 1654, false],
  ['tr-10', 'Days of Thunder', 'a-midnight', 'al-dot', 'g-synthwave', 320, 2014, 72, 'energetic', 'en', 1987, false],
  ['tr-11', 'Vampires', 'a-midnight', 'al-dot', 'g-synthwave', 302, 2014, 58, 'dark', 'en', 1120, false],
  ['tr-12', 'Cherry', 'a-chromatics', 'al-nd', 'g-synthwave', 272, 2007, 55, 'dreamy', 'en', 1530, false],
  ['tr-13', 'Into the Black', 'a-chromatics', 'al-nd', 'g-synthwave', 322, 2007, 51, 'dark', 'en', 986, false],
  ['tr-14', 'Turbo Killer', 'a-carpenter', 'al-trilogy', 'g-darksynth', 218, 2015, 94, 'energetic', 'inst', 2744, true],
  ['tr-15', 'Le Perv', 'a-carpenter', 'al-trilogy', 'g-darksynth', 253, 2015, 90, 'dark', 'inst', 1677, false],
  ['tr-16', 'Dangerous Days', 'a-perturbator', 'al-dd', 'g-darksynth', 280, 2014, 85, 'dark', 'inst', 1498, false],
  ['tr-17', 'Future Club', 'a-perturbator', 'al-dd', 'g-darksynth', 268, 2014, 88, 'energetic', 'inst', 1320, false],
  ['tr-18', 'Blade Runner (End Titles)', 'a-vangelis', 'al-br', 'g-score', 281, 1982, 52, 'melancholic', 'inst', 2105, false],
  ['tr-19', 'Tears in Rain', 'a-vangelis', 'al-br', 'g-score', 173, 1982, 40, 'melancholic', 'inst', 1433, false],
  ['tr-20', 'On the Nature of Daylight', 'a-richter', 'al-tbn', 'g-neoclassical', 371, 2004, 30, 'melancholic', 'inst', 2490, true],
  ['tr-21', 'The Blue Notebooks', 'a-richter', 'al-tbn', 'g-neoclassical', 312, 2004, 28, 'calm', 'inst', 1218, false],
  ['tr-22', 'Open Eye Signal', 'a-hopkins', 'al-immunity', 'g-techno', 468, 2013, 82, 'energetic', 'inst', 1762, false],
  ['tr-23', 'We Disappear', 'a-hopkins', 'al-immunity', 'g-techno', 333, 2013, 60, 'focused', 'inst', 1094, false],
  ['tr-24', 'Havaye Gham', 'a-moein', 'al-hg', 'g-persian', 281, 1998, 38, 'melancholic', 'fa', 3114, true],
  ['tr-25', 'Hamsafar', 'a-moein', 'al-hg', 'g-persian', 254, 1998, 42, 'melancholic', 'fa', 1788, false],
  ['tr-26', 'Shab-e Hojoom', 'a-ebi', 'al-sh', 'g-persian', 302, 1996, 44, 'melancholic', 'fa', 2056, false],
  ['tr-27', 'Gole Sorkh', 'a-ebi', 'al-sh', 'g-persian', 265, 1996, 36, 'melancholic', 'fa', 1420, false],
  ['tr-28', 'Pole', 'a-googoosh', 'al-pole', 'g-persian', 238, 1977, 46, 'dreamy', 'fa', 2333, true],
  ['tr-29', 'Trans-Europe Express', 'a-kraftwerk', 'al-tee', 'g-electronic', 404, 1977, 55, 'focused', 'inst', 1287, false],
  ['tr-30', 'The Robots', 'a-kraftwerk', 'al-tee', 'g-electronic', 371, 1977, 62, 'energetic', 'inst', 1102, false],
  ['tr-31', 'Blue Monday', 'a-neworder', 'al-pcl', 'g-electronic', 449, 1983, 71, 'energetic', 'en', 2567, true],
  ['tr-32', 'Age of Consent', 'a-neworder', 'al-pcl', 'g-electronic', 315, 1983, 60, 'energetic', 'en', 1509, false],
  ['tr-33', 'Roygbiv', 'a-boc', 'al-boc', 'g-ambient', 151, 1998, 45, 'calm', 'inst', 1922, false],
  ['tr-34', 'Aquarius', 'a-boc', 'al-boc', 'g-ambient', 356, 1998, 40, 'dreamy', 'inst', 1344, false],
  ['tr-35', 'Acid Rain', 'a-lorn', 'al-lorn', 'g-darksynth', 247, 2012, 66, 'dark', 'inst', 2180, false],
  ['tr-36', 'Ghosst(s)', 'a-lorn', 'al-lorn', 'g-darksynth', 239, 2012, 58, 'dark', 'inst', 967, false],
  // Dedicated prototype navigation companions for the full player.
  ['tr-37', 'Night Drive', 'a-sys', 'al-systema-night', 'g-electronic', 242, 2025, 69, 'focused', 'inst', 768, false],
  ['tr-38', 'Architectural Echoes', 'a-sys', 'al-systema-echoes', 'g-electronic', 268, 2025, 61, 'dreamy', 'inst', 644, false],
]

function makeLocalAI(seed: TrackSeed, index: number): Track['ai'] {
  // A deterministic local representation of the future analysis payload.
  // A small subset intentionally remains unanalyzed so AI sort paths handle
  // incomplete on-device data without special casing in the UI.
  const analyzed = index % 7 !== 0
  const energy = Math.round((seed[7] / 100) * 100) / 100
  const genre = genres.find(item => item.id === seed[4])?.name.toLowerCase() ?? 'electronic'
  return {
    analyzed,
    mood: [seed[8], energy > 0.7 ? 'energetic' : energy < 0.42 ? 'calm' : 'focused'],
    genres: [genre, energy > 0.7 ? 'electronic' : 'ambient'],
    energy,
    bpm: 86 + ((index * 11 + seed[5]) % 58),
    language: seed[9] === 'inst' ? 'instrumental' : seed[9],
    themes: index % 2 ? ['architecture', 'rhythm'] : ['night', 'motion'],
    confidence: analyzed ? Math.round((0.78 + ((index * 3) % 20) / 100) * 100) / 100 : 0,
  }
}

function buildTracks(): Track[] {
  const added = (i: number) => new Date(Date.UTC(2025, 4 + (i % 9), 1 + ((i * 3) % 27))).toISOString()
  return seeds.map((s, i) => ({
    id: s[0],
    title: s[1],
    artistId: s[2],
    albumId: s[3],
    genreId: s[4],
    duration: s[5],
    year: s[6],
    energy: s[7],
    mood: s[8],
    lang: s[9],
    plays: s[10],
    favorite: s[11],
    addedAt: added(i),
    ai: makeLocalAI(s, i),
  }))
}

export const tracks: Track[] = buildTracks()

// ------------------------------------------------------------
// Lookup helpers
// ------------------------------------------------------------
const albumById = new Map(albums.map((a) => [a.id, a]))
const artistById = new Map(artists.map((a) => [a.id, a]))
const genreById = new Map(genres.map((g) => [g.id, g]))

export function getAlbum(id: string): Album | undefined {
  return albumById.get(id)
}
export function getArtist(id: string): Artist | undefined {
  return artistById.get(id)
}
export function getGenre(id: string): Genre | undefined {
  return genreById.get(id)
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatMs(ms: number): string {
  return formatDuration(ms / 1000)
}

/** albums to continue listening to (mock) */
export function continueListening(): Album[] {
  return [
    getAlbum('al-outrun')!,
    getAlbum('al-blueprint')!,
    getAlbum('al-hg')!,
    getAlbum('al-ram')!,
    getAlbum('al-trilogy')!,
    getAlbum('al-tbn')!,
  ]
}

export function libraryStats() {
  return {
    tracks: tracks.length,
    albums: albums.length,
    artists: artists.length,
    genres: genres.length,
    favorites: tracks.filter((t) => t.favorite).length,
  }
}
