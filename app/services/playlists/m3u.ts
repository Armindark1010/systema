// ============================================================
// SYSTEMA — M3U Playlist Service (Export / Import / Parser)
// ============================================================
// Handles Extended M3U (#EXTM3U) format for standard compatibility
// with audio players (VLC, Android media players, iTunes, etc.)
// ============================================================

import type { Playlist, Track, ImportedEntry } from '../../types'
import { getArtist } from '../../data/music'
import { normalizeQuery } from '../search/normalization'

export interface ParsedM3UEntry {
  raw: string
  title: string
  artist?: string
  duration?: number
  uri?: string
  filename?: string
}

export interface ParsedM3U {
  title?: string
  entries: ParsedM3UEntry[]
}

/**
 * Exports a playlist to Extended M3U format (#EXTM3U)
 */
export function exportPlaylistToM3U(playlist: Playlist, allTracks: Track[]): string {
  const lines: string[] = ['#EXTM3U']
  
  if (playlist.title) {
    lines.push(`#PLAYLIST:${playlist.title}`)
  }

  for (const trackId of playlist.trackIds) {
    const track = allTracks.find(t => t.id === trackId)
    if (!track) continue

    const artistName = track.artist || (track.artistId ? getArtist(track.artistId)?.name : '') || 'Unknown Artist'
    const durationSec = Math.max(0, Math.round(track.duration || 0))
    const displayTitle = track.title || 'Untitled Track'

    // Extended M3U header: #EXTINF:<seconds>,<Artist> - <Title>
    lines.push(`#EXTINF:${durationSec},${artistName} - ${displayTitle}`)

    // File URI or fallback filename path
    if (track.uri) {
      lines.push(track.uri)
    } else {
      lines.push(`${artistName} - ${displayTitle}.mp3`)
    }
  }

  return lines.join('\n')
}

/**
 * Parses raw M3U / M3U8 string content
 */
export function parseM3U(content: string, fallbackTitle = 'Imported Playlist'): ParsedM3U {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const entries: ParsedM3UEntry[] = []
  let playlistTitle: string | undefined

  let pendingDuration: number | undefined
  let pendingArtist: string | undefined
  let pendingTitle: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Header / directives
    if (line.startsWith('#')) {
      if (line.startsWith('#PLAYLIST:')) {
        playlistTitle = line.slice(10).trim()
      } else if (line.startsWith('#EXT-X-TITLE:')) {
        playlistTitle = line.slice(13).trim()
      } else if (line.startsWith('#EXTINF:')) {
        // Format: #EXTINF:180,Artist - Title or #EXTINF:180,Title or #EXTINF:268971,... (milliseconds)
        const commaIdx = line.indexOf(',')
        const colonIdx = line.indexOf(':')

        if (colonIdx !== -1) {
          const durationStr = commaIdx !== -1 ? line.slice(colonIdx + 1, commaIdx).trim() : line.slice(colonIdx + 1).trim()
          let parsedDur = parseInt(durationStr, 10)
          if (!Number.isNaN(parsedDur)) {
            // If duration is in milliseconds (> 10000), convert to seconds
            if (parsedDur > 10000) {
              parsedDur = Math.round(parsedDur / 1000)
            }
            pendingDuration = parsedDur
          }
        }

        if (commaIdx !== -1) {
          const rawTrackInfo = line.slice(commaIdx + 1).trim()
          if (rawTrackInfo.includes(' - ')) {
            const parts = rawTrackInfo.split(' - ')
            pendingArtist = parts[0].trim()
            pendingTitle = parts.slice(1).join(' - ').trim()
          } else {
            pendingTitle = rawTrackInfo
          }
        }
      }
      continue
    }

    // Line is an audio path, URI, or title
    const rawUri = line
    // Deduce filename (strip folder paths & audio extension)
    const cleanFileName = rawUri.split(/[\\/]/).pop()?.replace(/\.[a-zA-Z0-9]+$/, '') || rawUri

    let itemTitle = pendingTitle
    let itemArtist = pendingArtist
    const itemDuration = pendingDuration

    if (!itemTitle) {
      if (cleanFileName.includes(' - ')) {
        const parts = cleanFileName.split(' - ')
        itemArtist = parts[0].trim()
        itemTitle = parts.slice(1).join(' - ').trim()
      } else {
        itemTitle = cleanFileName
      }
    }

    entries.push({
      raw: rawUri,
      title: itemTitle || cleanFileName || 'Untitled Track',
      artist: itemArtist,
      duration: itemDuration,
      uri: rawUri,
      filename: cleanFileName,
    })

    // Reset pending state
    pendingDuration = undefined
    pendingArtist = undefined
    pendingTitle = undefined
  }

  return {
    title: playlistTitle || fallbackTitle,
    entries,
  }
}

/**
 * Helper to extract raw filename without folders and extension
 */
