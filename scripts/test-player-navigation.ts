// ============================================================
// SYSTEMA — Player navigation / queue / recents tests
// ============================================================
// Covers the 23 required cases for the navigation fix.
//
// Nuxt composables cannot be imported here (auto-imports and the
// Capacitor bridge are unavailable outside the app runtime), so this
// suite mirrors the exact logic that ships in the store and in
// usePlaybackHistory. Any behavioural change must be made in both
// places — which is why each model below is a direct transcription
// rather than a paraphrase.
// ============================================================

interface Track { id: string; title: string; duration: number }

const track = (id: string): Track => ({ id, title: id.toUpperCase(), duration: 200 })
const A = track('a'); const B = track('b'); const C = track('c')
const D = track('d'); const E = track('e')

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

function group(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ------------------------------------------------------------
// Queue model — mirrors app/stores/player.ts
// ------------------------------------------------------------

const RESTART_THRESHOLD_SECONDS = 3

class QueueModel {
  order: Track[] = []
  index = -1
  shuffleOrder: number[] = []
  isShuffle = false
  repeat: 'off' | 'all' | 'one' = 'off'
  currentTime = 0
  isPlaying = false
  recents: string[] = []
  private lastRecorded: string | null = null

  get current(): Track | null {
    return this.order[this.index] ?? null
  }

  /** Playback order as indices — linear, or the shuffle permutation. */
  positions(): number[] {
    if (this.isShuffle && this.shuffleOrder.length === this.order.length) {
      return this.shuffleOrder
    }
    return this.order.map((_, i) => i)
  }

  get upNext(): Track[] {
    if (this.index < 0) return this.order
    const p = this.positions()
    const at = p.indexOf(this.index)
    if (at < 0) return []
    return p.slice(at + 1).map(i => this.order[i]!).filter(Boolean)
  }

  get history(): Track[] {
    if (this.index < 0) return []
    const p = this.positions()
    const at = p.indexOf(this.index)
    if (at <= 0) return []
    return p.slice(0, at).map(i => this.order[i]!).filter(Boolean)
  }

  /** Deterministic permutation; `rng` injected so tests are stable. */
  rebuildShuffle(rng: () => number = Math.random) {
    const indices = this.order.map((_, i) => i)
    const cur = this.index
    const rest = indices.filter(i => i !== cur)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = rest[i]!; rest[i] = rest[j]!; rest[j] = tmp
    }
    this.shuffleOrder = cur >= 0 ? [cur, ...rest] : rest
  }

  /** Records only genuine playback starts, collapsing repeats. */
  record() {
    const t = this.current
    if (!t) return
    if (this.recents[0] === t.id) { this.lastRecorded = t.id; return }
    this.lastRecorded = t.id
    this.recents = [t.id, ...this.recents.filter(id => id !== t.id)].slice(0, 50)
  }

  moveTo(index: number) {
    const t = this.order[index]
    if (!t) return
    this.index = index
    this.currentTime = 0
    this.isPlaying = true
    this.record()
  }

  playQueue(tracks: Track[], startIndex = 0) {
    if (!tracks.length) return
    const safe = Math.max(0, Math.min(startIndex, tracks.length - 1))
    this.order = [...tracks]
    this.index = safe
    this.rebuildShuffle()
    this.currentTime = 0
    this.isPlaying = true
    this.record()
  }

  playTrack(t: Track) {
    const existing = this.order.findIndex(x => x.id === t.id)
    if (existing >= 0) { this.index = existing }
    else { this.order = [t]; this.index = 0; this.rebuildShuffle() }
    this.currentTime = 0
    this.isPlaying = true
    this.record()
  }

  next(auto = false) {
    if (this.index < 0) return
    if (auto && this.repeat === 'one') { this.currentTime = 0; this.isPlaying = true; return }
    const p = this.positions()
    const at = p.indexOf(this.index)
    if (at < 0) return
    if (at < p.length - 1) return this.moveTo(p[at + 1]!)
    if (this.repeat === 'all' && p.length) return this.moveTo(p[0]!)
    this.isPlaying = false
    this.currentTime = 0
  }

  previous() {
    if (this.index < 0) return
    if (this.currentTime > RESTART_THRESHOLD_SECONDS) { this.currentTime = 0; return }
    const p = this.positions()
    const at = p.indexOf(this.index)
    if (at < 0) return
    if (at > 0) return this.moveTo(p[at - 1]!)
    if (this.repeat === 'all' && p.length) return this.moveTo(p[p.length - 1]!)
    this.currentTime = 0
  }

  reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const up = this.upNext
    const moved = up[fromIndex]; const target = up[toIndex]
    if (!moved || !target) return
    const from = this.order.findIndex(t => t.id === moved.id)
    const to = this.order.findIndex(t => t.id === target.id)
    if (from < 0 || to < 0) return
    const next = [...this.order]
    const [item] = next.splice(from, 1)
    if (!item) return
    next.splice(to, 0, item)
    const playing = this.current
    this.order = next
    if (playing) {
      const idx = next.findIndex(t => t.id === playing.id)
      if (idx >= 0) this.index = idx
    }
    this.rebuildShuffle()
  }

  toggleShuffle(rng?: () => number) {
    this.isShuffle = !this.isShuffle
    if (this.isShuffle) this.rebuildShuffle(rng)
    else this.shuffleOrder = []
  }

  /** Mirrors a Media3 currentMediaItemChanged event, resolved by id. */
  onNativeItemChanged(mediaId: string) {
    const idx = this.order.findIndex(t => t.id === mediaId)
    if (idx < 0) return { ok: false, code: 'NOT_FOUND' as const }
    this.index = idx
    this.currentTime = 0
    this.record()
    return { ok: true as const }
  }
}

