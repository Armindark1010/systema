<script setup lang="ts">
// Mobile bottom navigation — HOME / LIBRARY / SEARCH / AI
// Settings intentionally lives in the header, not here.
const route = useRoute()

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
    class="bg-surface border-t border-line grid grid-cols-4"
    aria-label="Mobile navigation"
  >
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="relative h-[60px] flex flex-col items-center justify-center gap-1 t-col focus-ring"
      :class="isActive(item.to) ? 'text-primary' : 'text-fg-muted active:text-fg'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <span
        class="absolute top-0 h-[2px] w-8 transition-colors duration-160"
        :class="isActive(item.to) ? 'bg-primary' : 'bg-transparent'"
        aria-hidden="true"
      />
      <UIcon :name="item.icon" class="w-5 h-5" />
      <span class="text-[9.5px] font-bold tracking-[0.14em]">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
