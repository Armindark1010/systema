<script setup lang="ts">
withDefaults(defineProps<{
  id?: string
  icon?: string
  label: string
  description?: string
  comingSoon?: string
}>(), {
  id: undefined,
  icon: undefined,
  description: undefined,
  comingSoon: undefined,
})
</script>

<template>
  <div :id="id" class="settings-row scroll-mt-24">
    <div class="flex items-start gap-3 min-w-0">
      <span v-if="icon" class="settings-row__icon" aria-hidden="true">
        <UIcon :name="icon" class="w-4 h-4" />
      </span>
      <div class="min-w-0">
        <p class="text-small font-semibold text-fg">{{ label }}</p>
        <p v-if="description" class="text-small text-fg-muted mt-0.5 max-w-[52ch] leading-relaxed">{{ description }}</p>
        <p v-if="comingSoon" class="mt-1 text-micro font-semibold tracking-[0.12em] uppercase text-fg-muted">{{ comingSoon }}</p>
      </div>
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
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  padding-block: var(--sys-density-row-py);
  border-bottom: 1px solid var(--sys-border);
}
.settings-row:last-child {
  border-bottom: 0;
}
.settings-row__icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  place-items: center;
  border: 1px solid var(--sys-border);
  color: var(--sys-foreground-muted);
  background: var(--sys-surface-muted);
}
</style>
