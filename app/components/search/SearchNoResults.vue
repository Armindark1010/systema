<script setup lang="ts">
// ============================================================
// SearchNoResults — minimal architectural empty state
// ============================================================

defineProps<{
  query: string
}>()

const emit = defineEmits<{
  'suggestion-click': [query: string]
}>()

const suggestedHints = [
  { label: 'Electronic & Synthwave', query: 'electronic' },
  { label: 'Calm night music', query: 'calm night' },
  { label: 'Systema Ensemble', query: 'Systema' },
  { label: 'Persian classics', query: 'فارسی' },
]
</script>

<template>
  <div class="search-no-results" role="status" aria-live="polite">
    <div class="search-no-results__content">
      <span class="search-no-results__code" aria-hidden="true">404 // NO MATCH</span>
      <h2 class="search-no-results__title">NO RESULTS</h2>
      <p class="search-no-results__query">
        No music found for <span class="search-no-results__highlight">“{{ query }}”</span>
      </p>

      <div class="search-no-results__hints">
        <p class="search-no-results__hints-label">SUGGESTIONS</p>
        <ul class="search-no-results__tips">
          <li>Check spelling or try a shorter phrase</li>
          <li>Search by artist name, album, or genre</li>
          <li>Describe a mood or activity (e.g. “calm electronic”, “workout”)</li>
        </ul>

        <div class="search-no-results__pills">
          <button
            v-for="hint in suggestedHints"
            :key="hint.query"
            type="button"
            class="search-hint-pill focus-ring"
            @click="emit('suggestion-click', hint.query)"
          >
            {{ hint.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem var(--sys-content-pad, 1rem);
  text-align: center;
}

.search-no-results__content {
  max-width: 28rem;
  width: 100%;
}

.search-no-results__code {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  color: var(--sys-foreground-faint, #6b7280);
  margin-bottom: 0.5rem;
}

.search-no-results__title {
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--sys-foreground, #fff);
  margin: 0 0 0.5rem 0;
}

.search-no-results__query {
  font-size: 0.875rem;
  color: var(--sys-foreground-muted, #9ba3af);
  margin: 0 0 2rem 0;
  line-height: 1.5;
}

.search-no-results__highlight {
  color: var(--sys-foreground, #fff);
  font-weight: 600;
}

.search-no-results__hints {
  border-top: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
  padding-top: 1.5rem;
  text-align: left;
}

.search-no-results__hints-label {
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: var(--sys-foreground-faint, #6b7280);
  margin: 0 0 0.75rem 0;
}

.search-no-results__tips {
  margin: 0 0 1.25rem 0;
  padding-left: 1.25rem;
  color: var(--sys-foreground-muted, #9ba3af);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.search-no-results__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.search-hint-pill {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.12));
  border-radius: 2px;
  background: var(--sys-surface, rgba(255, 255, 255, 0.03));
  color: var(--sys-foreground, #fff);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
}

.search-hint-pill:hover {
  border-color: var(--sys-primary, #64a0ff);
  color: var(--sys-primary, #64a0ff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.06));
}
</style>
