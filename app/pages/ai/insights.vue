<script setup lang="ts">
// ============================================================
// AI INSIGHTS — your music profile
// ============================================================

useHead({ title: 'AI Insights' })
definePageMeta({ pageTransition: { name: 'sys-ai', mode: 'out-in' } })
</script>

<template>
  <AIStage>
    <AIInsights />
  </AIStage>
</template>
