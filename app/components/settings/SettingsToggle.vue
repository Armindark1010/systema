<script setup lang="ts">
defineProps<{
  modelValue: boolean
  ariaLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <USwitch
    :model-value="modelValue"
    :aria-label="ariaLabel"
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
  />
</template>
