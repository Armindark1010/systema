<script setup lang="ts">
// ============================================================
// DesktopSidebar — architectural navigation rail
// ============================================================

const route = useRoute()
const { openPalette } = useQuickSearch()
const { theme, cycleTheme } = useTheme()

const groups = [
  {
    label: 'DISCOVER',
    items: [
      { index: '01', label: 'HOME', to: '/' },
      { index: '02', label: 'SEARCH', to: '/search' },
    ],
  },
  {
    label: 'LIBRARY',
    items: [
      { index: '03', label: 'LIBRARY', to: '/library' },
      { index: '04', label: 'ALBUMS', to: '/library/albums' },
      { index: '05', label: 'ARTISTS', to: '/library/artists' },
      { index: '06', label: 'PLAYLISTS', to: '/playlists' },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { index: '07', label: 'AI STUDIO', to: '/ai' },
      { index: '08', label: 'INSIGHTS', to: '/ai/insights' },
    ],
  },
]

const THEME_LABEL: Record<string, string> = {
  default: 'WHITE / STEEL',
  premium: 'IVORY / GOLD',
  dark: 'ONYX / SILVER',
  midcentury: 'TEAK / OLIVE',
  bauhaus: 'PRIMARY GRID',
}

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (to === '/ai') return route.path === '/ai' || route.path.startsWith('/ai/search') || route.path.startsWith('/ai/generate')
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <aside class="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[248px] flex-col bg-surface border-r border-line" aria-label="Primary">
    <div class="px-6 pt-6 pb-5">
      <BrandMark />
      <p class="mt-2 label-faint">MUSIC SYSTEM — V0.4</p>
    </div>

    <div class="hairline-t mx-6" />

    <nav class="flex-1 overflow-y-auto px-3 py-6 space-y-7" aria-label="Navigation groups">
      <div v-for="group in groups" :key="group.label">
        <p class="label-faint px-3 mb-2">{{ group.label }}</p>
        <ul class="space-y-0.5">
          <li v-for="item in group.items" :key="item.to">
            <NuxtLink
              :to="item.to"
              class="group flex items-center gap-3 h-9 px-3 text-[13px] font-semibold tracking-wide t-col focus-ring"
              :class="isActive(item.to) ? 'bg-primary-muted text-primary' : 'text-fg-muted hover:(bg-hover text-fg)'"
              :aria-current="isActive(item.to) ? 'page' : undefined"
            >
              <span
                class="w-4 shrink-0 text-right tnum text-[10px] tracking-[0.08em]"
                :class="isActive(item.to) ? 'text-primary' : 'text-fg-faint group-hover:text-fg-muted'"
              >{{ item.index }}</span>
              {{ item.label }}
              <span v-if="isActive(item.to)" class="ml-auto w-1.5 h-1.5 bg-primary" aria-hidden="true" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </nav>

    <!-- footer: quick search + settings + theme -->
    <div class="hairline-t px-3 py-4 space-y-2">
      <button
        class="w-full h-9 border border-line flex items-center gap-2 px-3 text-[12px] font-semibold tracking-wide text-fg-muted hover:(border-line-strong text-fg bg-hover) t-col pressable focus-ring"
        aria-label="Open quick search"
        @click="openPalette()"
      >
        <UIcon name="lucide:search" class="w-3.5 h-3.5 shrink-0" />
        <span class="flex-1 text-left">QUICK SEARCH</span>
        <kbd class="hidden 2xl:inline text-[10px] text-fg-faint border border-line px-1 py-px">⌘K</kbd>
      </button>

      <div class="flex items-center justify-between pl-3 pr-1">
        <NuxtLink
          to="/settings"
          class="flex items-center gap-2 h-8 text-[12px] font-semibold tracking-wide text-fg-muted hover:text-fg t-col focus-ring px-1"
          :class="{ 'text-primary': isActive('/settings') }"
        >
          <UIcon name="lucide:sliders-horizontal" class="w-3.5 h-3.5" />
          SETTINGS
        </NuxtLink>
        <button
          class="pressable focus-ring h-8 px-2 flex items-center gap-1.5"
          :aria-label="`Theme: ${THEME_LABEL[theme]}`"
          :title="`THEME — ${THEME_LABEL[theme]}`"
          @click="cycleTheme()"
        >
          <span class="grid grid-cols-2 gap-[2px] w-4 h-4 border border-line" aria-hidden="true">
            <span class="bg-primary" />
            <span class="bg-fg" />
            <span class="bg-line-strong" />
            <span class="bg-primary-muted" />
          </span>
          <span class="hidden xl:inline label text-fg-faint">{{ THEME_LABEL[theme] }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
