<script setup lang="ts">
// ============================================================
// AICompanionConversation — the message thread
// ============================================================
// User turns read as short right-aligned statements; EMO turns
// are full-width prose so long answers stay comfortable to
// read. The newest EMO answer is revealed by the store's
// typewriter (typingMessageId + typedLength).
// ============================================================

import type { Track } from '~/types'
import type { AIMessage } from '~/types/ai'

const props = defineProps<{
  messages: AIMessage[]
  thinking: boolean
  typingMessageId: string | null
  typedLength: number
}>()

const emit = defineEmits<{
  play: [track: Track]
  menu: [track: Track]
}>()

const { resolve } = useAICompanion()

/** Resolve mock match references into real catalog tracks. */
function resolvedResults(message: AIMessage) {
  return resolve(message.results)
}

/** Text visible right now — sliced while the typewriter runs. */
function visibleText(message: AIMessage): string {
  if (message.id !== props.typingMessageId) return message.text
  return message.text.slice(0, props.typedLength)
}

function isTyping(message: AIMessage): boolean {
  return message.id === props.typingMessageId
}

/** Results only appear once the answer has finished typing. */
function showResults(message: AIMessage): boolean {
  return !isTyping(message) && resolvedResults(message).length > 0
}

const thread = ref<HTMLElement | null>(null)

async function scrollToEnd() {
  await nextTick()
  thread.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

watch(() => props.messages.length, scrollToEnd)
watch(() => props.thinking, (v) => { if (v) scrollToEnd() })
</script>

<template>
  <section ref="thread" class="flex flex-col gap-5 px-4" aria-label="Conversation with EMO" aria-live="polite">
    <template v-for="message in messages" :key="message.id">
      <!-- USER -->
      <div v-if="message.role === 'user'" class="flex justify-end">
        <p class="ai-rise max-w-[85%] border border-ai-line-strong bg-ai-muted px-3.5 py-2.5 text-body text-ai-fg">
          {{ message.text }}
        </p>
      </div>

      <!-- EMO -->
      <div v-else class="ai-rise flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <span class="h-1.5 w-1.5 shrink-0 rounded-3 bg-ai-primary" aria-hidden="true" />
          <span class="ai-label">EMO</span>
        </div>

        <p class="text-body leading-relaxed text-ai-fg">
          {{ visibleText(message) }}<span
            v-if="isTyping(message)"
            class="ai-caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-ai-primary"
            aria-hidden="true"
          />
        </p>

        <!-- attached music results -->
        <div v-if="showResults(message)" class="ai-card">
          <h3 v-if="message.resultsLabel" class="border-b border-ai-line px-3 py-2.5 ai-label-strong">
            {{ message.resultsLabel }}
          </h3>
          <AICompanionResult
            v-for="(result, i) in resolvedResults(message)"
            :key="result.track.id"
            :track="result.track"
            :artist="result.artist"
            :cover="result.cover"
            :match="result.match"
            :index="i"
            @play="emit('play', $event)"
            @menu="emit('menu', $event)"
          />
        </div>
      </div>
    </template>

    <!-- thinking indicator -->
    <div v-if="thinking" class="flex flex-col gap-3" aria-label="EMO is thinking">
      <div class="flex items-center gap-2">
        <span class="h-1.5 w-1.5 shrink-0 rounded-3 bg-ai-accent" aria-hidden="true" />
        <span class="ai-label">EMO</span>
      </div>
      <span class="flex items-center gap-1.5" aria-hidden="true">
        <span class="ai-think-dot h-1.5 w-1.5 rounded-3 bg-ai-primary" />
        <span class="ai-think-dot h-1.5 w-1.5 rounded-3 bg-ai-primary" />
        <span class="ai-think-dot h-1.5 w-1.5 rounded-3 bg-ai-primary" />
      </span>
    </div>
  </section>
</template>
