<script setup lang="ts">
// ============================================================
// AI SEARCH — semantic search experience
// ============================================================

useHead({ title: 'AI Search' })
definePageMeta({ pageTransition: { name: 'sys-ai', mode: 'out-in' } })
</script>

<template>
  <AIStage>
    <AISearch />
  </AIStage>
</template>
