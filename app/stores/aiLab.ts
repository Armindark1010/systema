// ============================================================
// SYSTEMA — AI Lab store (Phase 14)
// ============================================================
// State for the benchmarking laboratory.
//
// SAFETY CONTRACT — the most important property of this file
// ----------------------------------------------------------
// This store has NO startup side effects. Nothing runs on
// instantiation, nothing subscribes to the library, nothing schedules
// work. A benchmark begins only when a human presses RUN, and it only
// ever sees the dataset it was handed.
//
// There is deliberately no action that takes "all tracks", no
// WorkManager enqueue, and no import of the library store's scan
// machinery. Phase 14 must never analyse the user's music library
// (§2, §21), and the cheapest way to guarantee that is to give the
// code no way to express it.
// ============================================================

import { defineStore } from 'pinia'
import type {
  BenchmarkDataset,
  BenchmarkRun,
  BenchmarkTargets,
  ExecutionProviderId,
  ModelDefinition,
} from '~/services/ai-lab/types'
import { DEFAULT_TARGETS } from '~/services/ai-lab/types'
import {
  DEFAULT_PREPROCESSING,
  getModel,
  listExecutionProviders,
  listModels,
} from '~/services/ai-lab/modelRegistry'
import {
  DEFAULT_SAMPLE_COUNT,
  MAX_DATASET_SAMPLES,
  buildDeviceDataset,
  fullSyntheticDataset,
  syntheticDataset,
} from '~/services/ai-lab/dataset'
import { runBenchmark, runSustainedBenchmark } from '~/services/ai-lab/benchmarkRunner'
import { getRuntime } from '~/services/ai-lab/inferenceRuntime'
import { DESKTOP_WARNING, detectDevice } from '~/services/ai-lab/deviceInfo'
import {
  clearProductionSelection,
  clearRuns,
  deleteRun,
  exportFilename,
  exportRuns,
  loadProductionSelection,
  loadRuns,
  saveProductionSelection,
  saveRun,
} from '~/services/ai-lab/resultStore'
import type { ProductionSelection } from '~/services/ai-lab/resultStore'

export type DatasetMode = 'synthetic' | 'device'

