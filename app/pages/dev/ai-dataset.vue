<script setup lang="ts">
// ============================================================
// SYSTEMA — AI Dataset (Phase 28)
// ============================================================
// Dataset management and manual labeling.
//
// Isolation: reachable only by typing /dev/ai-dataset, on the `dev`
// layout, so no application chrome mounts and nothing links here from
// the normal browsing experience.
//
// What this page is FOR
// ---------------------
// Reviewing collected analyses and attaching HUMAN ground-truth
// labels. Analyses are created in the Full Player; this page does not
// run inference and has no "analyse everything" control, because the
// underlying service offers none.
//
// What is NOT shown
// -----------------
// No predicted mood, language or genre. No classifier exists in this
// project. Every semantic value on this page was typed by a person,
// and the label editor is the only thing that can write one.
// ============================================================

import { computed, onMounted, ref } from 'vue'

import { useAiDataset, useLabelDraft } from '~/composables/useAiDataset'
import type { DatasetRecord } from '~/services/ai-dataset/datasetRecord'
import { exportCsv, exportJson } from '~/services/ai-dataset/datasetExport'
import { allRecords } from '~/services/ai-dataset/datasetService'
import {
  CONTEXT_VALUES,
  ENERGY_DISPLAY,
  ENERGY_VALUES,
  GENRE_SUGGESTIONS,
  LANGUAGE_DISPLAY,
  LANGUAGE_VALUES,
  MOOD_VALUES,
  VOCAL_VALUES,
  emptyLabels,
} from '~/services/ai-dataset/labels'

definePageMeta({ layout: 'dev' })
useHead({ title: 'AI Dataset' })

const dataset = useAiDataset()
const draft = useLabelDraft()

const selected = ref<DatasetRecord | null>(null)
const confirmDelete = ref<string | null>(null)
const saveError = ref<string | null>(null)
const exportNote = ref<string | null>(null)

onMounted(() => dataset.init())

const DASH = '—'

function fmt(v: number | null | undefined, digits = 0, suffix = ''): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH
  return `${v.toFixed(digits)}${suffix}`
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString()
}

function openRecord(r: DatasetRecord) {
  selected.value = r
  draft.begin(r.groundTruth ?? emptyLabels())
  saveError.value = null
}

function closeRecord() {
  selected.value = null
  draft.discard()
}

async function onSaveLabels() {
  if (!selected.value || !draft.draft.value) return
  draft.saving.value = true
  saveError.value = null
  const res = await dataset.saveLabels(selected.value.id, draft.draft.value)
  draft.saving.value = false
  if (res.ok) {
    // Re-seed from what was actually stored, so the badge reflects the
    // database rather than the form.
    const fresh = dataset.rows.value.find(r => r.id === selected.value?.id)
    if (fresh) {
      selected.value = fresh
      draft.begin(fresh.groundTruth)
    }
  } else {
    saveError.value = res.error ?? 'The labels were not saved.'
  }
}

async function onDelete(id: string) {
  const done = await dataset.remove(id)
  confirmDelete.value = null
  if (done && selected.value?.id === id) closeRecord()
}

/**
 * Writes an export to a file.
 *
 * On device this hands the text to a download; the shared-storage
 * export that survives a reinstall is a separate, later step.
 */
function downloadText(name: string, text: string, mime: string) {
  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    exportNote.value = `Exported ${name}`
  } catch (e) {
    exportNote.value = (e as Error)?.message ?? 'The export failed.'
  }
}

async function onExportJson() {
  const rows = await allRecords()
  downloadText(`systema-dataset-${Date.now()}.json`, exportJson(rows, true), 'application/json')
}

async function onExportCsv() {
  const rows = await allRecords()
  downloadText(`systema-dataset-${Date.now()}.csv`, exportCsv(rows), 'text/csv')
}

const selectedQuality = computed(() =>
  selected.value ? dataset.quality(selected.value) : null)

/** Distribution rows for the imbalance panel. */
function distRows(d: { counts: Record<string, number>, unlabelled: number }) {
  return Object.entries(d.counts).map(([k, v]) => ({ label: k, count: v }))
}
</script>

