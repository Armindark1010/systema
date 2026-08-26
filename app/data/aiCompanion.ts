// ============================================================
// SYSTEMA — AI COMPANION mock corpus
// ============================================================
// Every value here is MOCK. No model runs on device yet.
// The shapes mirror what the future local AI runtime will
// return, so swapping the mock for the real engine is a
// data-source change, not a UI change.
// ============================================================

import type {
  AIForYouSection,
  AIMockReply,
  AIQuickAction,
  AITrackInsight,
} from '~/types/ai'

// ------------------------------------------------------------
// STATUS STRIP — mock telemetry
// ------------------------------------------------------------
export const aiCompanionStatus = {
  engine: 'MOCK ENGINE',
  mode: 'ON-DEVICE (PLANNED)',
  analyzedTracks: 1284,
  libraryTracks: 1512,
} as const

// ------------------------------------------------------------
// EMO STATE COPY
// ------------------------------------------------------------
export const aiCompanionLines: Record<'idle' | 'listening' | 'thinking' | 'responding', string> = {
  idle: 'Ready when you are.',
  listening: 'Listening...',
  thinking: 'Thinking...',
  responding: "Here's what I found.",
}

// ------------------------------------------------------------
// PROMPT SUGGESTIONS
// ------------------------------------------------------------
export const aiPromptExamples: string[] = [
  'Something calm for coding tonight',
  'Find dark electronic tracks',
  'Play something similar to this',
  'Analyze the current track',
]

// ------------------------------------------------------------
// QUICK ACTIONS
// ------------------------------------------------------------
export const aiQuickActions: AIQuickAction[] = [
  {
    id: 'analyze-current',
    label: 'ANALYZE CURRENT',
    icon: 'lucide:activity',
    prompt: 'Analyze the current track',
    needsTrack: true,
  },
  {
    id: 'similar',
    label: 'SIMILAR TO THIS',
    icon: 'lucide:git-compare',
    prompt: 'Play something similar to this',
    needsTrack: true,
  },
  {
    id: 'mood',
    label: 'MY MOOD',
    icon: 'lucide:waves',
    prompt: 'What does my listening mood look like right now?',
  },
  {
    id: 'functional',
    label: 'FUNCTIONAL BEATS',
    icon: 'lucide:square-activity',
    prompt: 'Build me a set of functional beats for deep work',
  },
]

// ------------------------------------------------------------
// FOR YOU — mock recommendation sections
// ------------------------------------------------------------
export const aiForYouSections: AIForYouSection[] = [
  {
    id: 'functional-beats',
    label: 'FUNCTIONAL BEATS',
    description: 'Steady pulse, low vocal load — built for long focus blocks.',
    items: [
      { trackId: 'tr-01', match: 92 },
      { trackId: 'tr-02', match: 86 },
      { trackId: 'tr-39', match: 81 },
    ],
  },
  {
    id: 'late-signal',
    label: 'LATE SIGNAL',
    description: 'What you tend to reach for after midnight.',
    items: [
      { trackId: 'tr-04', match: 94 },
      { trackId: 'tr-13', match: 88 },
      { trackId: 'tr-35', match: 79 },
    ],
  },
  {
    id: 'quiet-architecture',
    label: 'QUIET ARCHITECTURE',
    description: 'Spacious, textural, almost no rhythmic pressure.',
    items: [
      { trackId: 'tr-20', match: 90 },
      { trackId: 'tr-33', match: 84 },
      { trackId: 'tr-19', match: 76 },
    ],
  },
]

// ------------------------------------------------------------
// MOCK INTENT ENGINE
// ------------------------------------------------------------
// A tiny deterministic keyword router. The real runtime will
// replace this with embeddings + the analysis database.
// ------------------------------------------------------------

interface MockIntent {
  id: string
  keywords: string[]
  text: string
  resultsLabel?: string
  trackIds?: string[]
  matches?: number[]
}

