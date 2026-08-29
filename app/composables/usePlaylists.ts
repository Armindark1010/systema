// ============================================================
// usePlaylists — playlist CRUD + M3U import/export
// ============================================================
// Supports native M3U (#EXTM3U) export/import with metadata matching
// against the music catalog, and persistence via StorageAdapter.
// ============================================================

import type { ImportStep, ImportedEntry, Playlist, Track } from '~/types'
import { playlists as seed } from '~/data/playlists'
import { tracks as fallbackCatalog } from '~/data/music'
import { PLAYLISTS_STORAGE_KEY, readJSON, writeJSON } from '~/services/persistence/storageAdapter'
import { exportPlaylistToM3U, parseM3U, matchM3UEntries, downloadM3UFile } from '~/services/playlists/m3u'
import { LIKED_PLAYLIST_ID, RECENT_PLAYLIST_ID, isSystemPlaylistId, type PlaylistPersistState } from '~/types/playlists'
import { usePlayerStore } from '~/stores/player'
import { usePlaybackHistory } from '~/composables/usePlaybackHistory'

function loadInitialPlaylists(): Playlist[] {
  const stored = readJSON<PlaylistPersistState | Playlist[]>(PLAYLISTS_STORAGE_KEY)
  if (Array.isArray(stored) && stored.length) return stored
  if (stored && 'playlists' in stored && Array.isArray(stored.playlists) && stored.playlists.length) {
    return stored.playlists
  }
  return seed.map((p) => ({ ...p, trackIds: [...p.trackIds] }))
}

const playlists = ref<Playlist[]>(loadInitialPlaylists())

function persistPlaylists() {
  writeJSON(PLAYLISTS_STORAGE_KEY, {
    version: 1,
    playlists: playlists.value,
    sortBy: 'updated',
    gridColumns: 2,
  })
}

// Watch on client to persist changes
if (import.meta.client) {
  watch(playlists, persistPlaylists, { deep: true })
}

// ---- import state machine ----------------------------------------------
const importStep = ref<ImportStep>('idle')
const importProgress = ref(0)
const importEntries = ref<ImportedEntry[]>([])
const importFormat = ref('M3U')
const importTitle = ref('IMPORTED PLAYLIST')
const importError = ref<string | null>(null)

// ---- export state machine ----------------------------------------------
const exportStep = ref<'idle' | 'preparing' | 'done'>('idle')
const exportFormat = ref('M3U')

