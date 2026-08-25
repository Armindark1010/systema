// ============================================================
// SYSTEMA — Mock AI telemetry & presets
// ============================================================
// Frontend representation of the future local AI engine
// (ONNX Runtime / on-device inference). All values are mock.
// ============================================================

import type { AIInsight, AIRecommendation, AnalysisMode } from '~/types'

export const aiSearchExamples: { label: string; query: string; lang: 'en' | 'fa' }[] = [
  { label: 'DARK CINEMATIC MUSIC FOR A NIGHT DRIVE', query: 'dark cinematic electronic music for a night drive', lang: 'en' },
  { label: 'یه آهنگ غمگین فارسی برای شب', query: 'یه آهنگ غمگین فارسی برای شب', lang: 'fa' },
  { label: 'ENERGETIC MUSIC FOR GYM', query: 'energetic music for gym', lang: 'en' },
  { label: 'CALM INSTRUMENTALS FOR DEEP FOCUS', query: 'calm instrumentals for deep focus', lang: 'en' },
]

export const aiSearchStages: { key: string; label: string }[] = [
  { key: 'understanding', label: 'UNDERSTANDING REQUEST' },
  { key: 'searching', label: 'SEARCHING LIBRARY' },
  { key: 'ranking', label: 'RANKING RESULTS' },
]

export const aiGenerationStages: { key: string; label: string }[] = [
  { key: 'analyzing', label: 'ANALYZING' },
  { key: 'selecting', label: 'SELECTING TRACKS' },
  { key: 'ranking', label: 'RANKING' },
  { key: 'finalizing', label: 'FINALIZING' },
]

export const generationPresets = {
  moods: ['DARK', 'DREAMY', 'ENERGETIC', 'CALM', 'FOCUSED', 'MELANCHOLIC'],
  energies: ['LOW', 'MEDIUM', 'HIGH'],
  durations: [30, 60, 90],
  languages: ['ANY', 'ENGLISH', 'PERSIAN', 'INSTRUMENTAL'],
  genres: ['ELECTRONIC', 'SYNTHWAVE', 'DARK SYNTH', 'AMBIENT', 'NEOCLASSICAL', 'TECHNO', 'PERSIAN', 'ANY'],
}

export const analysisStateSeed: { total: number; analyzed: number; mode: AnalysisMode } = {
  total: 3921,
  analyzed: 3421,
  mode: 'charging-idle',
}

// ------------------------------------------------------------
// INSIGHTS — YOUR MUSIC PROFILE
// ------------------------------------------------------------
export const topGenres: AIInsight[] = [
  { id: 'ig-1', label: 'Synthwave', value: '34%', series: [30, 52, 61, 78, 66, 88] },
  { id: 'ig-2', label: 'Electronic', value: '27%', series: [24, 40, 58, 55, 70, 62] },
  { id: 'ig-3', label: 'Dark Synth', value: '16%', series: [12, 22, 34, 44, 38, 52] },
  { id: 'ig-4', label: 'Persian', value: '11%', series: [18, 16, 26, 20, 30, 28] },
  { id: 'ig-5', label: 'Neoclassical', value: '8%', series: [10, 14, 12, 18, 22, 20] },
]

export const topMoods: AIInsight[] = [
  { id: 'im-1', label: 'Focused', value: '28%', series: [40, 55, 70, 62, 80, 74] },
  { id: 'im-2', label: 'Dark', value: '24%', series: [30, 44, 52, 60, 55, 66] },
  { id: 'im-3', label: 'Energetic', value: '22%', series: [34, 48, 44, 58, 52, 60] },
  { id: 'im-4', label: 'Melancholic', value: '14%', series: [20, 28, 34, 30, 40, 38] },
  { id: 'im-5', label: 'Calm', value: '12%', series: [16, 20, 26, 22, 30, 28] },
]

/** listening intensity per hour of day, 0–100 */
export const listeningPattern: number[] = [
  0, 0, 0, 0, 0, 0, 8, 22, 41, 34, 26, 30,
  38, 32, 24, 28, 44, 56, 48, 62, 78, 84, 66, 38,
]

export const energyScore: AIInsight = { id: 'ie-1', label: 'Energy', value: '62', sub: 'AVG 24H' }
export const focusScore: AIInsight = { id: 'if-1', label: 'Focus', value: '84', sub: 'AVG SESSION' }

export const recentTrends: AIInsight[] = [
  { id: 'it-1', label: 'Late-night listening', value: '+18%', sub: 'VS PREVIOUS WEEK' },
  { id: 'it-2', label: 'Persian catalog', value: '+11%', sub: 'MELANCHOLIC SHIFT' },
  { id: 'it-3', label: 'Instrumental ratio', value: '64%', sub: 'OF PLAYS THIS MONTH' },
  { id: 'it-4', label: 'Listening time', value: '21H 40M', sub: 'THIS WEEK' },
]

export function recommendationsToInsights(recs: readonly AIRecommendation[]): AIInsight[] {
  return recs.map((r) => ({
    id: r.id,
    label: r.title,
    value: `${r.trackCount} TRACKS`,
    sub: r.description,
  }))
}
