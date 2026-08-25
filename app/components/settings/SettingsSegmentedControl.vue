<script setup lang="ts" generic="T extends string | number">
defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  ariaLabel: string
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <SettingsSegmented
    :model-value="modelValue"
    :options="options"
    :aria-label="ariaLabel"
    :compact="compact"
    @update:model-value="value => emit('update:modelValue', value)"
  />
</template>
