<script setup lang="ts">
// ============================================================
// PlayerAI — AI interaction inside player, EMO-centric
// ============================================================
// Keeps track title, artist, playback controls accessible.
// UI: EMO + conversation, not generic ChatGPT clone.
// ============================================================

import type { AIMessage } from '~/composables/usePlayerAI'

const props = defineProps<{
  messages: readonly AIMessage[]
  isThinking: boolean
  input: string
  prompts: string[]
  trackTitle: string
  contextLabel: string
}>()

const emit = defineEmits<{
  close: []
  send: [text: string]
  'update:input': [value: string]
}>()

const localInput = computed({
  get: () => props.input,
  set: (v) => emit('update:input', v),
})

const listRef = ref<HTMLElement | null>(null)

watch(() => props.messages.length, () => {
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  })
})

function onSubmit() {
  if (!localInput.value.trim()) return
  emit('send', localInput.value)
}

function onPrompt(p: string) {
  emit('send', p)
}
</script>

<template>
  <div class="player-ai-root">
    <div class="player-ai-header">
      <div class="player-ai-meta">
        <p class="player-ai-kicker">SYSTEMA AI · {{ contextLabel }}</p>
        <p class="player-ai-title">{{ trackTitle }}</p>
      </div>
      <button class="player-ai-close" aria-label="Close AI" @click="emit('close')">
        <UIcon name="lucide:x" class="w-4 h-4" />
      </button>
    </div>

    <div ref="listRef" class="player-ai-messages" role="log" aria-live="polite">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="player-ai-msg"
        :class="`is-${msg.role}`"
      >
        <span class="player-ai-msg-role">
          {{ msg.role === 'user' ? 'YOU' : msg.role === 'emo' ? 'EMO' : 'SYSTEMA' }}
        </span>
        <p class="player-ai-msg-text">{{ msg.text }}</p>
      </div>

      <div v-if="isThinking" class="player-ai-msg is-assistant is-thinking">
        <span class="player-ai-msg-role">SYSTEMA</span>
        <div class="player-ai-thinking">
          <span /><span /><span />
        </div>
      </div>
    </div>

    <div class="player-ai-prompts">
      <button
        v-for="p in prompts"
        :key="p"
        class="player-ai-prompt"
        @click="onPrompt(p)"
      >
        {{ p }}
      </button>
    </div>

    <form class="player-ai-input-row" @submit.prevent="onSubmit">
      <input
        v-model="localInput"
        type="text"
        class="player-ai-input"
        placeholder="Ask about this track..."
        aria-label="Ask AI about this track"
      >
      <button type="submit" class="player-ai-send" aria-label="Send" :disabled="!localInput.trim()">
        <UIcon name="lucide:arrow-up" class="w-4 h-4" />
      </button>
    </form>
  </div>
</template>

<style scoped>
.player-ai-root {
  width: 100%;
  max-width: var(--player-max-width);
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  min-height: clamp(22rem, 58vh, 32rem);
  max-height: clamp(26rem, 66vh, 40rem);
  padding-inline: var(--player-content-padding);
  gap: 0.875rem;
}

.player-ai-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--player-line);
  flex-shrink: 0;
}

.player-ai-kicker {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--player-fg-faint);
}

.player-ai-title {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--player-fg);
  letter-spacing: -0.01em;
}

.player-ai-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  flex-shrink: 0;
}

.player-ai-close:hover {
  color: var(--player-fg);
  background: var(--player-control-hover);
  border-color: var(--player-line-strong);
}

.player-ai-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-block: 0.5rem;
  scrollbar-width: none;
}

.player-ai-messages::-webkit-scrollbar { display: none; }

.player-ai-msg {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 86%;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  border-radius: 2px;
}

.player-ai-msg.is-user {
  align-self: flex-end;
  background: var(--player-fg);
  color: var(--player-bg);
  border-color: var(--player-fg);
}

.player-ai-msg.is-emo {
  align-self: flex-start;
  background: color-mix(in srgb, var(--player-accent) 14%, transparent);
  border-color: color-mix(in srgb, var(--player-accent) 22%, transparent);
  color: var(--player-fg);
}

.player-ai-msg.is-assistant {
  align-self: flex-start;
  background: var(--player-bg-soft);
  border-color: var(--player-line);
  color: var(--player-fg);
}

.player-ai-msg-role {
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
}

.player-ai-msg.is-user .player-ai-msg-role {
  color: rgba(10,11,14,0.6);
}

.player-ai-msg-text {
  font-size: 0.875rem;
  line-height: 1.5;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.player-ai-thinking {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 1.25rem;
}

.player-ai-thinking span {
  width: 4px;
  height: 4px;
  background: var(--player-fg-muted);
  border-radius: 999px;
  animation: ai-bounce 1.2s infinite ease-in-out;
}

.player-ai-thinking span:nth-child(2) { animation-delay: 0.15s; }
.player-ai-thinking span:nth-child(3) { animation-delay: 0.3s; }

@keyframes ai-bounce {
  0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.player-ai-prompts {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.player-ai-prompts::-webkit-scrollbar { display: none; }

.player-ai-prompt {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--player-line);
  background: transparent;
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  white-space: nowrap;
}

.player-ai-prompt:hover {
  color: var(--player-fg);
  border-color: var(--player-line-strong);
  background: var(--player-control);
}

.player-ai-input-row {
  display: grid;
  grid-template-columns: 1fr 2.5rem;
  gap: 0.5rem;
  align-items: center;
  flex-shrink: 0;
}

.player-ai-input {
  height: 2.75rem;
  padding-inline: 0.875rem;
  border: 1px solid var(--player-line);
  background: var(--player-bg-soft);
  color: var(--player-fg);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 160ms var(--player-ease-smooth);
}

.player-ai-input::placeholder {
  color: var(--player-fg-faint);
}

.player-ai-input:focus {
  border-color: var(--player-line-strong);
}

.player-ai-send {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  background: var(--player-fg);
  color: var(--player-bg);
  border: 1px solid var(--player-fg);
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
}

.player-ai-send:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.player-ai-send:hover:not(:disabled) {
  background: var(--player-fg);
  transform: scale(1.02);
}
</style>
