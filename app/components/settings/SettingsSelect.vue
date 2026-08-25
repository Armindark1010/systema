<script setup lang="ts" generic="T extends string | number">
const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  ariaLabel: string
  title?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const open = ref(false)
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? String(props.modelValue))

function choose(value: T) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div>
    <button
      type="button"
      class="sys-btn-outline !h-8"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @click="open = true"
    >
      {{ selectedLabel }}
      <UIcon name="lucide:chevron-down" class="w-3.5 h-3.5" />
    </button>

    <LibrarySheetFrame :open="open" :title="title ?? ariaLabel" @close="open = false">
      <div role="radiogroup" :aria-label="ariaLabel">
        <button
          v-for="option in options"
          :key="String(option.value)"
          type="button"
          class="w-full flex items-center justify-between min-h-11 px-4 text-left text-small font-semibold border-b border-line pressable focus-ring"
          :class="modelValue === option.value ? 'bg-muted text-fg' : 'text-fg-muted hover:text-fg'"
          role="radio"
          :aria-checked="modelValue === option.value"
          @click="choose(option.value)"
        >
          {{ option.label }}
          <UIcon v-if="modelValue === option.value" name="lucide:check" class="w-4 h-4 text-primary" />
        </button>
      </div>
    </LibrarySheetFrame>
  </div>
</template>
