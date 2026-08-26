// ============================================================
// SYSTEMA — AI COMPANION Store (Pinia)
// ============================================================
// Owns EVERYTHING about talking to EMO:
//   · companion status (idle / listening / thinking / responding)
//   · the active conversation and its messages
//   · persisted chat history
//   · mock response generation
//
// It owns NOTHING about playback. Track playing, queueing and
// now-playing state always come from usePlayerStore().
//
// FUTURE: replace `respond()` with a call into
//   Capacitor → Kotlin → Local AI Runtime → Analysis DB
// The component layer will not need to change.
// ============================================================

import { defineStore } from 'pinia'
import type {
  AICompanionStatus,
  AIConversation,
  AIMatch,
  AIMessage,
  AIMockReply,
} from '~/types/ai'
import {
  aiCompanionLines,
  aiCompanionStatus,
  aiConversationSeeds,
  mockAnalysisReply,
  mockInsightFor,
  mockReplyForPrompt,
} from '~/data/aiCompanion'
import { AI_CONVERSATIONS_STORAGE_KEY, readJSON, writeJSON } from '~/services/persistence/storageAdapter'
import { usePlayerStore } from '~/stores/player'
import { getAlbum, getArtist, getGenre } from '~/data/music'

const THINKING_MS = 900
const TYPING_CHAR_MS = 14
const MAX_CONVERSATIONS = 40

