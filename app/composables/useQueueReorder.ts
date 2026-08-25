// ============================================================
// useQueueReorder — Touch & pointer vertical queue reordering
// ============================================================
// Production-grade vertical drag-and-drop for upcoming tracks.
// Supports:
// 1. Press-and-hold activation (with mobile haptic when supported)
// 2. 1:1 vertical finger tracking with visual lift and elevation
// 3. Dynamic midpoint crossing calculation
// 4. Smooth CSS transition displacement of non-dragged items
// 5. Complete isolation from bottom sheet drag-to-dismiss
// 6. Commits order directly to Pinia store on release
// ============================================================

import type { Ref } from 'vue'

export interface QueueReorderOptions {
  itemsCount: Ref<number>
  onReorder: (fromIndex: number, toIndex: number) => void
}

export function useQueueReorder(options: QueueReorderOptions) {
  const { itemsCount, onReorder } = options

  const isReordering = ref(false)
  const isHoldPending = ref(false)
  const dragIndex = ref<number | null>(null)
  const targetIndex = ref<number | null>(null)
  const dragOffset = ref(0)
  const rowHeight = ref(68)

  let pointerId: number | null = null
  let startY = 0
  let holdTimer: ReturnType<typeof setTimeout> | null = null

  function onHandlePointerDown(event: PointerEvent, index: number) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.stopPropagation()

    pointerId = event.pointerId
    dragIndex.value = index
    targetIndex.value = index
    startY = event.clientY
    dragOffset.value = 0
    isHoldPending.value = true

    const rowEl = (event.currentTarget as HTMLElement).closest<HTMLElement>('.player-queue-item')
    if (rowEl) {
      rowHeight.value = rowEl.getBoundingClientRect().height || 68
    }

    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)

    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = setTimeout(() => {
      if (pointerId !== event.pointerId) return
      isHoldPending.value = false
      isReordering.value = true
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(15) } catch { /* ignore */ }
      }
    }, 150)
  }

  function onHandlePointerMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    event.stopPropagation()

    const deltaY = event.clientY - startY

    if (isHoldPending.value && Math.abs(deltaY) > 8) {
      // User moved noticeably; enter reorder immediately
      if (holdTimer) clearTimeout(holdTimer)
      isHoldPending.value = false
      isReordering.value = true
    }

    if (!isReordering.value || dragIndex.value === null) return

    if (event.cancelable) event.preventDefault()

    dragOffset.value = deltaY

    // Recalculate target slot based on midpoint crossing
    const h = rowHeight.value || 68
    const deltaSlots = Math.round(deltaY / h)
    const count = itemsCount.value
    const nextTarget = Math.max(0, Math.min(count - 1, dragIndex.value + deltaSlots))
    targetIndex.value = nextTarget
  }

  function onHandlePointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    event.stopPropagation()

    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }

    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null

    if (
      isReordering.value &&
      dragIndex.value !== null &&
      targetIndex.value !== null &&
      dragIndex.value !== targetIndex.value
    ) {
      onReorder(dragIndex.value, targetIndex.value)
    }

    pointerId = null
    isHoldPending.value = false
    isReordering.value = false
    dragIndex.value = null
    targetIndex.value = null
    dragOffset.value = 0
  }

  function onHandlePointerCancel(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
    pointerId = null
    isHoldPending.value = false
    isReordering.value = false
    dragIndex.value = null
    targetIndex.value = null
    dragOffset.value = 0
  }

  function getItemStyle(index: number) {
    if (!isReordering.value || dragIndex.value === null || targetIndex.value === null) {
      return undefined
    }

    // Dragged item follows finger with visual elevation
    if (index === dragIndex.value) {
      return {
        transform: `translate3d(0, ${dragOffset.value}px, 0) scale(1.02)`,
        boxShadow: 'var(--player-queue-drag-shadow, 0 12px 24px rgba(0,0,0,0.38))',
        backgroundColor: 'var(--player-bg-soft)',
        zIndex: 35,
        position: 'relative' as const,
        transition: 'none',
      }
    }

    // Shift items that are between source and target
    const h = rowHeight.value || 68
    const from = dragIndex.value
    const to = targetIndex.value

    if (from < to && index > from && index <= to) {
      return {
        transform: `translate3d(0, -${h}px, 0)`,
        transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
      }
    }

    if (from > to && index >= to && index < from) {
      return {
        transform: `translate3d(0, ${h}px, 0)`,
        transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
      }
    }

    return {
      transform: 'translate3d(0, 0, 0)',
      transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
    }
  }

  return {
    isReordering,
    isHoldPending,
    dragIndex,
    targetIndex,
    dragOffset,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
    getItemStyle,
  }
}
