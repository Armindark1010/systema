<script setup lang="ts">
/**
 * Threshold sweep and distribution analysis (Phase 21.4).
 *
 * Reads pair results that ALREADY EXIST — either the pairs held live
 * from the current run, or a previously exported report JSON — and
 * reports where cosine does or does not separate SIMILAR from
 * DIFFERENT.
 *
 * It runs nothing. No model, no audio, no inference, no embeddings.
 *
 * It also does not CHOOSE anything: it reports candidate thresholds and
 * marks the ones that are artefacts. Selecting a production threshold
 * is a human decision on more data than this.
 */
import { computed, ref } from 'vue'

import {
  type AnalysablePair,
  type ThresholdPick,
  type ThresholdRow,
  analyseThresholds,
  assessSignal,
  formatRange,
} from '~/services/ai-lab/thresholdAnalysis'

const props = defineProps<{
  /** Pairs from the current run, already mapped to label + cosine. */
  pairs: readonly AnalysablePair[]
}>()

/** Pairs loaded from an exported report, when the live run is gone. */
const imported = ref<AnalysablePair[] | null>(null)
const importNote = ref('')
const importError = ref('')
const showAllRows = ref(false)

/**
 * Live pairs win when present. A completed run in front of the user is
 * the more trustworthy source; an import is the fallback for when the
 * page has been reloaded since.
 */
const activePairs = computed<readonly AnalysablePair[]>(() =>
  props.pairs.length > 0 ? props.pairs : (imported.value ?? []),
)

const sourceLabel = computed(() => {
  if (props.pairs.length > 0) return `live run (${props.pairs.length} scored pairs)`
  if (imported.value) return `imported report (${imported.value.length} scored pairs)`
  return 'no data'
})

const analysis = computed(() => analyseThresholds(activePairs.value))
const signal = computed(() => assessSignal(analysis.value))

const hasData = computed(() => activePairs.value.length > 0)

/** Rows worth showing: every 0.05 by default, all 101 on request. */
const visibleRows = computed<ThresholdRow[]>(() => {
  const rows = analysis.value.sweep
  if (showAllRows.value) return rows
  return rows.filter(r => Math.round(r.threshold * 100) % 5 === 0)
})

const picks = computed(() => {
  const p = analysis.value.picks
  return [
    { key: 'f1', title: 'Best F1', pick: p.bestF1 },
    { key: 'balance', title: 'Best precision/recall balance', pick: p.bestBalance },
    { key: 'precision', title: 'Highest precision', pick: p.highestPrecision },
    { key: 'recall', title: 'Highest recall', pick: p.highestRecall },
  ]
})

const classRows = computed(() => {
  const a = analysis.value
  return [a.sameStats, a.similarStats, a.differentStats]
})

function n(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}
function pct(v: number, digits = 1): string {
  return Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
}

/** Highlights the best-F1 row in the sweep table. */
const bestF1Threshold = computed(() => analysis.value.picks.bestF1.row?.threshold ?? null)

function pickSummary(p: ThresholdPick): string {
  if (!p.row) return 'Not available on this data.'
  const r = p.row
  return `cosine ≥ ${r.threshold.toFixed(2)} · P ${n(r.precision)} · R ${n(r.recall)} · F1 ${n(r.f1)} · Acc ${n(r.accuracy)}`
}

/** Answers A–E, derived rather than written by hand. */
const answers = computed(() => {
  const a = analysis.value
  if (!a.analysable) {
    return [
      { q: 'A) What cosine range usually represents SIMILAR?', a: 'Not answerable: no usable SIMILAR/DIFFERENT split in this data.' },
      { q: 'B) What cosine range usually represents DIFFERENT?', a: 'Not answerable.' },
      { q: 'C) Where is the strongest practical threshold?', a: 'Not answerable.' },
      { q: 'D) How much do SIMILAR and DIFFERENT overlap?', a: 'Not answerable.' },
      { q: 'E) Is the signal strong enough to continue with this model?', a: signal.value.summary },
    ]
  }
  const f1 = a.picks.bestF1.row
  const beatsMajority = Number.isFinite(a.overlap.bestAccuracy)
    && a.overlap.bestAccuracy > a.overlap.majorityClassAccuracy

  return [
    {
      q: 'A) What cosine range usually represents SIMILAR?',
      a: `Middle half (P25–P75): ${formatRange(a.similarRange.interquartile)}. `
        + `Central 80% (P10–P90): ${formatRange(a.similarRange.centralEighty)}. `
        + `Full observed range: ${formatRange(a.similarRange.full)}.`,
    },
    {
      q: 'B) What cosine range usually represents DIFFERENT?',
      a: `Middle half (P25–P75): ${formatRange(a.differentRange.interquartile)}. `
        + `Central 80% (P10–P90): ${formatRange(a.differentRange.centralEighty)}. `
        + `Full observed range: ${formatRange(a.differentRange.full)}.`,
    },
    {
      q: 'C) Where is the strongest practical threshold?',
      a: f1
        ? `By F1, cosine ≥ ${f1.threshold.toFixed(2)} (F1 ${n(f1.f1)}, precision ${n(f1.precision)}, recall ${n(f1.recall)}, accuracy ${n(f1.accuracy)}). `
          + (beatsMajority
            ? `That beats always guessing the larger class (${n(a.overlap.majorityClassAccuracy)}), but only by ${n(a.overlap.bestAccuracy - a.overlap.majorityClassAccuracy)}.`
            : `It does NOT beat always guessing the larger class (${n(a.overlap.majorityClassAccuracy)}), so no threshold here is practical.`)
        : 'No threshold produces a usable F1.',
    },
    {
      q: 'D) How much do SIMILAR and DIFFERENT overlap?',
      a: `${pct(a.overlap.overlapPercent)} of SIMILAR+DIFFERENT pairs fall inside the other class's range `
        + `(${a.overlap.similarInsideDifferentRange} SIMILAR inside DIFFERENT, `
        + `${a.overlap.differentInsideSimilarRange} DIFFERENT inside SIMILAR). `
        + `Shared interval ${formatRange(a.overlap.interval)}. `
        + `AUC ${n(a.overlap.auc, 4)}, mean gap ${n(a.overlap.meanGap, 4)}.`,
    },
    {
      q: 'E) Is the signal strong enough to continue with this model?',
      a: `${signal.value.summary} This is a measurement, not an authorisation — see the note below.`,
    },
  ]
})

function onImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importError.value = ''
  importNote.value = ''

  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      // Accept an exported report ({ pairs: [...] }) or a bare array.
      const raw = Array.isArray(parsed) ? parsed : parsed?.pairs
      if (!Array.isArray(raw)) {
        importError.value = 'That file has no `pairs` array, so there is nothing to analyse.'
        return
      }
      const mapped: AnalysablePair[] = raw.map((p: Record<string, unknown>) => ({
        trackA: typeof p.trackA === 'string' ? p.trackA : String(p.trackIdA ?? ''),
        trackB: typeof p.trackB === 'string' ? p.trackB : String(p.trackIdB ?? ''),
        label: String(p.label ?? ''),
        cosine: typeof p.cosine === 'number' ? p.cosine : null,
      }))
      imported.value = mapped
      importNote.value = `Loaded ${mapped.length} pair(s) from ${file.name}.`
    } catch (e) {
      importError.value = `Could not read that file: ${(e as Error).message}`
    }
  }
  reader.onerror = () => { importError.value = 'The file could not be read.' }
  reader.readAsText(file)
  input.value = ''
}

function clearImport() {
  imported.value = null
  importNote.value = ''
  importError.value = ''
}
</script>

<template>
  <section class="sys-card p-4 space-y-4">
    <header class="space-y-1">
      <h2 class="text-base font-semibold">
        Threshold &amp; distribution analysis
      </h2>
      <p class="text-xs opacity-70">
        Reads the pairs already scored by a completed run. Runs no model, decodes no
        audio, and creates no embeddings. Source: <strong>{{ sourceLabel }}</strong>.
      </p>
    </header>

    <!-- Data source ------------------------------------------------- -->
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <label class="sys-btn-outline chip cursor-pointer">
        Load exported report JSON
        <input
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="onImport"
        >
      </label>
      <button
        v-if="imported"
        type="button"
        class="sys-btn-outline chip"
        @click="clearImport"
      >
        Clear imported
      </button>
      <span v-if="importNote" class="opacity-70">{{ importNote }}</span>
      <span v-if="importError" class="text-[var(--sys-danger,#f87171)]">{{ importError }}</span>
    </div>

    <p v-if="!hasData" class="text-xs opacity-70">
      No scored pairs are loaded. Either complete a labelled evaluation on this page,
      or load a previously exported report JSON above. Nothing is analysed until then.
    </p>

    <template v-else>
      <!-- Caveats --------------------------------------------------- -->
      <ul v-if="analysis.caveats.length" class="text-xs space-y-1">
        <li v-for="c in analysis.caveats" :key="c" class="opacity-80">
          ⚠ {{ c }}
        </li>
      </ul>

      <!-- Class distributions --------------------------------------- -->
      <div class="space-y-1">
        <h3 class="text-sm font-medium">
          Cosine distribution by ground truth
        </h3>
        <p class="text-xs opacity-70">
          SAME is reported here for context and is held out of the binary analysis below.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="opacity-70">
              <tr>
                <th class="text-left py-1">Class</th>
                <th class="text-right">n</th>
                <th class="text-right">min</th>
                <th class="text-right">P10</th>
                <th class="text-right">P25</th>
                <th class="text-right">median</th>
                <th class="text-right">mean</th>
                <th class="text-right">P75</th>
                <th class="text-right">P90</th>
                <th class="text-right">max</th>
                <th class="text-right">sd</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in classRows" :key="s.label" class="border-t border-[var(--sys-border,#2a2a2a)]">
                <td class="py-1 font-medium">{{ s.label }}</td>
                <td class="text-right">{{ s.count }}</td>
                <td class="text-right">{{ n(s.min) }}</td>
                <td class="text-right">{{ n(s.p10) }}</td>
                <td class="text-right">{{ n(s.p25) }}</td>
                <td class="text-right">{{ n(s.median) }}</td>
                <td class="text-right">{{ n(s.mean) }}</td>
                <td class="text-right">{{ n(s.p75) }}</td>
                <td class="text-right">{{ n(s.p90) }}</td>
                <td class="text-right">{{ n(s.max) }}</td>
                <td class="text-right">{{ n(s.stdDev) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Overlap --------------------------------------------------- -->
      <div class="space-y-1">
        <h3 class="text-sm font-medium">
          SIMILAR vs DIFFERENT overlap
        </h3>
        <dl class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div>
            <dt class="opacity-70">Overlapping pairs</dt>
            <dd>{{ pct(analysis.overlap.overlapPercent) }}</dd>
          </div>
          <div>
            <dt class="opacity-70">Shared interval</dt>
            <dd>{{ formatRange(analysis.overlap.interval) }}</dd>
          </div>
          <div>
            <dt class="opacity-70">AUC (0.5 = chance)</dt>
            <dd>{{ n(analysis.overlap.auc, 4) }}</dd>
          </div>
          <div>
            <dt class="opacity-70">Mean gap</dt>
            <dd>{{ n(analysis.overlap.meanGap, 4) }}</dd>
          </div>
          <div>
            <dt class="opacity-70">Best accuracy</dt>
            <dd>{{ n(analysis.overlap.bestAccuracy) }}</dd>
          </div>
          <div>
            <dt class="opacity-70">Majority-guess accuracy</dt>
            <dd>{{ n(analysis.overlap.majorityClassAccuracy) }}</dd>
          </div>
        </dl>
      </div>

      <!-- Picks ----------------------------------------------------- -->
      <div class="space-y-1">
        <h3 class="text-sm font-medium">
          Candidate thresholds
        </h3>
        <p class="text-xs opacity-70">
          Rule: {{ 'predict SIMILAR when cosine ≥ threshold' }}. None of these is selected
          or applied anywhere.
        </p>
        <ul class="space-y-1 text-xs">
          <li
            v-for="p in picks"
            :key="p.key"
            class="border-t border-[var(--sys-border,#2a2a2a)] pt-1"
          >
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-medium">{{ p.title }}</span>
              <span class="opacity-80">{{ pickSummary(p.pick) }}</span>
              <span v-if="p.pick.tieCount > 1" class="opacity-60">
                ({{ p.pick.tieCount }} thresholds tie)
              </span>
            </div>
            <div v-if="p.pick.isDegenerate" class="opacity-70">
              ⚠ Not a real finding: {{ p.pick.degenerateReason }}
            </div>
          </li>
        </ul>
      </div>

      <!-- Sweep ----------------------------------------------------- -->
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-medium">
            Threshold sweep ({{ analysis.sweep.length }} steps, 0.00–1.00 by 0.01)
          </h3>
          <button type="button" class="sys-btn-outline chip text-xs" @click="showAllRows = !showAllRows">
            {{ showAllRows ? 'Show every 0.05' : 'Show all 101' }}
          </button>
        </div>
        <div class="overflow-x-auto max-h-80 overflow-y-auto">
          <table class="w-full text-xs">
            <thead class="opacity-70 sticky top-0 bg-[var(--sys-surface,#111)]">
              <tr>
                <th class="text-left py-1">t</th>
                <th class="text-right">TP</th>
                <th class="text-right">FP</th>
                <th class="text-right">TN</th>
                <th class="text-right">FN</th>
                <th class="text-right">Prec</th>
                <th class="text-right">Rec</th>
                <th class="text-right">F1</th>
                <th class="text-right">Acc</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in visibleRows"
                :key="r.threshold"
                class="border-t border-[var(--sys-border,#2a2a2a)]"
                :class="bestF1Threshold === r.threshold ? 'font-semibold' : ''"
              >
                <td class="py-0.5">{{ r.threshold.toFixed(2) }}</td>
                <td class="text-right">{{ r.tp }}</td>
                <td class="text-right">{{ r.fp }}</td>
                <td class="text-right">{{ r.tn }}</td>
                <td class="text-right">{{ r.fn }}</td>
                <td class="text-right">{{ n(r.precision) }}</td>
                <td class="text-right">{{ n(r.recall) }}</td>
                <td class="text-right">{{ n(r.f1) }}</td>
                <td class="text-right">{{ n(r.accuracy) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Answers --------------------------------------------------- -->
      <div class="space-y-2">
        <h3 class="text-sm font-medium">
          Summary
        </h3>
        <div v-for="row in answers" :key="row.q" class="text-xs">
          <p class="font-medium">{{ row.q }}</p>
          <p class="opacity-80">{{ row.a }}</p>
        </div>
      </div>

      <p class="text-xs opacity-70 border-t border-[var(--sys-border,#2a2a2a)] pt-2">
        <strong>ANALYSIS ONLY.</strong> No production threshold has been chosen, no
        recommendation behaviour has changed, and no model has been selected. These
        numbers describe {{ analysis.partition.usableCount }} labelled pairs from one
        device run and do not establish that any threshold generalises.
      </p>
    </template>
  </section>
</template>
