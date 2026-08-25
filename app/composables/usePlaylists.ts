// ============================================================
// usePlaylists — playlist CRUD + import/export state machines
// ============================================================
// Frontend representation only. Native file access and a real
// playlist parser plug in behind the same state machine later.
// ============================================================

import type { ImportStep, ImportedEntry, Playlist } from '~/types'
import { playlists as seed } from '~/data/playlists'

const playlists = ref<Playlist[]>(seed.map((p) => ({ ...p, trackIds: [...p.trackIds] })))

// ---- import state machine ----------------------------------------------
const importStep = ref<ImportStep>('idle')
const importProgress = ref(0)
const importEntries = ref<ImportedEntry[]>([])
const importFormat = ref('M3U')

// ---- export state machine ----------------------------------------------
const exportStep = ref<'idle' | 'preparing' | 'done'>('idle')
const exportFormat = ref('SYSTEMA JSON')

export function usePlaylists() {
  function getPlaylist(id: string) {
    return playlists.value.find((p) => p.id === id)
  }

  function createPlaylist(title: string, description?: string): Playlist {
    const id = `pl-${Date.now().toString(36)}`
    const now = new Date().toISOString()
    const pl: Playlist = {
      id,
      title,
      description,
      kind: 'user',
      trackIds: [],
      createdAt: now,
      updatedAt: now,
    }
    playlists.value = [pl, ...playlists.value]
    return pl
  }

  function updatePlaylist(id: string, patch: Partial<Playlist>) {
    const pl = getPlaylist(id)
    if (!pl) return
    Object.assign(pl, patch, { updatedAt: new Date().toISOString() })
  }

  function deletePlaylist(id: string) {
    playlists.value = playlists.value.filter((p) => p.id !== id)
  }

  function addTracks(id: string, trackIds: string[]) {
    const pl = getPlaylist(id)
    if (!pl) return
    const existing = new Set(pl.trackIds)
    pl.trackIds = [...pl.trackIds, ...trackIds.filter((t) => !existing.has(t))]
    pl.updatedAt = new Date().toISOString()
  }

  function removeTrack(id: string, trackId: string) {
    const pl = getPlaylist(id)
    if (!pl) return
    pl.trackIds = pl.trackIds.filter((t) => t !== trackId)
    pl.updatedAt = new Date().toISOString()
  }

  /** reorder (prepared for drag & drop) */
  function reorder(id: string, from: number, to: number) {
    const pl = getPlaylist(id)
    if (!pl || from === to) return
    const next = [...pl.trackIds]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    pl.trackIds = next
    pl.updatedAt = new Date().toISOString()
  }

  // ---------------- import ----------------
  /** simulate selecting a file — real file picker plugs in here */
  function startImport(format = 'M3U') {
    importFormat.value = format
    importStep.value = 'select'
    importProgress.value = 0
    importEntries.value = []
  }

  function selectFile() {
    // MOCK: a file was chosen, parsing begins
    importStep.value = 'reading'
    importProgress.value = 0
    const timer = setInterval(() => {
      importProgress.value += 8
      if (importProgress.value >= 100) {
        clearInterval(timer)
        importStep.value = 'matching'
        // 18 entries, ~70% matched against the catalog
        const titles = [
          'Nightcall', 'Midnight City', 'Turbo Killer', 'Havaye Gham', 'Blue Monday',
          'On the Nature of Daylight', 'Dangerous Days', 'Structure & Rhythm', 'Cherry',
          'Contact', 'Acid Rain', 'Open Eye Signal', 'Trans-Europe Express', 'Pole',
          'The Night of the Hunter', 'Golden Hour Theme', 'Static Bloom', 'Parallel Roads',
        ]
        const artists = [
          'Kavinsky', 'M83', 'Carpenter Brut', 'Moein', 'New Order',
          'Max Richter', 'Perturbator', 'Systema Ensemble', 'Chromatics',
          'Daft Punk', 'Lorn', 'Jon Hopkins', 'Kraftwerk', 'Googoosh',
          'Unknown', 'Unknown', 'Unknown', 'Unknown',
        ]
        importEntries.value = titles.map((title, i) => {
          const matched = i < 13
          return {
            id: `ie-${i}`,
            title,
            artist: artists[i],
            status: matched ? 'matched' : 'missing',
            matchedTrackId: matched ? `tr-${['04', '08', '14', '24', '31', '20', '16', '01', '12', '06', '35', '22', '29', '28'][i]}` : undefined,
          } as ImportedEntry
        })
      }
    }, 140)
  }

  function resolveMissing(id: string, action: 'skip' | 'manual') {
    const entry = importEntries.value.find((e) => e.id === id)
    if (entry) entry.status = action === 'skip' ? 'skip' : 'matched'
  }

  function finishImport() {
    const matchedIds = importEntries.value
      .filter((e) => e.status === 'matched' && e.matchedTrackId)
      .map((e) => e.matchedTrackId!)
    const pl = createPlaylist('IMPORTED PLAYLIST', `${importFormat.value} · ${matchedIds.length} TRACKS`)
    addTracks(pl.id, matchedIds)
    importStep.value = 'done'
    return pl
  }

  function resetImport() {
    importStep.value = 'idle'
    importProgress.value = 0
    importEntries.value = []
  }

  // ---------------- export ----------------
  function startExport() {
    exportStep.value = 'preparing'
    setTimeout(() => (exportStep.value = 'done'), 900)
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
    startImport,
    selectFile,
    resolveMissing,
    finishImport,
    resetImport,
    // export
    exportStep,
    exportFormat,
    startExport,
    resetExport,
    setExportFormat: (f: string) => (exportFormat.value = f),
  }
}