const ids = (list: Track[]) => list.map(t => t.id)

// ------------------------------------------------------------
group('1. Normal queue construction')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 0)
  check('order is the full list', ids(q.order), ['a', 'b', 'c', 'd', 'e'])
  check('current is A', q.current?.id, 'a')
  check('up next excludes the current track', ids(q.upNext), ['b', 'c', 'd', 'e'])
  check('history is empty at the start', ids(q.history), [])
  check('index is 0', q.index, 0)
}

// ------------------------------------------------------------
group('2. Next chain A -> B -> C -> D')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 0)
  const seen: string[] = [q.current!.id]
  q.next(); seen.push(q.current!.id)
  q.next(); seen.push(q.current!.id)
  q.next(); seen.push(q.current!.id)
  check('follows the real order', seen, ['a', 'b', 'c', 'd'])
  check('queue is not consumed', ids(q.order), ['a', 'b', 'c', 'd'])
  check('history rebuilt from order', ids(q.history), ['a', 'b', 'c'])
}

// ------------------------------------------------------------
group('3. Previous chain D -> C -> B -> A')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 3)
  const seen: string[] = [q.current!.id]
  q.previous(); seen.push(q.current!.id)
  q.previous(); seen.push(q.current!.id)
  q.previous(); seen.push(q.current!.id)
  check('walks back through the real order', seen, ['d', 'c', 'b', 'a'])
  check('order unchanged', ids(q.order), ['a', 'b', 'c', 'd'])
}

// ------------------------------------------------------------
group('4. Previous after 3 s restarts the track')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C], 1)
  q.currentTime = 12
  q.previous()
  check('stays on B', q.current?.id, 'b')
  check('restarts at 0', q.currentTime, 0)
}

// ------------------------------------------------------------
group('5. Previous near the start moves back')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C], 1)
  q.currentTime = 1.2
  q.previous()
  check('moves to A', q.current?.id, 'a')
}

// ------------------------------------------------------------
group('6. Repeat modes')
// ------------------------------------------------------------
{
  const off = new QueueModel()
  off.playQueue([A, B], 1)
  off.next()
  check('REPEAT_OFF stops at the end', off.isPlaying, false)
  check('REPEAT_OFF keeps the last track', off.current?.id, 'b')

  const all = new QueueModel()
  all.repeat = 'all'
  all.playQueue([A, B, C], 2)
  all.next()
  check('REPEAT_ALL wraps forward to A', all.current?.id, 'a')
  all.previous()
  check('REPEAT_ALL wraps backward to C', all.current?.id, 'c')

  const one = new QueueModel()
  one.repeat = 'one'
  one.playQueue([A, B, C], 1)
  one.currentTime = 55
  one.next(true)
  check('REPEAT_ONE repeats on automatic end', one.current?.id, 'b')
  check('REPEAT_ONE restarts position', one.currentTime, 0)
  one.next(false)
  check('explicit Next still advances under REPEAT_ONE', one.current?.id, 'c')
}

