// ============================================================
// SYSTEMA — Phase 4.1: playback restore initialisation race
// ============================================================
// The bug these tests exist for:
//
//   On an Android cold start the restore ran before the native
//   library had loaded. Every saved id failed to resolve against the
//   empty store, which looked exactly like "all these tracks were
//   deleted" — so the code cleared the saved session. The user's
//   playback context was destroyed by the act of opening the app.
//
// The fix makes the library's readiness an explicit input, so
// "not loaded yet" and "genuinely gone" can no longer produce the
// same decision. These tests exercise the REAL classifier and the
// REAL decision function, not a transcription of them.
//
// Required scenarios (§7 of the phase spec):
//   1. session + library loading           -> WAIT
//   2. library ready + track exists        -> restore succeeds
//   3. library ready + track missing       -> handled safely
//   4. library init failed                 -> session NOT destroyed
//   5. queue with deleted tracks           -> invalid entries removed
//   6. second startup                      -> restore does not run twice
// ============================================================

import type { Track } from '../app/types'
import {
  classifyLibraryReadiness,
  isLibraryAuthoritative,
} from '../app/services/persistence/libraryReadiness'
import {
  decideRestore,
  buildPlaybackSession,
  type PersistedPlaybackSession,
} from '../app/services/persistence/playbackSession'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
  }
}

function check(name: string, actual: unknown, expected: unknown) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.log(`      expected ${JSON.stringify(expected)}`)
    console.log(`      actual   ${JSON.stringify(actual)}`)
  }
}

function track(id: string, title = id): Track {
  return {
    id,
    title,
    artistId: 'ar1',
    albumId: 'al1',
    genreId: 'g1',
    duration: 240,
    year: 2024,
    energy: 50,
    mood: 'calm',
    lang: 'en',
    plays: 0,
    favorite: false,
    addedAt: '2024-01-01',
  }
}

const t1 = track('device:1')
const t2 = track('device:2')
const t3 = track('device:3')

function session(ids: string[], currentIndex = 0): PersistedPlaybackSession {
  return buildPlaybackSession({
    tracks: ids.map(id => track(id)),
    currentIndex,
    positionSeconds: 42,
    shuffle: true,
    repeat: 'all',
  })!
}

console.log('\n\x1b[1mSYSTEMA — restore initialisation race\x1b[0m\n')

// ============================================================
console.log('Library readiness classification')
// ============================================================

// The browser has no native library to wait for, so it is
// immediately authoritative — otherwise `npm run dev` would hang.
check(
  'browser is ready immediately',
  classifyLibraryReadiness({ isNativeLibrary: false, isLoading: false, nativeDataLoaded: false, hasError: false }),
  'ready',
)

// This is the exact state during the cold-start window that caused
// the data loss.
check(
  'native, loading, no data yet -> loading',
  classifyLibraryReadiness({ isNativeLibrary: true, isLoading: true, nativeDataLoaded: false, hasError: false }),
  'loading',
)

// The store is constructed before the init hook runs: not loading,
// no data, no error. Treating this as "ready" is what deleted
// sessions, so it must classify as loading.
check(
  'native, init not started yet -> loading',
  classifyLibraryReadiness({ isNativeLibrary: true, isLoading: false, nativeDataLoaded: false, hasError: false }),
  'loading',
)

check(
  'native, first page loaded -> ready',
  classifyLibraryReadiness({ isNativeLibrary: true, isLoading: false, nativeDataLoaded: true, hasError: false }),
  'ready',
)

check(
  'native, scan error -> failed',
  classifyLibraryReadiness({ isNativeLibrary: true, isLoading: false, nativeDataLoaded: false, hasError: true }),
  'failed',
)

// Denied permission is terminal: the store settles with no data and
// never loads. Calling it "loading" would wait forever.
check(
  'native, permission denied -> failed',
  classifyLibraryReadiness({
    isNativeLibrary: true,
    isLoading: false,
    nativeDataLoaded: false,
    hasError: false,
    permissionStatus: 'denied',
  }),
  'failed',
)

// Not yet answered is in-progress, not a verdict: wait, never delete.
check(
  'native, permission prompt pending -> loading',
  classifyLibraryReadiness({
    isNativeLibrary: true,
    isLoading: false,
    nativeDataLoaded: false,
    hasError: false,
    permissionStatus: 'prompt',
  }),
  'loading',
)

check(
  'native, permission check not returned yet -> loading',
  classifyLibraryReadiness({
    isNativeLibrary: true,
    isLoading: true,
    nativeDataLoaded: false,
    hasError: false,
    permissionStatus: 'unknown',
  }),
  'loading',
)

// An empty phone is a legitimate, authoritative answer.
check(
  'native, granted but genuinely empty -> ready',
  classifyLibraryReadiness({
    isNativeLibrary: true,
    isLoading: false,
    nativeDataLoaded: true,
    hasError: false,
    permissionStatus: 'granted',
  }),
  'ready',
)

ok('only "ready" is authoritative', isLibraryAuthoritative('ready')
  && !isLibraryAuthoritative('loading')
  && !isLibraryAuthoritative('failed'))

// ============================================================
console.log('\n1. Session saved, library still loading -> WAIT')
// ============================================================

const loadingDecision = decideRestore({
  session: session(['device:1', 'device:2']),
  libraryReadiness: 'loading',
  available: [], // empty precisely because it has not loaded
})

check('decision is wait', loadingDecision.action, 'wait')
ok('does not discard while loading', loadingDecision.action !== 'discard')

// The regression itself: with the library loading, an empty lookup
// must never reach the destructive branch.
ok(
  'REGRESSION: empty library during load never clears the session',
  decideRestore({ session: session(['a', 'b', 'c']), libraryReadiness: 'loading', available: [] }).action === 'wait',
)

