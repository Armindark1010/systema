<script setup lang="ts">
// ============================================================
// AI GENERATE — playlist generation pipeline
// ============================================================

useHead({ title: 'AI Generate' })
definePageMeta({ pageTransition: { name: 'sys-ai', mode: 'out-in' } })
</script>

<template>
  <AIStage>
    <AIPlaylistGenerator />
  </AIStage>
</template>
