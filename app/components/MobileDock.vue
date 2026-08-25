<script setup lang="ts">
// Mobile dock — stacked above the bottom navigation, per spec:
//   QUICK SEARCH (top) → MINI PLAYER → BOTTOM NAVIGATION
const { openPalette } = useQuickSearch()
const { currentTrack } = usePlayer()
</script>

<template>
  <div class="flex flex-col">
    <!-- quick search action -->
    <button
      class="h-12 bg-base border-t border-line flex items-center gap-2.5 px-4 t-col pressable focus-ring"
      aria-label="Quick search"
      @click="openPalette()"
    >
      <UIcon name="lucide:search" class="w-4 h-4 text-fg-muted shrink-0" />
      <span class="text-[13px] font-medium text-fg-muted flex-1 text-left truncate">
        QUICK SEARCH — TRACKS, ARTISTS, AI…
      </span>
      <span class="label text-fg-faint hidden sm:inline">⌘K</span>
    </button>

    <!-- mini player -->
    <MiniPlayer v-if="currentTrack" />

    <!-- bottom navigation -->
    <MobileBottomNavigation />
  </div>
</template>
