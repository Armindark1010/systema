<script setup lang="ts">
// Mobile bottom navigation — HOME / LIBRARY / SEARCH / AI
// Settings intentionally lives in the header, not here.
const route = useRoute()
const { closePalette } = useQuickSearch()

const items = [
  { label: 'HOME', to: '/', icon: 'lucide:house' },
  { label: 'LIBRARY', to: '/library/tracks', icon: 'lucide:library' },
  { label: 'SEARCH', to: '/search', icon: 'lucide:search' },
  { label: 'AI', to: '/ai', icon: 'lucide:sparkles' },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (to === '/library/tracks') return route.path.startsWith('/library')
  if (to === '/ai') return route.path === '/ai' || route.path.startsWith('/ai/')
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <nav
    class="mobile-liquid-nav mobile-liquid-surface mx-3 grid grid-cols-4"
    aria-label="Mobile navigation"
  >
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="group relative h-16 flex flex-col items-center justify-center gap-1 t-col focus-ring"
      :class="isActive(item.to) ? 'text-primary' : 'text-fg-muted active:text-fg'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
      @click="closePalette()"
    >
      <span
        class="mobile-liquid-nav__active"
        :class="isActive(item.to) ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-active:opacity-60 group-active:scale-95'"
        aria-hidden="true"
      />
      <UIcon :name="item.icon" class="relative z-1 w-5 h-5" />
      <span class="relative z-1 text-[9.5px] font-bold tracking-[0.14em]">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
