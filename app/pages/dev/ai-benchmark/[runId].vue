<script setup lang="ts">
// ============================================================
// SYSTEMA — Benchmark run detail (Phase 14, §17)
// ============================================================
// Everything measured in one run, including the raw per-sample rows.
//
// The principle here is that a benchmark you cannot audit is not
// evidence. So this page shows the full reproducibility record, every
// sample outcome with its failure reason, and the confidence label on
// every number — rather than a tidy summary that hides how it was
// produced.
// ============================================================

import { useAiLabStore } from '~/stores/aiLab'
import { getRun, exportRuns, exportFilename } from '~/services/ai-lab/resultStore'
import { evaluateTargets } from '~/services/ai-lab/comparison'
import { getModel } from '~/services/ai-lab/modelRegistry'
import type { BenchmarkRun } from '~/services/ai-lab/types'

definePageMeta({ layout: 'dev' })

const route = useRoute()
const router = useRouter()
const lab = useAiLabStore()

const run = ref<BenchmarkRun | null>(null)

onMounted(() => {
  run.value = getRun(String(route.params.runId))
})

useHead({ title: () => run.value ? `Run — ${run.value.modelName}` : 'Benchmark run' })

const targetRows = computed(() => {
  if (!run.value) return []
  const model = getModel(run.value.modelId)
  return evaluateTargets(run.value, lab.targets, model?.sizeMb ?? null)
})

const failedSamples = computed(() =>
  run.value?.samples.filter(s => s.status !== 'SUCCESS') ?? [])

function envLabel(env: BenchmarkRun['environment']): string {
  if (env === 'DEVICE') return 'DEVICE BENCHMARK'
  if (env === 'SYNTHETIC') return 'SYNTHETIC HARNESS RUN'
  return 'DESKTOP BENCHMARK'
}

