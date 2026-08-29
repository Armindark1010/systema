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
import type { SemanticAnalysis } from '~/services/ai-dataset/semanticRecord'
import { topFor, topNFor } from '~/services/ai-dataset/semanticRecord'
import {
  MOOD_LABEL_MAPPING,
  VOCAL_LABEL_MAPPING,
  computeCoverage,
  evaluateField,
} from '~/services/ai-dataset/semanticEvaluation'
import { exportToDevice } from '~/services/ai-dataset/nativeGateway'
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
async function downloadText(name: string, text: string, mime: string) {
  // Prefer shared device storage: that file outlives an uninstall,
  // which is the only way this dataset survives a reinstall.
  const device = await exportToDevice(name, text, mime)
  if (device?.ok) {
    exportNote.value = `Saved to ${device.path} (${device.bytes} bytes)`
    return
  }
  if (device && !device.ok) {
    exportNote.value = device.error ?? 'The export failed.'
    return
  }

  // No device bridge (web build): fall back to a browser download.
  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    exportNote.value = `Downloaded ${name}`
  } catch (e) {
    exportNote.value = (e as Error)?.message ?? 'The export failed.'
  }
}

async function onExportJson() {
  const rows = await allRecords()
  await downloadText(
    `systema-dataset-${Date.now()}.json`,
    exportJson(rows, true),
    'application/json',
  )
}

async function onExportCsv() {
  const rows = await allRecords()
  await downloadText(`systema-dataset-${Date.now()}.csv`, exportCsv(rows), 'text/csv')
}

const selectedQuality = computed(() =>
  selected.value ? dataset.quality(selected.value) : null)

/**
 * Model-vs-human evaluation.
 *
 * Reads from every record, not the current page, because a metric
 * computed over one page of 25 would change as you paginate.
 */
const semanticOf = (r: DatasetRecord) => r.semantic
const moodEval = computed(() =>
  evaluateField(dataset.allRows.value, semanticOf, MOOD_LABEL_MAPPING))
const vocalEval = computed(() =>
  evaluateField(dataset.allRows.value, semanticOf, VOCAL_LABEL_MAPPING))
const moodCoverage = computed(() =>
  computeCoverage(dataset.allRows.value, semanticOf, MOOD_LABEL_MAPPING))
const vocalCoverage = computed(() =>
  computeCoverage(dataset.allRows.value, semanticOf, VOCAL_LABEL_MAPPING))

/** Paired metric + coverage per evaluated field, for the panel. */
const evaluations = computed(() => [
  { k: 'Mood', e: moodEval.value, c: moodCoverage.value },
  { k: 'Vocal / Instrumental', e: vocalEval.value, c: vocalCoverage.value },
])

/**
 * The prediction fields shown as table columns, in §9's order.
 *
 * `tags` is included even though no usable tagging head exists today:
 * the column renders "n/a", which is the honest state. Hiding it would
 * make a missing capability invisible.
 */
const SEMANTIC_COLUMNS = ['mood', 'genre', 'tags', 'vocalInstrumental'] as const

/**
 * Highest score the model emitted for a track, across all heads.
 *
 * Deliberately a max and not a mean: averaging 56 mostly-near-zero
 * sigmoid outputs would produce a number that looks like a confidence
 * and means nothing.
 */
function peakConfidence(s: SemanticAnalysis): number | null {
  let best: number | null = null
  for (const h of s.heads) {
    for (const p of h.predictions) {
      if (best === null || p.score > best) best = p.score
    }
  }
  return best
}

/** Rows carrying any model prediction. */
const semanticCount = computed(() =>
  dataset.allRows.value.filter(r => r.semantic !== null).length)

