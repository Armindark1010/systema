<script setup lang="ts">
const { currentTrack } = usePlayer()
const { open, openPalette } = useQuickSearch()
</script>

<template>
  <div class="mobile-dock" :class="{ 'mobile-dock--with-player': currentTrack }">
    <button
      v-if="!open"
      type="button"
      class="mobile-quick-search pressable focus-ring"
      aria-label="Open Search"
      @click="openPalette()"
    >
      <UIcon name="lucide:search" class="mobile-quick-search__icon" />
    </button>

    <div class="mobile-dock__controls">
      <MobileMiniPlayer v-if="currentTrack" />
      <MobileBottomNavigation />
    </div>
  </div>
</template>
