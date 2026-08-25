// ============================================================
// SYSTEMA — Quick search / command palette catalog
// ============================================================
import type { SearchResult } from '~/types'

export const pageIndex: { label: string; description: string; to: string }[] = [
  { label: 'Home', description: 'Your music system', to: '/' },
  { label: 'Search', description: 'Find anything in the archive', to: '/search' },
  { label: 'Library', description: 'Tracks, albums, artists, genres', to: '/library/tracks' },
  { label: 'Playlists', description: 'Curated and generated sets', to: '/playlists' },
  { label: 'AI Studio', description: 'What do you want to hear?', to: '/ai' },
  { label: 'AI Insights', description: 'Your music profile', to: '/ai/insights' },
  { label: 'Settings', description: 'Playback, library, AI, appearance', to: '/settings' },
]

/** Heuristic: descriptive / non-latin queries are treated as semantic. */
export function isSemanticQuery(q: string): boolean {
  const t = q.trim()
  if (!t) return false
  const hasNonLatin = /[\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/.test(t)
  if (hasNonLatin) return true
  // long descriptive phrases without an obvious catalog title
  return t.length >= 24
}

export function buildMockResults(query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SearchResult[] = []
  if (isSemanticQuery(q)) {
    out.push({
      id: 'ai-1',
      type: 'ai',
      title: 'Semantic search in your library',
      subtitle: '“' + query.trim() + '”',
      match: 94,
    })
  }
  return out
}
