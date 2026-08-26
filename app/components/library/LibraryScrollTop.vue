<script setup lang="ts">
// ============================================================
// LibraryScrollTop — subtle "back to start" affordance
// ============================================================
// Hidden at the top of the library, fades in once the user has
// scrolled past a screenful, and returns them to the first track.
// Sits above the mobile dock via the existing dock height tokens so
// it can never cover the bottom navigation.
// ============================================================

const props = withDefaults(defineProps<{
  /** Current document scroll offset, from useDocumentScroll. */
  scrollY: number
  /** Show the button only after this many px. */
  threshold?: number
}>(), {
  threshold: 900,
})

const visible = computed(() => props.scrollY > props.threshold)

function toTop() {
  // `smooth` is the requirement; browsers that ignore it still jump to
  // the top, which remains correct behaviour.
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <Transition name="library-scrolltop">
    <button
      v-if="visible"
      type="button"
      class="library-scrolltop"
      aria-label="Scroll to the start of the library"
      @click="toTop"
    >
      <Icon name="lucide:arrow-up" class="library-scrolltop__icon" />
    </button>
  </Transition>
</template>

<style scoped>
.library-scrolltop {
  position: fixed;
  right: var(--library-gutter, 1rem);
  /* Clears the mini player + bottom navigation + the safe area. */
  bottom: calc(var(--sys-dock-player-h, 8rem) + 0.75rem);
  z-index: 35;

  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;

  color: var(--sys-fg);
  background: var(--sys-bg);
  border: var(--library-line-width, 1px) solid var(--sys-border);
  border-radius: 0;
  cursor: pointer;

  transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
}

.library-scrolltop:hover {
  background: var(--sys-fg);
  color: var(--sys-bg);
}

.library-scrolltop:active {
  transform: translateY(1px);
}

.library-scrolltop__icon {
  width: 1rem;
  height: 1rem;
}

/* Subtle entrance/exit — a short fade plus a few px of travel. */
.library-scrolltop-enter-active,
.library-scrolltop-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.library-scrolltop-enter-from,
.library-scrolltop-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .library-scrolltop,
  .library-scrolltop-enter-active,
  .library-scrolltop-leave-active {
    transition: none;
  }
}
</style>
