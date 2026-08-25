<script setup lang="ts">
// SettingsSection — one settings category block
withDefaults(defineProps<{
  id: string
  index: string
  label: string
  description?: string
}>(), { description: undefined })
</script>

<template>
  <section :id="id" class="scroll-mt-24" :aria-label="label">
    <header class="hairline-b pb-3 mb-5 flex items-baseline gap-4">
      <span class="label tnum text-fg-muted">{{ index }}</span>
      <h2 class="text-title font-bold tracking-wide text-fg">{{ label }}</h2>
      <p v-if="description" class="text-[11px] text-fg-muted ml-auto text-right hidden md:block">{{ description }}</p>
    </header>
    <slot />
  </section>
</template>
