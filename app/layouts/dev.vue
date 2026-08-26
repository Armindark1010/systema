<script setup lang="ts">
// ============================================================
// dev layout — isolated developer tooling
// ============================================================
// Applies SYSTEMA design tokens without mounting AppShell, so the
// benchmarking lab gets no bottom navigation, no mini player and no
// command palette.
//
// This is a requirement, not a style choice (§15): Phase 14 is a
// research instrument and must be unreachable from the normal
// browsing experience. Following the precedent set by the `emo`
// prototype layout.
// ============================================================
useTheme()
</script>

<template>
  <div class="min-h-dvh bg-base text-fg">
    <slot />
  </div>
</template>
