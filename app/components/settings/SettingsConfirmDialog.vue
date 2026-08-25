<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  requirePhrase?: string
}>(), {
  confirmLabel: 'CONFIRM',
  danger: false,
  requirePhrase: undefined,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const phrase = ref('')

watch(() => props.open, (open) => {
  if (!open) phrase.value = ''
})

const canConfirm = computed(() => {
  if (!props.requirePhrase) return true
  return phrase.value.trim().toUpperCase() === props.requirePhrase.toUpperCase()
})

function close() {
  emit('update:open', false)
}

function confirm() {
  if (!canConfirm.value) return
  emit('confirm')
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :model-value="open"
    :ui="{ width: 'max-w-[440px]', content: 'bg-surface text-fg' }"
    :title="title"
    :description="description"
    @update:model-value="(value: boolean) => emit('update:open', value)"
  >
    <template #body>
      <p class="text-small text-fg-muted leading-relaxed">{{ description }}</p>
      <label v-if="requirePhrase" class="block mt-5">
        <span class="label-muted">TYPE {{ requirePhrase }} TO CONFIRM</span>
        <input
          v-model="phrase"
          type="text"
          class="sys-input mt-2"
          :aria-label="`Type ${requirePhrase} to confirm`"
          autocomplete="off"
        >
      </label>
      <div class="flex justify-end gap-2 mt-6">
        <button type="button" class="sys-btn-ghost" @click="close">CANCEL</button>
        <button
          type="button"
          class="sys-btn-primary"
          :class="danger ? '!bg-danger hover:!bg-danger' : ''"
          :disabled="!canConfirm"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </template>
  </UModal>
</template>
