<script setup lang="ts">
// ============================================================
// PlayerAI — full-player AI conversation and readable typewriter
// ============================================================

import type { AIMessage } from '~/composables/usePlayerAI'

const props = defineProps<{
  messages: readonly AIMessage[]
  isThinking: boolean
  isTyping: boolean
  input: string
  prompts: string[]
  trackTitle: string
  contextLabel: string
  context?: {
    artist: string
    album: string
    duration: number
    bpm: number
    mood: string
    energy: number
    analysisStatus: string
  } | null
}>()

const emit = defineEmits<{
  close: []
  send: [text: string]
  'update:input': [value: string]
  'type-complete': [messageId: string]
}>()

const localInput = computed({
  get: () => props.input,
  set: value => emit('update:input', value),
})

const listRef = ref<HTMLElement | null>(null)
const revealed = reactive<Record<string, string>>({})
let typingTimer: ReturnType<typeof setInterval> | null = null
let typingId: string | null = null

function stopTypewriter() {
  if (typingTimer) clearInterval(typingTimer)
  typingTimer = null
  typingId = null
}

function revealMessage(message: AIMessage) {
  if (message.role !== 'assistant') {
    revealed[message.id] = message.text
    return
  }

  stopTypewriter()
  typingId = message.id
  revealed[message.id] = ''
  const chunks = message.text.match(/\S+\s*/g) ?? [message.text]
  let index = 0

  // Two words at a time creates a natural, readable stream without the
  // distracting single-character crawl common in fake chat interfaces.
  typingTimer = setInterval(() => {
    if (typingId !== message.id) return
    revealed[message.id] += chunks.slice(index, index + 2).join('')
    index += 2
    nextTick(scrollToLatest)
    if (index >= chunks.length) {
      stopTypewriter()
      emit('type-complete', message.id)
    }
  }, 62)
}

function syncMessages() {
  const latest = props.messages.at(-1)
  for (const message of props.messages) {
    if (message.id !== latest?.id || message.role !== 'assistant') revealed[message.id] = message.text
  }
  if (latest && latest.role === 'assistant' && revealed[latest.id] !== latest.text) revealMessage(latest)
  nextTick(scrollToLatest)
}

function scrollToLatest() {
  if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
}

watch(() => props.messages, syncMessages, { deep: true, immediate: true })
watch(() => props.isTyping, typing => {
  if (!typing) {
    const latest = props.messages.at(-1)
    if (latest?.role === 'assistant') revealed[latest.id] = latest.text
  }
})

function onSubmit() {
  if (!localInput.value.trim() || props.isThinking || props.isTyping) return
  emit('send', localInput.value)
}

onBeforeUnmount(stopTypewriter)
</script>

<template>
  <div class="player-ai-root">
    <div class="player-ai-header">
      <div class="player-ai-meta">
        <p class="player-ai-kicker">AI ABOUT THIS TRACK</p>
        <p class="player-ai-title">{{ trackTitle }}</p>
        <p v-if="context" class="player-ai-context">
          {{ context.artist }} · {{ context.bpm }} BPM · {{ context.mood }}
        </p>
      </div>
      <button class="player-ai-close" aria-label="Close AI session" @click="emit('close')">
        <UIcon name="lucide:x" class="w-4 h-4" />
      </button>
    </div>

    <div ref="listRef" class="player-ai-messages" role="log" aria-live="polite">
      <div
        v-for="message in messages"
        :key="message.id"
        class="player-ai-msg"
        :class="`is-${message.role}`"
      >
        <span class="player-ai-msg-role">{{ message.role === 'user' ? 'YOU' : 'EMO' }}</span>
        <p class="player-ai-msg-text">{{ revealed[message.id] ?? message.text }}</p>
      </div>

      <div v-if="isThinking" class="player-ai-msg is-assistant is-thinking">
        <span class="player-ai-msg-role">EMO</span>
        <div class="player-ai-thinking" aria-label="EMO is thinking">
          <span /><span /><span />
        </div>
      </div>
    </div>

    <div class="player-ai-prompts" aria-label="Suggested questions">
      <button
        v-for="prompt in prompts"
        :key="prompt"
        class="player-ai-prompt"
        :disabled="isThinking || isTyping"
        @click="emit('send', prompt)"
      >
        {{ prompt }}
      </button>
    </div>

    <form class="player-ai-input-row" @submit.prevent="onSubmit">
      <input
        v-model="localInput"
        type="text"
        class="player-ai-input"
        placeholder="Ask about this track..."
        aria-label="Ask AI about this track"
        :disabled="isThinking || isTyping"
      >
      <button type="submit" class="player-ai-send" aria-label="Send" :disabled="!localInput.trim() || isThinking || isTyping">
        <UIcon name="lucide:arrow-up" class="w-4 h-4" />
      </button>
    </form>

    <p v-if="context" class="player-ai-session-context">
      {{ context.album }} · {{ Math.floor(context.duration / 60) }}:{{ String(context.duration % 60).padStart(2, '0') }} · {{ context.analysisStatus }}
    </p>
  </div>
