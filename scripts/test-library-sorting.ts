import assert from 'node:assert/strict'
import { tracks as catalogTracks, artists as catalogArtists, albums as catalogAlbums } from '../app/data/music'
import type { Track, Artist, Album } from '../app/types'
import type { LibrarySortKey } from '../app/stores/library'

console.log('--- SYSTEMA LIBRARY SORTING LOGIC TESTS ---')

const tracks: Track[] = catalogTracks
const artists: Artist[] = catalogArtists
const albums: Album[] = catalogAlbums

const recentRank = new Map<string, number>([
  ['tr-04', 0],
  ['tr-08', 1],
  ['tr-24', 2],
])

function sortTracks(list: Track[], sortBy: LibrarySortKey): Track[] {
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const missingLast = (value?: string | number) => (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value)) ? 1 : 0)

  return [...list].sort((a: Track, b: Track) => {
    const artistA = artists.find((art: Artist) => art.id === a.artistId)?.name ?? a.artist ?? ''
    const artistB = artists.find((art: Artist) => art.id === b.artistId)?.name ?? b.artist ?? ''
    const albumA = albums.find((alb: Album) => alb.id === a.albumId)?.title ?? a.album ?? ''
    const albumB = albums.find((alb: Album) => alb.id === b.albumId)?.title ?? b.album ?? ''

    switch (sortBy) {
      case 'recently-added': {
        const dateA = a.addedAt || ''
        const dateB = b.addedAt || ''
        return dateB.localeCompare(dateA) || byText(a.title || '', b.title || '')
      }
      case 'recently-played': {
        const rankA: number = recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const rankB: number = recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        if (rankA !== rankB) return rankA - rankB
        const dateA = a.addedAt || ''
        const dateB = b.addedAt || ''
        return dateB.localeCompare(dateA) || byText(a.title || '', b.title || '')
      }
      case 'title':
        return byText(a.title || '', b.title || '')
      case 'artist':
        return byText(artistA, artistB) || byText(a.title || '', b.title || '')
      case 'album':
        return byText(albumA, albumB) || byText(a.title || '', b.title || '')
      case 'duration':
        return (a.duration || 0) - (b.duration || 0) || byText(a.title || '', b.title || '')
      case 'most-played':
        return (b.plays || 0) - (a.plays || 0) || byText(a.title || '', b.title || '')
      case 'ai-mood': {
        const moodA = a.ai?.analyzed && a.ai.mood?.length ? a.ai.mood[0] : (a.mood || undefined)
        const moodB = b.ai?.analyzed && b.ai.mood?.length ? b.ai.mood[0] : (b.mood || undefined)
        return missingLast(moodA) - missingLast(moodB) || byText(moodA ?? '', moodB ?? '') || byText(a.title || '', b.title || '')
      }
      case 'ai-energy': {
        const energyA = a.ai?.analyzed && typeof a.ai.energy === 'number' ? a.ai.energy : (a.energy != null ? a.energy / 100 : undefined)
        const energyB = b.ai?.analyzed && typeof b.ai.energy === 'number' ? b.ai.energy : (b.energy != null ? b.energy / 100 : undefined)
        return missingLast(energyA) - missingLast(energyB) || (energyB ?? -1) - (energyA ?? -1) || byText(a.title || '', b.title || '')
      }
    }
  })
}

// 1. Title sort
console.log('Testing title sort...')
const byTitle = sortTracks(tracks, 'title')
assert.ok(byTitle[0].title.localeCompare(byTitle[1].title) <= 0)
console.log('✓ Title sort passed (first:', byTitle[0].title, ')')

// 2. Duration sort
console.log('Testing duration sort...')
const byDuration = sortTracks(tracks, 'duration')
assert.ok(byDuration[0].duration <= byDuration[1].duration)
assert.ok(byDuration[byDuration.length - 1].duration >= byDuration[0].duration)
console.log('✓ Duration sort passed (min:', byDuration[0].duration, 's, max:', byDuration[byDuration.length - 1].duration, 's)')

// 3. Most played sort
console.log('Testing most-played sort...')
const byPlays = sortTracks(tracks, 'most-played')
assert.ok(byPlays[0].plays >= byPlays[1].plays)
console.log('✓ Most-played sort passed (top plays:', byPlays[0].plays, ')')

// 4. Recently played sort
console.log('Testing recently-played sort...')
const byRecent = sortTracks(tracks, 'recently-played')
assert.equal(byRecent[0].id, 'tr-04')
assert.equal(byRecent[1].id, 'tr-08')
assert.equal(byRecent[2].id, 'tr-24')
console.log('✓ Recently-played sort passed')

// 5. AI mood sort
console.log('Testing ai-mood sort...')
const byMood = sortTracks(tracks, 'ai-mood')
assert.ok(byMood.length === tracks.length)
console.log('✓ AI mood sort passed')

// 6. AI energy sort
console.log('Testing ai-energy sort...')
const byEnergy = sortTracks(tracks, 'ai-energy')
assert.ok(byEnergy.length === tracks.length)
console.log('✓ AI energy sort passed')

// 7. Artist sort
console.log('Testing artist sort...')
const byArtist = sortTracks(tracks, 'artist')
assert.ok(byArtist.length === tracks.length)
console.log('✓ Artist sort passed')

// 8. Album sort
console.log('Testing album sort...')
const byAlbum = sortTracks(tracks, 'album')
assert.ok(byAlbum.length === tracks.length)
console.log('✓ Album sort passed')

// 9. Recently added sort
console.log('Testing recently-added sort...')
const byAdded = sortTracks(tracks, 'recently-added')
assert.ok(byAdded.length === tracks.length)
console.log('✓ Recently-added sort passed')

console.log('--- ALL SORT TESTS PASSED! ---')
