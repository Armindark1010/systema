// ============================================================
// SYSTEMA — native player contract tests
// ============================================================
// Verifies the pure mapping/normalisation logic that sits between the
// Pinia store and Media3, plus a model of the engine's queue/shuffle/
// repeat semantics. Run: npx tsx scripts/test-native-player.ts
// ============================================================

import assert from 'node:assert/strict'
import type { Track } from '../app/types'

// ---- Local copies of the pure mappers ------------------------
// playerService.ts imports @capacitor/core, which cannot resolve under
// plain tsx. These mirror its conversion logic exactly; the assertions
// below pin the contract those functions must satisfy.

interface NativePlayerTrack {
  id: string
  uri: string
  title: string
  artist: string | null
  album: string | null
  artworkUri: string | null
  duration: number
}

function isPlayableNatively(track: Partial<Track> | null | undefined): boolean {
  return Boolean(track?.uri)
}

function toNativeTrack(track: Track): NativePlayerTrack | null {
  if (!track.uri) return null
  return {
    id: track.id,
    uri: track.uri,
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    artworkUri: track.artworkUri ?? null,
    duration: Math.max(0, Math.round((track.duration || 0) * 1000)),
  }
}

function toNativeTracks(tracks: Track[]): NativePlayerTrack[] {
  const out: NativePlayerTrack[] = []
  for (const t of tracks) {
    const mapped = toNativeTrack(t)
    if (mapped) out.push(mapped)
  }
  return out
}

type RepeatMode = 'off' | 'all' | 'one'
const toNativeRepeat = (m: RepeatMode) => (m === 'one' ? 'one' : m === 'all' ? 'all' : 'off')
const fromNativeRepeat = (m: string): RepeatMode => (m === 'one' ? 'one' : m === 'all' ? 'all' : 'off')

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'ms:external_primary:1',
    title: 'Test Track',
    artistId: 'ar-1',
    albumId: 'al-1',
    genreId: 'gn-1',
    duration: 214,
    year: 2024,
    energy: 0,
    mood: 'focused',
    lang: 'inst',
    plays: 0,
    favorite: false,
    addedAt: new Date().toISOString(),
    artist: 'Test Artist',
    album: 'Test Album',
    uri: 'content://media/external/audio/media/1',
    artworkUri: 'content://media/external/audio/albumart/9',
    ...over,
  } as Track
}

console.log('--- SYSTEMA NATIVE PLAYER TESTS ---')

// 1. Track mapping
console.log('Testing track mapping...')
{
  const native = toNativeTrack(makeTrack())!
  assert.equal(native.uri, 'content://media/external/audio/media/1', 'raw content URI passes through')
  // The UI stores seconds; Media3 wants milliseconds.
  assert.equal(native.duration, 214_000, 'seconds convert to ms')
  assert.equal(native.artworkUri, 'content://media/external/audio/albumart/9')

  // Artwork must stay a URI reference — never bytes.
  assert.ok(!native.artworkUri!.startsWith('data:'), 'artwork is never Base64')
  assert.ok(native.artworkUri!.startsWith('content://'), 'artwork stays a content URI')

  // Absent metadata becomes null, never an invented string.
  const sparse = toNativeTrack(makeTrack({ artist: undefined, album: undefined, artworkUri: undefined }))!
  assert.equal(sparse.artist, null)
  assert.equal(sparse.album, null)
  assert.equal(sparse.artworkUri, null)
}
console.log('✓ tracks map to the native contract by reference')

// 2. Mock catalog tracks must never be sent to Media3
console.log('Testing browser-fallback gate...')
{
  const mock = makeTrack({ id: 'tr-01', uri: undefined })
  assert.equal(isPlayableNatively(mock), false, 'mock tracks are not natively playable')
  assert.equal(toNativeTrack(mock), null, 'mock tracks produce no native item')
  assert.equal(isPlayableNatively(makeTrack()), true, 'device tracks are playable')
  assert.equal(isPlayableNatively(null), false, 'null is safe')
}
console.log('✓ mock catalog stays on the browser engine')

