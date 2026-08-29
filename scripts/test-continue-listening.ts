// ============================================================
// SYSTEMA — Continue Listening session persistence tests
// ============================================================
// Tests the pure functions and persistence logic in
// app/services/persistence/playlistSession.ts.
// ============================================================

// ---- localStorage stub (must precede imports) ----------------
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
  parsePlaylistSessions,
  mergeRanges,
  calculateTrackListenedSeconds,
  calculatePlaylistListenedSeconds,
  calculateActualPlaylistProgress,
  calculatePlaylistProgress,
  isSessionIncomplete,
  loadPlaylistSessions,
  savePlaylistSessions,
  saveSinglePlaylistSession,
  removePlaylistSession,
  PLAYLIST_SESSIONS_STORAGE_KEY,
  PLAYLIST_SESSIONS_VERSION,
  PLAYLIST_COMPLETION_THRESHOLD_PCT,
  PLAYLIST_SESSION_MAX_AGE_MS,
  type PersistedPlaylistSession,
  type TimeRange,
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
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`      expected ${b}`)
    console.log(`      actual   ${a}`)
  }
}

function ok(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
  }
}

console.log('\n1. Building a playlist session with ranges')
{
  const session = buildPlaylistSession({
    playlistId: 'pl-custom-1',
    trackId: 'tr-04',
    trackIndex: 2,
    positionSeconds: 45.5,
    durationSeconds: 240,
    now: 1700000000000,
    listenedRanges: {
      'tr-04': [[0, 45.5]],
    },
  })

  ok('session is not null', session !== null)
  check('playlistId matches', session?.playlistId, 'pl-custom-1')
  check('trackId matches', session?.trackId, 'tr-04')
  check('trackIndex matches', session?.trackIndex, 2)
  check('positionSeconds matches', session?.positionSeconds, 45.5)
  check('durationSeconds matches', session?.durationSeconds, 240)
  check('completed is false by default', session?.completed, false)
  check('totalListenedSeconds is 45.5', session?.totalListenedSeconds, 45.5)
  check('lastPlayedAt matches', session?.lastPlayedAt, 1700000000000)

  const emptyPl = buildPlaylistSession({
    playlistId: '',
    trackId: 'tr-01',
    trackIndex: 0,
    positionSeconds: 0,
    durationSeconds: 100,
  })
  check('empty playlistId rejected', emptyPl, null)

  const emptyTr = buildPlaylistSession({
    playlistId: 'pl-test',
    trackId: '',
    trackIndex: 0,
    positionSeconds: 0,
    durationSeconds: 100,
  })
  check('empty trackId rejected', emptyTr, null)
}

console.log('\n2. Time Range Merging & De-duplication (Replay Protection)')
{
  // Basic disjoint
  check('disjoint ranges', mergeRanges([[0, 30], [60, 90]]), [[0, 30], [60, 90]])

  // Overlapping
  check('overlapping ranges merged', mergeRanges([[0, 30], [20, 50]]), [[0, 50]])

  // Identical duplicate replay
  check('replaying identical segment merged into one', mergeRanges([[0, 60], [0, 60]]), [[0, 60]])

  // Nested
  check('nested range merged', mergeRanges([[0, 100], [20, 50]]), [[0, 100]])

  // Multiple segments
  check('complex sequence merged', mergeRanges([[10, 20], [0, 15], [30, 40], [35, 60]]), [[0, 20], [30, 60]])
}

