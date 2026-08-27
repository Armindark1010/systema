<script setup lang="ts">
defineProps<{
  sortLabel: string
  trackCount: number
}>()

const emit = defineEmits<{
  sort: []
  shuffle: []
}>()
</script>

<template>
  <section class="library-controls" aria-label="Library controls">
    <button class="library-controls__sort focus-ring flex items-center gap-1" aria-label="Choose how tracks are sorted" @click="emit('sort')">
      <span class="library-controls__sort-value text-xs">{{ sortLabel }}</span>
      <UIcon name="lucide:chevron-down" class="library-controls__chevron" aria-hidden="true" />
    </button>

    <div class="flex gap-2">
      <UIcon name="lucide:shuffle" class="library-controls__shuffle-icon" aria-hidden="true" @click="emit('shuffle')" />
      <span class="library-controls__count label-muted tnum" aria-live="polite">
        {{ trackCount.toLocaleString() }} Songs
      </span>
    </div>

  </section>
</template>

<style scoped>
.library-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--library-gutter);
  align-items: center;
  /* padding: var(--library-control-pad); */
  /* border: var(--library-line-width) solid var(--sys-border); */
  background: var(--sys-surface);
}

.library-controls__sort {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--sys-foreground);
  text-align: left;
  cursor: pointer;
}

.library-controls__sort-value {
  overflow: hidden;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.library-controls__chevron {
  width: var(--library-icon-size);
  height: var(--library-icon-size);
  color: var(--sys-foreground-faint);
  flex-shrink: 0;
}

.library-controls__count {
  align-self: start;
  text-align: right;
  white-space: nowrap;
}

.library-controls__shuffle {
  display: inline-flex;
  min-height: var(--library-menu-size);
  grid-column: 2;
  align-items: center;
  justify-content: center;
  gap: var(--library-gap);
  padding-inline: var(--library-control-pad);
  border: var(--library-line-width) solid var(--sys-border-strong);
  background: var(--sys-primary);
  color: var(--sys-primary-foreground);
  font-weight: 700;
  letter-spacing: 0.14em;
  cursor: pointer;
}

.library-controls__shuffle:hover {
  background: var(--sys-primary-strong);
}

.library-controls__shuffle-icon {
  width: var(--library-icon-size);
  height: var(--library-icon-size);
}

@media (min-width: 640px) {
  .library-controls {
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
  }

  .library-controls__count { align-self: center; }
  .library-controls__shuffle { grid-column: auto; }
}
</style>
