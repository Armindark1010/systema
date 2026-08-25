// ============================================================
// usePlayerAI — AI conversation inside player
// ============================================================

export interface AIMessage {
  id: string
  role: 'user' | 'emo' | 'assistant'
  text: string
  at: string
}

const isAIMode = ref(false)
const messages = ref<AIMessage[]>([])
const isThinking = ref(false)
const input = ref('')

const PROMPTS = [
  'What mood is this?',
  'Why do I like this?',
  'Find similar songs',
  'Tell me about this song',
]

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

const FAKE_RESPONSES: Record<string, string[]> = {
  mood: [
    'This one sits in a focused, slightly tense space — high precision, low distraction. Energy around 0.72, built for structure.',
    'Dreamy but grounded. It’s got that midnight-city haze — calm surface, energetic undercurrent.',
    'Dark and driving. The kind of track that makes you move before you decide to.',
  ],
  like: [
    'You keep coming back to tracks with clean architecture and steady pulse — this fits your FOCUS pattern perfectly.',
    'Your library leans to melancholic + energetic contrasts. This balances both — tension without chaos.',
    'Because it doesn’t ask for attention, it earns it. Minimal, but every bar is intentional.',
  ],
  similar: [
    'If you like this, try Signal Grid → Linear Motion → Trans-Europe Express. Same grid logic, different temperature.',
    'Closest in your library: Days of Thunder, Turbo Killer, and Structure & Rhythm — all high-energy, architectural.',
    'I can build you a FOCUS playlist from this seed — 45 min, instrumental, 118 BPM average. Want me to?',
  ],
  about: [
    'STRUCTURE & RHYTHM — SYSTEMA Ensemble, 2025. Blueprint 01. Built as a study in Swiss precision — 118 BPM, 0.74 energy, instrumental.',
    'This track was designed as the system’s thesis: rhythm as architecture. Every element has a place, nothing decorative.',
    'It’s the opening statement of Blueprint 01 — the track that defines SYSTEMA’s sound: minimal, intelligent, music-first.',
  ],
}

function pickResponse(userText: string): string {
  const t = userText.toLowerCase()
  if (t.includes('mood')) return FAKE_RESPONSES.mood![Math.floor(Math.random() * FAKE_RESPONSES.mood!.length)]!
  if (t.includes('like') || t.includes('why')) return FAKE_RESPONSES.like![Math.floor(Math.random() * FAKE_RESPONSES.like!.length)]!
  if (t.includes('similar') || t.includes('find')) return FAKE_RESPONSES.similar![Math.floor(Math.random() * FAKE_RESPONSES.similar!.length)]!
  if (t.includes('about') || t.includes('tell')) return FAKE_RESPONSES.about![Math.floor(Math.random() * FAKE_RESPONSES.about!.length)]!
  // default
  const all = [...FAKE_RESPONSES.mood!, ...FAKE_RESPONSES.like!, ...FAKE_RESPONSES.about!]
  return all[Math.floor(Math.random() * all.length)]!
}

export function usePlayerAI() {
  const { currentTrack } = usePlayer()

  const contextLabel = computed(() => {
    if (!currentTrack.value) return 'SYSTEMA'
    return `${currentTrack.value.title} — CONTEXT`
  })

  function openAI() {
    isAIMode.value = true
    if (messages.value.length === 0 && currentTrack.value) {
      messages.value = [
        {
          id: makeId(),
          role: 'emo',
          text: `Want to know something about ${currentTrack.value.title}?`,
          at: new Date().toISOString(),
        },
      ]
    }
  }

  function closeAI() {
    isAIMode.value = false
  }

  function toggleAI() {
    if (isAIMode.value) closeAI()
    else openAI()
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input.value).trim()
    if (!content) return

    const userMsg: AIMessage = {
      id: makeId(),
      role: 'user',
      text: content,
      at: new Date().toISOString(),
    }
    messages.value = [...messages.value, userMsg]
    input.value = ''
    isThinking.value = true

    // Simulate EMO thinking -> listening -> responding
    await new Promise(r => setTimeout(r, 900 + Math.random() * 600))

    const response = pickResponse(content)

    const assistantMsg: AIMessage = {
      id: makeId(),
      role: 'assistant',
      text: response,
      at: new Date().toISOString(),
    }

    messages.value = [...messages.value, assistantMsg]
    isThinking.value = false
  }

  function sendPrompt(prompt: string) {
    sendMessage(prompt)
  }

  function clear() {
    messages.value = []
  }

  return {
    isAIMode: readonly(isAIMode),
    messages: readonly(messages),
    isThinking: readonly(isThinking),
    input,
    prompts: PROMPTS,
    contextLabel,
    openAI,
    closeAI,
    toggleAI,
    sendMessage,
    sendPrompt,
    clear,
    setAIMode: (v: boolean) => (isAIMode.value = v),
  }
}
