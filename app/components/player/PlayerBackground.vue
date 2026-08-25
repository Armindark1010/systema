<script setup lang="ts">
// ============================================================
// PlayerBackground — immersive artwork background with layers
// ============================================================
// Layers: artwork → dark overlay → vertical gradient → UI
// Uses design tokens exclusively.
// ============================================================

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
}>(), {
  src: undefined,
  alt: 'album artwork',
})
</script>

<template>
  <div class="player-bg-root" aria-hidden="true">
    <!-- artwork layer -->
    <div
      class="player-bg-art"
      :style="src ? { backgroundImage: `url(${src})` } : undefined"
    >
      <img
        v-if="src"
        :src="src"
        :alt="alt"
        class="sr-only"
        loading="eager"
        decoding="async"
      >
    </div>

    <!-- dark translucent overlay -->
    <div class="player-bg-overlay" />

    <!-- vertical gradient -->
    <div class="player-bg-gradient" />

    <!-- a very low-intensity moving light, behind all UI layers -->
    <div class="player-bg-light" />

    <!-- subtle vignette for depth -->
    <div class="player-bg-vignette" />
  </div>
</template>

<style scoped>
.player-bg-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--player-bg);
}

.player-bg-art {
  position: absolute;
  inset: -4%;
  background-color: var(--player-bg);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: saturate(1.1) contrast(1.05);
  transform: scale(1.04);
  transition: background-image 420ms var(--player-ease-smooth), transform 600ms var(--player-ease);
  will-change: background-image, transform;
}

.player-bg-overlay {
  position: absolute;
  inset: 0;
  background: var(--player-overlay);
  backdrop-filter: blur(0.5px);
}

.player-bg-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    var(--player-gradient-top) 0%,
    var(--player-gradient-mid) 48%,
    var(--player-gradient-bottom) 100%
  );
}

.player-bg-light {
  position: absolute;
  inset: -22%;
  pointer-events: none;
  opacity: 0.3;
  background:
    radial-gradient(32% 26% at 24% 26%, color-mix(in srgb, var(--player-accent) 24%, transparent), transparent 74%),
    radial-gradient(30% 24% at 76% 72%, rgba(237, 240, 244, 0.1), transparent 75%);
  mix-blend-mode: screen;
  animation: player-soft-light 28s ease-in-out infinite alternate;
  will-change: transform;
}

.player-bg-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120% 90% at 50% 18%,
    transparent 38%,
    rgba(10, 11, 14, 0.22) 78%,
    rgba(10, 11, 14, 0.55) 100%
  );
}

@keyframes player-soft-light {
  0% { transform: translate3d(-2%, -1%, 0) scale(1); }
  50% { transform: translate3d(3%, 2%, 0) scale(1.03); }
  100% { transform: translate3d(-1%, 4%, 0) scale(1.01); }
}

@media (prefers-reduced-motion: reduce) {
  .player-bg-art,
  .player-bg-light {
    transition: none;
    animation: none;
  }
}
</style>
