<script setup lang="ts">
// ============================================================
// AI STUDIO — prompt → SEARCH / GENERATE
// ============================================================
// The companion at /ai is now the primary AI entry point; the
// studio keeps its own route so the Intelligence tools
// (search, generate, insights) remain reachable unchanged.
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