export function usePlaylists() {
  function getPlaylist(id: string): Playlist | undefined {
    if (id === 'favorites' || id === 'liked' || id === LIKED_PLAYLIST_ID) {
      let favList: string[] = []
      try {
        favList = Array.from(usePlayerStore().favorites)
      } catch {
        favList = []
      }
      return {
        id: 'favorites',
        title: 'FAVORITES',
        description: 'Your favorite tracks in one place.',
        kind: 'system',
        trackIds: favList,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: new Date().toISOString(),
      }
    }
    if (id === 'recents' || id === 'recent' || id === RECENT_PLAYLIST_ID) {
      let recList: string[] = []
      try {
        recList = usePlaybackHistory().recentTrackIds.value
      } catch {
        recList = []
      }
      return {
        id: 'recents',
        title: 'RECENTS',
        description: 'Recently played tracks from playback history.',
        kind: 'system',
        trackIds: recList,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: new Date().toISOString(),
      }
    }
    return playlists.value.find((p) => p.id === id)
  }

  function createPlaylist(title: string, description?: string, trackIds: string[] = []): Playlist {
    const id = `pl-${Date.now().toString(36)}`
    const now = new Date().toISOString()
    const pl: Playlist = {
      id,
      title: title.trim(),
      description: description?.trim() || undefined,
      kind: 'user',
      trackIds: [...trackIds],
      createdAt: now,
      updatedAt: now,
    }
    playlists.value = [pl, ...playlists.value]
    persistPlaylists()
    return pl
  }

  function updatePlaylist(id: string, patch: Partial<Playlist>) {
    if (isSystemPlaylistId(id) || id === 'favorites' || id === 'recents') return
    const pl = getPlaylist(id)
    if (!pl) return
    Object.assign(pl, patch, { updatedAt: new Date().toISOString() })
    persistPlaylists()
  }

  function deletePlaylist(id: string) {
    if (isSystemPlaylistId(id) || id === 'favorites' || id === 'recents') return
    playlists.value = playlists.value.filter((p) => p.id !== id)
    persistPlaylists()
  }

  function addTracks(id: string, trackIds: string[]) {
    if (isSystemPlaylistId(id) || id === 'favorites' || id === 'recents') return
    const pl = getPlaylist(id)
    if (!pl) return
    const existing = new Set(pl.trackIds)
    pl.trackIds = [...pl.trackIds, ...trackIds.filter((t) => !existing.has(t))]
    pl.updatedAt = new Date().toISOString()
    persistPlaylists()
  }

  function removeTrack(id: string, trackId: string) {
    if (id === 'favorites' || id === 'liked' || id === LIKED_PLAYLIST_ID) {
      try {
        usePlayerStore().toggleFavoriteId(trackId)
      } catch {
        /* store unavailable */
      }
      return
    }
    const pl = getPlaylist(id)
    if (!pl) return
    pl.trackIds = pl.trackIds.filter((t) => t !== trackId)
    pl.updatedAt = new Date().toISOString()
    persistPlaylists()
  }

  /** reorder (prepared for drag & drop) */
  function reorder(id: string, from: number, to: number) {
    const pl = getPlaylist(id)
    if (!pl || from === to) return
    const next = [...pl.trackIds]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    pl.trackIds = next
    pl.updatedAt = new Date().toISOString()
    persistPlaylists()
  }

  // ---------------- M3U IMPORT ----------------

  function startImport(format = 'M3U') {
    importFormat.value = format
    importStep.value = 'select'
    importProgress.value = 0
    importEntries.value = []
    importError.value = null
    importTitle.value = 'IMPORTED PLAYLIST'
  }

  /**
   * Parses and matches M3U text content against catalog tracks
   */
  async function processM3UText(content: string, catalogTracks: Track[], filename = 'Playlist') {
    try {
      importError.value = null
      importStep.value = 'reading'
      importProgress.value = 35

      await new Promise(r => setTimeout(r, 120))
      const parsed = parseM3U(content, filename.replace(/\.m3u8?$/i, ''))
      importTitle.value = parsed.title || filename.replace(/\.m3u8?$/i, '')
      importProgress.value = 70

      if (!parsed.entries.length) {
        throw new Error('No tracks found in the M3U file')
      }

      await new Promise(r => setTimeout(r, 120))
      importStep.value = 'matching'
      importProgress.value = 90

      const matched = matchM3UEntries(parsed.entries, catalogTracks.length ? catalogTracks : fallbackCatalog)
      importEntries.value = matched
      importProgress.value = 100

      await new Promise(r => setTimeout(r, 150))
      importStep.value = 'resolve'
    } catch (err: any) {
      importError.value = err?.message || 'Failed to parse M3U file'
      importStep.value = 'select'
    }
  }

  /**
   * Reads a File object and processes M3U content
   */
  async function processM3UFile(file: File, catalogTracks: Track[]) {
    const text = await file.text()
    await processM3UText(text, catalogTracks, file.name)
  }

  /**
   * Sample M3U loader for instant testing / demo
   */
  async function selectSampleFile(catalogTracks: Track[]) {
    const sampleM3U = [
      '#EXTM3U',
      '#PLAYLIST:SYSTEMA CLASSICS',
      '#EXTINF:240,Kavinsky - Nightcall',
      'Kavinsky - Nightcall.mp3',
      '#EXTINF:243,M83 - Midnight City',
      'M83 - Midnight City.mp3',
      '#EXTINF:219,Carpenter Brut - Turbo Killer',
      'Carpenter Brut - Turbo Killer.mp3',
      '#EXTINF:284,Moein - Havaye Gham',
      'Moein - Havaye Gham.mp3',
      '#EXTINF:449,New Order - Blue Monday',
      'New Order - Blue Monday.mp3',
      '#EXTINF:373,Max Richter - On the Nature of Daylight',
      'Max Richter - On the Nature of Daylight.mp3',
      '#EXTINF:280,Perturbator - Dangerous Days',
      'Perturbator - Dangerous Days.mp3',
      '#EXTINF:320,Chromatics - Cherry',
      'Chromatics - Cherry.mp3',
      '#EXTINF:380,Daft Punk - Contact',
      'Daft Punk - Contact.mp3',
      '#EXTINF:180,Lorn - Acid Rain',
      'Lorn - Acid Rain.mp3',
      '#EXTINF:310,Jon Hopkins - Open Eye Signal',
      'Jon Hopkins - Open Eye Signal.mp3',
      '#EXTINF:405,Kraftwerk - Trans-Europe Express',
      'Kraftwerk - Trans-Europe Express.mp3',
      '#EXTINF:230,Googoosh - Pole',
      'Googoosh - Pole.mp3',
      '#EXTINF:200,Unknown Artist - Golden Hour Theme',
      'Unknown Artist - Golden Hour Theme.mp3',
      '#EXTINF:215,Synthwave Collective - Static Bloom',
      'Synthwave Collective - Static Bloom.mp3',
    ].join('\n')

    await processM3UText(sampleM3U, catalogTracks, 'SYSTEMA CLASSICS')
  }

  function resolveMissing(id: string, action: 'skip' | 'manual', manualTrackId?: string) {
    const entry = importEntries.value.find((e) => e.id === id)
    if (!entry) return

    if (action === 'skip') {
      entry.status = 'skip' as any
      entry.matchedTrackId = undefined
    } else if (action === 'manual' && manualTrackId) {
      entry.status = 'matched'
      entry.matchedTrackId = manualTrackId
    }
  }

  function finishImport(overrideTitle?: string): Playlist {
    const matchedIds = importEntries.value
      .filter((e) => e.status === 'matched' && e.matchedTrackId)
      .map((e) => e.matchedTrackId!)

    const finalTitle = (overrideTitle || importTitle.value || 'IMPORTED PLAYLIST').trim().toUpperCase()
    const pl = createPlaylist(finalTitle, `M3U IMPORT · ${matchedIds.length} TRACKS`, matchedIds)
    importStep.value = 'done'
    return pl
  }

  function resetImport() {
    importStep.value = 'idle'
    importProgress.value = 0
    importEntries.value = []
    importError.value = null
    importTitle.value = 'IMPORTED PLAYLIST'
  }

  // ---------------- M3U EXPORT ----------------

  function exportPlaylist(playlist: Playlist, allTracks: Track[], format = 'M3U') {
    exportFormat.value = format
    exportStep.value = 'preparing'

    setTimeout(() => {
      if (format === 'M3U') {
        const m3uContent = exportPlaylistToM3U(playlist, allTracks)
        downloadM3UFile(playlist.title, m3uContent)
      } else {
        // Fallback JSON export
        const jsonContent = JSON.stringify({
          title: playlist.title,
          description: playlist.description,
          trackIds: playlist.trackIds,
          exportedAt: new Date().toISOString(),
        }, null, 2)
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${playlist.title.replace(/[\\/:*?"<>|]/g, '_')}.json`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      exportStep.value = 'done'
    }, 400)
  }

  function startExport() {
    exportStep.value = 'preparing'
    setTimeout(() => (exportStep.value = 'done'), 600)
  }

  function resetExport() {
    exportStep.value = 'idle'
  }

  return {
    playlists,
    getPlaylist,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addTracks,
    removeTrack,
    reorder,
    // import
    importStep,
    importProgress,
    importEntries,
    importFormat,
    importTitle,
    importError,
    startImport,
    processM3UFile,
    processM3UText,
    selectSampleFile,
    resolveMissing,
    finishImport,
    resetImport,
    // export
    exportStep,
    exportFormat,
    startExport,
    exportPlaylist,
    resetExport,
    setExportFormat: (f: string) => (exportFormat.value = f),
  }
}
