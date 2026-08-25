<script setup lang="ts">
import type { EmoExpression } from '~/types/emo'

withDefaults(defineProps<{
  expression?: EmoExpression
  message?: string
}>(), {
  expression: 'idle',
  message: 'LIBRARY READY',
})
</script>

<template>
  <header class="library-hero" aria-label="Library">
    <div class="library-hero__emo">
      <EmoCompanion
        :expression="expression"
        :message="message"
      />
    </div>
    <h1 class="text-h1 font-bold tracking-tight text-fg">LIBRARY</h1>
  </header>
</template>

<style scoped>
.library-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--library-gutter) var(--library-gutter) 0;
  text-align: center;
}

.library-hero__emo {
  display: flex;
  width: 100%;
  height: var(--library-hero-emo-height);
  align-items: flex-start;
  justify-content: center;
  overflow: visible;
}

.library-hero__emo :deep(.emo-companion) {
  width: var(--emo-companion-width);
  transform: scale(0.48);
  transform-origin: top center;
}

@media (min-width: 768px) {
  .library-hero {
    padding-top: var(--library-gutter-wide);
  }

  .library-hero__emo :deep(.emo-companion) {
    transform: scale(0.56);
  }
}
</style>
