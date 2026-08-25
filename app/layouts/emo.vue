<script setup lang="ts">
// Isolated prototype layout: applies SYSTEMA tokens without mounting AppShell.
useTheme()
</script>

<template>
  <div class="min-h-dvh bg-base text-fg">
    <slot />
  </div>
</template>
