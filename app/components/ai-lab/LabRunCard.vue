<script setup lang="ts">
// ============================================================
// LabRunCard — one benchmark run in the history list
// ============================================================
// Carries the four facts needed to judge whether a run is worth
// opening: which model, where it ran, whether it succeeded, and the
// headline latency. The environment badge is never omitted.
// ============================================================

import type { BenchmarkRun } from '~/services/ai-lab/types'

defineProps<{
  run: BenchmarkRun
  selected?: boolean
}>()

defineEmits<{
  open: []
  toggleCompare: []
}>()

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function statusTone(status: BenchmarkRun['status']): string {
  if (status === 'SUCCESS') return 'text-success'
  if (status === 'PARTIAL_SUCCESS') return 'text-warning'
  return 'text-danger'
}

function envTone(env: BenchmarkRun['environment']): string {
  if (env === 'DEVICE') return 'text-success'
  if (env === 'SYNTHETIC') return 'text-fg-faint'
  return 'text-warning'
}

function envLabel(env: BenchmarkRun['environment']): string {
  if (env === 'DEVICE') return 'DEVICE BENCHMARK'
  if (env === 'SYNTHETIC') return 'SYNTHETIC HARNESS'
  return 'DESKTOP BENCHMARK'
}
</script>

<template>
  <div
    class="border border-line bg-surface"
    :class="selected ? 'border-primary' : ''"
  >
    <div class="px-4 py-3 flex items-start justify-between gap-3">
      <button
        type="button"
        class="text-left flex-1 min-w-0"
        @click="$emit('open')"
      >
        <p class="text-[13px] font-bold text-fg truncate">
          {{ run.modelName }}
          <span class="text-fg-muted font-normal">v{{ run.modelVersion }}</span>
        </p>
        <p class="mt-0.5 text-small text-fg-muted">
          {{ formatTime(run.timestamp) }} · {{ run.device.label }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="label" :class="envTone(run.environment)">
            {{ envLabel(run.environment) }}
          </span>
          <span class="label" :class="statusTone(run.status)">
            {{ run.status.replace('_', ' ') }}
          </span>
          <span class="label text-fg-muted">
            {{ run.executionProvider.toUpperCase() }}
          </span>
        </div>
      </button>

      <div class="text-right shrink-0">
        <p class="tnum text-[15px] font-bold text-fg">
          {{ run.performance.medianInferenceMs.value?.toFixed(1) ?? '—' }}
        </p>
        <p class="label text-fg-muted">
          MS MEDIAN
        </p>
        <p class="mt-1 tnum text-small text-fg-muted">
          {{ run.reliability.successfulSamples }}/{{ run.sampleCount }} ok
        </p>
      </div>
    </div>

    <div class="border-t border-line px-4 py-2 flex items-center justify-between">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          :checked="selected"
          class="accent-primary"
          @change="$emit('toggleCompare')"
        >
        <span class="label text-fg-muted">COMPARE</span>
      </label>
      <button
        type="button"
        class="label text-fg-muted hover:text-fg t-col"
        @click="$emit('open')"
      >
        INSPECT →
      </button>
    </div>
  </div>
</template>