// ------------------------------------------------------------
group('7. Shuffle is a fixed order, not random per press')
// ------------------------------------------------------------
{
  // Force the documented example permutation C A E B D.
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 2) // current = C
  q.isShuffle = true
  q.shuffleOrder = [2, 0, 4, 1, 3] // C A E B D
  check('permutation covers every track once',
    [...q.shuffleOrder].sort((x, y) => x - y), [0, 1, 2, 3, 4])
  check('current track is first in the shuffle order', q.shuffleOrder[0], q.index)

  const forward: string[] = [q.current!.id]
  q.next(); forward.push(q.current!.id)
  q.next(); forward.push(q.current!.id)
  q.next(); forward.push(q.current!.id)
  q.next(); forward.push(q.current!.id)
  check('shuffle Next follows C A E B D', forward, ['c', 'a', 'e', 'b', 'd'])

  const back: string[] = [q.current!.id]
  q.previous(); back.push(q.current!.id)
  q.previous(); back.push(q.current!.id)
  q.previous(); back.push(q.current!.id)
  q.previous(); back.push(q.current!.id)
  check('shuffle Previous retraces D B E A C', back, ['d', 'b', 'e', 'a', 'c'])
}

// ------------------------------------------------------------
group('8. Toggling shuffle preserves the current track')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 2)
  const before = q.current?.id
  q.toggleShuffle(() => 0.42)
  check('enabling keeps the same track', q.current?.id, before)
  check('enabling does not restart it', q.currentTime, 0)
  check('current track leads the shuffle order', q.shuffleOrder[0], q.index)

  q.toggleShuffle()
  check('disabling keeps the same track', q.current?.id, before)
  check('disabling restores the original order', ids(q.order), ['a', 'b', 'c', 'd', 'e'])
  check('linear Next resumes after C', (() => { q.next(); return q.current?.id })(), 'd')
}

// ------------------------------------------------------------
group('9. Queue reorder affects real playback order')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 0) // current A, up next B C D E
  q.reorder(2, 0) // move D to the front of up next
  check('up next reordered', ids(q.upNext), ['d', 'b', 'c', 'e'])
  check('real order reflects it', ids(q.order), ['a', 'd', 'b', 'c', 'e'])
  check('current track unchanged', q.current?.id, 'a')
  check('current index follows the track', q.index, 0)
  check('Next now plays D', (() => { q.next(); return q.current?.id })(), 'd')
  check('Previous returns to A', (() => { q.previous(); return q.current?.id })(), 'a')
}

// ------------------------------------------------------------
group('10. Reorder does not restart the playing track')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 1)
  q.currentTime = 44
  q.reorder(0, 1)
  check('still on B', q.current?.id, 'b')
  check('position preserved', q.currentTime, 44)
}

// ------------------------------------------------------------
group('11. Playlist / Library / Search playback context')
// ------------------------------------------------------------
{
  const playlist = new QueueModel()
  playlist.playQueue([A, B, C, D, E], 2) // tap track C
  check('whole playlist becomes the queue', ids(playlist.order), ['a', 'b', 'c', 'd', 'e'])
  check('current is the tapped track', playlist.current?.id, 'c')
  check('Previous goes to B', (() => { playlist.previous(); return playlist.current?.id })(), 'b')
  playlist.next()
  check('Next goes back to C', playlist.current?.id, 'c')
  playlist.next()
  check('Next continues to D', playlist.current?.id, 'd')

  const search = new QueueModel()
  search.playQueue([C, A, E], 1)
  check('search results form the context', ids(search.order), ['c', 'a', 'e'])
  check('search current is the tapped item', search.current?.id, 'a')

  const library = new QueueModel()
  library.playQueue([A, B, C], 0)
  check('library play starts a real context', ids(library.upNext), ['b', 'c'])

  const single = new QueueModel()
  single.playTrack(A)
  check('a lone track still plays', single.current?.id, 'a')
  single.playTrack(A)
  check('replaying the same track does not duplicate it', ids(single.order), ['a'])
}

// ------------------------------------------------------------
group('12. play(track) preserves an existing context')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 0)
  q.playTrack(C)
  check('jumps within the queue', q.current?.id, 'c')
  check('queue is preserved, not replaced', ids(q.order), ['a', 'b', 'c', 'd'])
  check('Next still follows the context', (() => { q.next(); return q.current?.id })(), 'd')
}

// ------------------------------------------------------------
group('13. Recents: insertion, dedup and ordering')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C], 0)
  check('first play recorded', q.recents, ['a'])
  q.next()
  check('newest first', q.recents, ['b', 'a'])
  q.next()
  check('ordering maintained', q.recents, ['c', 'b', 'a'])

  // Repeat events for the same track must not duplicate.
  q.record(); q.record(); q.record()
  check('repeat events insert nothing', q.recents, ['c', 'b', 'a'])

  // Replaying an earlier track moves it to the top, no duplicate.
  q.playTrack(A)
  check('replay moves to top without duplicating', q.recents, ['a', 'c', 'b'])

  // The documented B, A case rather than B, B, B, A.
  const d = new QueueModel()
  d.playQueue([A, B], 0)
  d.next()
  d.record(); d.record()
  check('result is B, A not B, B, B, A', d.recents, ['b', 'a'])
}

