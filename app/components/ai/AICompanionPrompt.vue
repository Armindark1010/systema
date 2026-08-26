<script setup lang="ts">
// ============================================================
// AICompanionPrompt — the primary conversation input
// ============================================================
// Multiline, auto-growing, keyboard-safe. Enter sends,
// Shift+Enter inserts a newline. Glow only appears on focus and
// while the companion is working.
// ============================================================

const props = withDefaults(defineProps<{
  modelValue: string
  busy?: boolean
  /** Suggestion chips shown only before the first message. */
  examples?: string[]
}>(), {
  busy: false,
  examples: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  example: [prompt: string]
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const focused = ref(false)

const canSend = computed(() => props.modelValue.trim().length > 0 && !props.busy)

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  // cap at ~6 lines so the sheet/keyboard never gets squeezed out
  el.style.height = `${Math.min(el.scrollHeight, 148)}px`
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  nextTick(autoGrow)
}

function onSubmit() {
  if (!canSend.value) return
  emit('submit')
  nextTick(() => {
    if (textarea.value) {
      textarea.value.style.height = 'auto'
      autoGrow()
    }
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSubmit()
  }
}

/** Keep the input visible when the mobile keyboard opens. */
function onFocus() {
  focused.value = true
  setTimeout(() => {
    textarea.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 240)
}

watch(() => props.modelValue, () => nextTick(autoGrow))
onMounted(autoGrow)

defineExpose({
  focus: () => textarea.value?.focus(),
})
</script>

<template>
  <section class="px-4" aria-label="Ask EMO">
    <div
      class="flex items-end gap-2 border bg-ai-surface p-2 transition-all duration-160 ease-sys"
      :class="focused || busy
        ? 'border-ai-primary shadow-ai-glow'
        : 'border-ai-line-strong'"
    >
      <label class="sr-only" for="ai-companion-prompt">Ask EMO about your music</label>
      <textarea
        id="ai-companion-prompt"
        ref="textarea"
        :value="modelValue"
        rows="1"
        enterkeyhint="send"
        autocomplete="off"
        autocapitalize="sentences"
        spellcheck="false"
        class="max-h-[9.25rem] min-h-11 w-full flex-1 resize-none bg-transparent px-2 py-2.5 text-body leading-relaxed text-ai-fg outline-none placeholder:text-ai-fg-muted"
        placeholder="Tell me what you're looking for..."
        :aria-busy="busy"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="focused = false"
      />

      <button
        type="button"
        class="ai-send-btn"
        :disabled="!canSend"
        :aria-label="busy ? 'EMO is responding' : 'Send message'"
        @click="onSubmit"
      >
        <UIcon v-if="busy" name="lucide:loader-circle" class="h-4.5 w-4.5 animate-spin" />
        <UIcon v-else name="lucide:arrow-up" class="h-4.5 w-4.5" />
      </button>
    </div>

    <!-- example prompts, first-run only -->
    <ul v-if="examples.length" class="mt-3 flex flex-wrap gap-2" aria-label="Example prompts">
      <li v-for="example in examples" :key="example">
        <button
          type="button"
          class="inline-flex h-8 items-center border border-ai-line bg-ai-surface px-2.5 text-small text-ai-fg-muted ai-press focus-ring-ai hover:(border-ai-primary bg-ai-muted text-ai-fg)"
          @click="emit('example', example)"
        >
          {{ example }}
        </button>
      </li>
    </ul>
  </section>
</template>
