// ============================================================
// SYSTEMA — Library pagination logic tests
// ============================================================
// Models the store's pagination state machine against a fake native
// index so the ordering/race guarantees can be verified without a
// device. Run: npx tsx scripts/test-library-pagination.ts
// ============================================================

import assert from 'node:assert/strict'

interface NativeTrack { id: string; title: string; albumId: number | null }
interface Page { tracks: NativeTrack[]; total: number; hasMore: boolean }

/** Fake native index: N tracks, offset/limit paginated. */
function makeIndex(total: number, tag = 't') {
  const rows: NativeTrack[] = Array.from({ length: total }, (_, i) => ({
    id: `${tag}-${i}`,
    title: `${tag} ${i}`,
    albumId: Math.floor(i / 10),
  }))
  return {
    rows,
    getTracks({ offset, limit }: { offset: number; limit: number }): Page {
      const slice = rows.slice(offset, offset + limit)
      return { tracks: slice, total, hasMore: offset + slice.length < total }
    },
  }
}

/** Faithful model of the store's pagination half. */
function createStore(index: ReturnType<typeof makeIndex>) {
  const state = {
    tracks: [] as NativeTrack[],
    total: 0,
    offset: 0,
    pageSize: 100,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    requests: 0,
  }
  let generation = 0

  function mergeUnique(current: NativeTrack[], incoming: NativeTrack[]) {
    const seen = new Set(current.map(t => t.id))
    const out = [...current]
    for (const t of incoming) if (!seen.has(t.id)) { seen.add(t.id); out.push(t) }
    return out
  }

  async function loadFirstPage(src = index) {
    const gen = ++generation
    state.isLoading = true
    state.isLoadingMore = false
    state.requests++
    const page = src.getTracks({ offset: 0, limit: state.pageSize })
    await Promise.resolve()
    if (gen !== generation) return
    state.tracks = page.tracks
    state.total = page.total
    state.offset = page.tracks.length
    state.hasMore = page.hasMore && page.tracks.length > 0
    state.isLoading = false
  }

  async function loadMore(src = index, delay = 0) {
    if (!state.hasMore || state.isLoadingMore || state.isLoading) return
    const gen = generation
    const offset = state.offset
    state.isLoadingMore = true
    state.requests++
    const page = src.getTracks({ offset, limit: state.pageSize })
    if (delay) await new Promise(r => setTimeout(r, delay))
    else await Promise.resolve()
    if (gen !== generation) return
    if (page.tracks.length === 0) { state.hasMore = false; state.isLoadingMore = false; return }
    state.tracks = mergeUnique(state.tracks, page.tracks)
    state.total = page.total
    state.offset = offset + page.tracks.length
    state.hasMore = page.hasMore && state.offset < page.total
    state.isLoadingMore = false
  }

  return { state, loadFirstPage, loadMore, reset: () => { generation++ } }
}

console.log('--- SYSTEMA LIBRARY PAGINATION TESTS ---')

// 1. Progressive paging to completion
console.log('Testing progressive paging 0->100->200->...')
{
  const index = makeIndex(642)
  const s = createStore(index)
  await s.loadFirstPage()
  assert.equal(s.state.tracks.length, 100, 'first page is 100')
  assert.equal(s.state.total, 642)
  assert.equal(s.state.hasMore, true)

  await s.loadMore()
  assert.equal(s.state.tracks.length, 200, 'second page appends to 200')
  await s.loadMore()
  assert.equal(s.state.tracks.length, 300, 'third page appends to 300')

  let guard = 0
  while (s.state.hasMore && guard++ < 50) await s.loadMore()

  assert.equal(s.state.tracks.length, 642, 'all rows eventually load')
  assert.equal(s.state.hasMore, false, 'hasMore clears at the end')
  assert.equal(new Set(s.state.tracks.map(t => t.id)).size, 642, 'no duplicates')
  // 642 = 100 * 6 + 42 -> 7 pages total
  assert.equal(s.state.requests, 7, 'exactly one request per page, no extras')
}
console.log('✓ pages load progressively with no duplicates or gaps')

// 2. No missing/skipped pages — order is preserved
console.log('Testing page ordering...')
{
  const index = makeIndex(350)
  const s = createStore(index)
  await s.loadFirstPage()
  while (s.state.hasMore) await s.loadMore()
  const ids = s.state.tracks.map(t => t.id)
  assert.deepEqual(ids, index.rows.map(r => r.id), 'global order preserved across pages')
}
console.log('✓ no skipped pages, server order preserved')

