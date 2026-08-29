/**
 * SYSTEMA — dataset UI state (Phase 28).
 *
 * UI → THIS → dataset service → gateway → database.
 *
 * The refs here are a CACHE of what the database holds, never the
 * storage itself. Every mutation goes through the service and the
 * local copy is refreshed from what came back, so the screen can only
 * ever show something that was actually written.
 */

import { computed, reactive, ref } from 'vue'

import { initDataset, isDatasetDurable } from '~/services/ai-dataset'
import type { DatasetQuery } from '~/services/ai-dataset/datasetGateway'
import type { DatasetRecord } from '~/services/ai-dataset/datasetRecord'
import { assessRecord } from '~/services/ai-dataset/datasetRecord'
import {
  allRecords,
  deleteRecord,
  queryDataset,
  saveLabels as persistLabels,
} from '~/services/ai-dataset/datasetService'
import {
  buildLabelDistributions,
  buildOverview,
} from '~/services/ai-dataset/datasetStats'
import type { GroundTruthLabels } from '~/services/ai-dataset/labels'
import { labelsEqual, sanitiseLabels } from '~/services/ai-dataset/labels'

export type LabelSaveState = 'saved' | 'modified' | 'unsaved' | 'saving'

const rows = ref<DatasetRecord[]>([])
const total = ref(0)
const everything = ref<DatasetRecord[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const ready = ref(false)

const filters = reactive<DatasetQuery>({
  search: '',
  sortBy: 'updatedAt',
  sortDir: 'desc',
  limit: 25,
  offset: 0,
})

export function useAiDataset() {
  /** Selects the backend once, then loads. */
  async function init(): Promise<void> {
    if (!ready.value) {
      await initDataset()
      ready.value = true
    }
    await refresh()
  }

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const page = await queryDataset({ ...filters })
      rows.value = page.rows
      total.value = page.total
      // Statistics describe the WHOLE dataset, not the current page —
      // a class-imbalance figure computed from 25 visible rows would
      // be actively misleading.
      everything.value = await allRecords()
    } catch (e) {
      error.value = (e as Error)?.message ?? 'The dataset could not be read.'
      rows.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  async function setFilter(patch: Partial<DatasetQuery>): Promise<void> {
    Object.assign(filters, patch)
    // Any filter change resets paging: staying on page 4 of a result
    // set that now has one page shows an empty screen.
    if (!('offset' in patch)) filters.offset = 0
    await refresh()
  }

  async function goToPage(page: number): Promise<void> {
    const limit = filters.limit ?? 25
    filters.offset = Math.max(0, (page - 1) * limit)
    await refresh()
  }

  async function remove(id: string): Promise<boolean> {
    const okDeleted = await deleteRecord(id)
    if (okDeleted) await refresh()
    return okDeleted
  }

  async function saveLabels(
    id: string,
    labels: GroundTruthLabels,
  ): Promise<{ ok: boolean, error?: string }> {
    const res = await persistLabels(id, sanitiseLabels(labels))
    if (res.ok) await refresh()
    return { ok: res.ok, error: res.error }
  }

  const overview = computed(() => buildOverview(everything.value))
  const distributions = computed(() => buildLabelDistributions(everything.value))

  const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? 25)) + 1)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / (filters.limit ?? 25))))

  return {
    rows,
    total,
    loading,
    error,
    filters,
    page,
    pageCount,
    overview,
    distributions,
    /** False when writes are not being persisted. The UI must warn. */
    durable: computed(() => isDatasetDurable()),
    init,
    refresh,
    setFilter,
    goToPage,
    remove,
    saveLabels,
    quality: (r: DatasetRecord) => assessRecord(r),
  }
}

/**
 * Tracks whether an open label editor has unsaved changes.
 *
 * Kept separate from the dataset cache: the draft is deliberately NOT
 * written anywhere until the user presses save, so an abandoned edit
 * cannot end up in the training set.
 */
export function useLabelDraft() {
  const draft = ref<GroundTruthLabels | null>(null)
  const original = ref<GroundTruthLabels | null>(null)
  const saving = ref(false)

  function begin(labels: GroundTruthLabels): void {
    original.value = JSON.parse(JSON.stringify(labels)) as GroundTruthLabels
    draft.value = JSON.parse(JSON.stringify(labels)) as GroundTruthLabels
  }

  function discard(): void {
    draft.value = null
    original.value = null
  }

  const state = computed<LabelSaveState>(() => {
    if (saving.value) return 'saving'
    if (!draft.value || !original.value) return 'unsaved'
    if (!labelsEqual(draft.value, original.value)) return 'modified'
    return original.value.revision > 0 ? 'saved' : 'unsaved'
  })

  const dirty = computed(() =>
    Boolean(draft.value && original.value && !labelsEqual(draft.value, original.value)))

  /** Multi-select toggle used by genre, mood and context. */
  function toggle(field: 'genres' | 'moods' | 'contexts', value: string): void {
    if (!draft.value) return
    const list = draft.value[field] as string[]
    const i = list.indexOf(value)
    if (i === -1) list.push(value)
    else list.splice(i, 1)
  }

  /** Single-select; pressing the active value clears it. */
  function choose(
    field: 'language' | 'vocal' | 'energy',
    value: string | null,
  ): void {
    if (!draft.value) return
    ;(draft.value[field] as string | null) = draft.value[field] === value ? null : value
  }

  return { draft, original, saving, state, dirty, begin, discard, toggle, choose }
}
