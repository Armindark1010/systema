// ============================================================
// useTrackAnalysis — fake AI analysis with states
// ============================================================

import { useSettingsStore } from '~/stores/settings'

export type AnalysisStatus = 'not-analyzed' | 'analyzing' | 'analyzed' | 'error'

export interface TrackAnalysis {
  trackId: string
  analyzed: boolean
  status: AnalysisStatus
  mood: string[]
  genres: string[]
  energy: number
  bpm: number
  language: string
  themes: string[]
  confidence: number
  analyzedAt?: string
  error?: string
}

const ANALYSIS_DB = reactive<Map<string, TrackAnalysis>>(new Map())

function makeFakeAnalysis(trackId: string): TrackAnalysis {
  const moods = [
    ['focused', 'energetic'],
    ['dreamy', 'calm'],
    ['dark', 'energetic'],
    ['melancholic', 'calm'],
    ['focused', 'calm'],
  ]
  const genresPool = [
    ['electronic', 'ambient'],
    ['synthwave', 'electronic'],
    ['dark-synth', 'industrial'],
    ['neoclassical', 'ambient'],
    ['persian', 'melancholic'],
  ]
  const themesPool = [
    ['architecture', 'rhythm'],
    ['night', 'drive'],
    ['memory', 'light'],
    ['system', 'structure'],
    ['love', 'distance'],
  ]

  const hash = trackId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const mood = moods[hash % moods.length]!
  const genres = genresPool[hash % genresPool.length]!
  const themes = themesPool[hash % themesPool.length]!

  return {
    trackId,
    analyzed: true,
    status: 'analyzed',
    mood,
    genres,
    energy: 0.35 + (hash % 65) / 100,
    bpm: 78 + (hash % 60),
    language: hash % 3 === 0 ? 'instrumental' : hash % 3 === 1 ? 'en' : 'fa',
    themes,
    confidence: 0.78 + (hash % 22) / 100,
    analyzedAt: new Date().toISOString(),
  }
}

// Pre-seed some analyzed tracks for prototype realism
const PRE_ANALYZED = ['tr-01', 'tr-04', 'tr-08', 'tr-14', 'tr-20', 'tr-24']
for (const id of PRE_ANALYZED) {
  ANALYSIS_DB.set(id, makeFakeAnalysis(id))
}

export function useTrackAnalysis() {
  const { currentTrack } = usePlayer()

  const currentAnalysis = computed<TrackAnalysis | null>(() => {
    if (!currentTrack.value) return null
    return ANALYSIS_DB.get(currentTrack.value.id) ?? null
  })

  const status = computed<AnalysisStatus>(() => {
    if (!currentTrack.value) return 'not-analyzed'
    const a = ANALYSIS_DB.get(currentTrack.value.id)
    if (!a) return 'not-analyzed'
    return a.status
  })

  const isAnalyzed = computed(() => status.value === 'analyzed')
  const isAnalyzing = computed(() => status.value === 'analyzing')

  function getAnalysis(trackId: string): TrackAnalysis | null {
    return ANALYSIS_DB.get(trackId) ?? null
  }

  function analyzeTrack(trackId: string, force = false): Promise<TrackAnalysis> {
    try {
      if (!useSettingsStore().ai.enabled) {
        return Promise.reject(new Error('AI features disabled'))
      }
    } catch {
      /* settings store unavailable — continue */
    }
    const existing = ANALYSIS_DB.get(trackId)

    if (existing && existing.status === 'analyzing') {
      return Promise.resolve(existing)
    }

    if (existing && existing.status === 'analyzed' && !force) {
      return Promise.resolve(existing)
    }

    // Set to analyzing
    const analyzing: TrackAnalysis = {
      trackId,
      analyzed: false,
      status: 'analyzing',
      mood: existing?.mood ?? [],
      genres: existing?.genres ?? [],
      energy: existing?.energy ?? 0,
      bpm: existing?.bpm ?? 0,
      language: existing?.language ?? 'unknown',
      themes: existing?.themes ?? [],
      confidence: existing?.confidence ?? 0,
    }
    ANALYSIS_DB.set(trackId, analyzing)

    // Simulate async analysis 1.8s - 3.2s
    const delay = 1800 + Math.random() * 1400

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // 8% chance error for realism
        if (Math.random() < 0.08 && !force) {
          const err: TrackAnalysis = {
            ...analyzing,
            status: 'error',
            error: 'Analysis failed — low confidence',
          }
          ANALYSIS_DB.set(trackId, err)
          reject(err)
          return
        }

        const result = makeFakeAnalysis(trackId)
        ANALYSIS_DB.set(trackId, result)
        resolve(result)
      }, delay)
    })
  }

  function analyzeCurrent(force = false) {
    if (!currentTrack.value) return Promise.reject('No track')
    return analyzeTrack(currentTrack.value.id, force)
  }

  function cachedCount() {
    return ANALYSIS_DB.size
  }

  function clearCache() {
    ANALYSIS_DB.clear()
  }

  return {
    currentAnalysis,
    status,
    isAnalyzed,
    isAnalyzing,
    getAnalysis,
    analyzeTrack,
    analyzeCurrent,
    cachedCount,
    clearCache,
    db: ANALYSIS_DB,
  }
}
