<script setup lang="ts">
// Mobile dock — a floating liquid-glass search control sits above
// the navigation. It expands in place to accept a query.
const { open, query, openPalette, closePalette } = useQuickSearch()
const { currentTrack } = usePlayer()
const archiveSearch = useSearch()
const isMobile = useMediaQuery('(max-width: 1023px)')
const searchInput = ref<HTMLInputElement | null>(null)

const expanded = computed(() => open.value && isMobile.value)

watch(expanded, async (value) => {
  if (!value) return
  await nextTick()
  searchInput.value?.focus()
})

function submitSearch() {
  const value = query.value.trim()
  if (!value) return
  closePalette()
  archiveSearch.submit(value)
}
</script>

<template>
  <div class="mobile-dock-safe flex flex-col">
    <!-- mini player remains above the floating controls -->
    <div v-if="currentTrack" class="mx-3 mb-2 overflow-hidden rounded-[20px] mobile-liquid-surface">
      <MiniPlayer />
    </div>

    <!-- floating search pill — morphs to a full-width input -->
    <div
      class="mobile-search-shell"
      :class="expanded ? 'mobile-search-shell--expanded' : 'mobile-search-shell--idle'"
    >
      <form
        class="mobile-floating-search mobile-liquid-surface"
        role="search"
        :aria-label="expanded ? 'Quick search input' : 'Open quick search'"
        :aria-expanded="expanded"
        @submit.prevent="submitSearch"
        @click="!expanded && openPalette()"
      >
        <button
          v-if="!expanded"
          type="button"
          class="h-full w-full flex items-center justify-center gap-2 text-fg-muted"
          aria-label="Open quick search"
          @click.stop="openPalette()"
        >
          <UIcon name="lucide:search" class="w-4 h-4 shrink-0" />
          <span class="text-[13px] font-medium">Search</span>
        </button>

        <template v-else>
          <UIcon name="lucide:search" class="w-4.5 h-4.5 text-fg-muted shrink-0 ml-4" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            class="mobile-floating-search__input"
            placeholder="Search tracks, artists, albums…"
            autocomplete="off"
            autocapitalize="none"
            aria-label="Quick search"
            @keydown.esc.prevent="closePalette()"
          >
          <button
            type="button"
            class="w-9 h-9 mr-1 shrink-0 grid place-items-center rounded-full text-fg-muted hover:text-fg hover:bg-hover/70 t-col focus-ring"
            aria-label="Close quick search"
            @click.stop="closePalette()"
          >
            <UIcon name="lucide:x" class="w-4 h-4" />
          </button>
        </template>
      </form>
    </div>

    <MobileBottomNavigation />
  </div>
</template>
