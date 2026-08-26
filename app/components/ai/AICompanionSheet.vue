<script setup lang="ts">
// ============================================================
// AICompanionSheet — the companion's bottom-sheet primitive
// ============================================================
// Shared by the chat history sheet and the result action sheet
// so both follow one gesture + accessibility contract:
//   · opens from the bottom with a smooth transition
//   · drag handle + swipe-down to close (useSwipeToDismiss)
//   · background interaction blocked while open (scroll locked,
//     inert scrim, focus trapped to the panel)
//   · never exceeds the viewport, always respects safe-area
// ============================================================

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  /** Accessible label for the close control. */
  closeLabel?: string
}>(), {
  closeLabel: 'Close',
})

const emit = defineEmits<{ close: [] }>()

const drag = useSwipeToDismiss(() => emit('close'))
const panel = ref<HTMLElement | null>(null)
const titleId = useId()

// Block background scroll (and therefore background interaction)
// for as long as the sheet is mounted and open.
const locked = import.meta.client ? useScrollLock(document.body) : ref(false)

watch(() => props.open, async (open) => {
  locked.value = open
  if (!open) {
    drag.reset()
    return
  }
  await nextTick()
  // Move focus into the sheet so keyboard users land inside it.
  panel.value?.focus()
})

onBeforeUnmount(() => {
  locked.value = false
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panel.value) return

  // Simple focus trap — the sheet owns the keyboard while open.
  const focusables = panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (!focusables.length) return
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const active = document.activeElement

  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="fixed inset-0 z-70 flex items-end justify-center bg-ai-scrim backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <Transition name="ai-sheet" appear>
          <section
            v-if="open"
            ref="panel"
            class="ai-sheet-panel max-h-[var(--ai-sheet-max-h)]"
            :style="drag.dragStyle.value"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="titleId"
            tabindex="-1"
            @keydown="onKeydown"
          >
            <!-- drag handle -->
            <div
              class="grid h-6 shrink-0 cursor-grab touch-none place-items-center"
              role="presentation"
              @pointerdown="drag.onDragStart"
              @pointermove="drag.onDragMove"
              @pointerup="drag.onDragEnd"
              @pointercancel="drag.onDragEnd"
            >
              <span class="h-[3px] w-9 rounded-3 bg-ai-line-strong" aria-hidden="true" />
            </div>

            <!-- header -->
            <header class="flex shrink-0 items-center justify-between gap-3 border-b border-ai-line px-4 pb-3 pt-1">
              <h2 :id="titleId" class="ai-label-strong">{{ title }}</h2>
              <button
                type="button"
                class="ai-icon-btn h-9 w-9"
                :aria-label="closeLabel"
                @click="emit('close')"
              >
                <UIcon name="lucide:x" class="h-4 w-4" />
              </button>
            </header>

            <!-- scrollable body -->
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <slot />
            </div>

            <!-- pinned footer + safe area -->
            <div v-if="$slots.footer" class="shrink-0 border-t border-ai-line px-4 py-3">
              <slot name="footer" />
            </div>
            <div class="h-[max(0.75rem,var(--ai-safe-bottom))] shrink-0" aria-hidden="true" />
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
