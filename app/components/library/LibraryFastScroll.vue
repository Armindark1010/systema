<script setup lang="ts">
// ============================================================
// LibraryFastScroll — minimal drag-to-jump rail
// ============================================================
// A thin rail on the right edge of the track list with a small thumb
// that follows the finger and maps its position onto the document
// scroll range.
//
// Two details make it safe to overlay on the list:
//
//   1. The rail itself is `pointer-events: none`; only the thumb is
//      interactive. Taps anywhere else — cards, three-dot menus —
//      pass straight through to the list underneath.
//   2. `touch-action: none` is set on the thumb only, so the browser
//      hands us the vertical drag instead of scrolling the page, while
//      ordinary scrolling elsewhere is completely unaffected.
//
// Scroll writes are coalesced into one rAF per frame: a fast drag can
// emit pointermove far more often than the display refreshes, and
// calling scrollTo on each one just burns work the user never sees.
// ============================================================

const props = withDefaults(defineProps<{
  /** Current document scroll offset. */
  scrollY: number
  /** Maximum reachable scroll offset. */
  maxScroll: number
  /** Hide the rail unless the page scrolls at least this far. */
  minScrollRange?: number
}>(), {
  minScrollRange: 1200,
})

const emit = defineEmits<{
  /** Raised while dragging so the page can show context if it wants. */
  scrub: [progress: number]
}>()

const railRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)

/** Long libraries only: on a short list the rail is pointless clutter. */
const enabled = computed(() => props.maxScroll >= props.minScrollRange)

const progress = computed(() => {
  if (props.maxScroll <= 0) return 0
  return Math.min(1, Math.max(0, props.scrollY / props.maxScroll))
})

/**
 * Thumb offset as a percentage of the rail, inset by the thumb's own
 * height so it stays fully inside the rail at both extremes.
 */
const thumbStyle = computed(() => ({
  top: `calc(${progress.value * 100}% - ${progress.value * 2.75}rem)`,
}))

let activePointerId: number | null = null
let pendingTarget: number | null = null
let frame: number | null = null

/** Coalesce scroll writes to one per animation frame. */
function scheduleScroll(target: number) {
  pendingTarget = target
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    if (pendingTarget === null) return
    // `instant`: during a drag the list must track the finger. A smooth
    // animation would lag behind and feel disconnected.
    window.scrollTo({ top: pendingTarget, behavior: 'instant' as ScrollBehavior })
    pendingTarget = null
  })
}

function progressFromPointer(event: PointerEvent): number {
  const rail = railRef.value
  if (!rail) return 0
  const rect = rail.getBoundingClientRect()
  if (rect.height <= 0) return 0
  return Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
}

function onPointerDown(event: PointerEvent) {
  if (!enabled.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return

  activePointerId = event.pointerId
  isDragging.value = true
  // Capture on the thumb so the drag survives the finger sliding off
  // the narrow rail — without this a fast drag loses tracking.
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value || event.pointerId !== activePointerId) return
  const next = progressFromPointer(event)
  scheduleScroll(next * props.maxScroll)
  emit('scrub', next)
  event.preventDefault()
}

function endDrag(event: PointerEvent) {
  if (event.pointerId !== activePointerId) return
  const target = event.currentTarget as HTMLElement
  if (target?.hasPointerCapture?.(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  isDragging.value = false
  activePointerId = null
}

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
})
</script>

<template>
  <div
    v-if="enabled"
    ref="railRef"
    class="library-fastscroll"
    :class="{ 'is-dragging': isDragging }"
    aria-hidden="true"
  >
    <div
      class="library-fastscroll__thumb"
      :style="thumbStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
    >
      <span class="library-fastscroll__grip" />
    </div>
  </div>
</template>

<style scoped>
.library-fastscroll {
  position: fixed;
  top: 30vh;
  right: 0;
  /* Stop short of the dock so the thumb never sits over the nav. */
  bottom: calc(var(--sys-dock-player-h, 8rem) + 0.5rem);
  width: 1.5rem;
  z-index: 30;

  /*
    The rail is inert. Only the thumb below re-enables pointer events,
    so cards and three-dot menus underneath stay fully tappable.
  */
  pointer-events: none;
}

.library-fastscroll__thumb {
  position: absolute;
  right: 0;
  width: 1.5rem;
  height: 2.75rem;

  display: grid;
  place-items: center;

  pointer-events: auto;
  /* Claim the vertical drag for scrubbing rather than page scroll. */
  touch-action: none;
  cursor: grab;

  opacity: 0.35;
  transition: opacity 160ms ease;
}

.library-fastscroll__thumb:hover {
  opacity: 0.7;
}

.library-fastscroll.is-dragging .library-fastscroll__thumb {
  opacity: 1;
  cursor: grabbing;
}

/* Minimal SYSTEMA mark: a short vertical bar, not a chunky scrollbar. */
.library-fastscroll__grip {
  display: block;
  width: 2px;
  height: 2rem;
  background: var(--sys-fg);
}

.library-fastscroll.is-dragging .library-fastscroll__grip {
  width: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .library-fastscroll__thumb {
    transition: none;
  }
}
</style>
