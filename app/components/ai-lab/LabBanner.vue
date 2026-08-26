<script setup lang="ts">
// ============================================================
// LabBanner — prominent, unmissable caveats
// ============================================================
// Used for the statements that must never be scrolled past: that a
// run was measured on a desktop, that a model has no weights, that a
// comparison is invalid. §8 requires these be impossible to overlook.
// ============================================================

withDefaults(defineProps<{
  tone?: 'info' | 'warning' | 'danger'
  title: string
}>(), { tone: 'info' })
</script>

<template>
  <div
    class="border-l-2 border border-line bg-surface px-4 py-3"
    :class="{
      'border-l-warning': tone === 'warning',
      'border-l-danger': tone === 'danger',
      'border-l-primary': tone === 'info',
    }"
  >
    <p
      class="label"
      :class="{
        'text-warning': tone === 'warning',
        'text-danger': tone === 'danger',
        'text-primary': tone === 'info',
      }"
    >
      {{ title }}
    </p>
    <div class="mt-1.5 text-small text-fg-muted leading-relaxed max-w-[80ch]">
      <slot />
    </div>
  </div>
</template>
