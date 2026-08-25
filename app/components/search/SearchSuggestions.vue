<script setup lang="ts">
// ============================================================
// SearchSuggestions — Discover pills & live query suggestions
// ============================================================

defineProps<{
  suggestedQueries: string[]
  liveSuggestions?: string[]
  hasQuery?: boolean
}>()

const emit = defineEmits<{
  select: [term: string]
}>()
</script>

<template>
  <div class="search-suggestions-container">
    <!-- Live suggestions while typing -->
    <section v-if="hasQuery && liveSuggestions && liveSuggestions.length" class="search-live-suggestions" aria-label="Query suggestions">
      <p class="search-suggestions-label">SUGGESTIONS</p>
      <ul class="search-live-list">
        <li v-for="item in liveSuggestions" :key="item" class="search-live-item">
          <button
            type="button"
            class="search-live-btn focus-ring"
            @click="emit('select', item)"
          >
            <UIcon name="lucide:search" class="search-live-icon" />
            <span class="truncate">{{ item }}</span>
            <UIcon name="lucide:arrow-up-right" class="search-live-arrow" />
          </button>
        </li>
      </ul>
    </section>

    <!-- Discover / Suggested search pills -->
    <section class="search-discover-section" aria-label="Suggested discovery searches">
      <p class="search-suggestions-label">DISCOVER</p>
      <div class="search-discover-pills">
        <button
          v-for="pill in suggestedQueries"
          :key="pill"
          type="button"
          class="search-discover-pill focus-ring"
          :class="{ 'is-persian': /[\u0600-\u06FF]/.test(pill) }"
          @click="emit('select', pill)"
        >
          <UIcon
            :name="/[\u0600-\u06FF]/.test(pill) || pill.toLowerCase().includes('focus') ? 'lucide:sparkles' : 'lucide:compass'"
            class="search-pill-icon"
          />
          <span>{{ pill }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-suggestions-container {
  padding: 0.5rem var(--sys-content-pad, 1rem) 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.search-suggestions-label {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--sys-foreground-faint, #6b7280);
  margin: 0 0 0.75rem 0;
}

.search-live-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-live-item {
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
}

.search-live-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0;
  border: 0;
  background: transparent;
  color: var(--sys-foreground, #fff);
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: color 140ms ease;
}

.search-live-btn:hover {
  color: var(--sys-primary, #64a0ff);
}

.search-live-icon {
  width: 1rem;
  height: 1rem;
  color: var(--sys-foreground-faint, #6b7280);
  flex-shrink: 0;
}

.search-live-arrow {
  width: 0.875rem;
  height: 0.875rem;
  color: var(--sys-foreground-faint, #6b7280);
  margin-left: auto;
  flex-shrink: 0;
}

.search-discover-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.search-discover-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.25rem;
  padding: 0.375rem 0.875rem;
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  background: var(--sys-surface, rgba(255, 255, 255, 0.03));
  color: var(--sys-foreground, #fff);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: all 150ms ease;
}

.search-discover-pill:hover {
  border-color: var(--sys-primary, #64a0ff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.07));
  color: var(--sys-primary, #64a0ff);
}

.search-discover-pill.is-persian {
  font-family: inherit;
  letter-spacing: normal;
}

.search-pill-icon {
  width: 0.875rem;
  height: 0.875rem;
  color: var(--sys-foreground-muted, #9ba3af);
  flex-shrink: 0;
}
</style>
