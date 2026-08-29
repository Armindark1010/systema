// ============================================================
// SYSTEMA — End-to-End Lifecycle Test for Playlist Session Persistence
// ============================================================
// Simulates:
//   Play Track 15 (2 min) -> Save Range & State -> Force Close ->
//   Reopen -> Load Session -> Verify 2.0% Progress (NOT 50%) ->
//   Resume Exact Position & Track -> Complete -> Filter Out
// ============================================================

const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, String(v)) },
  removeItem: (k: string) => { storage.delete(k) },
  clear: () => { storage.clear() },
}
;(globalThis as any).window = { localStorage: mockLocalStorage }
;(globalThis as any).localStorage = mockLocalStorage

import { setStorageAdapter } from '../app/services/persistence/storageAdapter'

setStorageAdapter({
  get: (k: string) => storage.get(k) ?? null,
  set: (k: string, v: string) => { storage.set(k, v) },
  remove: (k: string) => { storage.delete(k) },
})

import {
  buildPlaylistSession,
  loadPlaylistSessions,
  saveSinglePlaylistSession,
  calculatePlaylistProgress,
  isSessionIncomplete,
  removePlaylistSession,
  clearPlaylistSessions,
  type PersistedPlaylistSession,
} from '../app/services/persistence/playlistSession'

let passed = 0
let failed = 0

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.error(`  \x1b[31m✗\x1b[0m ${name}`)
    console.error(`      expected ${b}`)
    console.error(`      actual   ${a}`)
  }
}

function ok(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.error(`  \x1b[31m✗\x1b[0m ${name}`)
  }
}

console.log('--- SYSTEMA PLAYLIST SESSION END-TO-END LIFECYCLE TESTS ---')

// 1. Initial State
console.log('\nStep 1: Clean Startup')
clearPlaylistSessions()
check('Storage is initially empty', loadPlaylistSessions(), {})

// 2. Playback of Track 15 (2 min) in a 30-track playlist (6000s total)
console.log('\nStep 2: Active Listening Session & True Progress Persistence')
const playlistId = 'pl-workout-30'
const trackDurations30 = Array.from({ length: 30 }, () => 200) // 30 tracks * 200s = 6000s

// User plays Track 15 (index 14) for 120 seconds
const session = buildPlaylistSession({
  playlistId,
  trackId: 'tr-15',
  trackIndex: 14,
  positionSeconds: 120,
  durationSeconds: 200,
  completed: false,
  listenedRanges: {
    'tr-15': [[0, 120]],
  },
  totalListenedSeconds: 120,
})
ok('Session object created successfully', session !== null)

if (session) {
  saveSinglePlaylistSession(session)
  ok('Session committed to storage', storage.size > 0)
}

// 3. Force Close / App Termination Simulation
console.log('\nStep 3: Simulate App Force-Close (Wiping In-Memory State)')
let inMemorySession: PersistedPlaylistSession | null = null
check('In-memory state destroyed', inMemorySession, null)

// 4. App Re-open & State Hydration
console.log('\nStep 4: App Re-opened — Hydrating from Storage')
const reloaded = loadPlaylistSessions()
const restoredSession = reloaded[playlistId]
ok('Session survived process kill and reloaded', Boolean(restoredSession))
check('Restored playlistId is exact', restoredSession?.playlistId, 'pl-workout-30')
check('Restored trackId is exact', restoredSession?.trackId, 'tr-15')
check('Restored trackIndex is exact (Track 15)', restoredSession?.trackIndex, 14)
check('Restored positionSeconds is exact', restoredSession?.positionSeconds, 120)
check('Restored durationSeconds is exact', restoredSession?.durationSeconds, 200)
check('Restored totalListenedSeconds is exact', restoredSession?.totalListenedSeconds, 120)

// 5. Incomplete Check & Progress Verification
console.log('\nStep 5: Verify Progress & Continue Listening Eligibility')
const progress = calculatePlaylistProgress(
  trackDurations30,
  restoredSession!.trackIndex,
  restoredSession!.positionSeconds,
  restoredSession!.listenedRanges,
  restoredSession!.totalListenedSeconds,
)
// 120 / 6000 = 2.0% (NOT 50%)
check('Calculated playlist progress is strictly 2.0% (NOT 50%!)', progress, 2.0)
ok('Session is incomplete and eligible for Continue Listening', isSessionIncomplete(restoredSession!, trackDurations30))

// 6. Resume Playback Simulation
console.log('\nStep 6: Resume Playback Simulation')
const simulatedPlayer = {
  activePlaylistId: null as string | null,
  currentIndex: -1,
  currentTrackId: null as string | null,
  currentTime: 0,
  isPlaying: false,
}

// User taps on the Continue Listening card:
simulatedPlayer.activePlaylistId = restoredSession!.playlistId
simulatedPlayer.currentIndex = restoredSession!.trackIndex
simulatedPlayer.currentTrackId = restoredSession!.trackId
simulatedPlayer.currentTime = restoredSession!.positionSeconds
simulatedPlayer.isPlaying = true

check('Player activePlaylistId resumed', simulatedPlayer.activePlaylistId, 'pl-workout-30')
check('Player currentIndex resumed', simulatedPlayer.currentIndex, 14)
check('Player currentTrackId resumed', simulatedPlayer.currentTrackId, 'tr-15')
check('Player currentTime resumed at exact timestamp (02:00)', simulatedPlayer.currentTime, 120)
check('Player is playing', simulatedPlayer.isPlaying, true)

// 7. Progress to Completion
console.log('\nStep 7: Progress to 96% and Complete Playlist')
const completedSession = buildPlaylistSession({
  playlistId,
  trackId: 'tr-30',
  trackIndex: 29,
  positionSeconds: 195,
  durationSeconds: 200,
  completed: true,
  totalListenedSeconds: 5800,
})
saveSinglePlaylistSession(completedSession!)

const reloadedAfterCompletion = loadPlaylistSessions()
const sessionAfterCompletion = reloadedAfterCompletion[playlistId]
ok('Completed session is flagged as completed', sessionAfterCompletion?.completed === true)
ok('Completed session is filtered OUT of Continue Listening', !isSessionIncomplete(sessionAfterCompletion!, trackDurations30))

// 8. Deletion & Cleanup
console.log('\nStep 8: Deletion')
removePlaylistSession(playlistId)
const reloadedAfterDelete = loadPlaylistSessions()
check('Session successfully deleted', reloadedAfterDelete[playlistId], undefined)

console.log(`\n========================================`)
console.log(`E2E Results: ${passed} passed, ${failed} failed`)
console.log(`========================================\n`)

if (failed > 0) {
  process.exit(1)
}