<template>
  <div class="min-h-dvh">
    <!-- Header -->
    <header class="border-b border-line bg-surface">
      <div class="sys-container py-6">
        <p class="label text-fg-faint">DEVELOPER · DATA COLLECTION</p>
        <h1 class="mt-2 text-[24px] font-bold tracking-tight text-fg">
          AI Dataset
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Collected audio measurements and experimental embeddings, plus
          manually assigned ground-truth labels. Every semantic value here is
          typed by a person — no classifier for mood, genre, language or
          context exists in this project yet. Analyses are created from the
          Full Player; this page reviews and labels them.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <!-- Durability warning: the one thing worse than no labeling UI
           is one that silently throws work away. -->
      <div
        v-if="!dataset.durable.value"
        class="border border-line bg-surface px-5 py-4"
      >
        <p class="label text-fg-muted">NOT PERSISTED</p>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          No device database is available in this environment, so the dataset
          is being held in memory only and will be lost when this page is
          reloaded. Labels entered here are not saved. Run the app on a device
          for real persistence.
        </p>
      </div>

      <p v-if="dataset.error.value" class="text-small text-fg-muted">
        {{ dataset.error.value }}
      </p>

      <!-- ---------------------------------------------------------- -->
      <!-- Overview                                                    -->
      <!-- ---------------------------------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">OVERVIEW</p>
        </div>
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
          <div
            v-for="stat in [
              { k: 'Records', v: dataset.overview.value.totalRecords },
              { k: 'Tracks', v: dataset.overview.value.distinctTracks },
              { k: 'Analysed', v: dataset.overview.value.analysedRecords },
              { k: 'Failed', v: dataset.overview.value.failedRecords },
              { k: 'Labelled', v: dataset.overview.value.labelledRecords },
              { k: 'Unlabelled', v: dataset.overview.value.unlabelledRecords },
              { k: 'Embeddings', v: dataset.overview.value.embeddingCount },
              { k: 'Avg complete', v: `${dataset.overview.value.averageCompleteness}%` },
            ]"
            :key="stat.k"
            class="bg-surface px-5 py-4"
          >
            <dt class="label text-fg-faint">{{ stat.k }}</dt>
            <dd class="mt-1 text-[20px] font-bold text-fg tnum">{{ stat.v }}</dd>
          </div>
        </dl>

        <div
          v-if="Object.keys(dataset.overview.value.modelDistribution).length"
          class="border-t border-line px-5 py-4"
        >
          <p class="label text-fg-faint">MODEL / VERSION</p>
          <ul class="mt-2 space-y-1">
            <li
              v-for="(count, model) in dataset.overview.value.modelDistribution"
              :key="model"
              class="text-small text-fg-muted flex justify-between gap-4"
            >
              <span class="truncate">{{ model }}</span>
              <span class="tnum shrink-0">{{ count }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- ---------------------------------------------------------- -->
      <!-- Class balance                                               -->
      <!-- ---------------------------------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">LABEL DISTRIBUTION</p>
        </div>
        <p class="px-5 pt-4 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Class balance across the whole dataset. A field dominated by one
          value will train a classifier that looks accurate and has learned
          nothing, so check this before using the data.
        </p>
        <div class="px-5 py-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="field in [
              { k: 'Language', d: dataset.distributions.value.language },
              { k: 'Genre', d: dataset.distributions.value.genre },
              { k: 'Mood', d: dataset.distributions.value.mood },
              { k: 'Vocal', d: dataset.distributions.value.vocal },
              { k: 'Energy', d: dataset.distributions.value.energy },
              { k: 'Context', d: dataset.distributions.value.context },
            ]"
            :key="field.k"
          >
            <p class="label text-fg-faint">
              {{ field.k }}
              <span v-if="field.d.imbalanceRatio" class="text-fg-muted">
                · ratio {{ field.d.imbalanceRatio }}
              </span>
            </p>
            <ul class="mt-2 space-y-1">
              <li
                v-for="row in distRows(field.d)"
                :key="row.label"
                class="text-small text-fg-muted flex justify-between gap-4"
              >
                <span>{{ row.label }}</span>
                <span class="tnum">{{ row.count }}</span>
              </li>
              <li
                v-if="field.d.unlabelled"
                class="text-small text-fg-faint flex justify-between gap-4"
              >
                <span>(unlabelled)</span>
                <span class="tnum">{{ field.d.unlabelled }}</span>
              </li>
              <li v-if="!distRows(field.d).length && !field.d.unlabelled"
                class="text-small text-fg-faint">
                No data
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ---------------------------------------------------------- -->
      <!-- Controls                                                    -->
      <!-- ---------------------------------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <p class="label text-fg-muted">RECORDS · {{ dataset.total.value }}</p>
          <div class="flex flex-wrap gap-2">
            <button class="sys-btn-outline" @click="onExportJson">EXPORT JSON</button>
            <button class="sys-btn-outline" @click="onExportCsv">EXPORT CSV</button>
            <button class="sys-btn-outline" @click="dataset.refresh()">REFRESH</button>
          </div>
        </div>

        <p v-if="exportNote" class="px-5 pt-3 text-small text-fg-muted">{{ exportNote }}</p>

        <div class="px-5 py-4 flex flex-wrap gap-3 items-end">
          <label class="flex-1 min-w-[200px]">
            <span class="label text-fg-faint">SEARCH</span>
            <input
              :value="dataset.filters.search"
              type="search"
              placeholder="Title or artist"
              class="mt-1 w-full bg-base border border-line px-3 py-2 text-small text-fg"
              @input="dataset.setFilter({ search: ($event.target as HTMLInputElement).value })"
            >
          </label>

          <label>
            <span class="label text-fg-faint">LABELS</span>
            <select
              class="mt-1 bg-base border border-line px-3 py-2 text-small text-fg"
              @change="dataset.setFilter({ labelled: (($event.target as HTMLSelectElement).value || undefined) as never })"
            >
              <option value="">All</option>
              <option value="labelled">Labelled</option>
              <option value="unlabelled">Unlabelled</option>
            </select>
          </label>

          <label>
            <span class="label text-fg-faint">STATUS</span>
            <select
              class="mt-1 bg-base border border-line px-3 py-2 text-small text-fg"
              @change="dataset.setFilter({ status: (($event.target as HTMLSelectElement).value || undefined) as never })"
            >
              <option value="">All</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>

          <label>
            <span class="label text-fg-faint">SORT</span>
            <select
              class="mt-1 bg-base border border-line px-3 py-2 text-small text-fg"
              @change="dataset.setFilter({ sortBy: ($event.target as HTMLSelectElement).value as never })"
            >
              <option value="updatedAt">Updated</option>
              <option value="createdAt">Created</option>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="completeness">Completeness</option>
            </select>
          </label>

          <button
            class="sys-btn-outline"
            @click="dataset.setFilter({ sortDir: dataset.filters.sortDir === 'asc' ? 'desc' : 'asc' })"
          >
            {{ dataset.filters.sortDir === 'asc' ? 'ASC' : 'DESC' }}
          </button>
        </div>

        <!-- Table -->
        <div class="overflow-x-auto border-t border-line">
          <table class="w-full text-small">
            <thead>
              <tr class="border-b border-line text-fg-faint">
                <th class="text-left font-normal px-4 py-2">Track</th>
                <th class="text-left font-normal px-4 py-2">Language</th>
                <th class="text-left font-normal px-4 py-2">Genre</th>
                <th class="text-left font-normal px-4 py-2">Mood</th>
                <th class="text-left font-normal px-4 py-2">Vocal</th>
                <th class="text-left font-normal px-4 py-2">Energy</th>
                <th class="text-left font-normal px-4 py-2">Contexts</th>
                <th class="text-left font-normal px-4 py-2">Analysis</th>
                <th class="text-left font-normal px-4 py-2">Embedding</th>
                <th class="text-left font-normal px-4 py-2">Complete</th>
                <th class="text-left font-normal px-4 py-2">Updated</th>
                <th class="text-left font-normal px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-if="dataset.loading.value">
                <td colspan="12" class="px-4 py-6 text-fg-faint">Loading…</td>
              </tr>
              <tr v-else-if="!dataset.rows.value.length">
                <td colspan="12" class="px-4 py-6 text-fg-faint">
                  No records yet. Analyse a track from the Full Player.
                </td>
              </tr>
              <tr
                v-for="r in dataset.rows.value"
                v-else
                :key="r.id"
                class="border-b border-line hover:bg-base/40"
              >
                <td class="px-4 py-3">
                  <p class="text-fg truncate max-w-[220px]">{{ r.track.title ?? DASH }}</p>
                  <p class="text-fg-faint truncate max-w-[220px]">{{ r.track.artist ?? DASH }}</p>
                </td>
                <td class="px-4 py-3 text-fg-muted">{{ r.groundTruth.language ?? DASH }}</td>
                <td class="px-4 py-3 text-fg-muted">
                  {{ r.groundTruth.genres.length ? r.groundTruth.genres.join(', ') : DASH }}
                </td>
                <td class="px-4 py-3 text-fg-muted">
                  {{ r.groundTruth.moods.length ? r.groundTruth.moods.join(', ') : DASH }}
                </td>
                <td class="px-4 py-3 text-fg-muted">{{ r.groundTruth.vocal ?? DASH }}</td>
                <td class="px-4 py-3 text-fg-muted">{{ r.groundTruth.energy ?? DASH }}</td>
                <td class="px-4 py-3 text-fg-muted">
                  {{ r.groundTruth.contexts.length ? r.groundTruth.contexts.join(', ') : DASH }}
                </td>
                <td class="px-4 py-3 text-fg-muted">
                  {{ r.status }}<span v-if="r.supersededAt" class="text-fg-faint"> · old</span>
                </td>
                <td class="px-4 py-3 text-fg-muted tnum">
                  {{ r.embedding ? `${r.embedding.dimension}-d` : DASH }}
                </td>
                <td class="px-4 py-3 text-fg-muted tnum">
                  {{ dataset.quality(r).completeness }}%
                </td>
                <td class="px-4 py-3 text-fg-faint tnum">{{ shortDate(r.updatedAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex gap-2">
                    <button class="sys-btn-outline" @click="openRecord(r)">OPEN</button>
                    <button class="sys-btn-outline" @click="confirmDelete = r.id">DELETE</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="border-t border-line px-5 py-3 flex items-center justify-between gap-3">
          <p class="text-small text-fg-faint tnum">
            Page {{ dataset.page.value }} of {{ dataset.pageCount.value }}
          </p>
          <div class="flex gap-2">
            <button
              class="sys-btn-outline"
              :disabled="dataset.page.value <= 1"
              @click="dataset.goToPage(dataset.page.value - 1)"
            >
              PREV
            </button>
            <button
              class="sys-btn-outline"
              :disabled="dataset.page.value >= dataset.pageCount.value"
              @click="dataset.goToPage(dataset.page.value + 1)"
            >
              NEXT
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- ------------------------------------------------------------ -->
    <!-- Delete confirmation                                           -->
    <!-- ------------------------------------------------------------ -->
    <div
      v-if="confirmDelete"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div class="w-full max-w-md border border-line bg-surface p-5">
        <p class="label text-fg-muted">DELETE RECORD</p>
        <p class="mt-2 text-small text-fg-muted leading-relaxed">
          This permanently removes the analysis, its embedding and any
          hand-assigned labels. It cannot be undone.
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="sys-btn-outline" @click="confirmDelete = null">CANCEL</button>
          <button class="sys-btn-outline" @click="onDelete(confirmDelete)">DELETE</button>
        </div>
      </div>
    </div>

    <!-- ------------------------------------------------------------ -->
    <!-- Labeling editor                                               -->
    <!-- ------------------------------------------------------------ -->
    <div
      v-if="selected && draft.draft.value"
      class="fixed inset-0 z-40 overflow-y-auto bg-base"
    >
      <div class="sys-container py-6 space-y-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="label text-fg-faint">LABELING</p>
            <h2 class="mt-1 text-[20px] font-bold text-fg">
              {{ selected.track.title ?? 'Untitled' }}
            </h2>
            <p class="text-small text-fg-muted">{{ selected.track.artist ?? DASH }}</p>
          </div>
          <button class="sys-btn-outline shrink-0" @click="closeRecord">CLOSE</button>
        </div>

        <!-- Measurements: what the machine actually knows. -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">MEASURED · NOT EDITABLE</p>
          </div>
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
            <div
              v-for="m in [
                { k: 'Tempo', v: selected.measurements.bpm === null ? DASH : `${Math.round(selected.measurements.bpm)} BPM` },
                { k: 'Loudness', v: fmt(selected.measurements.loudnessDbfs, 1, ' dBFS') },
                { k: 'Dynamics', v: fmt(selected.measurements.dynamicRangeDb, 1, ' dB') },
                { k: 'Peak', v: fmt(selected.measurements.peak, 2) },
                { k: 'Duration', v: fmt(selected.measurements.sourceDurationSec, 0, ' s') },
                { k: 'Analysed', v: fmt(selected.measurements.analysedDurationSec, 0, ' s') },
                { k: 'Centroid', v: fmt(selected.measurements.spectralCentroid, 0, ' Hz') },
                { k: 'Windows', v: selected.measurements.windowsProcessed ?? DASH },
              ]"
              :key="m.k"
              class="bg-surface px-4 py-3"
            >
              <dt class="label text-fg-faint">{{ m.k }}</dt>
              <dd class="mt-1 text-small text-fg tnum">{{ m.v }}</dd>
            </div>
          </dl>
          <div class="border-t border-line px-5 py-3 text-small text-fg-muted">
            <span v-if="selected.embedding">
              {{ selected.embedding.model }} · {{ selected.embedding.modelVersion }} ·
              {{ selected.embedding.dimension }}-d ·
              {{ selected.embedding.normalized ? 'normalised' : 'raw' }} · experimental
            </span>
            <span v-else>No embedding stored for this record.</span>
          </div>
        </section>

        <!-- Ground truth. -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between gap-3">
            <p class="label text-fg-muted">GROUND TRUTH · HUMAN ASSIGNED</p>
            <span class="label" :class="{
              'text-fg-faint': draft.state.value === 'unsaved',
              'text-fg': draft.state.value === 'modified' || draft.state.value === 'saving',
              'text-fg-muted': draft.state.value === 'saved',
            }">
              {{ draft.state.value === 'modified' ? 'UNSAVED CHANGES'
                : draft.state.value === 'saving' ? 'SAVING…'
                  : draft.state.value === 'saved' ? 'SAVED' : 'NOT LABELLED' }}
            </span>
          </div>

          <div class="px-5 py-4 space-y-5">
            <!-- Language -->
            <div>
              <p class="label text-fg-faint">LANGUAGE</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in LANGUAGE_VALUES"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.language === v }"
                  @click="draft.choose('language', v)"
                >
                  {{ LANGUAGE_DISPLAY[v] }}
                </button>
              </div>
            </div>

            <!-- Vocal -->
            <div>
              <p class="label text-fg-faint">VOCAL</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in VOCAL_VALUES"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.vocal === v }"
                  @click="draft.choose('vocal', v)"
                >
                  {{ v.toUpperCase() }}
                </button>
              </div>
            </div>

            <!-- Energy: perceived, not measured. -->
            <div>
              <p class="label text-fg-faint">ENERGY · PERCEIVED, NOT FROM LOUDNESS</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in ENERGY_VALUES"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.energy === v }"
                  @click="draft.choose('energy', v)"
                >
                  {{ ENERGY_DISPLAY[v] }}
                </button>
              </div>
            </div>

            <!-- Genre -->
            <div>
              <p class="label text-fg-faint">GENRE · MULTI-SELECT</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in GENRE_SUGGESTIONS"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.genres.includes(v) }"
                  @click="draft.toggle('genres', v)"
                >
                  {{ v.toUpperCase() }}
                </button>
              </div>
            </div>

            <!-- Mood -->
            <div>
              <p class="label text-fg-faint">MOOD · MULTI-SELECT</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in MOOD_VALUES"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.moods.includes(v) }"
                  @click="draft.toggle('moods', v)"
                >
                  {{ v.toUpperCase() }}
                </button>
              </div>
            </div>

            <!-- Contexts -->
            <div>
              <p class="label text-fg-faint">CONTEXT SUITABILITY · MULTI-SELECT</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="v in CONTEXT_VALUES"
                  :key="v"
                  class="sys-btn-outline"
                  :class="{ 'border-fg text-fg': draft.draft.value.contexts.includes(v) }"
                  @click="draft.toggle('contexts', v)"
                >
                  {{ v.toUpperCase() }}
                </button>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <p class="label text-fg-faint">NOTES</p>
              <textarea
                v-model="draft.draft.value.notes"
                rows="2"
                class="mt-2 w-full bg-base border border-line px-3 py-2 text-small text-fg"
                placeholder="Optional reviewer note"
              />
            </div>
          </div>

          <div class="border-t border-line px-5 py-4 flex items-center justify-between gap-3">
            <div class="text-small text-fg-faint">
              <span v-if="selectedQuality">
                {{ selectedQuality.completeness }}% complete
                <span v-if="selectedQuality.issues.length">
                  · missing: {{ selectedQuality.issues.join(', ').toLowerCase().replace(/missing_|incomplete_/g, '') }}
                </span>
              </span>
            </div>
            <button
              class="sys-btn-outline"
              :disabled="!draft.dirty.value || draft.saving.value"
              @click="onSaveLabels"
            >
              SAVE LABELS
            </button>
          </div>

          <p v-if="saveError" class="px-5 pb-4 text-small text-fg-muted">{{ saveError }}</p>
        </section>
      </div>
    </div>
  </div>
</template>
