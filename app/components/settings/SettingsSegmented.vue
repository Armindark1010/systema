<script setup lang="ts" generic="T extends string | number">
const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  ariaLabel: string
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div
    class="inline-flex flex-wrap border border-line"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in props.options"
      :key="String(option.value)"
      type="button"
      class="h-8 px-2.5 text-[10px] font-bold tracking-[0.12em] t-all pressable focus-ring"
      :class="[
        props.modelValue === option.value ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
        props.compact ? '!px-2 !text-[9px]' : '',
      ]"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
