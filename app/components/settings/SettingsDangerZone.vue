<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="border border-danger">
    <header v-if="title" class="px-4 py-3 border-b border-danger">
      <p class="label text-danger">{{ title }}</p>
    </header>
    <slot />
  </div>
</template>
