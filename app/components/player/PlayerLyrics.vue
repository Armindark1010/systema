<script setup lang="ts">
// ============================================================
// PlayerLyrics — immersive lyrics view
// Transforms artwork area into lyrics, highlights current line,
// auto-scrolls, premium transitions.
// ============================================================

import type { LyricLine } from '~/composables/useLyrics'

const props = defineProps<{
  lines: LyricLine[]
  currentIndex: number
  trackTitle: string
  artist: string
  hasLyrics: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const containerRef = ref<HTMLElement | null>(null)

watch(() => props.currentIndex, (idx) => {
  if (idx < 0 || !containerRef.value) return
  const el = containerRef.value.querySelector(`[data-line="${idx}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}, { flush: 'post' })
</script>

<template>
  <div class="player-lyrics-root">
    <div class="player-lyrics-header">
      <div class="player-lyrics-meta">
        <p class="player-lyrics-kicker">LYRICS · LIVE SYNC</p>
        <p class="player-lyrics-track">{{ trackTitle }}</p>
        <p class="player-lyrics-artist">{{ artist }}</p>
      </div>
      <button class="player-lyrics-close" aria-label="Close lyrics" @click="emit('close')">
        <UIcon name="lucide:x" class="w-4 h-4" />
      </button>
    </div>

    <div v-if="!hasLyrics" class="player-lyrics-empty">
      <p class="player-lyrics-empty-title">LYRICS UNAVAILABLE</p>
      <p class="player-lyrics-empty-sub">This track has no synced lyrics yet.</p>
    </div>

    <div
      v-else
      ref="containerRef"
      class="player-lyrics-list"
      role="log"
      aria-live="polite"
      aria-label="Lyrics"
    >
      <button
        v-for="(line, i) in lines"
        :key="`${line.time}-${i}`"
        :data-line="i"
        class="player-lyric-line"
        :class="{
          'is-current': i === currentIndex,
          'is-past': i < currentIndex,
          'is-future': i > currentIndex,
        }"
        :aria-current="i === currentIndex ? 'true' : undefined"
        tabindex="-1"
      >
        {{ line.text }}
      </button>
    </div>

    <div class="player-lyrics-fade-top" aria-hidden="true" />
    <div class="player-lyrics-fade-bottom" aria-hidden="true" />
  </div>
</template>

<style scoped>
.player-lyrics-root {
  position: relative;
  width: 100%;
  max-width: var(--player-max-width);
  height: 100%;
  min-height: 0;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  padding-inline: var(--player-content-padding);
  overflow: hidden;
}

.player-lyrics-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--player-line);
  margin-bottom: 1rem;
  flex-shrink: 0;
}

.player-lyrics-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.player-lyrics-kicker {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--player-fg-faint);
}

.player-lyrics-track {
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--player-fg);
}

.player-lyrics-artist {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--player-fg-muted);
}

.player-lyrics-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  flex-shrink: 0;
}

.player-lyrics-close:hover {
  color: var(--player-fg);
  border-color: var(--player-line-strong);
  background: var(--player-control-hover);
}

.player-lyrics-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-block: 1.5rem 3rem;
  scrollbar-width: none;
}

.player-lyrics-list::-webkit-scrollbar {
  display: none;
}

.player-lyric-line {
  text-align: center;
  font-size: 0.9375rem;
  line-height: 1.5;
  font-weight: 500;
  color: var(--player-fg-faint);
  transition: all 320ms var(--player-ease);
  cursor: default;
  background: none;
  border: 0;
  padding: 0.15rem 0;
  opacity: 0.6;
  transform: scale(0.96);
}

.player-lyric-line.is-past {
  opacity: 0.42;
  transform: scale(0.94);
}

.player-lyric-line.is-current {
  font-size: clamp(1.125rem, 4.2vw, 1.375rem);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: var(--player-fg);
  opacity: 1;
  transform: scale(1);
  text-shadow: 0 1px 20px rgba(0,0,0,0.4);
}

.player-lyric-line.is-future {
  opacity: 0.58;
  transform: scale(0.96);
}

.player-lyrics-empty {
  display: grid;
  place-items: center;
  flex: 1;
  text-align: center;
  gap: 0.5rem;
  padding-block: 3rem;
}

.player-lyrics-empty-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg-faint);
}

.player-lyrics-empty-sub {
  font-size: 0.8125rem;
  color: var(--player-fg-muted);
}

.player-lyrics-fade-top,
.player-lyrics-fade-bottom {
  position: absolute;
  left: 0;
  right: 0;
  height: 3rem;
  pointer-events: none;
}

.player-lyrics-fade-top {
  top: 4.5rem;
  background: linear-gradient(to bottom, var(--player-bg), transparent);
  opacity: 0.85;
}

.player-lyrics-fade-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--player-bg), transparent);
  opacity: 0.95;
}
</style>
