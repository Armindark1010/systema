<script setup lang="ts">
withDefaults(defineProps<{
  /** index number, e.g. "01" */
  index: string
  /** technical kicker label */
  kicker: string
  /** big editorial title */
  title: string
  /** right-aligned metadata block */
  meta?: string
}>(), { meta: undefined })
</script>

<template>
  <header class="sys-container pt-6 md:pt-8">
    <div class="flex items-baseline justify-between gap-6 hairline-b pb-4">
      <span class="label tnum text-fg-faint">{{ index }}</span>
      <span class="label-muted text-right hidden sm:block">{{ kicker }}</span>
    </div>
    <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mt-6">
      <h1 class="text-display font-bold tracking-tight text-fg text-balance max-w-[14ch]">
        {{ title }}
      </h1>
      <div class="shrink-0 md:text-right max-w-[280px]">
        <p v-if="meta" class="text-small text-fg-muted leading-relaxed">{{ meta }}</p>
        <div class="mt-4 flex gap-3">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </header>
</template>
