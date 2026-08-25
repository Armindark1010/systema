<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'muted' | 'warning' | 'ai'
}>(), { tone: 'muted' })
</script>

<template>
  <p
    class="mt-3 text-[11px] leading-relaxed"
    :class="{
      'text-fg-faint': tone === 'muted',
      'text-warning': tone === 'warning',
      'text-ai-fg-muted': tone === 'ai',
    }"
  >
    <slot />
  </p>
</template>
