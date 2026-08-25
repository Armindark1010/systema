<script setup lang="ts">
// ============================================================
// SettingsLayout — control-center frame
// Mobile: hub or dedicated category with back
// Desktop: left configuration rail + content
// ============================================================

import { SETTINGS_CATEGORIES } from '~/data/settings'

const route = useRoute()
const isIndex = computed(() => route.path === '/settings')
const active = computed(() => SETTINGS_CATEGORIES.find(category => route.path === category.to || route.path.startsWith(`${category.to}/`)))

function scrollToHash() {
  if (!import.meta.client) return
  const hash = route.hash.replace('#', '')
  if (!hash) return
  nextTick(() => {
    const target = document.getElementById(hash)
    if (!target) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  })
}

watch(() => route.fullPath, scrollToHash, { immediate: true })
</script>

<template>
  <div class="sys-container mt-4 md:mt-8 pb-16">
    <header class="flex flex-wrap items-end justify-between gap-4 hairline-b pb-4">
      <div class="flex items-center gap-3 min-w-0">
        <NuxtLink
          v-if="!isIndex"
          to="/settings"
          class="lg:hidden pressable focus-ring w-10 h-10 grid place-items-center border border-line text-fg"
          aria-label="Back to settings"
        >
          <UIcon name="lucide:arrow-left" class="w-4 h-4" />
        </NuxtLink>
        <div class="min-w-0">
          <p class="label text-fg-muted">{{ isIndex ? 'CONTROL CENTER' : (active?.index ?? '00') }}</p>
          <div class="flex flex-wrap items-baseline gap-3">
            <h1 class="text-h1 font-bold tracking-tight text-fg">
              {{ isIndex ? 'SETTINGS' : (active?.label ?? 'SETTINGS') }}
            </h1>
            <span class="label tnum text-fg-muted hidden sm:inline">
              {{ isIndex ? `${String(SETTINGS_CATEGORIES.length).padStart(2, '0')} CATEGORIES` : (active?.kicker ?? '') }}
            </span>
          </div>
        </div>
      </div>
      <p class="text-small text-fg-muted max-w-[36ch] text-right hidden md:block">
        SYSTEM CONFIGURATION — LOCAL, PERSISTED, READY FOR NATIVE STORAGE.
      </p>
    </header>

    <div class="grid lg:grid-cols-[220px_1fr] gap-8 mt-6">
      <nav class="lg:sticky lg:top-8 self-start hidden lg:block" aria-label="Settings categories">
        <ul class="border border-line bg-surface">
          <li v-for="category in SETTINGS_CATEGORIES" :key="category.id">
            <NuxtLink
              :to="category.to"
              class="w-full flex items-center gap-3 h-10 px-3 text-left text-[12px] font-semibold tracking-[0.12em] t-col pressable focus-ring"
              :class="active?.id === category.id ? 'bg-primary-muted text-primary' : 'text-fg-muted hover:(bg-hover text-fg)'"
              :aria-current="active?.id === category.id ? 'page' : undefined"
            >
              <UIcon :name="category.icon" class="w-3.5 h-3.5 shrink-0" />
              <span>{{ category.label }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <div class="min-w-0">
        <SettingsSearch class="mb-6" />
        <slot />
      </div>
    </div>
  </div>
</template>
