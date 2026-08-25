<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <section class="library-empty" role="status">
    <p class="label-muted">{{ title }}</p>
    <p class="text-small text-fg-muted"><slot /></p>
  </section>
</template>

<style scoped>
.library-empty {
  display: flex;
  min-height: calc(var(--library-row-height) * 3);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--library-gap);
  border-top: var(--library-line-width) solid var(--sys-border);
  border-bottom: var(--library-line-width) solid var(--sys-border);
  text-align: center;
}
</style>