// 3. Concurrent triggers produce ONE request
console.log('Testing duplicate-request prevention...')
{
  const index = makeIndex(500)
  const s = createStore(index)
  await s.loadFirstPage()
  const before = s.state.requests

  // Simulate the observer firing 5x while a page is in flight.
  await Promise.all([
    s.loadMore(index, 20),
    s.loadMore(index, 20),
    s.loadMore(index, 20),
    s.loadMore(index, 20),
    s.loadMore(index, 20),
  ])

  assert.equal(s.state.requests - before, 1, 'only one request despite 5 triggers')
  assert.equal(s.state.tracks.length, 200, 'exactly one page appended')
  assert.equal(new Set(s.state.tracks.map(t => t.id)).size, 200, 'no duplicated rows')
}
console.log('✓ overlapping triggers collapse to a single request')

// 4. Sort change resets pagination and never mixes datasets
console.log('Testing sort reset...')
{
  const byTitle = makeIndex(400, 'title')
  const byDate = makeIndex(400, 'date')
  const s = createStore(byTitle)

  await s.loadFirstPage(byTitle)
  await s.loadMore(byTitle)
  assert.equal(s.state.tracks.length, 200)
  assert.ok(s.state.tracks.every(t => t.id.startsWith('title-')))

  // User re-sorts: reset + first page of the NEW dataset.
  await s.loadFirstPage(byDate)
  assert.equal(s.state.tracks.length, 100, 'offset reset to 0')
  assert.equal(s.state.offset, 100)
  assert.ok(s.state.tracks.every(t => t.id.startsWith('date-')), 'no rows from the old sort')

  await s.loadMore(byDate)
  assert.equal(s.state.tracks.length, 200)
  assert.ok(s.state.tracks.every(t => t.id.startsWith('date-')), 'datasets never mix')
}
console.log('✓ sorting resets pagination without mixing datasets')

// 5. In-flight page from an old generation is discarded
console.log('Testing stale-response rejection...')
{
  const oldSet = makeIndex(400, 'old')
  const newSet = makeIndex(400, 'new')
  const s = createStore(oldSet)
  await s.loadFirstPage(oldSet)

  // Start a slow page-2 for the OLD dataset, then re-sort mid-flight.
  const inflight = s.loadMore(oldSet, 30)
  await s.loadFirstPage(newSet)
  await inflight

  assert.ok(s.state.tracks.every(t => t.id.startsWith('new-')), 'stale page must not be merged')
  assert.equal(s.state.tracks.length, 100, 'offset not corrupted by the stale response')
  assert.equal(s.state.offset, 100)
}
console.log('✓ stale in-flight pages are discarded, offset stays correct')

// 6. Search query reset behaves like a sort reset
console.log('Testing search reset...')
{
  const metal = makeIndex(250, 'metal')
  const rock = makeIndex(180, 'rock')
  const s = createStore(metal)

  await s.loadFirstPage(metal)
  await s.loadMore(metal)
  assert.equal(s.state.tracks.length, 200)

  await s.loadFirstPage(rock)
  assert.equal(s.state.tracks.length, 100)
  assert.equal(s.state.total, 180, 'total reflects the new query')
  assert.ok(s.state.tracks.every(t => t.id.startsWith('rock-')), 'no results from the old query')
}
console.log('✓ changing the query resets pagination cleanly')

// 7. Exact-multiple boundary must not over-fetch
console.log('Testing exact page-size boundary...')
{
  const index = makeIndex(200)
  const s = createStore(index)
  await s.loadFirstPage()
  await s.loadMore()
  assert.equal(s.state.tracks.length, 200)
  assert.equal(s.state.hasMore, false, 'must stop exactly at the boundary')
  const before = s.state.requests
  await s.loadMore()
  assert.equal(s.state.requests, before, 'no request once fully loaded')
}
console.log('✓ stops cleanly at an exact multiple of the page size')

// 8. Small library never paginates
console.log('Testing library smaller than one page...')
{
  const s = createStore(makeIndex(37))
  await s.loadFirstPage()
  assert.equal(s.state.tracks.length, 37)
  assert.equal(s.state.hasMore, false)
  const before = s.state.requests
  await s.loadMore()
  assert.equal(s.state.requests, before, 'no extra request for a short library')
}
console.log('✓ short libraries load in one page and stop')

console.log('--- ALL LIBRARY PAGINATION TESTS PASSED! ---')
