<script setup lang="ts">
// ============================================================
// SearchResultSection — section header with title and count
// ============================================================

defineProps<{
  title: string
  count?: number
}>()
</script>

<template>
  <div class="search-section-header">
    <h3 class="search-section-label">{{ title }}</h3>
    <span v-if="count !== undefined && count > 0" class="search-section-count">
      {{ count }} {{ count === 1 ? 'RESULT' : 'RESULTS' }}
    </span>
  </div>
</template>

<style scoped>
.search-section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 1rem 0 0.5rem;
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
  margin-bottom: 0.25rem;
}

.search-section-label {
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--sys-foreground-faint, #6b7280);
  margin: 0;
}

.search-section-count {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--sys-foreground-faint, #6b7280);
  font-variant-numeric: tabular-nums;
}
</style>
