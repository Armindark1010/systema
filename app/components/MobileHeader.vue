<script setup lang="ts">
// Mobile header — brand + quick actions (search / settings)
const { openPalette } = useQuickSearch()
</script>

<template>
  <header class="lg:hidden sticky top-0 z-30 h-14 bg-base/95 backdrop-blur-sm border-b border-line flex items-center px-4 gap-3">
    <BrandMark compact />
    <div class="flex-1" />
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg"
      aria-label="Quick search"
      @click="openPalette()"
    >
      <UIcon name="lucide:search" class="w-4.5 h-4.5" />
    </button>
    <NuxtLink
      to="/settings"
      class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg"
      aria-label="Settings"
    >
      <UIcon name="lucide:sliders-horizontal" class="w-4.5 h-4.5" />
    </NuxtLink>
  </header>
</template>
