<script setup lang="ts">
// ============================================================
// PlayerPlaylistPicker — compact playlist selector
// ============================================================

export interface PlaylistOption {
  id: string
  title: string
  count: number
}

const props = defineProps<{
  open: boolean
  playlists: PlaylistOption[]
  trackTitle: string
  addedTo: string | null
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
  create: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="player-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Add to playlist"
        @click.self="emit('close')"
      >
        <div class="player-sheet">
          <div class="player-sheet-handle" aria-hidden="true"><span /></div>

          <div class="player-sheet-header">
            <h2 class="player-sheet-title">ADD TO PLAYLIST</h2>
            <button class="player-sheet-close" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="w-4 h-4" />
            </button>
          </div>

          <div v-if="addedTo" class="playlist-added">
            <UIcon name="lucide:check" class="w-4 h-4" />
            <div>
              <p class="playlist-added-label">ADDED TO</p>
              <p class="playlist-added-name">{{ addedTo }}</p>
            </div>
          </div>

          <div class="playlist-list">
            <button
              v-for="pl in playlists"
              :key="pl.id"
              class="playlist-item"
              @click="emit('select', pl.id)"
            >
              <div class="playlist-item-main">
                <span class="playlist-item-title">{{ pl.title }}</span>
                <span class="playlist-item-count">{{ pl.count }} TRACKS</span>
              </div>
              <UIcon name="lucide:plus" class="w-4 h-4 playlist-item-plus" />
            </button>

            <button class="playlist-item playlist-item--new" @click="emit('create')">
              <div class="playlist-item-main">
                <span class="playlist-item-title">NEW PLAYLIST</span>
                <span class="playlist-item-count">CREATE</span>
              </div>
              <UIcon name="lucide:plus" class="w-4 h-4" />
            </button>
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
  z-index: 72;
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
  align-items: center;
  justify-content: space-between;
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--player-line);
}

.player-sheet-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg);
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
}

.playlist-added {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  background: color-mix(in srgb, var(--player-accent) 14%, transparent);
  border-bottom: 1px solid var(--player-line);
  color: var(--player-fg);
}

.playlist-added-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
}

.playlist-added-name {
  font-size: 0.875rem;
  font-weight: 700;
}

.playlist-list {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0;
}

.playlist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3.25rem;
  padding-inline: 1.25rem;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--player-line);
  cursor: pointer;
  text-align: left;
  transition: all 160ms var(--player-ease-smooth);
  color: var(--player-fg-muted);
}

.playlist-item:hover {
  background: var(--player-control);
  color: var(--player-fg);
}

.playlist-item--new {
  border-bottom: 0;
  color: var(--player-fg-faint);
  border-top: 1px solid var(--player-line);
  margin-top: 0.5rem;
}

.playlist-item-main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.playlist-item-title {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: inherit;
}

.playlist-item-count {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--player-fg-faint);
}

.playlist-item-plus {
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
