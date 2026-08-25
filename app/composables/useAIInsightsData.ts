// ============================================================
// useAIInsightsData — static AI insight payloads
// ============================================================

import { aiRecommendations as recs } from '~/data/playlists'

export function useAIInsightsData() {
  return { aiRecommendations: recs }
}
