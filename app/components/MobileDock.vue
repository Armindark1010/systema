<script setup lang="ts">
// Mobile dock — quick search sits BELOW the bottom navigation:
//   MINI PLAYER → BOTTOM NAVIGATION → QUICK SEARCH (bottom)
const { openPalette } = useQuickSearch()
const { currentTrack } = usePlayer()
</script>

<template>
  <div class="flex flex-col">
    <!-- mini player -->
    <MiniPlayer v-if="currentTrack" />

    <!-- bottom navigation -->
    <MobileBottomNavigation />

    <!-- quick search action — below the bottom buttons -->
    <button
      class="h-12 pb-safe bg-base border-t border-line flex items-center gap-2.5 px-4 t-col pressable focus-ring"
      aria-label="Quick search"
      @click="openPalette()"
    >
      <UIcon name="lucide:search" class="w-4 h-4 text-fg-muted shrink-0" />
      <span class="text-[13px] font-medium text-fg-muted flex-1 text-left truncate">
        QUICK SEARCH — TRACKS, ARTISTS, AI…
      </span>
      <span class="label text-fg-faint hidden sm:inline">⌘K</span>
    </button>
  </div>
</template>
