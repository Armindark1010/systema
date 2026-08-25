<script setup lang="ts">
import { SETTINGS_CATEGORIES } from '~/data/settings'

useHead({ title: 'Settings' })
</script>

<template>
  <div>
    <p class="text-small text-fg-muted max-w-[56ch] mb-6">
      Configure the music system, the playback engine, and the intelligence layer.
      Each category is a dedicated control surface — not a generic device menu.
    </p>

    <ul class="border border-line divide-y divide-line bg-surface">
      <li v-for="category in SETTINGS_CATEGORIES" :key="category.id">
        <NuxtLink
          :to="category.to"
          class="flex items-center gap-4 px-4 py-5 t-col pressable focus-ring hover:bg-hover"
        >
          <span class="settings-hub-icon" aria-hidden="true">
            <UIcon :name="category.icon" class="w-4 h-4" />
          </span>
          <span class="tnum text-[11px] font-semibold text-fg-muted w-6 shrink-0">{{ category.index }}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] font-bold tracking-[0.14em] text-fg">{{ category.label }}</span>
            <span class="block mt-1 text-[11.5px] text-fg-muted">{{ category.kicker }} — {{ category.description }}</span>
          </span>
          <UIcon name="lucide:arrow-up-right" class="w-4 h-4 text-fg-muted shrink-0" />
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.settings-hub-icon {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  place-items: center;
  border: 1px solid var(--sys-border);
  color: var(--sys-foreground-muted);
  background: var(--sys-surface-muted);
}
</style>
