<script setup lang="ts">
// ============================================================
// AICompanionHistory — CHAT HISTORY bottom sheet
// ============================================================
// Grouped by TODAY / YESTERDAY / EARLIER, searchable, with a
// confirm-gated Clear history. Selecting a conversation closes
// the sheet and restores the thread in place.
// ============================================================

import type { AIConversation } from '~/types/ai'

const props = defineProps<{
  open: boolean
  groups: { id: string; label: string; items: AIConversation[] }[]
  query: string
  activeId: string | null
  total: number
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  select: [id: string]
  delete: [id: string]
  clear: []
}>()

const { trackById } = useAICompanion()
const confirmingClear = ref(false)

watch(() => props.open, (open) => {
  if (!open) confirmingClear.value = false
})

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function contextLabel(conversation: AIConversation): string | null {
  if (!conversation.trackContextId) return null
  return trackById(conversation.trackContextId)?.title ?? null
}

function onClear() {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    return
  }
  emit('clear')
  confirmingClear.value = false
}
</script>

<template>
  <AICompanionSheet
    :open="open"
    title="CHAT HISTORY"
    close-label="Close history"
    @close="emit('close')"
  >
    <!-- search -->
    <div class="sticky top-0 z-10 border-b border-ai-line bg-ai-surface px-4 py-3">
      <label class="sr-only" for="ai-history-search">Search conversations</label>
      <div class="flex h-11 items-center gap-2 border border-ai-line bg-ai-muted px-3 focus-within:border-ai-primary transition-colors duration-160 ease-sys">
        <UIcon name="lucide:search" class="h-4 w-4 shrink-0 text-ai-fg-muted" aria-hidden="true" />
        <input
          id="ai-history-search"
          :value="query"
          type="search"
          autocomplete="off"
          class="w-full min-w-0 bg-transparent text-body text-ai-fg outline-none placeholder:text-ai-fg-muted"
          placeholder="Search conversations"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        >
        <button
          v-if="query"
          type="button"
          class="grid h-7 w-7 shrink-0 place-items-center text-ai-fg-muted ai-press focus-ring-ai hover:text-ai-fg"
          aria-label="Clear search"
          @click="emit('update:query', '')"
        >
          <UIcon name="lucide:x" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- grouped conversations -->
    <div v-if="groups.length" class="pb-2">
      <section v-for="group in groups" :key="group.id" :aria-labelledby="`ai-history-${group.id}`">
        <h3
          :id="`ai-history-${group.id}`"
          class="border-b border-ai-line bg-ai-tint px-4 py-2 ai-label"
        >
          {{ group.label }}
        </h3>

        <div
          v-for="conversation in group.items"
          :key="conversation.id"
          class="flex items-center border-b border-ai-line last:border-b-0"
          :class="conversation.id === activeId ? 'bg-ai-muted' : ''"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col items-start gap-1 px-4 py-3 text-left ai-press focus-ring-ai hover:bg-ai-surface"
            :aria-label="`Open conversation: ${conversation.title}`"
            :aria-current="conversation.id === activeId ? 'true' : undefined"
            @click="emit('select', conversation.id)"
          >
            <span
              class="w-full truncate text-body font-semibold"
              :class="conversation.id === activeId ? 'text-ai-primary' : 'text-ai-fg'"
            >{{ conversation.title }}</span>

            <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ai-fg-muted">
              <span class="tnum">{{ conversation.messages.length }} messages</span>
              <span aria-hidden="true">·</span>
              <span class="tnum">{{ timeOf(conversation.updatedAt) }}</span>
              <template v-if="contextLabel(conversation)">
                <span aria-hidden="true">·</span>
                <span class="inline-flex min-w-0 items-center gap-1 text-ai-secondary">
                  <UIcon name="lucide:disc-3" class="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span class="truncate">{{ contextLabel(conversation) }}</span>
                </span>
              </template>
            </span>
          </button>

          <button
            type="button"
            class="ai-icon-btn mr-2 h-10 w-10 border-transparent bg-transparent"
            :aria-label="`Delete conversation: ${conversation.title}`"
            @click="emit('delete', conversation.id)"
          >
            <UIcon name="lucide:trash-2" class="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>

    <!-- empty states -->
    <div v-else class="px-4 py-10 text-center">
      <p class="text-body text-ai-fg">
        {{ query ? 'No conversations match that search.' : 'No conversations yet.' }}
      </p>
      <p class="mt-1.5 text-small text-ai-fg-muted">
        {{ query ? 'Try a different word.' : 'Ask EMO something and it will show up here.' }}
      </p>
    </div>

    <!-- clear history, confirm gated -->
    <template #footer>
      <div v-if="!confirmingClear" class="flex items-center justify-between gap-3">
        <span class="ai-label tnum">{{ total }} STORED</span>
        <button
          type="button"
          class="ai-action-chip"
          :disabled="total === 0"
          aria-label="Clear chat history"
          @click="onClear"
        >
          <UIcon name="lucide:trash-2" class="h-3.5 w-3.5" />
          CLEAR HISTORY
        </button>
      </div>

      <div v-else class="flex flex-col gap-2.5" role="alertdialog" aria-label="Confirm clearing chat history">
        <p class="text-small text-ai-fg">
          Delete all {{ total }} conversations? This cannot be undone.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="ai-action-chip flex-1"
            aria-label="Cancel clearing history"
            @click="confirmingClear = false"
          >
            CANCEL
          </button>
          <button
            type="button"
            class="inline-flex h-10 flex-1 items-center justify-center gap-2 bg-ai-accent px-3 text-micro font-bold uppercase tracking-[0.12em] text-ai-base ai-press focus-ring-ai"
            aria-label="Confirm delete all conversations"
            @click="onClear"
          >
            <UIcon name="lucide:trash-2" class="h-3.5 w-3.5" />
            DELETE ALL
          </button>
        </div>
      </div>
    </template>
  </AICompanionSheet>
</template>