</template>

<style scoped>
.player-ai-root {
  width: 100%;
  max-width: var(--player-max-width);
  height: 100%;
  min-height: 0;
  margin-inline: auto;
  display: flex;
  flex: 1;
  flex-direction: column;
  padding-inline: var(--player-content-padding);
  gap: 0.75rem;
  overflow: hidden;
}

.player-ai-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--player-line);
  flex-shrink: 0;
}

.player-ai-kicker,
.player-ai-session-context {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--player-fg-faint);
  text-transform: uppercase;
}

.player-ai-title {
  margin-top: 0.25rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--player-fg);
  letter-spacing: -0.01em;
}

.player-ai-context {
  margin-top: 0.2rem;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--player-fg-muted);
  text-transform: uppercase;
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

.player-ai-close:hover { color: var(--player-fg); background: var(--player-control-hover); border-color: var(--player-line-strong); }

.player-ai-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-block: 0.35rem;
  scrollbar-width: none;
  overscroll-behavior: contain;
}
.player-ai-messages::-webkit-scrollbar { display: none; }

.player-ai-msg {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 90%;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  border-radius: 2px;
}
.player-ai-msg.is-user { align-self: flex-end; background: var(--player-fg); color: var(--player-bg); border-color: var(--player-fg); }
.player-ai-msg.is-emo,
.player-ai-msg.is-assistant { align-self: flex-start; background: var(--player-bg-soft); color: var(--player-fg); }
.player-ai-msg-role { font-size: 0.5625rem; font-weight: 700; letter-spacing: 0.14em; color: var(--player-fg-faint); }
.player-ai-msg.is-user .player-ai-msg-role { color: rgba(10,11,14,0.6); }
.player-ai-msg-text { font-size: 0.875rem; line-height: 1.5; font-weight: 500; letter-spacing: -0.01em; }

.player-ai-thinking { display: flex; gap: 4px; align-items: center; height: 1.25rem; }
.player-ai-thinking span { width: 4px; height: 4px; background: var(--player-fg-muted); border-radius: 999px; animation: ai-bounce 1.2s infinite ease-in-out; }
.player-ai-thinking span:nth-child(2) { animation-delay: 0.15s; }
.player-ai-thinking span:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-bounce { 0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }

.player-ai-prompts { display: flex; gap: 0.5rem; overflow-x: auto; flex-shrink: 0; padding-bottom: 0.15rem; scrollbar-width: none; }
.player-ai-prompts::-webkit-scrollbar { display: none; }
.player-ai-prompt { flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; padding: 0.36rem 0.7rem; border: 1px solid var(--player-line); background: transparent; color: var(--player-fg-muted); border-radius: 999px; cursor: pointer; white-space: nowrap; }
.player-ai-prompt:hover:not(:disabled) { color: var(--player-fg); border-color: var(--player-line-strong); background: var(--player-control); }
.player-ai-prompt:disabled { opacity: 0.45; }

.player-ai-input-row { display: grid; grid-template-columns: 1fr 2.5rem; gap: 0.5rem; align-items: center; flex-shrink: 0; }
.player-ai-input { min-width: 0; height: 2.65rem; padding-inline: 0.875rem; border: 1px solid var(--player-line); background: var(--player-bg-soft); color: var(--player-fg); font-size: 0.875rem; outline: none; }
.player-ai-input::placeholder { color: var(--player-fg-faint); }
.player-ai-input:focus { border-color: var(--player-line-strong); }
.player-ai-send { display: grid; place-items: center; width: 2.65rem; height: 2.65rem; background: var(--player-fg); color: var(--player-bg); border: 1px solid var(--player-fg); cursor: pointer; }
.player-ai-send:disabled { opacity: 0.4; pointer-events: none; }

.player-ai-session-context { flex-shrink: 0; text-align: center; padding-bottom: 0.15rem; }
</style>