function makeId(prefix = 'msg'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function isoDaysAgo(daysAgo: number, hour: number, minute: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

/** Build the seeded history the first time the app runs. */
function buildSeedConversations(): AIConversation[] {
  return aiConversationSeeds.map((seed) => {
    const at = isoDaysAgo(seed.daysAgo, seed.hour, seed.minute)
    return {
      id: seed.id,
      title: seed.title,
      createdAt: at,
      updatedAt: at,
      trackContextId: seed.trackContextId,
      messages: seed.messages.map((m, i) => ({
        id: `${seed.id}-m${i}`,
        role: m.role,
        text: m.text,
        at,
        results: m.results,
        resultsLabel: m.resultsLabel,
      })),
    }
  })
}

/** Trim a prompt down to a readable conversation title. */
function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (clean.length <= 42) return clean
  return `${clean.slice(0, 41).trimEnd()}…`
}

export const useAIStore = defineStore('ai', () => {
  const player = usePlayerStore()

  // ---- State -------------------------------------------------
  const status = ref<AICompanionStatus>('idle')
  const draft = ref('')
  const conversations = ref<AIConversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const historyOpen = ref(false)
  const historyQuery = ref('')
  /** Id of the message currently running the typewriter. */
  const typingMessageId = ref<string | null>(null)
  /** How many characters of the typing message are revealed. */
  const typedLength = ref(0)
  const hydrated = ref(false)

  let thinkTimer: ReturnType<typeof setTimeout> | null = null
  let typeTimer: ReturnType<typeof setInterval> | null = null
  let listenTimer: ReturnType<typeof setTimeout> | null = null

  // ---- Getters -----------------------------------------------
  const activeConversation = computed<AIConversation | null>(
    () => conversations.value.find(c => c.id === activeConversationId.value) ?? null,
  )

  const messages = computed<AIMessage[]>(() => activeConversation.value?.messages ?? [])

  const hasConversation = computed(() => messages.value.length > 0)

  const isBusy = computed(() => status.value === 'thinking' || status.value === 'responding')

  const statusLine = computed(() => aiCompanionLines[status.value])

  /** EMO expression derived from companion status. */
  const emoExpression = computed(() => {
    switch (status.value) {
      case 'listening': return 'listening' as const
      case 'thinking': return 'thinking' as const
      case 'responding': return 'happy' as const
      default: return 'idle' as const
    }
  })

  const analyzedTracks = computed(() => aiCompanionStatus.analyzedTracks)
  const engineLabel = computed(() => aiCompanionStatus.engine)

  /** Mock analysis row for the currently playing track. */
  const currentTrackInsight = computed(() => {
    const track = player.currentTrack
    if (!track) return null
    return mockInsightFor({
      id: track.id,
      energy: track.energy,
      mood: track.mood,
      genre: getGenre(track.genreId)?.name ?? 'Electronic',
      bpm: track.ai?.bpm,
    })
  })

  const currentTrackArtist = computed(() => {
    const track = player.currentTrack
    if (!track) return ''
    return track.artist || getArtist(track.artistId)?.name || 'SYSTEMA'
  })

  const currentTrackCover = computed(() => {
    const track = player.currentTrack
    if (!track) return undefined
    return track.artwork || getAlbum(track.albumId)?.cover
  })

  /** Conversations matching the history search box, newest first. */
  const filteredConversations = computed(() => {
    const q = historyQuery.value.trim().toLowerCase()
    const list = [...conversations.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!q) return list
    return list.filter(c =>
      c.title.toLowerCase().includes(q)
      || c.messages.some(m => m.text.toLowerCase().includes(q)),
    )
  })

  /** History grouped into TODAY / YESTERDAY / EARLIER buckets. */
  const groupedConversations = computed(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfYesterday = startOfToday - 86_400_000

    const groups: { id: string; label: string; items: AIConversation[] }[] = [
      { id: 'today', label: 'TODAY', items: [] },
      { id: 'yesterday', label: 'YESTERDAY', items: [] },
      { id: 'earlier', label: 'EARLIER', items: [] },
    ]

    for (const c of filteredConversations.value) {
      const t = new Date(c.updatedAt).getTime()
      if (t >= startOfToday) groups[0]!.items.push(c)
      else if (t >= startOfYesterday) groups[1]!.items.push(c)
      else groups[2]!.items.push(c)
    }

    return groups.filter(g => g.items.length > 0)
  })

  // ---- Persistence -------------------------------------------
  function persist() {
    if (!hydrated.value) return
    writeJSON(AI_CONVERSATIONS_STORAGE_KEY, conversations.value.slice(0, MAX_CONVERSATIONS))
  }

  /**
   * Load stored conversations. Called once from the AI page on
   * mount so SSR never touches storage.
   * FUTURE: swap for a native AI conversation database read.
   */
  function hydrate() {
    if (hydrated.value) return
    const stored = readJSON<AIConversation[]>(AI_CONVERSATIONS_STORAGE_KEY)
    conversations.value = Array.isArray(stored) && stored.length ? stored : buildSeedConversations()
    hydrated.value = true
    persist()
  }

  // ---- Internal ----------------------------------------------
  function clearTimers() {
    if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null }
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null }
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null }
  }

  function touch(conversation: AIConversation) {
    conversation.updatedAt = new Date().toISOString()
  }

  function ensureConversation(title: string, trackContextId?: string): AIConversation {
    const existing = activeConversation.value
    if (existing) {
      if (trackContextId && !existing.trackContextId) existing.trackContextId = trackContextId
      return existing
    }
    const now = new Date().toISOString()
    const conversation: AIConversation = {
      id: makeId('conv'),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      trackContextId,
    }
    conversations.value = [conversation, ...conversations.value].slice(0, MAX_CONVERSATIONS)
    activeConversationId.value = conversation.id
    return conversation
  }

  function appendMessage(conversation: AIConversation, message: AIMessage) {
    conversation.messages = [...conversation.messages, message]
    touch(conversation)
    persist()
  }

  /** Reveal an EMO answer with a smooth, readable typewriter. */
  function runTypewriter(messageId: string, text: string) {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null }

    const reduced = import.meta.client
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      typingMessageId.value = null
      typedLength.value = text.length
      status.value = 'idle'
      return
    }

    typingMessageId.value = messageId
    typedLength.value = 0

    // Reveal in small chunks so long answers stay comfortable to read.
    const step = Math.max(1, Math.round(text.length / 90))
    typeTimer = setInterval(() => {
      typedLength.value = Math.min(text.length, typedLength.value + step)
      if (typedLength.value >= text.length) {
        if (typeTimer) { clearInterval(typeTimer); typeTimer = null }
        typingMessageId.value = null
        status.value = 'idle'
      }
    }, TYPING_CHAR_MS * step)
  }

  /** Stage a mock reply: THINKING → RESPONDING → typewriter → IDLE. */
  function respond(conversation: AIConversation, reply: AIMockReply, trackId?: string) {
    clearTimers()
    status.value = 'thinking'

    thinkTimer = setTimeout(() => {
      thinkTimer = null
      const message: AIMessage = {
        id: makeId(),
        role: 'emo',
        text: reply.text,
        at: new Date().toISOString(),
        results: reply.results,
        resultsLabel: reply.resultsLabel,
        trackId,
      }
      appendMessage(conversation, message)
      status.value = 'responding'
      runTypewriter(message.id, message.text)
    }, THINKING_MS)
  }

  // ---- Actions -----------------------------------------------

  /** Brief LISTENING pulse while the user is typing. */
  function noteTyping() {
    if (isBusy.value) return
    status.value = 'listening'
    if (listenTimer) clearTimeout(listenTimer)
    listenTimer = setTimeout(() => {
      if (status.value === 'listening') status.value = 'idle'
      listenTimer = null
    }, 1400)
  }

  function setDraft(value: string) {
    draft.value = value
    if (value.trim()) noteTyping()
  }

  /** Submit a free-text prompt. */
  function send(text?: string) {
    const content = (text ?? draft.value).replace(/\s+/g, ' ').trim()
    if (!content || isBusy.value) return

    const conversation = ensureConversation(
      titleFromPrompt(content),
      player.currentTrack?.id,
    )

    appendMessage(conversation, {
      id: makeId(),
      role: 'user',
      text: content,
      at: new Date().toISOString(),
    })

    draft.value = ''
    respond(conversation, mockReplyForPrompt(content))
  }

  /** Ask EMO to analyze the currently playing track. */
  function analyzeCurrentTrack() {
    const track = player.currentTrack
    const insight = currentTrackInsight.value
    if (!track || !insight || isBusy.value) return

    const conversation = ensureConversation(`Analyze ${track.title}`, track.id)

    appendMessage(conversation, {
      id: makeId(),
      role: 'user',
      text: `Analyze "${track.title}"`,
      at: new Date().toISOString(),
    })

    respond(conversation, mockAnalysisReply(track.title, insight), track.id)
  }

  /** Open a conversation scoped to the current track. */
  function askAboutCurrentTrack() {
    const track = player.currentTrack
    if (!track || isBusy.value) return

    const conversation = ensureConversation(`About ${track.title}`, track.id)

    appendMessage(conversation, {
      id: makeId(),
      role: 'user',
      text: `Tell me about "${track.title}"`,
      at: new Date().toISOString(),
    })

    respond(conversation, mockReplyForPrompt(`similar ${track.mood}`), track.id)
  }

  /** Run one of the quick action chips. */
  function runQuickAction(actionId: string, prompt: string) {
    if (isBusy.value) return
    if (actionId === 'analyze-current') {
      analyzeCurrentTrack()
      return
    }
    send(prompt)
  }

  /** Start a fresh conversation without discarding history. */
  function startNewConversation() {
    clearTimers()
    status.value = 'idle'
    typingMessageId.value = null
    typedLength.value = 0
    activeConversationId.value = null
    draft.value = ''
  }

  /** Restore a stored conversation and continue where it left off. */
  function openConversation(id: string) {
    const conversation = conversations.value.find(c => c.id === id)
    if (!conversation) return
    clearTimers()
    status.value = 'idle'
    typingMessageId.value = null
    typedLength.value = 0
    activeConversationId.value = conversation.id
    historyOpen.value = false
    historyQuery.value = ''
  }

  function deleteConversation(id: string) {
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (activeConversationId.value === id) startNewConversation()
    persist()
  }

  function clearHistory() {
    conversations.value = []
    startNewConversation()
    persist()
  }

  function setHistoryOpen(open: boolean) {
    historyOpen.value = open
    if (!open) historyQuery.value = ''
  }

  function setHistoryQuery(value: string) {
    historyQuery.value = value
  }

  /** Track context attached to the active conversation, if any. */
  const activeTrackContext = computed(() => {
    const id = activeConversation.value?.trackContextId
    if (!id) return null
    return player.queue.find(t => t.id === id) ?? (player.currentTrack?.id === id ? player.currentTrack : null)
  })

  function reset() {
    clearTimers()
    status.value = 'idle'
    draft.value = ''
    typingMessageId.value = null
    typedLength.value = 0
    activeConversationId.value = null
  }

  function dispose() {
    clearTimers()
  }

  return {
    // state
    status,
    draft,
    conversations,
    activeConversationId,
    historyOpen,
    historyQuery,
    typingMessageId,
    typedLength,
    hydrated,

    // getters
    activeConversation,
    activeTrackContext,
    messages,
    hasConversation,
    isBusy,
    statusLine,
    emoExpression,
    analyzedTracks,
    engineLabel,
    currentTrackInsight,
    currentTrackArtist,
    currentTrackCover,
    filteredConversations,
    groupedConversations,

    // actions
    hydrate,
    setDraft,
    noteTyping,
    send,
    analyzeCurrentTrack,
    askAboutCurrentTrack,
    runQuickAction,
    startNewConversation,
    openConversation,
    deleteConversation,
    clearHistory,
    setHistoryOpen,
    setHistoryQuery,
    reset,
    dispose,
  }
})

export type { AIConversation, AIMatch, AIMessage }