const MOCK_INTENTS: MockIntent[] = [
  {
    id: 'calm-coding',
    keywords: ['calm', 'coding', 'focus', 'study', 'work', 'concentrate', 'deep work'],
    text: 'I found some tracks with low energy and atmospheric textures. They hold a steady pulse without pulling attention away from what you are doing.',
    resultsLabel: 'FUNCTIONAL BEATS',
    trackIds: ['tr-01', 'tr-02', 'tr-39'],
    matches: [92, 86, 81],
  },
  {
    id: 'dark-electronic',
    keywords: ['dark', 'electronic', 'night', 'midnight', 'moody', 'darksynth'],
    text: 'Here is the darker end of your library — dense low end, cold synth textures and very little brightness in the top range.',
    resultsLabel: 'DARK ELECTRONIC',
    trackIds: ['tr-16', 'tr-35', 'tr-13'],
    matches: [95, 89, 83],
  },
  {
    id: 'similar',
    keywords: ['similar', 'like this', 'more of this', 'same vibe', 'related'],
    text: 'I compared tempo, energy curve and texture against what is playing. These three sit closest to it.',
    resultsLabel: 'SIMILAR TO CURRENT',
    trackIds: ['tr-38', 'tr-37', 'tr-11'],
    matches: [91, 87, 78],
  },
  {
    id: 'energetic',
    keywords: ['energetic', 'gym', 'workout', 'run', 'fast', 'hype', 'high energy'],
    text: 'These push hardest in your library — high energy, aggressive tempo and a strong forward drive.',
    resultsLabel: 'HIGH ENERGY',
    trackIds: ['tr-14', 'tr-06', 'tr-17'],
    matches: [96, 90, 85],
  },
  {
    id: 'sad',
    keywords: ['sad', 'melancholic', 'emotional', 'cry', 'slow', 'غمگین'],
    text: 'Slow, melancholic and mostly acoustic or orchestral. These are the tracks you return to when the pace drops.',
    resultsLabel: 'MELANCHOLIC',
    trackIds: ['tr-20', 'tr-24', 'tr-19'],
    matches: [93, 88, 82],
  },
  {
    id: 'mood',
    keywords: ['mood', 'my mood', 'feeling', 'how am i'],
    text: 'Your last sessions read as focused with a dark tilt: mid energy, instrumental heavy, and a clear preference for steady tempos between 100 and 125 BPM.',
    resultsLabel: 'MATCHES YOUR MOOD',
    trackIds: ['tr-02', 'tr-04', 'tr-23'],
    matches: [89, 85, 80],
  },
  {
    id: 'persian',
    keywords: ['persian', 'farsi', 'فارسی', 'ایرانی'],
    text: 'From the Persian side of your archive — mostly melancholic vocal work with warm, analogue arrangements.',
    resultsLabel: 'PERSIAN',
    trackIds: ['tr-24', 'tr-26', 'tr-28'],
    matches: [94, 87, 81],
  },
]

const FALLBACK_INTENT: MockIntent = {
  id: 'fallback',
  keywords: [],
  text: 'I read that as a request for something structured and atmospheric. Here is what fits closest in your library right now.',
  resultsLabel: 'FOR YOU',
  trackIds: ['tr-01', 'tr-38', 'tr-33'],
  matches: [88, 83, 77],
}

/** Deterministic mock reply for a free-text prompt. */
export function mockReplyForPrompt(prompt: string): AIMockReply {
  const q = prompt.toLowerCase().trim()
  const intent = MOCK_INTENTS.find(i => i.keywords.some(k => q.includes(k))) ?? FALLBACK_INTENT

  return {
    text: intent.text,
    resultsLabel: intent.resultsLabel,
    results: intent.trackIds?.map((trackId, i) => ({
      trackId,
      match: intent.matches?.[i] ?? 80,
    })),
  }
}

/** Mock analysis narrative for a specific track. */
export function mockAnalysisReply(title: string, insight: AITrackInsight): AIMockReply {
  return {
    text: `${title} reads as ${insight.mood.toLowerCase()} at ${insight.tempo} BPM, sitting around ${insight.energy}% energy. `
      + `The arrangement is ${insight.atmosphere.toLowerCase()}, which is why it holds up over long listens without fatiguing. `
      + `Filed under ${insight.genre.toLowerCase()}.`,
  }
}

// ------------------------------------------------------------
// TRACK INSIGHT — deterministic mock analysis row
// ------------------------------------------------------------
const MOODS = ['Atmospheric', 'Focused', 'Nocturnal', 'Reflective', 'Driving', 'Weightless']
const ATMOSPHERES = [
  'Wide and reverberant',
  'Close and dry',
  'Layered with soft tape noise',
  'Cold and metallic',
  'Warm analogue haze',
  'Sparse and architectural',
]

function hashOf(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 99991
  return h
}

/**
 * Deterministic stand-in for one row of the future
 * Music Analysis JSON Database.
 */
export function mockInsightFor(input: {
  id: string
  energy: number
  mood: string
  genre: string
  bpm?: number
}): AITrackInsight {
  const h = hashOf(input.id)
  return {
    mood: MOODS[h % MOODS.length] ?? 'Atmospheric',
    energy: Math.max(4, Math.min(99, Math.round(input.energy))),
    tempo: input.bpm ?? 86 + (h % 58),
    genre: input.genre,
    atmosphere: ATMOSPHERES[(h >> 3) % ATMOSPHERES.length] ?? 'Sparse and architectural',
    confidence: Math.round((0.74 + (h % 22) / 100) * 100) / 100,
  }
}

// ------------------------------------------------------------
// SEEDED CHAT HISTORY
// ------------------------------------------------------------
// Realistic seed conversations so the history sheet is never
// empty on first run. Timestamps are generated relative to now
// so TODAY / YESTERDAY grouping always demonstrates correctly.
// ------------------------------------------------------------

interface SeedMessage {
  role: 'user' | 'emo'
  text: string
  results?: { trackId: string; match: number }[]
  resultsLabel?: string
}

