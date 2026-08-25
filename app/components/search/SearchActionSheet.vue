<script setup lang="ts">
// ============================================================
// SearchActionSheet — contextual three-dot actions sheet
// ============================================================

import type { Album, Artist, Playlist, Track } from '~/types'

export type ActionItem =
  | { kind: 'track'; item: Track }
  | { kind: 'album'; item: Album }
  | { kind: 'artist'; item: Artist }
  | { kind: 'playlist'; item: Playlist }

const props = defineProps<{
  target: ActionItem | null
  isLiked?: boolean
}>()

const emit = defineEmits<{
  close: []
  action: [actionId: string, target: ActionItem]
}>()

const sheetDrag = useSwipeToDismiss(() => emit('close'))

const title = computed(() => {
  if (!props.target) return ''
  if (props.target.kind === 'track') return props.target.item.title
  if (props.target.kind === 'album') return props.target.item.title
  if (props.target.kind === 'artist') return props.target.item.name
  return props.target.item.title
})

const subtitle = computed(() => {
  if (!props.target) return ''
  return props.target.kind.toUpperCase()
})

const options = computed(() => {
  if (!props.target) return []

  if (props.target.kind === 'track') {
    return [
      { id: 'play', label: 'PLAY NOW', icon: 'lucide:play' },
      { id: 'play-next', label: 'PLAY NEXT', icon: 'lucide:skip-forward' },
      { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
      { id: 'playlist', label: 'ADD TO PLAYLIST', icon: 'lucide:list-plus' },
      { id: 'like', label: props.isLiked ? 'REMOVE FROM FAVORITES' : 'ADD TO FAVORITES', icon: 'lucide:heart' },
      { id: 'album', label: 'VIEW ALBUM', icon: 'lucide:disc-3' },
      { id: 'artist', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
      { id: 'info', label: 'TRACK INFO', icon: 'lucide:info' },
    ]
  }

  if (props.target.kind === 'album') {
    return [
      { id: 'play', label: 'PLAY ALBUM', icon: 'lucide:play' },
      { id: 'shuffle', label: 'SHUFFLE ALBUM', icon: 'lucide:shuffle' },
      { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
      { id: 'playlist', label: 'ADD TO PLAYLIST', icon: 'lucide:list-plus' },
      { id: 'artist', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
    ]
  }

  if (props.target.kind === 'artist') {
    return [
      { id: 'play', label: 'PLAY ARTIST', icon: 'lucide:play' },
      { id: 'shuffle', label: 'SHUFFLE ARTIST', icon: 'lucide:shuffle' },
      { id: 'view', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
    ]
  }

  return [
    { id: 'play', label: 'PLAY PLAYLIST', icon: 'lucide:play' },
    { id: 'shuffle', label: 'SHUFFLE PLAYLIST', icon: 'lucide:shuffle' },
    { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
  ]
})

function onSelect(actionId: string) {
  if (props.target) {
    emit('action', actionId, props.target)
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="target"
        class="search-action-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Result actions"
        @click.self="emit('close')"
      >
        <section
          class="search-action-sheet"
          :class="{ 'is-dragging': sheetDrag.isDragging.value }"
          :style="sheetDrag.dragStyle.value"
        >
          <!-- Drag handle -->
          <div
            class="search-action-sheet__handle"
            aria-label="Swipe down to close"
            @pointerdown="sheetDrag.onDragStart"
            @pointermove="sheetDrag.onDragMove"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          >
            <span />
          </div>

          <!-- Header -->
          <div class="search-action-sheet__header">
            <p class="search-action-sheet__kind">{{ subtitle }}</p>
            <h3 class="search-action-sheet__title truncate">{{ title }}</h3>
          </div>

          <!-- Action list -->
          <div class="search-action-sheet__list">
            <button
              v-for="opt in options"
              :key="opt.id"
              type="button"
              class="search-action-row focus-ring"
              @click="onSelect(opt.id)"
            >
              <UIcon :name="opt.icon" class="search-action-icon" />
              <span class="search-action-label">{{ opt.label }}</span>
            </button>
          </div>

          <div class="search-action-sheet__safe" aria-hidden="true" />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-action-overlay {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(10, 11, 14, 0.6);
  backdrop-filter: blur(8px);
}

.search-action-sheet {
  width: 100%;
  max-width: 32rem;
  max-height: 85dvh;
  overflow: hidden;
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.12));
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: var(--sys-surface-elevated, #11141c);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
}

.search-action-sheet.is-dragging {
  user-select: none;
}

.search-action-sheet__handle {
  display: grid;
  height: 1.5rem;
  place-items: center;
  cursor: grab;
  touch-action: none;
  flex-shrink: 0;
}

.search-action-sheet__handle span {
  width: 2rem;
  height: 3px;
  border-radius: 999px;
  background: var(--sys-foreground-faint, #6b7280);
  opacity: 0.6;
}

.search-action-sheet__header {
  padding: 0.5rem 1.25rem 0.75rem;
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
  flex-shrink: 0;
}

.search-action-sheet__kind {
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: var(--sys-primary, #64a0ff);
  margin: 0 0 0.25rem 0;
}

.search-action-sheet__title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--sys-foreground, #fff);
  margin: 0;
}

.search-action-sheet__list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0.5rem 0;
}

.search-action-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  height: 3rem;
  padding: 0 1.25rem;
  border: 0;
  background: transparent;
  color: var(--sys-foreground, #fff);
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease;
}

.search-action-row:hover {
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.06));
}

.search-action-icon {
  width: 1.125rem;
  height: 1.125rem;
  color: var(--sys-foreground-muted, #9ba3af);
  flex-shrink: 0;
}

.search-action-label {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.search-action-sheet__safe {
  height: max(1rem, var(--sys-safe-bottom, 0px));
  flex-shrink: 0;
}
</style>
