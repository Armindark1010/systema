<script setup lang="ts">
// ============================================================
// SYSTEMA — Benchmark comparison view (Phase 14, §17)
// ============================================================
// Places selected runs side by side — but only after stating whether
// that comparison is legitimate.
//
// Compatibility is rendered FIRST, above the table, because a
// side-by-side layout implies equivalence to the reader whether or
// not it exists. When runs differ in dataset, preprocessing or
// environment, the blockers are shown and the table is explicitly
// marked as not a fair comparison rather than being hidden — the
// underlying data is still real and worth inspecting.
//
// Note this route is a static sibling of [runId].vue; Nuxt resolves
// static segments before dynamic ones, so /compare never matches a
// run id.
// ============================================================

import { useAiLabStore } from '~/stores/aiLab'
import { assessCompatibility, buildRecommendations } from '~/services/ai-lab/comparison'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Benchmark comparison' })

const lab = useAiLabStore()
const router = useRouter()

onMounted(() => lab.refresh())

const runs = computed(() => lab.comparisonRuns)
const compatibility = computed(() => assessCompatibility(runs.value))
const recommendations = computed(() => buildRecommendations(runs.value))

/** The metric rows. Each cell keeps its own confidence labelling. */
const rows = computed(() => {
  const list = runs.value
  if (list.length === 0) return []

  const fmt = (value: number | null, digits = 2, suffix = '') =>
    value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits) + suffix

  return [
    {
      label: 'Environment',
      values: list.map(r => r.environment),
      emphasise: new Set(list.map(r => r.environment)).size > 1,
    },
    {
      label: 'Execution provider',
      values: list.map(r => r.executionProvider.toUpperCase()),
      emphasise: false,
    },
    {
      label: 'Dataset',
      values: list.map(r => r.datasetId),
      emphasise: new Set(list.map(r => r.datasetId)).size > 1,
    },
    {
      label: 'Model load (ms)',
      values: list.map(r => fmt(r.performance.modelLoadMs.value)),
      emphasise: false,
    },
    {
      label: 'Median inference (ms)',
      values: list.map(r => fmt(r.performance.medianInferenceMs.value)),
      emphasise: false,
    },
    {
      label: 'P95 inference (ms)',
      values: list.map(r => fmt(r.performance.p95InferenceMs.value)),
      emphasise: false,
    },
    {
      label: 'Real-time factor',
      values: list.map(r => fmt(r.performance.realTimeFactor.value, 4)),
      emphasise: false,
    },
    {
      label: 'Peak memory (MB)',
      values: list.map(r =>
        `${fmt(r.memory.peakMb.value, 1)} (${r.memory.peakMb.confidence.toLowerCase()})`),
      emphasise: false,
    },
    {
      label: 'Success rate',
      values: list.map(r => `${(r.reliability.successRate * 100).toFixed(1)}%`),
      emphasise: false,
    },
    {
      label: 'Determinism',
      values: list.map(r => fmt(r.quality.determinism.value, 4)),
      emphasise: false,
    },
    {
      label: 'Mean pairwise similarity',
      values: list.map(r => fmt(r.quality.meanPairwiseSimilarity.value, 4)),
      emphasise: false,
    },
    {
      label: 'Embedding dimension',
      values: list.map(r =>
        String(r.samples.find(s => s.embeddingStats)?.embeddingStats?.dimension ?? '—')),
      emphasise: false,
    },
  ]
})

