// ============================================================
// SYSTEMA — Phase 4: playback restoration tests
// ============================================================
// These import and exercise the REAL implementation from
// app/services/persistence/playbackSession.ts rather than a
// transcription of it, so the assertions cannot drift from the
// shipping code. That module is deliberately free of Vue, Nuxt
// auto-imports and Capacitor for exactly this reason — the only thing
// stubbed below is localStorage, which does not exist under tsx.
//
// Covers the phase requirements:
//   §6  what is persisted (ids, not files or bitmaps)
//   §7  restoration rules, deleted tracks, empty queue
//   §8  position clamping
//   §9  queue restoration by stable id, never by index
//   §10 restoration must not touch Recents
// ============================================================

// ---- localStorage stub (must precede the import) -------------
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  },
}
// The adapter checks import.meta.client; under tsx it is undefined, so
// the storage IO functions no-op. The pure functions are what matter
// here and they are tested directly.

import type { Track } from '../app/types'
import {
  buildPlaybackSession,
  parsePlaybackSession,
  resolvePlaybackSession,
  clampPosition,
  PLAYBACK_SESSION_VERSION,
  PLAYBACK_SESSION_MAX_AGE_MS,
  type PersistedPlaybackSession,
} from '../app/services/persistence/playbackSession'

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
  check(name, condition, true)
}

