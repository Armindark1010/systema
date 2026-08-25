<script setup lang="ts">
// ============================================================
// PlayerMoreMenu — bottom sheet with useful actions
// ============================================================

export interface MoreMenuItem {
  label: string
  icon: string
  action: string
  danger?: boolean
  separator?: boolean
}

const props = defineProps<{
  open: boolean
  trackTitle: string
}>()

const emit = defineEmits<{
  close: []
  action: [action: string]
}>()

const items: MoreMenuItem[] = [
  { label: 'ADD TO PLAYLIST', icon: 'lucide:list-plus', action: 'playlist' },
  { label: 'ADD TO QUEUE', icon: 'lucide:list-music', action: 'queue' },
  { label: 'SHARE', icon: 'lucide:share-2', action: 'share', separator: true },
  { label: 'GO TO ARTIST', icon: 'lucide:mic-vocal', action: 'artist' },
  { label: 'GO TO ALBUM', icon: 'lucide:disc-3', action: 'album' },
  { label: 'VIEW TRACK INFO', icon: 'lucide:info', action: 'info', separator: true },
  { label: 'DOWNLOAD', icon: 'lucide:download', action: 'download' },
  { label: 'REMOVE FROM LIBRARY', icon: 'lucide:trash-2', action: 'remove', danger: true },
]

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.open, (v) => {
  if (v) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})

onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="player-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="More options"
        @click.self="emit('close')"
      >
        <div class="player-sheet">
          <div class="player-sheet-handle" aria-hidden="true"><span /></div>

          <div class="player-sheet-header">
            <div>
              <h2 class="player-sheet-title">MORE</h2>
              <p class="player-sheet-sub">{{ trackTitle }}</p>
            </div>
            <button class="player-sheet-close" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="w-4 h-4" />
            </button>
          </div>

          <div class="more-list">
            <template v-for="(item, idx) in items" :key="item.action">
              <div v-if="item.separator && idx !== 0" class="more-separator" aria-hidden="true" />
              <button
                class="more-item"
                :class="{ 'is-danger': item.danger }"
                @click="emit('action', item.action)"
              >
                <UIcon :name="item.icon" class="more-item-icon" />
                <span class="more-item-label">{{ item.label }}</span>
                <UIcon name="lucide:chevron-right" class="more-item-chevron" />
              </button>
            </template>
          </div>

          <div class="player-sheet-footer-safe" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(10,11,14,0.56);
  backdrop-filter: blur(8px);
}

.player-sheet {
  width: 100%;
  max-width: 480px;
  max-height: 88dvh;
  overflow-y: auto;
  background: var(--player-sheet-bg);
  border: 1px solid var(--player-sheet-line);
  border-bottom: 0;
  border-radius: var(--player-sheet-radius) var(--player-sheet-radius) 0 0;
  box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
  animation: sheet-in 360ms var(--player-ease);
}

.player-sheet-handle {
  display: grid;
  place-items: center;
  height: 28px;
}
.player-sheet-handle span {
  width: 32px;
  height: 3px;
  background: var(--player-fg-faint);
  border-radius: 999px;
  opacity: 0.6;
}

.player-sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--player-line);
  gap: 1rem;
}

.player-sheet-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg);
}

.player-sheet-sub {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--player-fg-muted);
  line-height: 1.3;
}

.player-sheet-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  flex-shrink: 0;
}

.more-list {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0;
}

.more-separator {
  height: 1px;
  background: var(--player-line);
  margin: 0.5rem 1.25rem;
}

.more-item {
  display: grid;
  grid-template-columns: 1.25rem 1fr 1rem;
  align-items: center;
  gap: 0.75rem;
  min-height: 3rem;
  padding-inline: 1.25rem;
  background: transparent;
  border: 0;
  color: var(--player-fg-muted);
  cursor: pointer;
  text-align: left;
  transition: all 160ms var(--player-ease-smooth);
}

.more-item:hover {
  background: var(--player-control);
  color: var(--player-fg);
}

.more-item.is-danger {
  color: #ff6b5e;
}

.more-item-icon {
  width: 1rem;
  height: 1rem;
}

.more-item-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.more-item-chevron {
  width: 0.875rem;
  height: 0.875rem;
  color: var(--player-fg-faint);
}

.player-sheet-footer-safe {
  height: calc(1rem + var(--player-safe-bottom));
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
