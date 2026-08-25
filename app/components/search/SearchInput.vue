<script setup lang="ts">
// ============================================================
// SearchInput — primary search input field
// ============================================================
// Features:
// - Autofocus on open
// - Responsive mobile keyboard handling (enterkeyhint="search")
// - Clear button with accessible label
// - Subtle mode indicator (TEXT / AI INTENT)
// ============================================================

const props = defineProps<{
  modelValue: string
  isSearching?: boolean
  isSemantic?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  clear: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function onClear() {
  emit('clear')
  emit('update:modelValue', '')
  inputRef.value?.focus()
}

function onSubmit() {
  emit('submit')
  // Blur to dismiss mobile keyboard naturally
  inputRef.value?.blur()
}

onMounted(() => {
  nextTick(() => {
    inputRef.value?.focus()
  })
})
</script>

<template>
  <div class="search-input-shell">
    <form class="search-input-box focus-within:border-fg-muted" role="search" @submit.prevent="onSubmit">
      <!-- Search icon or loading spinner -->
      <span class="search-input-icon-wrap" aria-hidden="true">
        <UIcon
          v-if="isSearching"
          name="lucide:loader-2"
          class="search-input-icon animate-spin text-primary"
        />
        <UIcon
          v-else
          :name="isSemantic ? 'lucide:sparkles' : 'lucide:search'"
          class="search-input-icon"
          :class="isSemantic ? 'text-primary' : 'text-fg-muted'"
        />
      </span>

      <!-- Primary text input -->
      <input
        ref="inputRef"
        :value="modelValue"
        type="search"
        class="search-input-field focus:outline-none"
        placeholder="Search music..."
        aria-label="Search music"
        autofocus
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        @input="onInput"
      >

      <!-- Mode indicator tag -->
      <span
        v-if="isSemantic"
        class="search-input-mode"
        aria-label="AI Semantic mode detected"
      >
        <UIcon name="lucide:sparkles" class="w-2.5 h-2.5" />
        <span>AI INTENT</span>
      </span>

      <!-- Clear button -->
      <button
        v-if="modelValue"
        type="button"
        class="search-input-clear focus-ring"
        aria-label="Clear search"
        @click="onClear"
      >
        <UIcon name="lucide:x" class="w-3.5 h-3.5" />
      </button>
    </form>
  </div>
</template>

<style scoped>
.search-input-shell {
  width: 100%;
  padding: 0.75rem var(--sys-content-pad, 1rem);
}

.search-input-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  height: 3rem;
  padding: 0 0.875rem;
  background: var(--sys-surface, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--sys-border, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  transition: border-color 160ms ease, background 160ms ease;
}

.search-input-icon-wrap {
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.search-input-icon {
  width: 1.125rem;
  height: 1.125rem;
}

.search-input-field {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--sys-foreground, #fff);
  font-size: 0.9375rem;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.search-input-field::placeholder {
  color: var(--sys-foreground-faint, #6b7280);
}

/* Hide native webkit search cancel button */
.search-input-field::-webkit-search-cancel-button {
  -webkit-appearance: none;
  display: none;
}

.search-input-mode {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border-radius: 2px;
  background: rgba(var(--sys-primary-rgb, 100, 160, 255), 0.12);
  border: 1px solid rgba(var(--sys-primary-rgb, 100, 160, 255), 0.3);
  color: var(--sys-primary, #64a0ff);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  white-space: nowrap;
  flex-shrink: 0;
}

.search-input-clear {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--sys-foreground-muted, #9ba3af);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 140ms ease;
}

.search-input-clear:hover {
  color: var(--sys-foreground, #fff);
  background: var(--sys-surface-hover, rgba(255, 255, 255, 0.08));
}
</style>
