<script setup lang="ts">
// ============================================================
// AICompanionHeader — minimal companion header
// ============================================================
// Left: AI wordmark. Right: chat history + new conversation.
// Deliberately compact — no large text buttons, no toolbar.
// ============================================================

defineProps<{
  /** Shows the "new conversation" control only when one is open. */
  canReset?: boolean
}>()

const emit = defineEmits<{
  history: []
  reset: []
}>()
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-ai-line bg-ai-header backdrop-blur-md"
    style="padding-top: var(--ai-safe-top)"
  >
    <div class="mx-auto flex h-14 w-full max-w-[42rem] items-center justify-between gap-3 px-4">
      <div class="flex min-w-0 items-baseline gap-2.5">
        <h1 class="text-title font-bold tracking-[0.2em] text-ai-fg">AI</h1>
        <span class="truncate text-micro font-semibold uppercase tracking-[0.14em] text-ai-fg-faint">
          Music Companion
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="canReset"
          type="button"
          class="ai-icon-btn h-10 w-10"
          aria-label="New conversation"
          title="New conversation"
          @click="emit('reset')"
        >
          <UIcon name="lucide:plus" class="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          class="ai-icon-btn h-10 w-10"
          aria-label="Open chat history"
          title="Chat history"
          @click="emit('history')"
        >
          <UIcon name="lucide:history" class="h-4.5 w-4.5" />
        </button>
      </div>
    </div>
  </header>
</template>
