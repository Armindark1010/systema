<script setup lang="ts">
// Mobile header — brand + quick actions (search / theme / settings)
const { openPalette } = useQuickSearch()
const { theme, cycleTheme } = useTheme()

const THEME_LABEL: Record<string, string> = {
  default: 'WHITE / STEEL',
  premium: 'IVORY / GOLD',
  dark: 'ONYX / SILVER',
}
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
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg"
      :aria-label="`Theme: ${THEME_LABEL[theme]}`"
      :title="`THEME — ${THEME_LABEL[theme]}`"
      @click="cycleTheme()"
    >
      <span class="grid grid-cols-2 gap-[2px] w-3.5 h-3.5 border border-line" aria-hidden="true">
        <span class="bg-primary" />
        <span class="bg-fg" />
        <span class="bg-line-strong" />
        <span class="bg-primary-muted" />
      </span>
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
