// ============================================================
// useAI — Intelligence state machines (mock)
// ============================================================
// All AI behavior is simulated with staged state machines.
// A future on-device engine (ONNX Runtime) or API replaces
// the timers behind the same contract.
// ============================================================

import type { AIGenPhase, AIGenerationForm, AISearchPhase, AnalysisMode, AnalysisState, Track } from '~/types'
import { aiSearchStages } from '~/data/ai'
import { tracks as catalog } from '~/data/music'
import { useSettingsStore } from '~/stores/settings'

// ---- AI search ----------------------------------------------------------
const searchQuery = ref('')
const searchPhase = ref<AISearchPhase>('idle')
const searchProgress = ref(0)
const searchStageIndex = ref(0)
const searchResults = ref<{ track: Track; match: number }[]>([])

// ---- generation ----------------------------------------------------------
const genForm = ref<AIGenerationForm>({
  mood: 'DARK',
  energy: 'HIGH',
  duration: 60,
  language: 'ANY',
  genre: 'ANY',
  concept: '',
})
const genPhase = ref<AIGenPhase>('idle')
const genProgress = ref(0)
const genStageIndex = ref(0)
const genResult = ref<{ track: Track; order: number }[]>([])

// ---- analysis -------------------------------------------------------------
const analysis = ref<AnalysisState>({
  total: 3921,
  analyzed: 3421,
  progress: Math.round((3421 / 3921) * 1000) / 10,
  running: false,
  mode: 'charging-idle',
})

// ---- timers ----------------------------------------------------------------
let searchTimer: ReturnType<typeof setInterval> | null = null
let genTimer: ReturnType<typeof setInterval> | null = null
let analysisTimer: ReturnType<typeof setInterval> | null = null

export function useAI() {
  // ---------------- AI search ----------------
  function isEnabled() {
    try {
      return useSettingsStore().ai.enabled
    } catch {
      return true
    }
  }

  function runSearch(q: string) {
    if (!isEnabled()) return
    searchQuery.value = q
    searchPhase.value = 'understanding'
    searchStageIndex.value = 0
    searchProgress.value = 0
    searchResults.value = []
    if (searchTimer) clearInterval(searchTimer)
    searchTimer = setInterval(() => {
      searchProgress.value += 2
      searchStageIndex.value = Math.min(
        aiSearchStages.length - 1,
        Math.floor((searchProgress.value / 100) * aiSearchStages.length),
      )
      if (searchProgress.value >= 100) {
        clearInterval(searchTimer)
        searchTimer = null
        searchPhase.value = 'done'
        // mock ranked results
        const ids = ['tr-04', 'tr-16', 'tr-35', 'tr-24', 'tr-20', 'tr-08']
        const matches = [96, 88, 84, 79, 71, 63]
        searchResults.value = ids
          .map((id, i) => ({ track: catalog.find((t) => t.id === id)!, match: matches[i] }))
          .filter((r) => r.track)
      }
    }, 60)
  }

  function resetSearch() {
    if (searchTimer) clearInterval(searchTimer)
    searchTimer = null
    searchPhase.value = 'idle'
    searchProgress.value = 0
    searchResults.value = []
  }

  // ---------------- generation ----------------
  function runGeneration() {
    if (!isEnabled()) return
    genPhase.value = 'analyzing'
    genStageIndex.value = 0
    genProgress.value = 0
    genResult.value = []
    if (genTimer) clearInterval(genTimer)
    genTimer = setInterval(() => {
      genProgress.value += 1.4
      genStageIndex.value = Math.min(3, Math.floor((genProgress.value / 100) * 4))
      if (genProgress.value >= 100) {
        clearInterval(genTimer)
        genTimer = null
        genPhase.value = 'done'
        // mock generated tracklist
        const ids = ['tr-04', 'tr-16', 'tr-35', 'tr-15', 'tr-13', 'tr-11', 'tr-36', 'tr-18', 'tr-05', 'tr-19']
        genResult.value = ids
          .map((id, i) => ({ track: catalog.find((t) => t.id === id)!, order: i }))
          .filter((r) => r.track)
      }
    }, 70)
  }

  function resetGeneration() {
    if (genTimer) clearInterval(genTimer)
    genTimer = null
    genPhase.value = 'idle'
    genProgress.value = 0
    genResult.value = []
  }

  // ---------------- analysis ----------------
  function startAnalysis() {
    if (!isEnabled()) return
    if (analysis.value.running) return
    analysis.value.running = true
    if (analysisTimer) clearInterval(analysisTimer)
    analysisTimer = setInterval(() => {
      const remaining = analysis.value.total - analysis.value.analyzed
      if (remaining <= 0) {
        clearInterval(analysisTimer)
        analysisTimer = null
        analysis.value.running = false
        return
      }
      // speed depends on mode
      const speed = analysis.value.mode === 'manual' ? 1 : analysis.value.mode === 'charging' ? 2 : 4
      analysis.value.analyzed = Math.min(analysis.value.total, analysis.value.analyzed + speed)
      analysis.value.progress = Math.round((analysis.value.analyzed / analysis.value.total) * 1000) / 10
    }, 400)
  }

  function setAnalysisMode(mode: AnalysisMode) {
    analysis.value.mode = mode
  }

  function reset() {
    resetSearch()
    resetGeneration()
    if (analysisTimer) clearInterval(analysisTimer)
    analysisTimer = null
    analysis.value.running = false
    analysis.value.analyzed = 0
    analysis.value.progress = 0
  }

  return {
    enabled: computed(() => isEnabled()),
    reset,
    search: {
      query: searchQuery,
      phase: searchPhase,
      progress: searchProgress,
      stageIndex: searchStageIndex,
      results: searchResults,
      run: runSearch,
      reset: resetSearch,
    },
    generation: {
      form: genForm,
      phase: genPhase,
      progress: genProgress,
      stageIndex: genStageIndex,
      result: genResult,
      run: runGeneration,
      reset: resetGeneration,
    },
    analysis: {
      state: analysis,
      start: startAnalysis,
      setMode: setAnalysisMode,
    },
  }
}