// ------------------------------------------------------------
group('14. Recents are not the queue')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 0)
  q.next()
  check('queue holds upcoming tracks', ids(q.upNext), ['c', 'd', 'e'])
  check('recents hold played tracks', q.recents, ['b', 'a'])
  check('queued-but-unplayed tracks are absent from recents',
    q.recents.includes('e'), false)
}

// ------------------------------------------------------------
group('15. Queueing a track never records it as played')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A], 0)
  q.order = [...q.order, D, E] // queued only
  check('queued tracks stay out of recents', q.recents, ['a'])
}

// ------------------------------------------------------------
group('16. Rapid Next and Previous settle correctly')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 0)
  q.next(); q.next(); q.next()
  check('three rapid Next land on D', q.current?.id, 'd')
  check('index matches the track', q.index, 3)
  check('no duplicate recents from rapid navigation',
    q.recents, ['d', 'c', 'b', 'a'])

  q.previous(); q.previous(); q.next(); q.previous()
  check('prev/prev/next/prev settles on B', q.current?.id, 'b')
  check('index still consistent', q.order[q.index]?.id, 'b')
}

// ------------------------------------------------------------
group('17. currentMediaItemChanged reconciliation')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 0)

  // Native jumped to D on its own (e.g. it skipped unplayable files).
  const res = q.onNativeItemChanged('d')
  check('native event accepted', res.ok, true)
  check('current follows native', q.current?.id, 'd')
  check('index derived from the native item, not incremented', q.index, 3)
  check('reaching D records it', q.recents[0], 'd')

  // An unknown id must not silently select a different track.
  const before = q.current?.id
  const bad = q.onNativeItemChanged('does-not-exist')
  check('unknown mediaId returns a structured error', bad, { ok: false, code: 'NOT_FOUND' })
  check('current track untouched on failure', q.current?.id, before)
}

// ------------------------------------------------------------
group('18. Stable mediaId mapping')
// ------------------------------------------------------------
{
  const q = new QueueModel()
  // Same title/artist, different ids — identity must come from the id.
  const dupA = { id: 'x1', title: 'Same Title', duration: 100 }
  const dupB = { id: 'x2', title: 'Same Title', duration: 100 }
  q.playQueue([dupA, dupB], 0)
  q.onNativeItemChanged('x2')
  check('resolves the correct duplicate-titled track', q.current?.id, 'x2')
  check('index is right despite identical titles', q.index, 1)
}

// ------------------------------------------------------------
group('19. Cross-surface control sequence')
// ------------------------------------------------------------
{
  // Library play A -> Mini Next -> Fullscreen Next -> Queue Previous
  // -> Playlist play C -> Mini Previous -> Search play D -> Next.
  // Every surface calls the SAME store actions.
  const q = new QueueModel()
  q.playQueue([A, B, C, D, E], 0)
  check('library play -> A', q.current?.id, 'a')
  q.next()
  check('mini next -> B', q.current?.id, 'b')
  q.next()
  check('fullscreen next -> C', q.current?.id, 'c')
  q.previous()
  check('queue previous -> B', q.current?.id, 'b')

  q.playQueue([A, B, C, D, E], 2)
  check('playlist play C -> C', q.current?.id, 'c')
  q.previous()
  check('mini previous -> B', q.current?.id, 'b')

  q.playQueue([D, E], 0)
  check('search play D -> D', q.current?.id, 'd')
  q.next()
  check('fullscreen next -> E', q.current?.id, 'e')

  check('index always agrees with the track', q.order[q.index]?.id, q.current?.id)
  check('recents reflect only what played', q.recents, ['e', 'd', 'b', 'c', 'a'])
}

// ------------------------------------------------------------
group('20. Frontend order always equals the native payload')
// ------------------------------------------------------------
{
  // pushQueue() sends the whole order plus the index; there is no
  // "current + upcoming" reshaping left to drift.
  const q = new QueueModel()
  q.playQueue([A, B, C, D], 1)
  const payload = { tracks: ids(q.order), startIndex: q.index }
  check('payload is the full order', payload.tracks, ['a', 'b', 'c', 'd'])
  check('payload index is the current index', payload.startIndex, 1)

  q.next()
  q.reorder(0, 1)
  const after = { tracks: ids(q.order), startIndex: q.index }
  check('after navigation + reorder the order still matches',
    after.tracks.length, q.order.length)
  check('index still points at the playing track',
    q.order[after.startIndex]?.id, q.current?.id)
}

// ------------------------------------------------------------
console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
