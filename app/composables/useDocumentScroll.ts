// ============================================================
// useDocumentScroll — cheap, shared document scroll telemetry
// ============================================================
// The Library scrolls the document (there is no inner overflow
// container), so fast-scroll and scroll-to-top both need the window
// scroll position.
//
// Reading scrollTop/scrollHeight forces layout, so doing it inside a
// raw scroll handler would cost a reflow on every scroll event. The
// listener here is passive and only schedules a rAF; all measurement
// happens once per frame, in the frame the browser was going to
// produce anyway.
// ============================================================

export interface DocumentScrollState {
  /** Current window scroll offset in px. */
  scrollY: Readonly<Ref<number>>
  /** Largest reachable scroll offset, i.e. scrollHeight - innerHeight. */
  maxScroll: Readonly<Ref<number>>
  /** Scroll progress in the range 0..1. 0 when the page does not scroll. */
  progress: Readonly<Ref<number>>
  /** Force a re-measure, e.g. after new rows were appended. */
  measure: () => void
}

export function useDocumentScroll(): DocumentScrollState {
  const scrollY = ref(0)
  const maxScroll = ref(0)

  let frame: number | null = null

  function measure() {
    if (!import.meta.client) return
    const doc = document.documentElement
    scrollY.value = window.scrollY || doc.scrollTop || 0
    maxScroll.value = Math.max(0, doc.scrollHeight - window.innerHeight)
  }

  function schedule() {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      measure()
    })
  }

  const progress = computed(() => {
    if (maxScroll.value <= 0) return 0
    return Math.min(1, Math.max(0, scrollY.value / maxScroll.value))
  })

  onMounted(() => {
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
  })

  onBeforeUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
  })

  return {
    scrollY: readonly(scrollY),
    maxScroll: readonly(maxScroll),
    progress: readonly(progress),
    measure,
  }
}
