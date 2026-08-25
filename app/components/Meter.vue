<script setup lang="ts">
// Architectural meter — value bar with tick ruler.
const props = withDefaults(defineProps<{
  value: number
  label?: string
  /** css color (token class applied on the fill) */
  color?: string
  ai?: boolean
}>(), { label: undefined, color: 'bg-primary', ai: false })

const clamped = computed(() => Math.max(0, Math.min(100, Number.isFinite(Number(props.value)) ? Number(props.value) : 0)))
</script>

<template>
  <div>
    <div v-if="label" class="flex items-baseline justify-between mb-1.5">
      <span class="label-muted">{{ label }}</span>
      <span class="text-small font-semibold tnum" :class="ai ? 'text-ai-fg' : 'text-fg'">{{ value }}</span>
    </div>
    <div
      class="relative h-1.5 w-full bg-transparent"
      :class="ai ? 'bg-ai-muted' : 'bg-hover'"
      role="progressbar"
      :aria-valuenow="clamped"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label || 'meter'"
      :style="{ backgroundImage: 'repeating-linear-gradient(to right, transparent 0 9%, ' + (ai ? 'rgba(139,92,246,0.15)' : 'var(--sys-border-strong)') + ' 9% 10%)' }"
    >
      <div class="absolute inset-y-0 left-0 t-all" :class="color" :style="{ width: clamped + '%' }" />
    </div>
  </div>
</template>