// ============================================================
console.log('\n2. Library ready, track exists -> restore succeeds')
// ============================================================

const readyDecision = decideRestore({
  session: session(['device:1', 'device:2', 'device:3'], 1),
  libraryReadiness: 'ready',
  available: [t1, t2, t3],
})

check('decision is restore', readyDecision.action, 'restore')
if (readyDecision.action === 'restore') {
  const r = readyDecision.session
  check('whole queue restored', r.tracks.map(t => t.id), ['device:1', 'device:2', 'device:3'])
  check('current index preserved', r.currentIndex, 1)
  check('position preserved', r.positionSeconds, 42)
  check('shuffle preserved', r.shuffle, true)
  check('repeat preserved', r.repeat, 'all')
  check('nothing dropped', r.droppedTrackIds, [])
}

// ============================================================
console.log('\n3. Library ready, current track missing -> handled safely')
// ============================================================

const missingCurrent = decideRestore({
  session: session(['device:1', 'device:2', 'device:3'], 1),
  libraryReadiness: 'ready',
  available: [t1, t3], // the track that was playing is gone
})

check('still restores', missingCurrent.action, 'restore')
if (missingCurrent.action === 'restore') {
  const r = missingCurrent.session
  check('deleted track excluded', r.tracks.map(t => t.id), ['device:1', 'device:3'])
  check('missing id reported', r.droppedTrackIds, ['device:2'])
  // Falls forward to the next survivor rather than jumping to the start.
  check('lands on the next surviving track', r.currentIndex, 1)
  check('position reset for a different track', r.positionSeconds, 0)
}

// ============================================================
console.log('\n4. Library init failed -> session NOT destroyed')
// ============================================================

const failedDecision = decideRestore({
  session: session(['device:1', 'device:2']),
  libraryReadiness: 'failed',
  available: [],
})

check('decision is defer', failedDecision.action, 'defer')
ok('CRITICAL: a failed library never discards the session', failedDecision.action !== 'discard')

// Denied permission travels the same path: no data, but nothing deleted.
const deniedReadiness = classifyLibraryReadiness({
  isNativeLibrary: true,
  isLoading: false,
  nativeDataLoaded: false,
  hasError: false,
  permissionStatus: 'denied',
})
ok(
  'CRITICAL: denied permission never discards the session',
  decideRestore({ session: session(['device:1']), libraryReadiness: deniedReadiness, available: [] }).action === 'defer',
)

// ============================================================
console.log('\n5. Queue containing deleted tracks -> invalid entries removed')
// ============================================================

const partial = decideRestore({
  session: session(['device:1', 'gone:x', 'device:2', 'gone:y', 'device:3'], 0),
  libraryReadiness: 'ready',
  available: [t1, t2, t3],
})

check('restores the survivors', partial.action, 'restore')
if (partial.action === 'restore') {
  const r = partial.session
  check('only existing tracks remain', r.tracks.map(t => t.id), ['device:1', 'device:2', 'device:3'])
  check('both deletions reported', r.droppedTrackIds, ['gone:x', 'gone:y'])
  check('current track kept', r.currentIndex, 0)
  ok('no holes in the queue', r.tracks.every(Boolean))
}

// Whole queue gone, library authoritative: clearing is now correct.
const allGone = decideRestore({
  session: session(['gone:1', 'gone:2']),
  libraryReadiness: 'ready',
  available: [t1],
})
check('entire queue invalid -> discard', allGone.action, 'discard')
if (allGone.action === 'discard') check('discard reason', allGone.reason, 'all-tracks-missing')

// ============================================================
console.log('\n6. Second startup -> restoration does not run twice')
// ============================================================
// The composable latches on a SETTLED outcome, never on a wait.
// This models that latch to prove the ordering is right.

function makeRunner(readinessSequence: Array<'loading' | 'ready' | 'failed'>) {
  let settled = false
  let restoreCount = 0
  let step = 0

  function attempt(available: Track[]) {
    if (settled) return 'skipped-already-settled'
    const state = readinessSequence[Math.min(step, readinessSequence.length - 1)]!
    step++
    const decision = decideRestore({ session: session(['device:1']), libraryReadiness: state, available })
    if (decision.action === 'wait') return 'waiting'
    settled = true
    if (decision.action === 'restore') restoreCount++
    return decision.action
  }

  return { attempt, count: () => restoreCount, isSettled: () => settled }
}

const runner = makeRunner(['loading', 'loading', 'ready'])
check('first attempt waits', runner.attempt([]), 'waiting')
check('second attempt waits', runner.attempt([]), 'waiting')
check('third attempt restores', runner.attempt([t1]), 'restore')
check('fourth attempt is a no-op', runner.attempt([t1]), 'skipped-already-settled')
check('restored exactly once', runner.count(), 1)
ok('latch is set only after a settled outcome', runner.isSettled())

// A wait must NOT latch, otherwise the populated library never gets
// its turn — that was the second half of the original bug.
const neverReady = makeRunner(['loading'])
neverReady.attempt([])
ok('waiting does not latch', !neverReady.isSettled())

// ============================================================
console.log('\nOrdering guarantee')
// ============================================================
// Full cold-start sequence: empty+loading, then populated+ready.
// The point is that the first phase leaves the session intact.

const cold = makeRunner(['loading', 'ready'])
const first = cold.attempt([])
const second = cold.attempt([t1])
ok('start -> wait -> library ready -> restore', first === 'waiting' && second === 'restore')
check('session survived the loading window', cold.count(), 1)

// ============================================================
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`)
if (failed > 0) process.exit(1)
