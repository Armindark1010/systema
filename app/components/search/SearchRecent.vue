<script setup lang="ts">
// ============================================================
// SearchRecent — recent searches list
// ============================================================
// Supports:
// - Direct tap to execute search
// - Individual remove button
// - Clear all action
// ============================================================

defineProps<{
  searches: string[]
}>()

const emit = defineEmits<{
  select: [term: string]
  remove: [term: string]
  'clear-all': []
}>()
</script>

<template>
  <section v-if="searches.length" class="search-recent-section" aria-label="Recent searches">
    <div class="search-section-header">
      <h2 class="search-section-title">RECENT SEARCHES</h2>
      <button
        type="button"
        class="search-clear-all-btn focus-ring"
        @click="emit('clear-all')"
      >
        CLEAR ALL
      </button>
    </div>

    <ul class="search-recent-list">
      <li
        v-for="term in searches"
        :key="term"
        class="search-recent-item"
      >
        <button
          type="button"
          class="search-recent-term-btn focus-ring"
          @click="emit('select', term)"
        >
          <UIcon name="lucide:clock" class="search-recent-icon" />
          <span class="search-recent-text truncate">{{ term }}</span>
        </button>

        <button
          type="button"
          class="search-recent-remove-btn focus-ring"
          :aria-label="`Remove ${term} from recent searches`"
          @click.stop="emit('remove', term)"
        >
          <UIcon name="lucide:x" class="w-3.5 h-3.5" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.search-recent-section {
  padding: 0.5rem var(--sys-content-pad, 1rem) 1.5rem;
}

.search-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.625rem;
}

.search-section-title {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--sys-foreground-faint, #6b7280);
  margin: 0;
}

.search-clear-all-btn {
  border: 0;
  background: transparent;
  color: var(--sys-foreground-faint, #6b7280);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  transition: color 140ms ease;
}

.search-clear-all-btn:hover {
  color: var(--sys-danger, #ef4444);
}

.search-recent-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 2.75rem;
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-recent-term-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0.5rem 0;
  border: 0;
  background: transparent;
  color: var(--sys-foreground, #fff);
  text-align: left;
  cursor: pointer;
}

.search-recent-term-btn:hover .search-recent-text {
  color: var(--sys-primary, #64a0ff);
}

.search-recent-icon {
  width: 1rem;
  height: 1rem;
  color: var(--sys-foreground-faint, #6b7280);
  flex-shrink: 0;
}

.search-recent-text {
  font-size: 0.875rem;
  font-weight: 500;
}

.search-recent-remove-btn {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--sys-foreground-faint, #6b7280);
  cursor: pointer;
  transition: all 140ms ease;
}

.search-recent-remove-btn:hover {
  color: var(--sys-foreground, #fff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.08));
}
</style>
