<script setup lang="ts">
// ============================================================
// SearchHeader — focused top bar for the dedicated Search page
// ============================================================
// Features:
// - Direct Back button navigating to previous page (Home, Library, etc.)
// - Minimalist architectural title: SEARCH
// - Compact integrated EMO companion reacting to search status
// ============================================================

import type { EmoExpression } from '~/types/emo'

defineProps<{
  expression?: EmoExpression
  message?: string
}>()

const router = useRouter()

function goBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<template>
  <header class="search-header" aria-label="Search header">
    <div class="search-header__left">
      <button
        type="button"
        class="search-header__back focus-ring"
        aria-label="Back"
        @click="goBack"
      >
        <UIcon name="lucide:arrow-left" class="search-header__back-icon" />
      </button>
      <h1 class="search-header__title">SEARCH</h1>
    </div>

    <!-- Integrated EMO reaction avatar -->
    <div class="search-header__emo" aria-hidden="true">
      <EmoCompanion
        :expression="expression ?? 'curious'"
        :message="message ?? ''"
      />
    </div>
  </header>
</template>

<style scoped>
.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 3.5rem;
  padding: 0 var(--sys-content-pad, 1rem);
  border-bottom: 1px solid var(--sys-border, rgba(255, 255, 255, 0.08));
  background: var(--sys-background, #0b0d12);
  flex-shrink: 0;
}

.search-header__left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.search-header__back {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.1));
  background: transparent;
  color: var(--sys-foreground-muted, #9ba3af);
  cursor: pointer;
  transition: all 150ms ease;
}

.search-header__back:hover {
  color: var(--sys-foreground, #fff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.06));
}

.search-header__back-icon {
  width: 1.125rem;
  height: 1.125rem;
}

.search-header__title {
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--sys-foreground, #fff);
  margin: 0;
}

.search-header__emo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4.5rem;
  height: 2.5rem;
  overflow: visible;
}

.search-header__emo :deep(.emo-companion) {
  width: 8rem;
  transform: scale(0.32);
  transform-origin: center center;
}

.search-header__emo :deep(.emo-companion__status) {
  display: none;
}
</style>
