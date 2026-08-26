<script setup lang="ts">
// Mobile bottom navigation — HOME / LIBRARY / PLAYLISTS / AI.
// Search moved out of the dock: it is still reachable from the
// quick-search palette and the /search route, which are untouched.
// Settings intentionally lives in the header, not here.
const route = useRoute()
const { closePalette } = useQuickSearch()

const items = [
  { label: 'HOME', to: '/', icon: 'lucide:house' },
  { label: 'LIBRARY', to: '/library', icon: 'lucide:library' },
  { label: 'PLAYLISTS', to: '/playlists', icon: 'lucide:list-music' },
  { label: 'AI', to: '/ai', icon: 'lucide:sparkles' },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (to === '/library') return route.path.startsWith('/library')
  if (to === '/playlists') return route.path.startsWith('/playlists')
  if (to === '/ai') return route.path === '/ai' || route.path.startsWith('/ai/')
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <nav class="mobile-bottom-nav" aria-label="Primary navigation">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="mobile-bottom-nav__item focus-ring"
      :class="{ 'is-active': isActive(item.to) }"
      :aria-current="isActive(item.to) ? 'page' : undefined"
      @click="closePalette()"
    >
      <span class="mobile-bottom-nav__indicator" aria-hidden="true" />
      <UIcon :name="item.icon" class="mobile-bottom-nav__icon" />
      <span class="mobile-bottom-nav__label">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
