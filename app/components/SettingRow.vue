<script setup lang="ts">
// SettingRow — label + description + control, separated by hairlines
withDefaults(defineProps<{
  label: string
  description?: string
  comingSoon?: string
}>(), { description: undefined, comingSoon: undefined })
</script>

<template>
  <div class="settings-row">
    <div class="min-w-0">
      <p class="text-[13.5px] font-semibold text-fg">{{ label }}</p>
      <p v-if="description" class="text-[11.5px] text-fg-muted mt-0.5 max-w-[52ch] leading-relaxed">{{ description }}</p>
      <p v-if="comingSoon" class="mt-1 label text-fg-faint">{{ comingSoon }}</p>
    </div>
    <div class="shrink-0 flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding-block: var(--sys-density-row-py);
  border-bottom: 1px solid var(--sys-border);
}
.settings-row:last-child {
  border-bottom: 0;
}
</style>
