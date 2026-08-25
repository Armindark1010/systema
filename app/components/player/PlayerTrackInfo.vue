<script setup lang="ts">
// ============================================================
// PlayerTrackInfo — track title + artist with SYSTEMA tokens
// ============================================================

const props = defineProps<{
  title: string
  artist: string
  album?: string
  isAiMode?: boolean
  isLyricsMode?: boolean
}>()
</script>

<template>
  <div class="player-track-info">
    <!-- subtle context label -->
    <p v-if="isAiMode" class="player-track-context">AI · CONTEXT</p>
    <p v-else-if="isLyricsMode" class="player-track-context">LYRICS · LIVE</p>
    <p v-else class="player-track-context">NOW PLAYING</p>

    <h1 class="player-track-title">
      {{ title }}
    </h1>
    <p class="player-track-artist">
      {{ artist }}
    </p>
    <p v-if="album" class="player-track-album">
      {{ album }}
    </p>
  </div>
</template>

<style scoped>
.player-track-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  padding-inline: var(--player-content-padding);
}

.player-track-context {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg-faint);
  text-transform: uppercase;
}

.player-track-title {
  font-size: var(--player-track-title-size);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--player-fg);
  text-wrap: balance;
  max-width: 20ch;
}

.player-track-artist {
  font-size: var(--player-track-artist-size);
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--player-fg-muted);
  text-transform: uppercase;
  margin-top: 0.25rem;
}

.player-track-album {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--player-fg-faint);
  letter-spacing: 0.06em;
  margin-top: 0.15rem;
}
</style>