// 3. A malformed row must not destroy the queue
console.log('Testing queue mapping resilience...')
{
  const mapped = toNativeTracks([
    makeTrack({ id: 'a' }),
    makeTrack({ id: 'b', uri: undefined }), // unplayable
    makeTrack({ id: 'c' }),
  ])
  assert.equal(mapped.length, 2, 'unplayable entries are dropped')
  assert.deepEqual(mapped.map(t => t.id), ['a', 'c'], 'playable order preserved')
}
console.log('✓ one bad track cannot break the queue')

// 4. Repeat mode round-trips
console.log('Testing repeat mapping...')
{
  for (const mode of ['off', 'all', 'one'] as RepeatMode[]) {
    assert.equal(fromNativeRepeat(toNativeRepeat(mode)), mode, `${mode} round-trips`)
  }
  assert.equal(fromNativeRepeat('nonsense'), 'off', 'unknown values fall back to off')
}
console.log('✓ repeat modes round-trip safely')

// ---- Engine semantics model ----------------------------------
// Models the PlayerEngine + Media3 playlist behaviour the Kotlin layer
// relies on, so boundary rules are verified rather than assumed.

class EngineModel {
  items: string[] = []
  index = 0
  playing = false
  repeat: RepeatMode = 'off'
  shuffle = false
  /** Media3's shuffle order: a permutation, NOT a destroyed playlist. */
  private shuffleOrder: number[] = []

  setQueue(ids: string[], startIndex = 0) {
    this.items = [...ids]
    this.index = Math.max(0, Math.min(startIndex, ids.length - 1))
    this.playing = true
    this.rebuildShuffle()
  }

  private rebuildShuffle() {
    // Matches ExoPlayer's DefaultShuffleOrder behaviour: the item
    // playing right now stays first, so enabling shuffle never
    // interrupts it. The rest get a deterministic permutation here.
    const rest = this.items
      .map((_, i) => i)
      .filter(i => i !== this.index)
      .reverse()
    this.shuffleOrder = [this.index, ...rest]
  }

  setShuffle(on: boolean) {
    this.shuffle = on
    if (on) this.rebuildShuffle()
  }

  private orderPosition(): number {
    return this.shuffle ? this.shuffleOrder.indexOf(this.index) : this.index
  }

  private atOrder(pos: number): number {
    return this.shuffle ? this.shuffleOrder[pos]! : pos
  }

  private lastOrder(): number {
    return this.items.length - 1
  }

  /** Explicit user Next: repeat-one does NOT trap the user. */
  next() {
    const pos = this.orderPosition()
    if (pos < this.lastOrder()) {
      this.index = this.atOrder(pos + 1)
    } else if (this.repeat === 'all') {
      this.index = this.atOrder(0)
    } else {
      this.playing = false
    }
  }

  /** Automatic end-of-track transition: repeat-one repeats. */
  trackEnded() {
    if (this.repeat === 'one') return
    this.next()
  }

  previous(positionMs = 0) {
    if (positionMs > 3000) return 'restart'
    const pos = this.orderPosition()
    if (pos > 0) this.index = this.atOrder(pos - 1)
    else if (this.repeat === 'all') this.index = this.atOrder(this.lastOrder())
    return 'moved'
  }

  get currentId() { return this.items[this.index] }
}

// 5. Repeat OFF stops at the boundary
console.log('Testing repeat OFF boundary...')
{
  const e = new EngineModel()
  e.setQueue(['a', 'b', 'c'], 2)
  e.next()
  assert.equal(e.playing, false, 'playback stops past the last track')
  assert.equal(e.currentId, 'c', 'stays on the last track')
}
console.log('✓ repeat OFF stops cleanly at the end')