function extractFilename(pathOrUri?: string): string {
  if (!pathOrUri) return ''
  const decoded = decodeURIComponent(pathOrUri)
  return decoded.split(/[\\/]/).pop()?.replace(/\.[a-zA-Z0-9]+$/, '').trim() || ''
}

/**
 * Helper to split text into distinct normalized tokens
 */
function tokenize(text?: string): string[] {
  if (!text) return []
  return normalizeQuery(text)
    .split(/\s+/)
    .filter(token => token.length >= 2)
}

/**
 * Matches parsed M3U entries against the catalog / library tracks
 */
export function matchM3UEntries(entries: ParsedM3UEntry[], catalogTracks: Track[]): ImportedEntry[] {
  return entries.map((entry, index) => {
    const entryRawNorm = normalizeQuery(entry.raw || '')
    const entryUriNorm = normalizeQuery(entry.uri || '')
    const entryFilename = entry.filename || extractFilename(entry.uri || entry.raw)
    const entryFilenameNorm = normalizeQuery(entryFilename)
    const entryTitleNorm = normalizeQuery(entry.title || '')
    const entryArtistNorm = entry.artist ? normalizeQuery(entry.artist) : ''

    const entryAllTokens = new Set([
      ...tokenize(entry.title),
      ...tokenize(entry.artist),
      ...tokenize(entry.filename),
      ...tokenize(entry.raw),
    ])

    // 1. Direct match by URI / Path / ID
    let matched = catalogTracks.find(t => {
      if (entry.uri && t.uri && (t.uri === entry.uri || t.uri.toLowerCase() === entry.uri.toLowerCase())) {
        return true
      }
      if (entry.raw && (t.id === entry.raw || t.uri === entry.raw)) {
        return true
      }
      return false
    })

    // 2. Match by exact or normalized Filename (location-based match)
    if (!matched && entryFilenameNorm) {
      matched = catalogTracks.find(t => {
        const tFilenameNorm = normalizeQuery(extractFilename(t.uri || ''))
        const tTitleNorm = normalizeQuery(t.title || '')

        // Check if track uri filename matches
        if (tFilenameNorm && tFilenameNorm === entryFilenameNorm) return true
        // Check if track title matches the file name directly
        if (tTitleNorm === entryFilenameNorm) return true

        return false
      })
    }

    // 3. Match by normalized Title and Artist
    if (!matched && entryTitleNorm) {
      matched = catalogTracks.find(t => {
        const tTitleNorm = normalizeQuery(t.title || '')
        const tArtistName = t.artist || (t.artistId ? getArtist(t.artistId)?.name : '') || ''
        const tArtistNorm = normalizeQuery(tArtistName)

        if (entryArtistNorm) {
          const artistMatches = tArtistNorm === entryArtistNorm ||
            tArtistNorm.includes(entryArtistNorm) ||
            entryArtistNorm.includes(tArtistNorm)
          return tTitleNorm === entryTitleNorm && artistMatches
        }
        return tTitleNorm === entryTitleNorm
      })
    }

    // 4. Loose match by filename / title inclusion (handles Telegram tags, track numbers, etc.)
    if (!matched) {
      matched = catalogTracks.find(t => {
        const tTitleNorm = normalizeQuery(t.title || '')
        const tFilenameNorm = normalizeQuery(extractFilename(t.uri || ''))

        if (entryFilenameNorm && tTitleNorm) {
          if (entryFilenameNorm.includes(tTitleNorm) || tTitleNorm.includes(entryFilenameNorm)) {
            return true
          }
        }

        if (entryTitleNorm && tTitleNorm) {
          if (entryTitleNorm.includes(tTitleNorm) || tTitleNorm.includes(entryTitleNorm)) {
            return true
          }
        }

        if (entryFilenameNorm && tFilenameNorm) {
          if (entryFilenameNorm.includes(tFilenameNorm) || tFilenameNorm.includes(entryFilenameNorm)) {
            return true
          }
        }

        return false
      })
    }

    // 5. Match by token subset (all words of track title exist in entry)
    if (!matched && entryAllTokens.size > 0) {
      matched = catalogTracks.find(t => {
        const tTitleTokens = tokenize(t.title)
        if (tTitleTokens.length > 0 && tTitleTokens.every(token => entryAllTokens.has(token))) {
          return true
        }
        return false
      })
    }

    return {
      id: `m3u-entry-${index}-${Date.now()}`,
      title: entry.title || entryFilename || 'Untitled Track',
      artist: entry.artist || (matched ? (matched.artist || getArtist(matched.artistId)?.name) : undefined),
      status: matched ? 'matched' : 'missing',
      matchedTrackId: matched?.id,
    }
  })
}

/**
 * Triggers a browser file download for M3U content
 */
export function downloadM3UFile(filename: string, content: string) {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').trim()
  const fullName = safeName.endsWith('.m3u') ? safeName : `${safeName}.m3u`

  const blob = new Blob([content], { type: 'audio/x-mpegurl;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = fullName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()

  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}
