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
    <button class="library-controls__sort focus-ring" aria-label="Choose how tracks are sorted" @click="emit('sort')">
      <span class="label-muted">SORT BY</span>
      <span class="library-controls__sort-value text-small">{{ sortLabel }}</span>
      <UIcon name="lucide:chevron-down" class="library-controls__chevron" aria-hidden="true" />
    </button>

    <span class="library-controls__count label-muted tnum" aria-live="polite">
      {{ trackCount.toLocaleString() }} TRACKS
    </span>

    <button class="library-controls__shuffle focus-ring" aria-label="Shuffle library" @click="emit('shuffle')">
      <UIcon name="lucide:shuffle" class="library-controls__shuffle-icon" aria-hidden="true" />
      <span class="text-micro">SHUFFLE</span>
    </button>
  </section>
</template>

<style scoped>
.library-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--library-gutter);
  align-items: end;
  padding: var(--library-control-pad);
  border: var(--library-line-width) solid var(--sys-border);
  background: var(--sys-surface);
}

.library-controls__sort {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label icon'
    'value icon';
  gap: var(--library-gap-tight) var(--library-gap);
  border: 0;
  background: transparent;
  color: var(--sys-foreground);
  text-align: left;
  cursor: pointer;
}

.library-controls__sort > .label-muted { grid-area: label; }

.library-controls__sort-value {
  grid-area: value;
  overflow: hidden;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.library-controls__chevron {
  grid-area: icon;
  width: var(--library-icon-size);
  height: var(--library-icon-size);
  align-self: center;
  color: var(--sys-foreground-faint);
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
