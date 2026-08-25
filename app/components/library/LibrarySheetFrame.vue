<script setup lang="ts">
const props = defineProps<{
  open: boolean
  title: string
  label?: string
}>()

const emit = defineEmits<{ close: [] }>()
const sheetDrag = useSwipeToDismiss(() => emit('close'))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

if (import.meta.client) {
  watch(() => props.open, open => {
    document.documentElement.classList.toggle('library-sheet-open', open)
    document.body.classList.toggle('library-sheet-open', open)
    if (open) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    document.documentElement.classList.remove('library-sheet-open')
    document.body.classList.remove('library-sheet-open')
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="library-sheet-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="label ?? title"
        @click.self="emit('close')"
      >
        <section class="library-sheet" :class="{ 'is-dragging': sheetDrag.isDragging.value }" :style="sheetDrag.dragStyle.value">
          <div
            class="library-sheet__handle"
            aria-label="Swipe down to close"
            @pointerdown="sheetDrag.onDragStart"
            @pointermove="sheetDrag.onDragMove"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          ><span /></div>
          <header class="library-sheet__header">
            <h2 class="label-muted">{{ title }}</h2>
            <button class="library-sheet__close focus-ring" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="library-sheet__close-icon" aria-hidden="true" />
            </button>
          </header>
          <div class="library-sheet__body"><slot /></div>
          <div class="library-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.library-sheet-overlay { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-end; justify-content: center; background: color-mix(in srgb, var(--sys-foreground) 40%, transparent); backdrop-filter: blur(var(--library-gap)); }
.library-sheet { width: 100%; max-width: var(--library-sheet-width); max-height: calc(100dvh - var(--sys-safe-top)); overflow-y: auto; overscroll-behavior: contain; border: var(--library-line-width) solid var(--sys-border-strong); border-bottom: 0; border-radius: var(--library-sheet-radius) var(--library-sheet-radius) 0 0; background: var(--sys-surface); box-shadow: var(--sys-shadow-2); animation: library-sheet-in var(--library-motion) var(--sys-ease); }
.library-sheet.is-dragging { animation: none; user-select: none; }
.library-sheet__handle { display: grid; height: var(--library-menu-size); place-items: center; cursor: grab; touch-action: none; }
.library-sheet__handle:active { cursor: grabbing; }
.library-sheet__handle span { width: var(--library-number-column); height: var(--library-indicator-height); border-radius: var(--ui-radius); background: var(--sys-foreground-faint); }
.library-sheet__header { display: flex; min-height: var(--library-menu-size); align-items: center; justify-content: space-between; padding: 0 var(--library-control-pad); border-bottom: var(--library-line-width) solid var(--sys-border); }
.library-sheet__close { display: grid; width: var(--library-menu-size); height: var(--library-menu-size); place-items: center; border: 0; background: transparent; color: var(--sys-foreground-muted); cursor: pointer; }
.library-sheet__close:hover { color: var(--sys-foreground); background: var(--sys-surface-hover); }
.library-sheet__close-icon { width: var(--library-icon-size); height: var(--library-icon-size); }
.library-sheet__body { min-height: 0; }
.library-sheet__safe { height: calc(var(--library-control-pad) + var(--sys-safe-bottom)); }
@keyframes library-sheet-in { from { transform: translate3d(0, 100%, 0); } to { transform: translate3d(0, 0, 0); } }
@media (prefers-reduced-motion: reduce) { .library-sheet { animation: none; } }
</style>
