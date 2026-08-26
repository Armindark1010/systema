<script setup lang="ts">
// ============================================================
// LabMetric — one measurement with its confidence
// ============================================================
// Every number in the lab renders through this component, which is
// how §7's labelling requirement is enforced structurally rather than
// by remembering to add a caveat each time.
//
// A MEASURED value shows plainly. An ESTIMATED one is visibly marked.
// UNKNOWN and NOT_APPLICABLE show the reason instead of a number, so
// a missing measurement can never be mistaken for a zero.
// ============================================================

import type { Metric } from '~/services/ai-lab/types'

const props = withDefaults(defineProps<{
  label: string
  metric: Metric
  unit?: string
  /** Decimal places for a measured value. */
  precision?: number
}>(), {
  unit: '',
  precision: 2,
})

const display = computed(() => {
  if (props.metric.value === null || !Number.isFinite(props.metric.value)) return '—'
  return props.metric.value.toFixed(props.precision)
})

const isReal = computed(() => props.metric.confidence === 'MEASURED')

const badgeClass = computed(() => {
  switch (props.metric.confidence) {
    case 'MEASURED': return 'text-fg'
    case 'ESTIMATED': return 'text-warning'
    default: return 'text-fg-faint'
  }
})
</script>

<template>
  <div class="bg-surface px-4 py-3">
    <dt class="label text-fg-muted">
      {{ label }}
    </dt>
    <dd class="mt-1 flex items-baseline gap-1.5">
      <span
        class="tnum text-[15px] font-bold"
        :class="isReal ? 'text-fg' : 'text-fg-faint'"
      >{{ display }}</span>
      <span v-if="unit && metric.value !== null" class="text-small text-fg-muted">{{ unit }}</span>
    </dd>
    <p
      v-if="metric.confidence !== 'MEASURED'"
      class="mt-1 text-micro font-semibold uppercase tracking-[0.12em]"
      :class="badgeClass"
    >
      {{ metric.confidence.replace('_', ' ') }}
    </p>
    <p v-if="metric.note" class="mt-1 text-small text-fg-faint leading-snug">
      {{ metric.note }}
    </p>
  </div>
</template>
