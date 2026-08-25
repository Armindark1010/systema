<script setup lang="ts">
const props = defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  ariaLabel: string
  suffix?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <div class="flex items-center gap-3 w-44">
    <USlider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step ?? 1"
      size="sm"
      class="flex-1"
      :aria-label="ariaLabel"
      @update:model-value="(value: number | number[]) => emit('update:modelValue', Array.isArray(value) ? Number(value[0]) : Number(value))"
    />
    <span class="tnum text-small font-semibold text-fg w-10 text-right">
      {{ modelValue }}{{ suffix ?? '' }}
    </span>
  </div>
</template>
