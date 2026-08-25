// ============================================================
// useSwipeToDismiss — pointer-driven bottom-sheet dismissal
// ============================================================
// Shared by the player’s sheets so every panel follows the same
// mobile gesture contract: drag from its handle, release past the
// threshold to dismiss, otherwise settle back into place.
// ============================================================

export function useSwipeToDismiss(onDismiss: () => void, threshold = 88) {
  const dragOffset = ref(0)
  const isDragging = ref(false)
  let startY = 0
  let pointerId: number | null = null

  const dragStyle = computed(() => {
    if (!isDragging.value && dragOffset.value === 0) return undefined
    return {
      transform: `translate3d(0, ${dragOffset.value}px, 0)`,
      transition: isDragging.value ? 'none' : 'transform 280ms var(--player-ease)',
    }
  })

  function onDragStart(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    startY = event.clientY
    pointerId = event.pointerId
    dragOffset.value = 0
    isDragging.value = true
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
  }

  function onDragMove(event: PointerEvent) {
    if (!isDragging.value || event.pointerId !== pointerId) return
    dragOffset.value = Math.max(0, event.clientY - startY)
  }

  function onDragEnd(event: PointerEvent) {
    if (!isDragging.value || event.pointerId !== pointerId) return
    const shouldDismiss = dragOffset.value >= threshold
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
    pointerId = null
    isDragging.value = false

    if (shouldDismiss) {
      dragOffset.value = 0
      onDismiss()
    } else {
      dragOffset.value = 0
    }
  }

  function reset() {
    pointerId = null
    isDragging.value = false
    dragOffset.value = 0
  }

  return {
    dragOffset,
    isDragging,
    dragStyle,
    onDragStart,
    onDragMove,
    onDragEnd,
    reset,
  }
}
