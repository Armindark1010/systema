<script setup lang="ts">
withDefaults(defineProps<{
  /** small technical label, e.g. "CONTINUE LISTENING" */
  label: string
  /** optional large title */
  title?: string
  /** optional "SEE ALL" link */
  to?: string
  index?: string
}>(), { title: undefined, to: undefined, index: undefined })
</script>

<template>
  <header class="flex items-end justify-between gap-6 hairline-b pb-3">
    <div class="flex items-baseline gap-4">
      <span v-if="index" class="label text-fg-faint tnum">{{ index }}</span>
      <div>
        <p class="label-muted">{{ label }}</p>
        <h2 v-if="title" class="mt-1 text-h2 font-semibold tracking-tight text-fg">{{ title }}</h2>
      </div>
    </div>
    <NuxtLink
      v-if="to"
      :to="to"
      class="shrink-0 label text-fg-muted hover:text-primary t-col focus-ring py-1"
    >
      SEE ALL →
    </NuxtLink>
    <slot name="right" />
  </header>
</template>
