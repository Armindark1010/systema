// ============================================================
// usePlayerAI — track-scoped AI session inside the full player
// ============================================================

import type { Track } from '~/types'

export interface AIMessage {
  id: string
  role: 'user' | 'emo' | 'assistant'
  text: string
  at: string
}

export interface PlayerAIContext {
  trackId: string
  title: string
  artist: string
  album: string
  duration: number
  bpm: number
  mood: string
  energy: number
  analysisStatus: string
}

const isAIMode = ref(false)
const messages = ref<AIMessage[]>([])
const isThinking = ref(false)
const isTyping = ref(false)
const input = ref('')
const sessionContext = ref<PlayerAIContext | null>(null)
let responseTimer: ReturnType<typeof setTimeout> | null = null
let sessionVersion = 0

const PROMPTS = [
  'What mood is this?',
  'Why do I like this?',
  'Find similar songs',
  'Tell me about this song',
]

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

function bpmForTrack(track: Track) {
  // Deterministic local stand-in until a real analyzer provides BPM.
  const hash = track.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return 86 + (hash % 58)
}

function makeTrackResponse(context: PlayerAIContext) {
  const energy = context.energy >= 72 ? 'focused rather than aggressive' : context.energy <= 40 ? 'quiet and spacious' : 'balanced and deliberate'
  return `${context.title} is an atmospheric electronic track built around a steady ${context.bpm} BPM pulse. Its energy is ${energy}, making it a strong match for deep concentration and late-night work. ${context.album} frames the track with a ${context.mood.toLowerCase()} atmosphere.`
}

const FAKE_RESPONSES: Record<string, string[]> = {
  mood: [
    'The mood is focused and slightly tense: a calm surface with a precise rhythmic undercurrent. It keeps moving without asking for your attention.',
    'This sits in a midnight-city haze — grounded, spacious, and quietly energetic rather than loud.',
  ],
  like: [
    'You return to music with clean architecture and a steady pulse. This fits that focus pattern: tension without chaos.',
    'It earns attention through restraint. Each layer has a place, so the energy stays clear instead of crowded.',
  ],
  similar: [
    'Try Signal Grid, Linear Motion, and Trans-Europe Express next. They share the same deliberate grid logic with different temperatures.',
    'I would build a compact focus run around this: instrumental, steady tempo, and a controlled rise in energy.',
  ],
  about: [
    'It treats rhythm as architecture. The arrangement leaves deliberate space around each element, so the pulse feels physical but never overworked.',
    'The track is designed as a small system: repetition establishes the structure, while subtle textural changes keep the movement alive.',
  ],
}

function pickResponse(userText: string, context: PlayerAIContext | null): string {
  const text = userText.toLowerCase()
  let answers: string[]
  if (text.includes('mood')) answers = FAKE_RESPONSES.mood!
  else if (text.includes('like') || text.includes('why')) answers = FAKE_RESPONSES.like!
  else if (text.includes('similar') || text.includes('find')) answers = FAKE_RESPONSES.similar!
  else answers = FAKE_RESPONSES.about!

  const answer = answers[Math.floor(Math.random() * answers.length)]!
  return context ? `${answer} For ${context.title}, that reads as ${context.mood.toLowerCase()} at ${context.bpm} BPM.` : answer
}

export function usePlayerAI() {
  const { currentTrack } = usePlayer()
  const { getAlbum, getArtist } = useMusicLibrary()
  const analysis = useTrackAnalysis()

  const contextLabel = computed(() => {
    const context = sessionContext.value
    return context ? `${context.title} · CONTEXT` : 'SYSTEMA · CONTEXT'
  })

  const isResponding = computed(() => isThinking.value || isTyping.value)

  function buildContext(track: Track): PlayerAIContext {
    const analyzed = analysis.currentAnalysis.value
    return {
      trackId: track.id,
      title: track.title,
      artist: getArtist(track.artistId)?.name ?? 'SYSTEMA',
      album: getAlbum(track.albumId)?.title ?? 'SYSTEMA',
      duration: track.duration,
      bpm: analyzed?.bpm ?? bpmForTrack(track),
      mood: analyzed?.mood[0] ?? track.mood,
      energy: analyzed ? Math.round(analyzed.energy * 100) : track.energy,
      analysisStatus: analysis.status.value,
    }
  }

  function clearResponseTimer() {
    if (responseTimer) clearTimeout(responseTimer)
    responseTimer = null
  }

  function queueAssistantResponse(text: string, version: number, delay = 650) {
    clearResponseTimer()
    isThinking.value = true
    isTyping.value = false

    responseTimer = setTimeout(() => {
      if (!isAIMode.value || version !== sessionVersion) return
      messages.value = [
        ...messages.value,
        { id: makeId(), role: 'assistant', text, at: new Date().toISOString() },
      ]
      isThinking.value = false
      isTyping.value = true
      responseTimer = null
    }, delay)
  }

  function startSession(track?: Track | null) {
    const activeTrack = track ?? currentTrack.value
    if (!activeTrack) return

    sessionVersion += 1
    const version = sessionVersion
    sessionContext.value = buildContext(activeTrack)
    messages.value = []
    input.value = ''
    isAIMode.value = true
    queueAssistantResponse(makeTrackResponse(sessionContext.value), version, 480)
  }

  /** Opens a fresh, local AI session for the supplied current-track id. */
  function openAI(trackId?: string) {
    const active = currentTrack.value
    if (!active || (trackId && active.id !== trackId)) return
    startSession(active)
  }

  function closeAI() {
    sessionVersion += 1
    clearResponseTimer()
    isAIMode.value = false
    isThinking.value = false
    isTyping.value = false
    messages.value = []
    input.value = ''
    sessionContext.value = null
  }

  function toggleAI() {
    if (isAIMode.value) closeAI()
    else openAI(currentTrack.value?.id)
  }

  function sendMessage(text?: string) {
    const content = (text ?? input.value).trim()
    if (!content || isThinking.value || isTyping.value) return

    messages.value = [
      ...messages.value,
      { id: makeId(), role: 'user', text: content, at: new Date().toISOString() },
    ]
    input.value = ''
    const version = sessionVersion
    queueAssistantResponse(pickResponse(content, sessionContext.value), version, 650 + Math.random() * 300)
  }

  /** Called by the visual typewriter once the newest response is readable. */
  function completeTyping(messageId?: string) {
    const newest = [...messages.value].reverse().find(message => message.role === 'assistant')
    if (!messageId || newest?.id === messageId) isTyping.value = false
  }

  // A track change while the session is open starts a new scoped session so
  // lyrics, analysis metadata, and the AI's explanation can never be stale.
  watch(currentTrack, (track, previous) => {
    if (isAIMode.value && track && track.id !== previous?.id) startSession(track)
  })

  return {
    isAIMode: readonly(isAIMode),
    messages: readonly(messages),
    isThinking: readonly(isThinking),
    isTyping: readonly(isTyping),
    isResponding,
    input,
    prompts: PROMPTS,
    contextLabel,
    sessionContext: readonly(sessionContext),
    openAI,
    closeAI,
    toggleAI,
    sendMessage,
    completeTyping,
    clear: closeAI,
    setAIMode: (value: boolean) => value ? openAI(currentTrack.value?.id) : closeAI(),
  }
}
