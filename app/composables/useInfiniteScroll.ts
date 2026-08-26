// ============================================================
// useInfiniteScroll — sentinel-driven pagination
// ============================================================
// Watches a sentinel element placed near the end of a list and calls
// `onLoadMore` when it approaches the viewport.
//
// IntersectionObserver is used deliberately: it is evaluated by the
// browser off the main thread and fires only on threshold crossings,
// so there is no per-scroll-event work and no layout thrashing from
// reading scrollTop/offsetHeight on every frame.
//
// The `rootMargin` below extends the viewport downwards so loading
// starts a few hundred pixels before the user reaches the true bottom.
// ============================================================

import type { Ref } from 'vue'

export interface UseInfiniteScrollOptions {
  /** Start loading this many px before the sentinel is on screen. */
  rootMargin?: number
  /** Scrollable ancestor. Defaults to the viewport. */
  root?: Ref<HTMLElement | null> | null
}

export function useInfiniteScroll(
  sentinel: Ref<HTMLElement | null>,
  onLoadMore: () => void | Promise<void>,
  /** Observing stops as soon as this turns false. */
  canLoadMore: Ref<boolean>,
  options: UseInfiniteScrollOptions = {},
) {
  const { rootMargin = 400, root = null } = options

  let observer: IntersectionObserver | null = null
  // Local latch: an IntersectionObserver can fire repeatedly for one
  // crossing, and the awaited handler may not have flipped the store's
  // isLoadingMore flag yet. This guarantees one request per crossing.
  let pending = false

  function disconnect() {
    observer?.disconnect()
    observer = null
  }

  async function trigger() {
    if (pending || !canLoadMore.value) return
    pending = true
    try {
      await onLoadMore()
    } finally {
      pending = false
    }
  }

  function observe() {
    disconnect()

    const target = sentinel.value
    if (!target || typeof IntersectionObserver === 'undefined') return

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void trigger()
        }
      },
      {
        root: root?.value ?? null,
        // Only the bottom margin is extended: we want to preload ahead
        // of the user, not react to anything above the viewport.
        rootMargin: `0px 0px ${rootMargin}px 0px`,
        threshold: 0,
      },
    )

    observer.observe(target)
  }

  onMounted(observe)
  onBeforeUnmount(disconnect)

  // Re-attach when the sentinel is (re)created, e.g. when the list
  // switches out of its empty/skeleton state.
  watch(sentinel, () => {
    if (canLoadMore.value) observe()
    else disconnect()
  })

  // Stop observing entirely once the library is fully loaded so no
  // further callbacks or requests can occur.
  watch(canLoadMore, (can) => {
    if (can) observe()
    else disconnect()
  })

  return { observe, disconnect }
}