export interface AIConversationSeed {
  id: string
  title: string
  /** Days back from today. */
  daysAgo: number
  /** Local clock, 24h. */
  hour: number
  minute: number
  trackContextId?: string
  messages: SeedMessage[]
}

export const aiConversationSeeds: AIConversationSeed[] = [
  {
    id: 'seed-coding-2am',
    title: 'Coding at 2 AM',
    daysAgo: 0,
    hour: 2,
    minute: 14,
    trackContextId: 'tr-01',
    messages: [
      { role: 'user', text: 'Find me something calm for coding.' },
      {
        role: 'emo',
        text: 'I found some tracks with low energy and atmospheric textures. They hold a steady pulse without pulling attention away from what you are doing.',
        resultsLabel: 'FUNCTIONAL BEATS',
        results: [
          { trackId: 'tr-01', match: 92 },
          { trackId: 'tr-02', match: 86 },
          { trackId: 'tr-39', match: 81 },
        ],
      },
      { role: 'user', text: 'Keep it instrumental only.' },
      {
        role: 'emo',
        text: 'Filtered to instrumental. All three above already qualify, so the set stays intact — I only dropped two vocal candidates that were ranked lower.',
      },
      { role: 'user', text: 'How long can this run?' },
      { role: 'emo', text: 'About 52 minutes before it starts repeating. I can extend it with adjacent low-energy material if you want a longer block.' },
      { role: 'user', text: 'Extend it.' },
      { role: 'emo', text: 'Extended to roughly 1 hour 45 minutes. Energy stays between 38% and 62% the whole way through.' },
      { role: 'user', text: 'Perfect.' },
      { role: 'emo', text: 'Queued. I will keep the tempo drift under 8 BPM between transitions.' },
      { role: 'user', text: 'Thanks.' },
      { role: 'emo', text: 'Any time. I will stay quiet unless the energy drifts out of range.' },
    ],
  },
  {
    id: 'seed-dark-electronic',
    title: 'Dark electronic playlist',
    daysAgo: 0,
    hour: 0,
    minute: 42,
    messages: [
      { role: 'user', text: 'Find dark electronic tracks' },
      {
        role: 'emo',
        text: 'Here is the darker end of your library — dense low end, cold synth textures and very little brightness in the top range.',
        resultsLabel: 'DARK ELECTRONIC',
        results: [
          { trackId: 'tr-16', match: 95 },
          { trackId: 'tr-35', match: 89 },
          { trackId: 'tr-13', match: 83 },
        ],
      },
      { role: 'user', text: 'Anything heavier?' },
      { role: 'emo', text: 'Turbo Killer sits highest on aggression in your archive — 94% energy, 128 BPM, and a very compressed mid range.' },
      { role: 'user', text: 'Add it.' },
      { role: 'emo', text: 'Added. The set now peaks harder in the second half instead of front-loading the intensity.' },
      { role: 'user', text: 'Save this as a playlist.' },
      { role: 'emo', text: 'Ready to save. Once the local engine is connected I will write it straight into your library.' },
    ],
  },
  {
    id: 'seed-relaxing',
    title: 'Why does this song feel relaxing?',
    daysAgo: 1,
    hour: 23,
    minute: 42,
    trackContextId: 'tr-20',
    messages: [
      { role: 'user', text: 'Why does this song feel relaxing?' },
      {
        role: 'emo',
        text: 'Three reasons: the tempo sits under 60 BPM, the harmonic movement is very slow, and there is almost no percussive transient. Your ear has nothing sharp to track, so attention settles.',
      },
      { role: 'user', text: 'Is that true for the whole album?' },
      { role: 'emo', text: 'Mostly. Two tracks introduce a spoken layer that raises cognitive load slightly, but the rest keeps the same profile.' },
      { role: 'user', text: 'Find more like it.' },
      {
        role: 'emo',
        text: 'These share the same slow harmonic rhythm and low transient density.',
        resultsLabel: 'QUIET ARCHITECTURE',
        results: [
          { trackId: 'tr-21', match: 91 },
          { trackId: 'tr-19', match: 85 },
          { trackId: 'tr-33', match: 78 },
        ],
      },
    ],
  },
  {
    id: 'seed-morning',
    title: 'Morning commute energy',
    daysAgo: 3,
    hour: 8,
    minute: 5,
    messages: [
      { role: 'user', text: 'Something with momentum for the commute' },
      {
        role: 'emo',
        text: 'Mid-to-high energy, clear rhythmic grid, nothing abrasive before 9 AM.',
        resultsLabel: 'MOMENTUM',
        results: [
          { trackId: 'tr-31', match: 90 },
          { trackId: 'tr-03', match: 84 },
          { trackId: 'tr-10', match: 79 },
        ],
      },
      { role: 'user', text: 'Good enough.' },
      { role: 'emo', text: 'Queued. It ramps gradually rather than starting at peak.' },
    ],
  },
]