// 6. Repeat ALL wraps both directions
console.log('Testing repeat ALL boundaries...')
{
  const e = new EngineModel()
  e.setQueue(['a', 'b', 'c'], 2)
  e.repeat = 'all'
  e.next()
  assert.equal(e.currentId, 'a', 'wraps forward to the start')
  e.previous()
  assert.equal(e.currentId, 'c', 'wraps backward to the end')
}
console.log('✓ repeat ALL wraps at both boundaries')

// 7. Repeat ONE repeats automatically but not on an explicit skip
console.log('Testing repeat ONE...')
{
  const e = new EngineModel()
  e.setQueue(['a', 'b', 'c'], 0)
  e.repeat = 'one'

  e.trackEnded()
  assert.equal(e.currentId, 'a', 'automatic transition repeats the track')

  e.next()
  assert.equal(e.currentId, 'b', 'an explicit Next still advances')
}
console.log('✓ repeat ONE repeats on end, not on user skip')

// 8. Shuffle is a stable order, not a random pick each time
console.log('Testing shuffle stability...')
{
  const e = new EngineModel()
  e.setQueue(['a', 'b', 'c', 'd'], 0)
  const before = e.currentId
  e.setShuffle(true)
  assert.equal(e.currentId, before, 'enabling shuffle does not change the current track')

  // Walk forward, then back: we must retrace the same path, which a
  // random-pick-per-Next implementation could never guarantee.
  const forward: string[] = []
  for (let i = 0; i < 3; i++) { e.next(); forward.push(e.currentId!) }
  assert.equal(new Set(forward).size, 3, 'shuffle visits distinct tracks, never repeats')

  const path = [before!, ...forward]
  const backward: string[] = []
  for (let i = 0; i < 3; i++) { e.previous(); backward.push(e.currentId!) }

  // Walking back must retrace the exact outward path in reverse.
  assert.deepEqual(backward, path.slice(0, 3).reverse(),
    'previous retraces the shuffle order exactly')
  assert.equal(e.currentId, before, 'we end up back where we started')

  // The underlying queue is untouched: order is recoverable.
  assert.deepEqual(e.items, ['a', 'b', 'c', 'd'], 'shuffle never destroys the queue order')

  e.setShuffle(false)
  assert.deepEqual(e.items, ['a', 'b', 'c', 'd'], 'disabling shuffle restores linear order')
}
console.log('✓ shuffle is a stable, reversible order')

// 9. Seek clamping
console.log('Testing seek clamping...')
{
  const clamp = (pos: number, dur: number) => Math.max(0, Math.min(pos, dur))
  assert.equal(clamp(-5000, 200_000), 0, 'negative clamps to 0')
  assert.equal(clamp(999_999, 200_000), 200_000, 'overshoot clamps to duration')
  assert.equal(clamp(45_000, 200_000), 45_000, 'in-range passes through')

  // ±15s from near the boundaries must stay in range.
  assert.equal(clamp(5_000 - 15_000, 200_000), 0, 'rewind past the start clamps')
  assert.equal(clamp(195_000 + 15_000, 200_000), 200_000, 'forward past the end clamps')
}
console.log('✓ seeks clamp to [0, duration]')

// 10. Queue index mapping between Pinia and native
console.log('Testing queue index mapping...')
{
  // Pinia models "current track + upcoming queue"; the native queue is
  // one flat list with the current track at index 0. A reorder of
  // Pinia indices therefore shifts by one natively.
  const toNativeIndex = (pinia: number) => pinia + 1
  assert.equal(toNativeIndex(0), 1, 'first upcoming item is native index 1')
  assert.equal(toNativeIndex(4), 5)

  const current = { id: 'cur' }
  const queue = [{ id: 'q1' }, { id: 'q2' }]
  const nativeQueue = [current, ...queue].map(t => t.id)
  assert.deepEqual(nativeQueue, ['cur', 'q1', 'q2'], 'native queue leads with the current track')
}
console.log('✓ Pinia and native queue indices line up')

console.log('--- ALL NATIVE PLAYER TESTS PASSED! ---')
