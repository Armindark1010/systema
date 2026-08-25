<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  actionLabel?: string
  to?: string
  ai?: boolean
}>(), { label: 'NO CONTENT', actionLabel: undefined, to: undefined, ai: false })
</script>

<template>
  <div class="border border-dashed py-16 flex flex-col items-center gap-4 text-center px-6" :class="ai ? 'border-ai-line-strong bg-ai-surface/40' : 'border-line-strong bg-surface'">
    <span class="label" :class="ai ? 'text-ai-fg-faint' : 'text-fg-faint'">{{ label }}</span>
    <p v-if="$slots.default" class="text-small max-w-[38ch] mx-auto" :class="ai ? 'text-ai-fg-muted' : 'text-fg-muted'">
      <slot />
    </p>
    <NuxtLink v-if="to && actionLabel" :to="to" class="mt-2" :class="ai ? 'ai-btn-ghost' : 'sys-btn-ghost'" :tabindex="0">
      {{ actionLabel }} →
    </NuxtLink>
  </div>
</template>
