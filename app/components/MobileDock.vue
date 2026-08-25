<script setup lang="ts">
const { currentTrack } = usePlayer()
const { open, query } = useQuickSearch()

const searchExpanded = ref(false)
const searchShell = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

onClickOutside(searchShell, () => {
  if (searchExpanded.value) collapseSearch()
})

async function expandSearch() {
  query.value = ''
  searchExpanded.value = true
  await nextTick()
  searchInput.value?.focus()
}

function collapseSearch() {
  searchExpanded.value = false
}

function openSearchWorkspace() {
  const q = query.value.trim()
  searchExpanded.value = false
  if (q) {
    navigateTo(`/search?q=${encodeURIComponent(q)}`)
  } else {
    navigateTo('/search')
  }
}

watch(open, (isOpen) => {
  if (isOpen) searchExpanded.value = false
})
</script>

<template>
  <div class="mobile-dock" :class="{ 'mobile-dock--with-player': currentTrack }">
    <div
      v-if="!open"
      ref="searchShell"
      class="mobile-quick-search-shell"
      :class="searchExpanded ? 'mobile-quick-search-shell--expanded' : 'mobile-quick-search-shell--idle'"
    >
      <form
        class="mobile-quick-search"
        role="search"
        :aria-label="searchExpanded ? 'Quick Search input' : 'Open Quick Search'"
        :aria-expanded="searchExpanded"
        @submit.prevent="openSearchWorkspace"
      >
        <button
          v-if="!searchExpanded"
          type="button"
          class="mobile-quick-search__trigger pressable focus-ring"
          aria-label="Open Search input"
          @click="expandSearch"
        >
          <UIcon name="lucide:search" class="mobile-quick-search__icon" />
          <span>SEARCH</span>
        </button>

        <template v-else>
          <UIcon name="lucide:search" class="mobile-quick-search__icon mobile-quick-search__input-icon" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            class="mobile-quick-search__input focus-ring"
            placeholder="SEARCH SYSTEMA"
            autocomplete="off"
            enterkeyhint="search"
            aria-label="Search SYSTEMA"
            @keydown.esc.prevent="collapseSearch"
          >
          <button
            type="button"
            class="mobile-quick-search__close pressable focus-ring"
            aria-label="Close Search input"
            @click="collapseSearch"
          >
            <UIcon name="lucide:x" />
          </button>
        </template>
      </form>
    </div>

    <div class="mobile-dock__controls">
      <MobileMiniPlayer v-if="currentTrack" />
      <MobileBottomNavigation />
    </div>
  </div>
</template>