function group(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ---- Fixtures -------------------------------------------------

function track(id: string, duration = 200): Track {
  return {
    id,
    title: id.toUpperCase(),
    artistId: 'ar1',
    albumId: 'al1',
    genreId: 'g1',
    duration,
    year: 2024,
    energy: 50,
    mood: 'calm',
    lang: 'en',
    plays: 0,
    favorite: false,
    addedAt: '2024-01-01',
  } as Track
}

const A = track('ms:ext:1')
const B = track('ms:ext:2')
const C = track('ms:ext:3')
const D = track('ms:ext:4')

const NOW = 1_700_000_000_000

// ------------------------------------------------------------
group('1. Building a session')
// ------------------------------------------------------------
{
  const s = buildPlaybackSession({
    tracks: [A, B, C],
    currentIndex: 1,
    positionSeconds: 80.456,
    shuffle: true,
    repeat: 'all',
    now: NOW,
  })!

  check('stores stable track ids in order', s.trackIds, ['ms:ext:1', 'ms:ext:2', 'ms:ext:3'])
  check('stores the current index', s.currentIndex, 1)
  check('rounds the position', s.positionSeconds, 80.46)
  check('stores shuffle', s.shuffle, true)
  check('stores repeat', s.repeat, 'all')
  check('stamps the save time', s.savedAt, NOW)
  check('is versioned', s.version, PLAYBACK_SESSION_VERSION)

  // §6: nothing heavy may be persisted.
  const keys = Object.keys(s).sort()
  check('persists exactly six fields', keys,
    ['currentIndex', 'positionSeconds', 'repeat', 'savedAt', 'shuffle', 'trackIds', 'version'].sort())
  const serialised = JSON.stringify(s)
  ok('no artwork persisted', !serialised.includes('artwork'))
  ok('no uri persisted', !serialised.includes('content://') && !serialised.includes('uri'))
  ok('no title/metadata persisted', !serialised.includes('MS:EXT'))

  check('an empty queue produces no session',
    buildPlaybackSession({
      tracks: [], currentIndex: 0, positionSeconds: 0, shuffle: false, repeat: 'off',
    }), null)

  const clamped = buildPlaybackSession({
    tracks: [A, B], currentIndex: 99, positionSeconds: -5, shuffle: false, repeat: 'off', now: NOW,
  })!
  check('out-of-range index is clamped', clamped.currentIndex, 1)
  check('negative position becomes 0', clamped.positionSeconds, 0)

  const nanSession = buildPlaybackSession({
    tracks: [A], currentIndex: Number.NaN, positionSeconds: Number.NaN,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  check('NaN index falls back to 0', nanSession.currentIndex, 0)
  check('NaN position falls back to 0', nanSession.positionSeconds, 0)
}

// ------------------------------------------------------------
group('2. Parsing what came back from storage')
// ------------------------------------------------------------
{
  const valid: PersistedPlaybackSession = {
    version: PLAYBACK_SESSION_VERSION,
    trackIds: ['ms:ext:1', 'ms:ext:2'],
    currentIndex: 1,
    positionSeconds: 10,
    shuffle: false,
    repeat: 'one',
    savedAt: NOW,
  }

  ok('a valid payload parses', parsePlaybackSession(valid, NOW) !== null)
  check('null is rejected', parsePlaybackSession(null, NOW), null)
  check('a string is rejected', parsePlaybackSession('nonsense', NOW), null)
  check('a number is rejected', parsePlaybackSession(42, NOW), null)
  check('an empty object is rejected', parsePlaybackSession({}, NOW), null)
  check('a wrong version is rejected',
    parsePlaybackSession({ ...valid, version: 99 }, NOW), null)
  check('a missing queue is rejected',
    parsePlaybackSession({ ...valid, trackIds: [] }, NOW), null)
  check('a non-array queue is rejected',
    parsePlaybackSession({ ...valid, trackIds: 'a,b' }, NOW), null)

  const dirty = parsePlaybackSession(
    { ...valid, trackIds: ['ms:ext:1', '', null, 42, 'ms:ext:2'] }, NOW,
  )!
  check('non-string ids are dropped', dirty.trackIds, ['ms:ext:1', 'ms:ext:2'])

  check('an unknown repeat mode falls back to off',
    parsePlaybackSession({ ...valid, repeat: 'sideways' }, NOW)!.repeat, 'off')
  check('a non-boolean shuffle falls back to false',
    parsePlaybackSession({ ...valid, shuffle: 'yes' }, NOW)!.shuffle, false)
  check('a negative position falls back to 0',
    parsePlaybackSession({ ...valid, positionSeconds: -12 }, NOW)!.positionSeconds, 0)
  check('an out-of-range index is clamped',
    parsePlaybackSession({ ...valid, currentIndex: 500 }, NOW)!.currentIndex, 1)

  // Stale sessions are noise, and their files are likelier to be gone.
  check('a session older than the max age is rejected',
    parsePlaybackSession({ ...valid, savedAt: NOW - PLAYBACK_SESSION_MAX_AGE_MS - 1 }, NOW), null)
  ok('a session inside the max age survives',
    parsePlaybackSession({ ...valid, savedAt: NOW - PLAYBACK_SESSION_MAX_AGE_MS + 1000 }, NOW) !== null)
  ok('a future timestamp is tolerated, not discarded',
    parsePlaybackSession({ ...valid, savedAt: NOW + 60_000 }, NOW) !== null)
}

// ------------------------------------------------------------
group('3. Resolving against the live library (§9)')
// ------------------------------------------------------------
{
  const session = buildPlaybackSession({
    tracks: [A, B, C], currentIndex: 1, positionSeconds: 50,
    shuffle: true, repeat: 'all', now: NOW,
  })!

  const full = resolvePlaybackSession(session, [A, B, C, D])!
  check('the queue is restored in order', full.tracks.map(t => t.id),
    ['ms:ext:1', 'ms:ext:2', 'ms:ext:3'])
  check('the current track is preserved', full.tracks[full.currentIndex]!.id, 'ms:ext:2')
  check('the position is preserved', full.positionSeconds, 50)
  check('shuffle is restored', full.shuffle, true)
  check('repeat is restored', full.repeat, 'all')
  check('nothing was dropped', full.droppedTrackIds, [])

  // A Map is accepted too (what the composable actually passes).
  const viaMap = resolvePlaybackSession(session, new Map([[A.id, A], [B.id, B], [C.id, C]]))!
  check('a Map lookup resolves identically', viaMap.tracks.map(t => t.id),
    ['ms:ext:1', 'ms:ext:2', 'ms:ext:3'])

  // §9: resolution is by id, so a library that reordered between
  // sessions must not change which track is current.
  const reordered = resolvePlaybackSession(session, [D, C, B, A])!
  check('reordering the library does not change the current track',
    reordered.tracks[reordered.currentIndex]!.id, 'ms:ext:2')
}

// ------------------------------------------------------------
group('4. Deleted tracks (§7, §9) — never crash')
// ------------------------------------------------------------
{
  const session = buildPlaybackSession({
    tracks: [A, B, C], currentIndex: 2, positionSeconds: 30,
    shuffle: false, repeat: 'off', now: NOW,
  })!

  // A track BEFORE the current one is gone: the index must shift down
  // so the same track keeps playing. This is what storing a raw Media3
  // index could never survive.
  const withoutFirst = resolvePlaybackSession(session, [B, C])!
  check('a deleted earlier track shifts the index',
    withoutFirst.tracks[withoutFirst.currentIndex]!.id, 'ms:ext:3')
  check('the deleted id is reported', withoutFirst.droppedTrackIds, ['ms:ext:1'])
  check('the position survives', withoutFirst.positionSeconds, 30)

  // The CURRENT track is gone: fall to the next survivor, from 0.
  const midSession = buildPlaybackSession({
    tracks: [A, B, C], currentIndex: 1, positionSeconds: 42,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  const withoutCurrent = resolvePlaybackSession(midSession, [A, C])!
  check('a deleted current track falls to the next survivor',
    withoutCurrent.tracks[withoutCurrent.currentIndex]!.id, 'ms:ext:3')
  check('its position resets (it belonged to another track)',
    withoutCurrent.positionSeconds, 0)

  // Current track gone AND it was last: clamp to the final survivor.
  const lastSession = buildPlaybackSession({
    tracks: [A, B, C], currentIndex: 2, positionSeconds: 42,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  const withoutLast = resolvePlaybackSession(lastSession, [A, B])!
  check('a deleted last track clamps to the final survivor',
    withoutLast.tracks[withoutLast.currentIndex]!.id, 'ms:ext:2')

  // Everything gone: no session at all rather than an empty player.
  check('an entirely missing queue resolves to null',
    resolvePlaybackSession(session, []), null)
  check('a library with only unrelated tracks resolves to null',
    resolvePlaybackSession(session, [D]), null)

  // One-track queue survives as a one-track queue.
  const single = buildPlaybackSession({
    tracks: [A], currentIndex: 0, positionSeconds: 5,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  const singleResolved = resolvePlaybackSession(single, [A])!
  check('a one-track queue restores', singleResolved.tracks.length, 1)
  check('and stays current', singleResolved.currentIndex, 0)
}

// ------------------------------------------------------------
group('5. Position clamping (§8)')
// ------------------------------------------------------------
{
  check('a normal position passes through', clampPosition(45, 200), 45)
  check('a negative position becomes 0', clampPosition(-10, 200), 0)
  check('zero stays zero', clampPosition(0, 200), 0)
  check('beyond the duration restarts the track', clampPosition(500, 200), 0)
  check('exactly at the duration restarts', clampPosition(200, 200), 0)
  // Landing in the final second would fire an immediate track change.
  check('within the last second restarts', clampPosition(199.5, 200), 0)
  check('just before that is kept', clampPosition(198, 200), 198)

  // §8: an unknown duration must NOT clamp to zero — that was the bug
  // that silently rewound every restore.
  check('an unknown duration passes the position through', clampPosition(45, 0), 45)
  check('an undefined duration passes through', clampPosition(45, undefined), 45)
  check('a null duration passes through', clampPosition(45, null), 45)
  check('a NaN duration passes through', clampPosition(45, Number.NaN), 45)
  check('a NaN position becomes 0', clampPosition(Number.NaN, 200), 0)
  check('an Infinity duration passes through', clampPosition(45, Number.POSITIVE_INFINITY), 45)

  // The resolver applies the clamp against the RESTORED track.
  const past = buildPlaybackSession({
    tracks: [track('ms:ext:9', 100)], currentIndex: 0, positionSeconds: 300,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  const resolvedPast = resolvePlaybackSession(past, [track('ms:ext:9', 100)])!
  check('a position past a shortened track restarts it', resolvedPast.positionSeconds, 0)

  // Duration changed between sessions (re-encoded file, §20.11).
  const changed = buildPlaybackSession({
    tracks: [track('ms:ext:9', 300)], currentIndex: 0, positionSeconds: 250,
    shuffle: false, repeat: 'off', now: NOW,
  })!
  const resolvedChanged = resolvePlaybackSession(changed, [track('ms:ext:9', 400)])!
  check('a lengthened track keeps its position', resolvedChanged.positionSeconds, 250)
}

// ------------------------------------------------------------
group('6. Round trip')
// ------------------------------------------------------------
{
  const original = buildPlaybackSession({
    tracks: [A, B, C, D], currentIndex: 2, positionSeconds: 99.9,
    shuffle: true, repeat: 'one', now: NOW,
  })!
  const reparsed = parsePlaybackSession(JSON.parse(JSON.stringify(original)), NOW)!
  check('survives JSON', reparsed, original)

  const resolved = resolvePlaybackSession(reparsed, [A, B, C, D])!
  check('and resolves back to the same track',
    resolved.tracks[resolved.currentIndex]!.id, 'ms:ext:3')
  check('with shuffle intact', resolved.shuffle, true)
  check('with repeat intact', resolved.repeat, 'one')
}

// ------------------------------------------------------------
console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