console.log('\n3. Mandatory Real Listening Progress Scenarios')
{
  // 30 tracks of 200s each = 6000s total duration
  const trackDurations30 = Array.from({ length: 30 }, () => 200)
  const totalDuration = 6000

  // Scenario 1: Start Track 15 -> listen 2 min (120s) -> progress must be 120/6000 = 2% (NEVER 50%)
  const scenario1Progress = calculatePlaylistProgress(
    trackDurations30,
    14, // Track 15 (0-indexed 14)
    120,
    { 'tr-15': [[0, 120]] },
    120,
  )
  check('Scenario 1: Track 15 with 2 min listened is 2.0% (NOT 50%)', scenario1Progress, 2.0)

  // Scenario 2: Start Track 15 -> complete track (200s) -> progress must be 200/6000 = 3.3% (NEVER 50%)
  const scenario2Progress = calculatePlaylistProgress(
    trackDurations30,
    14,
    200,
    { 'tr-15': [[0, 200]] },
    200,
  )
  check('Scenario 2: Track 15 fully completed is 3.3% (previous tracks untouched)', scenario2Progress, 3.3)

  // Scenario 3: Track 1 complete (200s) + Track 2 half (100s) -> 300s / 6000s = 5.0%
  const scenario3Progress = calculatePlaylistProgress(
    trackDurations30,
    1,
    100,
    {
      'tr-1': [[0, 200]],
      'tr-2': [[0, 100]],
    },
    300,
  )
  check('Scenario 3: Track 1 full + Track 2 half = 5.0%', scenario3Progress, 5.0)

  // Scenario 4: Seek forward without playing (ranges remain [0, 20])
  const scenario4Ranges = mergeRanges([[0, 20]]) // Seek happened from 20 to 180 without playing
  const scenario4Listened = calculatePlaylistListenedSeconds({ 'tr-1': scenario4Ranges })
  check('Scenario 4: Seek forward without play adds 0 fake seconds', scenario4Listened, 20)

  // Scenario 5: Replay 0:00-0:30 three times
  const scenario5Ranges = mergeRanges([[0, 30], [0, 30], [0, 30]])
  const scenario5Listened = calculatePlaylistListenedSeconds({ 'tr-1': scenario5Ranges })
  check('Scenario 5: Replaying 3 times preserves exact 30s unique listening', scenario5Listened, 30)

  // Scenario 8: Progress is always clamped between 0 and 100
  check('Progress clamped at 0 for 0s', calculateActualPlaylistProgress(0, 6000), 0)
  check('Progress clamped at 100 for overflow', calculateActualPlaylistProgress(7000, 6000), 100)
}

console.log('\n4. Incomplete vs. Completed Session Filtering')
{
  const durations = [200, 200, 200] // Total: 600s
  const incompleteSession: PersistedPlaylistSession = {
    playlistId: 'pl-1',
    trackId: 'tr-1',
    trackIndex: 0,
    positionSeconds: 50,
    durationSeconds: 200,
    lastPlayedAt: Date.now(),
    updatedAt: new Date().toISOString(),
    completed: false,
    listenedRanges: { 'tr-1': [[0, 50]] },
    totalListenedSeconds: 50,
  }
  ok('50s into track 0 of 600s total is incomplete (8.3%)', isSessionIncomplete(incompleteSession, durations))

  const nearEndSession: PersistedPlaylistSession = {
    ...incompleteSession,
    trackIndex: 2,
    positionSeconds: 195,
    listenedRanges: {
      'tr-1': [[0, 200]],
      'tr-2': [[0, 200]],
      'tr-3': [[0, 195]],
    },
    totalListenedSeconds: 595, // 595/600 = 99.2%
  }
  ok('99% progress is completed (not incomplete)', !isSessionIncomplete(nearEndSession, durations))

  const explicitCompletedSession: PersistedPlaylistSession = {
    ...incompleteSession,
    completed: true,
  }
  ok('explicit completed is filtered out', !isSessionIncomplete(explicitCompletedSession, durations))
}

console.log('\n5. Parsing and Storage Round-trip with Range Persistence')
{
  const now = 1700000000000
  const sessionToSave: PersistedPlaylistSession = {
    playlistId: 'pl-active',
    trackId: 'tr-15',
    trackIndex: 14,
    positionSeconds: 120,
    durationSeconds: 240,
    lastPlayedAt: now,
    updatedAt: new Date(now).toISOString(),
    completed: false,
    listenedRanges: {
      'tr-15': [[0, 120]],
    },
    totalListenedSeconds: 120,
  }

  saveSinglePlaylistSession(sessionToSave, now)
  const loaded = loadPlaylistSessions(now)
  check('loaded session exists', Boolean(loaded['pl-active']), true)
  check('loaded trackIndex is 14', loaded['pl-active']?.trackIndex, 14)
  check('loaded positionSeconds is 120', loaded['pl-active']?.positionSeconds, 120)
  check('loaded totalListenedSeconds is 120', loaded['pl-active']?.totalListenedSeconds, 120)
  check('loaded range for tr-15 preserved', loaded['pl-active']?.listenedRanges?.['tr-15'], [[0, 120]])

  removePlaylistSession('pl-active', now)
  const afterRemove = loadPlaylistSessions(now)
  check('session removed', afterRemove['pl-active'], undefined)
}

console.log(`\n========================================`)
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log(`========================================\n`)

if (failed > 0) {
  process.exit(1)
}