export const useAiLabStore = defineStore('aiLab', () => {
  // ---- Catalogue (static, no side effects) ---------------------
  const models = shallowRef<readonly ModelDefinition[]>(listModels())

  // ---- Configuration -------------------------------------------
  const selectedModelId = ref<string>('reference-dsp-v1')
  const executionProvider = ref<ExecutionProviderId>('cpu')
  const datasetMode = ref<DatasetMode>('synthetic')
  const sampleCount = ref(DEFAULT_SAMPLE_COUNT)
  const warmupRuns = ref(2)
  const measuredRuns = ref(3)
  const includeEdgeCases = ref(false)
  const targets = ref<BenchmarkTargets>({ ...DEFAULT_TARGETS })

  /** Tracks the developer explicitly chose. Never auto-filled. */
  const selectedTrackIds = ref<string[]>([])

  // ---- Runtime state -------------------------------------------
  const runs = ref<BenchmarkRun[]>([])
  const isRunning = ref(false)
  const progress = ref<{ completed: number, total: number, label: string } | null>(null)
  const lastError = ref<string | null>(null)
  const logLines = ref<string[]>([])
  const productionSelection = ref<ProductionSelection | null>(null)
  const comparisonRunIds = ref<string[]>([])

  const sustainedResult = ref<Awaited<ReturnType<typeof runSustainedBenchmark>> | null>(null)

  // ---- Derived --------------------------------------------------
  const device = computed(() => detectDevice())
  const isDesktop = computed(() => device.value.platform !== 'android')

  const selectedModel = computed(() => getModel(selectedModelId.value))

  const providers = computed(() => listExecutionProviders(device.value.platform))

  const selectedRuntime = computed(() => {
    const model = selectedModel.value
    return model ? getRuntime(model.runtime) : null
  })

  /** Why the current configuration cannot run, or null when it can. */
  const blockedReason = computed<string | null>(() => {
    const model = selectedModel.value
    if (!model) return 'No model selected.'
    if (model.availability === 'NOT_INSTALLED') {
      return `${model.modelName} has no weights installed on this device. `
        + 'Model files are far too large for the repository and must be side-loaded; '
        + 'the runtime that would load them arrives in Phase 15.'
    }
    const runtime = selectedRuntime.value
    if (runtime && !runtime.isAvailable(executionProvider.value)) {
      return runtime.unavailableReason(executionProvider.value)
    }
    if (datasetMode.value === 'device' && selectedTrackIds.value.length === 0) {
      return 'Select at least one track for a device dataset.'
    }
    return null
  })

  const canRun = computed(() => !isRunning.value && blockedReason.value === null)

  /** Environment banner shown above every result. */
  const environmentWarning = computed(() =>
    isDesktop.value ? DESKTOP_WARNING : null)

  const comparisonRuns = computed(() =>
    comparisonRunIds.value
      .map(id => runs.value.find(r => r.id === id))
      .filter((r): r is BenchmarkRun => Boolean(r)))

  // ---- Dataset construction -------------------------------------

  /**
   * Builds the dataset for the next run.
   *
   * Device mode needs real track metadata, which the caller supplies —
   * this store never reaches into the library itself.
   */
  function buildDataset(
    tracks: Array<{ id: string, title: string, durationMs: number }> = [],
  ): BenchmarkDataset {
    if (datasetMode.value === 'device') {
      const chosen = tracks.filter(t => selectedTrackIds.value.includes(t.id))
      return buildDeviceDataset(chosen)
    }
    return includeEdgeCases.value
      ? fullSyntheticDataset()
      : syntheticDataset(sampleCount.value)
  }

  /** Toggles a track in the manual selection, respecting the cap. */
  function toggleTrack(trackId: string): void {
    const current = selectedTrackIds.value
    if (current.includes(trackId)) {
      selectedTrackIds.value = current.filter(id => id !== trackId)
      return
    }
    if (current.length >= MAX_DATASET_SAMPLES) return
    selectedTrackIds.value = [...current, trackId]
  }

  function clearTrackSelection(): void {
    selectedTrackIds.value = []
  }

  // ---- Execution -------------------------------------------------

  /**
   * Runs one benchmark.
   *
   * Only ever operates on the dataset built above. Never throws to the
   * caller: a failure becomes a stored FAILED run plus lastError.
   */
  async function execute(
    tracks: Array<{ id: string, title: string, durationMs: number }> = [],
  ): Promise<BenchmarkRun | null> {
    const model = selectedModel.value
    if (!model || isRunning.value) return null

    isRunning.value = true
    lastError.value = null
    logLines.value = []
    progress.value = { completed: 0, total: 0, label: 'preparing' }

    try {
      const dataset = buildDataset(tracks)

      const run = await runBenchmark({
        model,
        dataset,
        preprocessing: DEFAULT_PREPROCESSING,
        executionProvider: executionProvider.value,
        device: device.value,
        warmupRuns: warmupRuns.value,
        measuredRuns: measuredRuns.value,
        onProgress: (completed, total, label) => {
          progress.value = { completed, total, label }
        },
        log: (line) => {
          // Bounded: a long run must not grow the buffer without limit.
          logLines.value = [...logLines.value.slice(-199), line]
        },
      })

      if (isDesktop.value) run.warnings.unshift(DESKTOP_WARNING)
      if (model.availability === 'SYNTHETIC') {
        run.warnings.unshift(
          'SYNTHETIC HARNESS RUN — this validates that the benchmark pipeline measures '
          + 'correctly. It is not a real model and its numbers do not predict one.',
        )
        run.environment = 'SYNTHETIC'
      }

      saveRun(run)
      refresh()
      return run
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      isRunning.value = false
      progress.value = null
    }
  }

  /** Sustained/thermal probe (§14). Same dataset discipline. */
  async function executeSustained(iterations: number): Promise<void> {
    const model = selectedModel.value
    if (!model || isRunning.value) return

    isRunning.value = true
    lastError.value = null
    sustainedResult.value = null

    try {
      sustainedResult.value = await runSustainedBenchmark({
        model,
        dataset: syntheticDataset(1),
        preprocessing: DEFAULT_PREPROCESSING,
        executionProvider: executionProvider.value,
        device: device.value,
        iterations,
        onProgress: (completed, total, label) => {
          progress.value = { completed, total, label }
        },
      })
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
    } finally {
      isRunning.value = false
      progress.value = null
    }
  }

  // ---- Persistence -----------------------------------------------

  /** Loads stored runs. Called by the page, never automatically. */
  function refresh(): void {
    runs.value = loadRuns()
    productionSelection.value = loadProductionSelection()
  }

  function removeRun(runId: string): void {
    deleteRun(runId)
    comparisonRunIds.value = comparisonRunIds.value.filter(id => id !== runId)
    refresh()
  }

  function removeAllRuns(): void {
    clearRuns()
    comparisonRunIds.value = []
    refresh()
  }

  function toggleComparison(runId: string): void {
    const current = comparisonRunIds.value
    comparisonRunIds.value = current.includes(runId)
      ? current.filter(id => id !== runId)
      : [...current, runId].slice(-4)
  }

  // ---- Production selection (§28) ---------------------------------

  /**
   * Records a human decision. Never called automatically.
   *
   * The rationale is mandatory: a selection with no stated reason is
   * indistinguishable from a silent default, which §28 forbids.
   */
  function selectProductionModel(
    modelId: string,
    rationale: string,
    justifyingRunId: string | null,
  ): boolean {
    if (!getModel(modelId)) return false
    if (!rationale.trim()) return false
    saveProductionSelection({
      selectedModelId: modelId,
      selectedAt: Date.now(),
      justifyingRunId,
      rationale: rationale.trim(),
    })
    refresh()
    return true
  }

  function clearProductionModel(): void {
    clearProductionSelection()
    refresh()
  }

  // ---- Export (§20) -----------------------------------------------

  function exportAsJson(subset?: BenchmarkRun[]): { filename: string, content: string } {
    const target = subset && subset.length > 0 ? subset : runs.value
    return { filename: exportFilename(target), content: exportRuns(target) }
  }

  return {
    // catalogue
    models,
    providers,
    // config
    selectedModelId,
    selectedModel,
    executionProvider,
    datasetMode,
    sampleCount,
    warmupRuns,
    measuredRuns,
    includeEdgeCases,
    targets,
    selectedTrackIds,
    // state
    runs,
    isRunning,
    progress,
    lastError,
    logLines,
    productionSelection,
    comparisonRunIds,
    comparisonRuns,
    sustainedResult,
    // derived
    device,
    isDesktop,
    blockedReason,
    canRun,
    environmentWarning,
    // actions
    buildDataset,
    toggleTrack,
    clearTrackSelection,
    execute,
    executeSustained,
    refresh,
    removeRun,
    removeAllRuns,
    toggleComparison,
    selectProductionModel,
    clearProductionModel,
    exportAsJson,
  }
})