function onExport() {
  if (!run.value) return
  const blob = new Blob([exportRuns([run.value])], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename([run.value])
  anchor.click()
  URL.revokeObjectURL(url)
}

function onDelete() {
  if (!run.value) return
  lab.removeRun(run.value.id)
  router.push('/dev/ai-benchmark')
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
        <template v-if="run">
          <h1 class="mt-3 text-[22px] font-bold tracking-tight text-fg">
            {{ run.modelName }}
            <span class="text-fg-muted font-normal">v{{ run.modelVersion }}</span>
          </h1>
          <p class="mt-1 text-small text-fg-muted">
            {{ new Date(run.timestamp).toLocaleString() }} · {{ run.device.label }} ·
            {{ run.runtime }} / {{ run.executionProvider }}
          </p>
        </template>
      </div>
    </header>

    <div v-if="!run" class="sys-container py-12">
      <p class="text-small text-fg-muted">
        This run no longer exists. It may have been cleared, or trimmed when the
        stored-run limit was reached.
      </p>
    </div>

    <div v-else class="sys-container py-8 space-y-8">
      <!-- ---- Environment + status ------------------------ -->
      <LabBanner
        :tone="run.environment === 'DEVICE' ? 'info' : 'warning'"
        :title="envLabel(run.environment)"
      >
        <template v-if="run.environment === 'DESKTOP'">
          Measured in a desktop browser. These timings must not be quoted as device
          performance — desktop CPUs are several times faster and have no meaningful
          thermal ceiling.
        </template>
        <template v-else-if="run.environment === 'SYNTHETIC'">
          This run exercised the reference harness, not a real neural model. It proves
          the measurement pipeline works; it predicts nothing about a real model.
        </template>
        <template v-else>
          Measured on real device hardware: {{ run.device.label }},
          {{ run.device.osVersion }}, {{ run.device.cpuArchitecture }}.
        </template>
      </LabBanner>

      <LabBanner
        v-for="warning in run.warnings"
        :key="warning"
        tone="warning"
        title="RUN WARNING"
      >
        {{ warning }}
      </LabBanner>

      <!-- ---- Performance (§7) --------------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          PERFORMANCE
        </h2>
        <dl class="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
          <LabMetric label="MODEL LOAD" :metric="run.performance.modelLoadMs" unit="ms" />
          <LabMetric label="WARM-UP TOTAL" :metric="run.performance.warmupMs" unit="ms" />
          <LabMetric label="AVERAGE INFERENCE" :metric="run.performance.averageInferenceMs" unit="ms" />
          <LabMetric label="MEDIAN INFERENCE" :metric="run.performance.medianInferenceMs" unit="ms" />
          <LabMetric label="P95 INFERENCE" :metric="run.performance.p95InferenceMs" unit="ms" />
          <LabMetric label="THROUGHPUT" :metric="run.performance.throughputPerSec" unit="/s" />
          <LabMetric label="REAL-TIME FACTOR" :metric="run.performance.realTimeFactor" unit="x" :precision="4" />
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              AUDIO PROCESSED
            </dt>
            <dd class="mt-1 tnum text-[15px] font-bold text-fg">
              {{ run.performance.totalAudioSec.toFixed(1) }}
              <span class="text-small font-normal text-fg-muted">s</span>
            </dd>
          </div>
        </dl>
        <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
          Model load is measured separately from inference and is never included in the
          averages. Warm-up passes ran and were discarded before measurement began.
          Real-time factor below 1.0 means the model processes audio faster than it
          plays.
        </p>
      </section>

      <!-- ---- Memory + CPU ------------------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          MEMORY AND CPU
        </h2>
        <dl class="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
          <LabMetric label="BASELINE" :metric="run.memory.baselineMb" unit="MB" :precision="1" />
          <LabMetric label="PEAK" :metric="run.memory.peakMb" unit="MB" :precision="1" />
          <LabMetric label="DELTA" :metric="run.memory.deltaMb" unit="MB" :precision="1" />
          <LabMetric label="CPU USAGE" :metric="run.cpuUsage" unit="%" />
        </dl>
      </section>

      <!-- ---- Reliability (§7) --------------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          RELIABILITY
        </h2>
        <dl class="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border border-line">
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              STATUS
            </dt>
            <dd
              class="mt-1 text-[13px] font-bold"
              :class="{
                'text-success': run.status === 'SUCCESS',
                'text-warning': run.status === 'PARTIAL_SUCCESS',
                'text-danger': run.status === 'FAILED',
              }"
            >
              {{ run.status.replace('_', ' ') }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              SUCCEEDED
            </dt>
            <dd class="mt-1 tnum text-[15px] font-bold text-fg">
              {{ run.reliability.successfulSamples }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              FAILED
            </dt>
            <dd class="mt-1 tnum text-[15px] font-bold text-fg">
              {{ run.reliability.failedSamples }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              TIMEOUTS
            </dt>
            <dd class="mt-1 tnum text-[15px] font-bold text-fg">
              {{ run.reliability.timeoutCount }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              SUCCESS RATE
            </dt>
            <dd class="mt-1 tnum text-[15px] font-bold text-fg">
              {{ (run.reliability.successRate * 100).toFixed(1) }}%
            </dd>
          </div>
        </dl>
      </section>

      <!-- ---- Quality (§7) ------------------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          EMBEDDING QUALITY SIGNALS
        </h2>
        <dl class="grid sm:grid-cols-3 gap-px bg-line border border-line">
          <LabMetric label="DETERMINISM" :metric="run.quality.determinism" :precision="4" />
          <LabMetric label="MEAN PAIRWISE SIMILARITY" :metric="run.quality.meanPairwiseSimilarity" :precision="4" />
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              NEAREST-NEIGHBOUR SANITY
            </dt>
            <dd class="mt-1 text-[13px] font-bold" :class="run.quality.nearestNeighbourSane === true ? 'text-success' : run.quality.nearestNeighbourSane === false ? 'text-danger' : 'text-fg-faint'">
              {{ run.quality.nearestNeighbourSane === null ? 'NOT TESTED' : run.quality.nearestNeighbourSane ? 'PASS' : 'FAIL' }}
            </dd>
          </div>
        </dl>
        <ul class="mt-2 space-y-1">
          <li
            v-for="note in run.quality.notes"
            :key="note"
            class="text-small text-fg-muted leading-relaxed max-w-[76ch]"
          >
            — {{ note }}
          </li>
        </ul>
        <LabBanner tone="warning" title="NOT AN ACCURACY MEASUREMENT" class="mt-3">
          These figures describe whether embeddings are stable and whether the model
          separates different inputs. They are NOT accuracy: no labelled ground-truth
          dataset exists here, so no accuracy claim is made or implied.
        </LabBanner>
      </section>

      <!-- ---- Targets (§29) ------------------------------ -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          REFERENCE TARGETS
        </h2>
        <div class="border border-line overflow-x-auto">
          <table class="w-full text-small">
            <thead class="bg-surface border-b border-line">
              <tr>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  METRIC
                </th>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  TARGET
                </th>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  ACTUAL
                </th>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  VERDICT
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="row in targetRows" :key="row.metric" class="bg-surface">
                <td class="px-4 py-2 text-fg">
                  {{ row.metric }}
                </td>
                <td class="px-4 py-2 tnum text-fg-muted">
                  {{ row.target }}
                </td>
                <td class="px-4 py-2 tnum text-fg-muted">
                  {{ row.actual }}
                </td>
                <td
                  class="px-4 py-2 label"
                  :class="{
                    'text-success': row.verdict === 'MEETS',
                    'text-danger': row.verdict === 'MISSES',
                    'text-fg-faint': row.verdict === 'UNKNOWN',
                  }"
                >
                  {{ row.verdict }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
          Targets are configurable discussion aids, not pass/fail gates. UNKNOWN means
          the metric was not measured with enough confidence to judge — an estimated
          value is never used to declare a target met.
        </p>
      </section>

      <!-- ---- Failures (§25) ----------------------------- -->
      <section v-if="failedSamples.length">
        <h2 class="label text-fg-muted mb-3">
          FAILURES ({{ failedSamples.length }})
        </h2>
        <div class="border border-line divide-y divide-line">
          <div
            v-for="sample in failedSamples"
            :key="sample.sampleId"
            class="bg-surface px-4 py-3"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-small font-bold text-fg">
                {{ sample.sampleId }}
              </p>
              <span class="label text-danger">{{ sample.status }}</span>
            </div>
            <p class="mt-1 text-small text-fg-muted leading-relaxed">
              <span class="text-fg-faint">{{ sample.errorCode }}</span>
              — {{ sample.errorMessage }}
            </p>
          </div>
        </div>
        <p class="mt-2 text-small text-fg-faint leading-relaxed max-w-[76ch]">
          A failed sample does not abort the run: the remaining samples still execute
          and the run completes as a partial success, with averages covering only what
          succeeded.
        </p>
      </section>

      <!-- ---- Raw per-sample data (§19) ------------------ -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          RAW SAMPLE DATA
        </h2>
        <div class="border border-line overflow-x-auto">
          <table class="w-full text-small">
            <thead class="bg-surface border-b border-line">
              <tr>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  SAMPLE
                </th>
                <th class="text-left px-4 py-2 label text-fg-muted">
                  STATUS
                </th>
                <th class="text-right px-4 py-2 label text-fg-muted">
                  MS
                </th>
                <th class="text-right px-4 py-2 label text-fg-muted">
                  AUDIO S
                </th>
                <th class="text-right px-4 py-2 label text-fg-muted">
                  DIM
                </th>
                <th class="text-right px-4 py-2 label text-fg-muted">
                  L2 NORM
                </th>
                <th class="text-right px-4 py-2 label text-fg-muted">
                  FINITE
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="sample in run.samples" :key="sample.sampleId" class="bg-surface">
                <td class="px-4 py-2 text-fg truncate max-w-[220px]">
                  {{ sample.sampleId }}
                </td>
                <td
                  class="px-4 py-2 label"
                  :class="sample.status === 'SUCCESS' ? 'text-success' : 'text-danger'"
                >
                  {{ sample.status }}
                </td>
                <td class="px-4 py-2 text-right tnum text-fg-muted">
                  {{ sample.inferenceMs?.toFixed(2) ?? '—' }}
                </td>
                <td class="px-4 py-2 text-right tnum text-fg-muted">
                  {{ sample.audioSec.toFixed(1) }}
                </td>
                <td class="px-4 py-2 text-right tnum text-fg-muted">
                  {{ sample.embeddingStats?.dimension ?? '—' }}
                </td>
                <td class="px-4 py-2 text-right tnum text-fg-muted">
                  {{ sample.embeddingStats?.l2Norm.toFixed(4) ?? '—' }}
                </td>
                <td class="px-4 py-2 text-right label" :class="sample.embeddingStats?.hasNonFinite ? 'text-danger' : 'text-fg-muted'">
                  {{ sample.embeddingStats ? (sample.embeddingStats.hasNonFinite ? 'NO' : 'YES') : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ---- Reproducibility (§12) ---------------------- -->
      <section>
        <h2 class="label text-fg-muted mb-3">
          REPRODUCIBILITY RECORD
        </h2>
        <dl class="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line">
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              DATASET
            </dt>
            <dd class="mt-1 text-small text-fg break-all">
              {{ run.reproducibility.datasetId }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              CHECKSUM
            </dt>
            <dd class="mt-1 text-small text-fg break-all">
              {{ run.reproducibility.modelChecksum ?? 'not recorded' }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              HARNESS VERSION
            </dt>
            <dd class="mt-1 tnum text-small text-fg">
              {{ run.reproducibility.harnessVersion }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              WARM-UP / REPEATS
            </dt>
            <dd class="mt-1 tnum text-small text-fg">
              {{ run.reproducibility.warmupRuns }} / {{ run.reproducibility.measuredRuns }}
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              SAMPLE RATE / WINDOW
            </dt>
            <dd class="mt-1 tnum text-small text-fg">
              {{ run.reproducibility.preprocessing.sampleRate }} Hz /
              {{ run.reproducibility.preprocessing.windowSec }} s
            </dd>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="label text-fg-muted">
              NORMALISATION / AGGREGATION
            </dt>
            <dd class="mt-1 text-small text-fg">
              {{ run.reproducibility.preprocessing.normalization }} /
              {{ run.reproducibility.preprocessing.aggregation }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- ---- Actions ------------------------------------ -->
      <div class="flex flex-wrap gap-2 pt-2">
        <button type="button" class="sys-btn-outline" @click="onExport">
          EXPORT THIS RUN
        </button>
        <button type="button" class="sys-btn-ghost" @click="onDelete">
          DELETE RUN
        </button>
      </div>
    </div>
  </div>
</template>
