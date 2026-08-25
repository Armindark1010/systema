<script setup lang="ts">
// SettingRow — label + description + control, separated by hairlines
withDefaults(defineProps<{
  label: string
  description?: string
}>(), { description: undefined })
</script>

<template>
  <div class="flex items-center justify-between gap-6 py-4 border-b border-line last:border-b-0">
    <div class="min-w-0">
      <p class="text-[13.5px] font-semibold text-fg">{{ label }}</p>
      <p v-if="description" class="text-[11.5px] text-fg-muted mt-0.5 max-w-[46ch]">{{ description }}</p>
    </div>
    <div class="shrink-0 flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>
