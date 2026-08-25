<script setup lang="ts">
// ============================================================
// AI STUDIO — intelligence home
// ============================================================

useHead({ title: 'AI Studio' })
definePageMeta({
  layout: 'default',
  pageTransition: { name: 'sys-ai', mode: 'out-in' },
})
</script>

<template>
  <AIStage>
    <AIStudio />
  </AIStage>
</template>