function pct(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH
  return `${(v * 100).toFixed(1)}%`
}

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
        v-if="dataset.unavailableReason.value"
        class="border border-line bg-surface px-5 py-4"
      >
        <p class="label text-fg-muted">PERSISTENCE UNAVAILABLE</p>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          {{ dataset.unavailableReason.value }}
          This is a device build, so the dataset database was expected and is
          missing. Saving is disabled rather than accepted and discarded — any
          labels entered now would be lost. Check that
          <span class="tnum">registerPlugin(AiDatasetPlugin.class)</span> runs
          in MainActivity, then reinstall.
        </p>
      </div>

      <div
        v-else-if="!dataset.durable.value"
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
          <p class="label text-fg-muted">MODEL EVALUATION</p>
          <p class="mt-2 text-small text-fg-muted max-w-[80ch] leading-relaxed">
            Model predictions scored against human labels. Multi-label fields
            use per-example precision/recall/F1, not accuracy: on 56 mostly-absent
            mood tags a model that predicts nothing would score about 95%
            accuracy and have learned nothing.
          </p>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div
              v-for="ev in evaluations"
              :key="ev.k"
              class="border border-line px-4 py-3"
            >
              <p class="label text-fg-muted">{{ ev.k }}</p>

              <p class="mt-1 text-small text-fg-faint tnum">
                {{ ev.c.analysed }} analysed ·
                {{ ev.c.labelled }} labelled ·
                {{ ev.c.evaluable }} evaluable ·
                coverage {{ pct(ev.c.coverage) }}
              </p>

              <p
                v-if="ev.e.kind === 'insufficient'"
                class="mt-2 text-small text-fg-muted"
              >
                {{ ev.e.message }}
                ({{ ev.e.samples }}/{{ ev.e.required }})
              </p>

              <div v-else-if="ev.e.kind === 'multi-label'" class="mt-2 text-small tnum">
                <p>Precision {{ pct(ev.e.precision) }}</p>
                <p>Recall {{ pct(ev.e.recall) }}</p>
                <p>F1 {{ pct(ev.e.f1) }}</p>
                <p>Top-1 hit {{ pct(ev.e.topOneHit) }}</p>
                <p>Top-3 hit {{ pct(ev.e.topThreeHit) }}</p>
                <p class="text-fg-faint">
                  n={{ ev.e.samples }} · threshold {{ ev.e.threshold }}
                </p>
              </div>

              <div v-else class="mt-2 text-small tnum">
                <p>Top-1 accuracy {{ pct(ev.e.topOneAccuracy) }}</p>
                <p class="text-fg-faint">n={{ ev.e.samples }}</p>

                <!-- Confusion breakdown. Only meaningful for a
                     mutually-exclusive head, which is why it appears
                     here and not in the multi-label branch. Shows where
                     the model over- and under-predicts, which a single
                     accuracy figure hides entirely. -->
                <table class="mt-3 w-full text-small">
                  <thead>
                    <tr class="text-fg-faint border-b border-line">
                      <th class="text-left font-normal py-1">Class</th>
                      <th class="text-right font-normal py-1">Actual</th>
                      <th class="text-right font-normal py-1">Predicted</th>
                      <th class="text-right font-normal py-1">Correct</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(c, label) in ev.e.confusion"
                      :key="label"
                      class="border-b border-line/50"
                    >
                      <td class="py-1 text-fg">{{ label }}</td>
                      <td class="py-1 text-right text-fg-muted">{{ c.actual }}</td>
                      <td class="py-1 text-right text-fg-muted">{{ c.predicted }}</td>
                      <td class="py-1 text-right text-fg-muted">{{ c.correct }}</td>
                    </tr>
                  </tbody>
                </table>
                <p class="mt-1 text-fg-faint">
                  Predicted much higher than actual means the model
                  over-applies that class.
                </p>
              </div>
            </div>
          </div>

          <p class="mt-3 text-small text-fg-faint max-w-[80ch] leading-relaxed">
            Human labels are mapped onto the model's own vocabulary before
            comparison. Unmappable labels
            ({{ MOOD_LABEL_MAPPING.unmappable.join(', ') }}) are excluded rather
            than counted as misses — the model has no equivalent tag for them.
          </p>
        </div>

        <div class="border border-line bg-surface px-5 py-4">
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
              <!-- Provenance banding. The single most important thing this
                   table communicates is WHICH VALUES A HUMAN WROTE. Column
                   names alone were not enough once model columns appeared
                   next to identically-named human ones. -->
              <tr class="border-b border-line text-fg-faint">
                <th class="px-4 py-2" />
                <th class="text-left font-normal px-4 py-2 label" colspan="6">
                  HUMAN LABELS
                </th>
                <th
                  class="text-left font-normal px-4 py-2 label bg-base/40 border-x border-line"
                  colspan="6"
                >
                  MODEL PREDICTION · EXPERIMENTAL
                </th>
                <th class="px-4 py-2" colspan="5" />
              </tr>
              <tr class="border-b border-line text-fg-faint">
                <th class="text-left font-normal px-4 py-2">Track</th>
                <th class="text-left font-normal px-4 py-2">Language</th>
                <th class="text-left font-normal px-4 py-2">Genre</th>
                <th class="text-left font-normal px-4 py-2">Mood</th>
                <th class="text-left font-normal px-4 py-2">Vocal</th>
                <th class="text-left font-normal px-4 py-2">Energy</th>
                <th class="text-left font-normal px-4 py-2">Contexts</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40 border-l border-line">Model</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40">Mood</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40">Genre</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40">Tags</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40">Vocal</th>
                <th class="text-left font-normal px-4 py-2 bg-base/40 border-r border-line">Confidence</th>
                <th class="text-left font-normal px-4 py-2">Analysis</th>
                <th class="text-left font-normal px-4 py-2">Embedding</th>
                <th class="text-left font-normal px-4 py-2">Complete</th>
                <th class="text-left font-normal px-4 py-2">Updated</th>
                <th class="text-left font-normal px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-if="dataset.loading.value">
                <td colspan="18" class="px-4 py-6 text-fg-faint">Loading…</td>
              </tr>
              <tr v-else-if="!dataset.rows.value.length">
                <td colspan="18" class="px-4 py-6 text-fg-faint">
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
                <!-- MODEL region. Banded background, top-1 per field.
                     A field the model cannot produce shows an explicit
                     "n/a" rather than a dash, so "no prediction" and
                     "cannot predict" stay distinguishable. -->
                <td class="px-4 py-3 text-fg-muted bg-base/40 border-l border-line">
                  <template v-if="r.semantic">
                    <span class="text-fg-muted">{{ r.semantic.model }}</span>
                    <span class="block text-fg-faint tnum">v{{ r.semantic.modelVersion }}</span>
                  </template>
                  <span v-else>{{ DASH }}</span>
                </td>
                <td
                  v-for="f in SEMANTIC_COLUMNS"
                  :key="f"
                  class="px-4 py-3 text-fg-muted bg-base/40"
                >
                  <template v-if="r.semantic">
                    <template v-if="topFor(r.semantic, f)">
                      <span class="text-fg">{{ topFor(r.semantic, f)?.label }}</span>
                      <span class="block text-fg-faint tnum">
                        {{ pct(topFor(r.semantic, f)?.score) }}
                      </span>
                    </template>
                    <span v-else class="text-fg-faint" title="This model has no head for this field">
                      n/a
                    </span>
                  </template>
                  <span v-else>{{ DASH }}</span>
                </td>
                <!-- Confidence = the strongest score the model emitted for
                     this track across every head. A summary, never a
                     substitute for the per-field scores beside it. -->
                <td class="px-4 py-3 text-fg-muted tnum bg-base/40 border-r border-line">
                  {{ r.semantic ? pct(peakConfidence(r.semantic)) : DASH }}
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

        <!-- MODEL PREDICTIONS. Complete ranked output, not a top-k
             slice: this view is the evaluation surface. -->
        <section v-if="selected.semantic" class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center gap-3 flex-wrap">
            <p class="label text-fg-muted">SEMANTIC PREDICTION · MODEL OUTPUT</p>
            <span class="label text-fg-faint">EXPERIMENTAL</span>
          </div>

          <div class="px-5 py-4">
            <p class="text-small text-fg-muted max-w-[80ch] leading-relaxed">
              Produced by a model, not by a human. These values are never
              treated as ground truth and are never copied into the labels
              below. Scores are the model's raw output, uncalibrated.
            </p>

            <p class="mt-3 text-small text-fg-faint tnum">
              {{ selected.semantic.model }} v{{ selected.semantic.modelVersion }}
              · analyzer v{{ selected.semantic.analyzerVersion }}
              · {{ selected.semantic.sampleRate ?? DASH }} Hz
              · {{ selected.semantic.inferenceMs ?? DASH }} ms
              · {{ selected.semantic.analyzedAt }}
            </p>

            <div
              v-for="h in selected.semantic.heads"
              :key="h.head"
              class="mt-4 border border-line"
            >
              <div class="border-b border-line px-4 py-2 flex justify-between gap-3 flex-wrap">
                <span class="label text-fg-muted">{{ h.field }}</span>
                <span class="text-small text-fg-faint tnum">
                  {{ h.head }} v{{ h.headVersion }} ·
                  {{ h.activation }} ·
                  {{ h.multiLabel ? 'multi-label' : 'single-label' }} ·
                  {{ h.classCount }} classes
                </span>
              </div>

              <div class="px-4 py-3">
                <p class="label text-fg-faint">TOP 10</p>
                <div
                  v-for="p in topNFor(selected.semantic, h.field, 10)"
                  :key="`${h.head}-${p.label}`"
                  class="flex justify-between gap-4 py-1 text-small"
                >
                  <span class="text-fg">{{ p.label }}</span>
                  <span class="text-fg-muted tnum">{{ pct(p.score) }}</span>
                </div>

                <!-- The complete list, for debugging and evaluation.
                     Collapsed because 56 rows is unreadable by default,
                     present because the tail is the data. -->
                <details class="mt-3">
                  <summary class="text-small text-fg-muted cursor-pointer">
                    Raw output — all {{ h.predictions.length }} classes
                  </summary>
                  <div
                    v-for="p in h.predictions"
                    :key="`raw-${h.head}-${p.label}`"
                    class="flex justify-between gap-4 py-0.5 text-small"
                  >
                    <span class="text-fg-muted">{{ p.label }}</span>
                    <span class="text-fg-faint tnum">{{ p.score.toFixed(6) }}</span>
                  </div>
                </details>
              </div>
            </div>

            <details
              v-if="selected.semantic.unsupported.length"
              class="mt-4"
            >
              <summary class="text-small text-fg-muted cursor-pointer">
                Fields this model cannot produce
                ({{ selected.semantic.unsupported.length }})
              </summary>
              <ul class="mt-2 text-small text-fg-faint leading-relaxed">
                <li v-for="u in selected.semantic.unsupported" :key="u.field">
                  <strong class="text-fg-muted">{{ u.field }}</strong> — {{ u.reason }}
                </li>
              </ul>
            </details>
          </div>
        </section>

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
              :disabled="!draft.dirty.value || draft.saving.value || !!dataset.unavailableReason.value"
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
