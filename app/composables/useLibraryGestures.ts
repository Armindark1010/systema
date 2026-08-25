// ============================================================
// useLibraryGestures — Interactive direction-locked horizontal swipe
// ============================================================
// Supports:
// 1. Interactive 1:1 finger tracking across library sections
// 2. Strict direction locking: vertical movement scrolls the page
//    without triggering section change; horizontal swipe changes section
// 3. Elastic rubber-banding at catalog boundaries
// 4. Velocity and distance thresholds
// 5. Button and interactive element safety
// 6. Respects prefers-reduced-motion
// ============================================================

import type { Ref } from 'vue'

export interface LibraryGesturesOptions {
  activeIndex: Ref<number>
  totalSections: number
  onNavigate: (nextIndex: number) => void
}

export function useLibraryGestures(options: LibraryGesturesOptions) {
  const { activeIndex, totalSections, onNavigate } = options

  const dragOffset = ref(0)
  const isDragging = ref(false)
  const isTransitioning = ref(false)
  const containerWidth = ref(0)

  let pointerId: number | null = null
  let startX = 0
  let startY = 0
  let startTime = 0
  let axis: 'pending' | 'horizontal' | 'vertical' = 'pending'

  function isInteractiveElement(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return Boolean(
      target.closest(
        'button, a, input, textarea, select, [role="button"], [data-library-no-swipe], .library-track-item__menu, .library-track-item__play'
      )
    )
  }

  function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function onPointerDown(event: PointerEvent) {
    if (isInteractiveElement(event.target)) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const target = event.currentTarget as HTMLElement
    containerWidth.value = target.clientWidth || window.innerWidth

    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    startTime = performance.now()
    axis = 'pending'
    isDragging.value = false
    dragOffset.value = 0
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return

    const deltaX = event.clientX - startX
    const deltaY = event.clientY - startY
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (axis === 'pending') {
      const distance = Math.hypot(deltaX, deltaY)
      if (distance < 10) return

      // Determine axis with a bias toward vertical scrolling to keep page scroll natural
      if (absX > absY * 1.35) {
        axis = 'horizontal'
        isDragging.value = true
        ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
      } else {
        axis = 'vertical'
        // Let vertical scroll take over naturally
        return
      }
    }

    if (axis !== 'horizontal') return

    // Prevent native horizontal gestures
    if (event.cancelable) event.preventDefault()

    // Rubber-band resistance at boundaries
    const isAtLeftEdge = activeIndex.value === 0 && deltaX > 0
    const isAtRightEdge = activeIndex.value === totalSections - 1 && deltaX < 0

    if (isAtLeftEdge || isAtRightEdge) {
      dragOffset.value = deltaX * 0.22
    } else {
      dragOffset.value = deltaX
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return

    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }

    const deltaX = event.clientX - startX
    const duration = Math.max(1, performance.now() - startTime)
    const velocity = Math.abs(deltaX) / duration // px/ms
    const width = containerWidth.value || target.clientWidth || 360

    pointerId = null

    if (axis === 'horizontal' && isDragging.value) {
      const distanceThreshold = width * 0.22
      const isQuickFlick = Math.abs(deltaX) >= 36 && velocity >= 0.35
      const isPastDistance = Math.abs(deltaX) >= distanceThreshold

      let destinationIndex = activeIndex.value

      if (isQuickFlick || isPastDistance) {
        if (deltaX < 0 && activeIndex.value < totalSections - 1) {
          destinationIndex = activeIndex.value + 1
        } else if (deltaX > 0 && activeIndex.value > 0) {
          destinationIndex = activeIndex.value - 1
        }
      }

      if (destinationIndex !== activeIndex.value) {
        if (prefersReducedMotion()) {
          dragOffset.value = 0
          isDragging.value = false
          onNavigate(destinationIndex)
        } else {
          isTransitioning.value = true
          dragOffset.value = 0
          isDragging.value = false
          onNavigate(destinationIndex)
          setTimeout(() => {
            isTransitioning.value = false
          }, 320)
        }
      } else {
        // Snap back
        isTransitioning.value = true
        dragOffset.value = 0
        isDragging.value = false
        setTimeout(() => {
          isTransitioning.value = false
        }, 260)
      }
    } else {
      dragOffset.value = 0
      isDragging.value = false
    }

    axis = 'pending'
  }

  function onPointerCancel(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    pointerId = null
    dragOffset.value = 0
    isDragging.value = false
    axis = 'pending'
  }

  const trackTransform = computed(() => {
    const basePercent = -activeIndex.value * 100
    if (isDragging.value && dragOffset.value !== 0) {
      return `translate3d(calc(${basePercent}% + ${dragOffset.value}px), 0, 0)`
    }
    return `translate3d(${basePercent}%, 0, 0)`
  })

  const trackTransition = computed(() => {
    if (prefersReducedMotion()) return 'none'
    if (isDragging.value) return 'none'
    return 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
  })

  return {
    dragOffset,
    isDragging,
    isTransitioning,
    trackTransform,
    trackTransition,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