function onExport() {
  const { filename, content } = lab.exportAsJson(runs.value)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-line bg-surface">
      <div class="sys-container py-6">
        <button
          type="button"
          class="label text-fg-muted hover:text-fg t-col"
          @click="router.push('/dev/ai-benchmark')"
        >
          ← BENCHMARK LAB
        </button>
        <h1 class="mt-3 text-[22px] font-bold tracking-tight text-fg">
          Run comparison
        </h1>
        <p class="mt-1 text-small text-fg-muted">
          {{ runs.length }} run(s) selected
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <div v-if="runs.length < 2" class="border border-line bg-surface px-5 py-8">
        <p class="text-small text-fg-muted">
          Select at least two runs from the lab to compare them.
        </p>
      </div>

      <template v-else>
        <!-- ---- Compatibility verdict FIRST (§12) --------- -->
        <LabBanner
          v-if="compatibility.level === 'NOT_COMPARABLE'"
          tone="danger"
          title="THESE RUNS ARE NOT DIRECTLY COMPARABLE"
        >
          <p class="mb-2">
            The data below is real, but the runs measured different things. Reading a
            winner out of this table would be wrong.
          </p>
          <ul class="space-y-1">
            <li v-for="blocker in compatibility.blockers" :key="blocker">
              — {{ blocker }}
            </li>
          </ul>
        </LabBanner>

        <LabBanner
          v-else-if="compatibility.level === 'CAVEATED'"
          tone="warning"
          title="COMPARABLE, WITH CAVEATS"
        >
          <ul class="space-y-1">
            <li v-for="caveat in compatibility.caveats" :key="caveat">
              — {{ caveat }}
            </li>
          </ul>
        </LabBanner>

        <LabBanner v-else tone="info" title="DIRECTLY COMPARABLE">
          These runs share a dataset, preprocessing configuration, environment and
          harness version, so their numbers can be read against each other.
        </LabBanner>

        <!-- ---- Comparison table -------------------------- -->
        <section class="overflow-x-auto border border-line">
          <table class="w-full text-small">
            <thead class="bg-surface border-b border-line">
              <tr>
                <th class="text-left px-4 py-3 label text-fg-muted sticky left-0 bg-surface">
                  METRIC
                </th>
                <th
                  v-for="run in runs"
                  :key="run.id"
                  class="text-left px-4 py-3"
                >
                  <span class="block label text-fg">{{ run.modelName }}</span>
                  <span class="block mt-0.5 text-small font-normal text-fg-muted">
                    v{{ run.modelVersion }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="row in rows" :key="row.label" class="bg-surface">
                <td
                  class="px-4 py-2.5 text-fg-muted sticky left-0 bg-surface"
                  :class="row.emphasise ? 'text-warning font-semibold' : ''"
                >
                  {{ row.label }}
                </td>
                <td
                  v-for="(value, index) in row.values"
                  :key="index"
                  class="px-4 py-2.5 tnum text-fg"
                  :class="row.emphasise ? 'text-warning' : ''"
                >
                  {{ value }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <p class="text-small text-fg-faint leading-relaxed max-w-[76ch]">
          Rows highlighted in amber differ across runs in a way that affects
          interpretation. There is no aggregate score column: any weighting between
          latency, memory and embedding quality would be an invented number, so the
          metrics are presented separately and left to human judgement.
        </p>

        <!-- ---- Advisory recommendations ------------------ -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              ADVISORY — PER-METRIC LEADERS
            </p>
          </div>
          <div class="divide-y divide-line">
            <div v-for="rec in recommendations" :key="rec.category" class="px-5 py-3">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="label text-fg">
                  {{ rec.label }}
                </p>
                <p class="text-small text-fg-muted">
                  {{ rec.modelId ?? 'no candidate' }}
                </p>
              </div>
              <p class="mt-1 text-small text-fg-muted leading-relaxed max-w-[76ch]">
                {{ rec.reason }}
              </p>
              <p class="mt-1 text-small text-fg-faint">
                Basis: {{ rec.basis }}
              </p>
            </div>
          </div>
        </section>

        <LabBanner
          v-if="compatibility.level === 'NOT_COMPARABLE'"
          tone="danger"
          title="ADVISORY SUPPRESSED IN SPIRIT"
        >
          The leaders above are computed mechanically from whatever runs were selected.
          Because these runs are not comparable, treat those rankings as meaningless
          until the configurations are aligned.
        </LabBanner>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="sys-btn-outline" @click="onExport">
            EXPORT COMPARISON
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
