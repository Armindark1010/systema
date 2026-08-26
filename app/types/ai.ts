// ============================================================
// SYSTEMA — AI COMPANION type contracts
// ============================================================
// These shapes describe the conversation layer between the UI
// and the future local AI runtime:
//
//   Nuxt UI → Pinia → Capacitor → Kotlin → Local AI Runtime
//            → Music Analysis JSON Database
//
// Everything is currently served by mock generators, but the
// contracts are already shaped for a real conversation store.
// ============================================================

/** Lifecycle of the companion, mirrored by EMO's expression. */
export type AICompanionStatus = 'idle' | 'listening' | 'thinking' | 'responding'

export type AIMessageRole = 'user' | 'emo'

/** A ranked track reference produced by the (mock) engine. */
export interface AIMatch {
  trackId: string
  /** 0–100 confidence that the track answers the request. */
  match: number
}

export interface AIMessage {
  id: string
  role: AIMessageRole
  text: string
  /** ISO timestamp. */
  at: string
  /** Optional ranked music results attached to an EMO answer. */
  results?: AIMatch[]
  /** Section label rendered above the results (e.g. FUNCTIONAL BEATS). */
  resultsLabel?: string
  /** Track this answer was reasoning about, when scoped to one. */
  trackId?: string
}

export interface AIConversation {
  id: string
  title: string
  /** ISO timestamps. */
  createdAt: string
  updatedAt: string
  messages: AIMessage[]
  /** Optional now-playing context the conversation was opened with. */
  trackContextId?: string
}

/** Mock stand-in for one row of the future analysis database. */
export interface AITrackInsight {
  mood: string
  /** 0–100 */
  energy: number
  /** beats per minute */
  tempo: number
  genre: string
  atmosphere: string
  /** 0–1 */
  confidence: number
}

export interface AIQuickAction {
  id: string
  label: string
  icon: string
  prompt: string
  /** Requires a currently playing track. */
  needsTrack?: boolean
}

export interface AIForYouSection {
  id: string
  label: string
  description: string
  items: AIMatch[]
}

/** Deterministic result of the mock intent engine. */
export interface AIMockReply {
  text: string
  results?: AIMatch[]
  resultsLabel?: string
}
