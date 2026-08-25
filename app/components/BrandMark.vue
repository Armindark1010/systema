<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean; inverted?: boolean }>(), { compact: false, inverted: false })
</script>

<template>
  <NuxtLink
    to="/"
    class="inline-flex items-center gap-3 pressable focus-ring"
    :aria-label="'SYSTEMA — home'"
  >
    <!-- 2×2 grid mark — the SYSTEMA index -->
    <span
      class="grid grid-cols-2 grid-rows-2 gap-[2px] shrink-0 bg-primary p-[5px]"
      :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
      aria-hidden="true"
    >
      <span class="bg-primary-fg" />
      <span class="bg-primary-fg opacity-60" />
      <span class="bg-primary-fg opacity-60" />
      <span class="bg-primary-fg" />
    </span>
    <span
      class="font-bold tracking-[0.24em] uppercase"
      :class="[compact ? 'text-[13px]' : 'text-[15px]', inverted ? 'text-ai-fg' : 'text-fg']"
    >
      Systema
    </span>
  </NuxtLink>
</template>
