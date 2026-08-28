<script setup lang="ts">
// ============================================================
// SYSTEMA — Phase 18 production candidate evaluation (18K)
// ============================================================
// This page answers one question: what embedding architecture
// should SYSTEMA use for music similarity and, eventually,
// natural-language search?
//
// It answers it with RESEARCH, not measurement, and it is built so
// that this can never be misread. Two rules are enforced structurally
// rather than by good intentions:
//
//   1. Every candidate carries an explicit DEVICE STATUS and QUALITY
//      STATUS. Only YAMNet reads DEVICE VERIFIED, because only YAMNet
//      has ever run (Phase 17). Everything else reads NOT TESTED.
//
//   2. A complete dossier is not evidence. The rows below are dense
//      and well-sourced, and that is exactly why the status columns
//      are rendered as loud chips rather than quiet text — a tidy
//      table is the most persuasive way to accidentally imply that
//      something works.
//
// 18N COMPLIANCE
// --------------
// Nothing large is reactive here. The dossiers are a frozen module
// constant imported directly; the only reactive state is which row is
// expanded (a string id) and the filter (a string). No embeddings, no
// tensors, no matrices — there is nothing on this page to leak.
// ============================================================

import {
  CANDIDATES,
  NETWORK_PROBE,
  WEIGHTS_AVAILABILITY_NOTE,
  OVERALL_VERDICT,
  OVERALL_VERDICT_REASON,
  NO_AUTO_SELECTION_NOTICE,
  UNBLOCK_STEPS,
  type CandidateDossier,
} from '~/data/phase18Candidates'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Production candidates' })

const router = useRouter()

// ---- UI state (deliberately tiny) ---------------------------------
// Only an id and a filter string are reactive. See 18N note above.
const expandedId = ref<string | null>(null)
const modalityFilter = ref<'ALL' | 'AUDIO_AND_TEXT'>('ALL')

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

const visible = computed<CandidateDossier[]>(() =>
  modalityFilter.value === 'ALL'
    ? [...CANDIDATES]
    : CANDIDATES.filter(c => c.modality === 'AUDIO_AND_TEXT'),
)

const executedCount = computed(
  () => CANDIDATES.filter(c => c.deviceStatus === 'DEVICE_VERIFIED').length,
)
const researchedCount = computed(
  () => CANDIDATES.filter(c => c.deviceStatus === 'NOT_TESTED').length,
)

// ---- Presentation helpers -----------------------------------------
// These map a value to a class. They never invent a value: an unknown
// input falls through to the neutral style rather than to a
// reassuring one.

function verdictClass(v: CandidateDossier['verdict']): string {
  switch (v) {
    case 'PROMISING': return 'bg-success/15 text-success border-success/40'
    case 'NOT_SUITABLE': return 'bg-danger/15 text-danger border-danger/40'
    case 'BLOCKED': return 'bg-danger/15 text-danger border-danger/40'
    default: return 'bg-warning/15 text-warning border-warning/40'
  }
}

function deviceClass(s: CandidateDossier['deviceStatus']): string {
  return s === 'DEVICE_VERIFIED'
    ? 'bg-success/15 text-success border-success/40'
    : 'bg-warning/15 text-warning border-warning/40'
}

function label(v: string): string {
  return v.replace(/_/g, ' ')
}

function commercialClass(c: CandidateDossier['commercialUse']): string {
  switch (c) {
    case 'PERMITTED': return 'text-success'
    case 'COPYLEFT':
    case 'RESTRICTED': return 'text-danger'
    case 'ATTRIBUTION_REQUIRED': return 'text-warning'
    default: return 'text-fg-muted'
  }
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
          Production candidates &amp; CLAP feasibility
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Developer Diagnostic — Not a Production Feature. Phase 18
          evaluation of embedding architectures for music similarity and
          natural-language search.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <!-- ---- 18Q: the headline verdict, stated first ------------- -->
      <LabBanner tone="danger" :title="`OVERALL VERDICT — ${label(OVERALL_VERDICT)}`">
        <p class="leading-relaxed">{{ OVERALL_VERDICT_REASON }}</p>
        <p class="mt-3 font-bold text-fg">{{ NO_AUTO_SELECTION_NOTICE }}</p>
      </LabBanner>

      <!-- ---- Why nothing ran ------------------------------------ -->
      <LabBanner tone="warning" title="NO CANDIDATE MODEL WAS EXECUTED IN THIS PHASE">
        <p class="leading-relaxed">{{ WEIGHTS_AVAILABILITY_NOTE }}</p>
        <p class="mt-3 leading-relaxed">
          <strong class="text-fg">{{ executedCount }}</strong> model has real
          device measurements (YAMNet, from Phase 17).
          <strong class="text-fg">{{ researchedCount }}</strong> were
          researched only and are marked
          <span class="font-bold text-warning">NOT TESTED</span>. A dossier is
          not a measurement.
        </p>
      </LabBanner>

      <!-- ---- Network probe: the claim, evidenced ---------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">NETWORK PROBE — TESTED, NOT ASSUMED</p>
        </div>
        <ul class="divide-y divide-line">
          <li
            v-for="probe in NETWORK_PROBE"
            :key="probe.host"
            class="flex items-center justify-between gap-4 px-5 py-2.5"
          >
            <span class="font-mono text-small text-fg">{{ probe.host }}</span>
            <span
              class="label"
              :class="probe.result.startsWith('REACHABLE') ? 'text-success' : 'text-danger'"
            >{{ probe.result }}</span>
          </li>
        </ul>
      </section>

      <!-- ---- 18K: the candidate matrix -------------------------- -->
      <section class="border border-line bg-surface">
        <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <p class="label text-fg-muted">CANDIDATE EVALUATION</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="label px-2.5 py-1 border"
              :class="modalityFilter === 'ALL'
                ? 'border-fg text-fg'
                : 'border-line text-fg-muted hover:text-fg'"
              @click="modalityFilter = 'ALL'"
            >ALL</button>
            <button
              type="button"
              class="label px-2.5 py-1 border"
              :class="modalityFilter === 'AUDIO_AND_TEXT'
                ? 'border-fg text-fg'
                : 'border-line text-fg-muted hover:text-fg'"
              @click="modalityFilter = 'AUDIO_AND_TEXT'"
            >TEXT-CAPABLE</button>
          </div>
        </div>

        <ul class="divide-y divide-line">
          <li v-for="c in visible" :key="c.candidateId">
            <button
              type="button"
              class="w-full text-left px-5 py-4 hover:bg-base/40 t-col"
              @click="toggle(c.candidateId)"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-bold text-fg">{{ c.displayName }}</p>
                  <p class="mt-1 text-small text-fg-muted">
                    {{ c.architecture }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2 shrink-0">
                  <span
                    class="label px-2 py-0.5 border"
                    :class="deviceClass(c.deviceStatus)"
                  >{{ label(c.deviceStatus) }}</span>
                  <span
                    class="label px-2 py-0.5 border"
                    :class="verdictClass(c.verdict)"
                  >{{ label(c.verdict) }}</span>
                </div>
              </div>

              <!-- Compact spec strip: the 18K required columns -->
              <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                <div>
                  <dt class="label text-fg-muted">DIM</dt>
                  <dd class="text-small text-fg font-mono">
                    {{ c.embeddingDimension ?? 'UNKNOWN' }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">AUDIO / TEXT</dt>
                  <dd class="text-small font-mono"
                      :class="c.modality === 'AUDIO_AND_TEXT' ? 'text-success' : 'text-fg-muted'">
                    {{ c.modality === 'AUDIO_AND_TEXT' ? 'AUDIO+TEXT' : 'AUDIO ONLY' }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">ONNX</dt>
                  <dd class="text-small text-fg font-mono">{{ label(c.onnxStatus) }}</dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">COMMERCIAL</dt>
                  <dd class="text-small font-mono" :class="commercialClass(c.commercialUse)">
                    {{ label(c.commercialUse) }}
                  </dd>
                </div>
              </dl>
            </button>

            <!-- ---- Expanded dossier ---------------------------- -->
            <div
              v-if="expandedId === c.candidateId"
              class="border-t border-line bg-base/30 px-5 py-4 space-y-4"
            >
              <div>
                <p class="label text-fg-muted">VERDICT — {{ label(c.verdict) }}</p>
                <p class="mt-1 text-small text-fg leading-relaxed max-w-[76ch]">
                  {{ c.verdictReason }}
                </p>
              </div>

              <div>
                <p class="label text-fg-muted">TRAINED FOR MUSIC SIMILARITY?</p>
                <p class="mt-1 text-small text-fg leading-relaxed max-w-[76ch]">
                  {{ c.trainedForMusicSimilarity }}
                </p>
              </div>

              <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt class="label text-fg-muted">PARAMETERS</dt>
                  <dd class="text-small text-fg">{{ c.approxParams }}</dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">SIZE</dt>
                  <dd class="text-small text-fg">
                    {{ c.approximateSizeMb === null ? 'UNKNOWN' : `~${c.approximateSizeMb} MB` }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">SAMPLE RATE</dt>
                  <dd class="text-small text-fg font-mono">
                    {{ c.inputSampleRateHz === null ? 'UNKNOWN' : `${c.inputSampleRateHz} Hz` }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">WINDOW</dt>
                  <dd class="text-small text-fg font-mono">
                    {{ c.windowSeconds === null ? 'UNKNOWN' : `${c.windowSeconds} s` }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">SHARED TEXT/AUDIO SPACE</dt>
                  <dd class="text-small font-mono"
                      :class="c.sharedSpaceDimension ? 'text-success' : 'text-fg-muted'">
                    {{ c.sharedSpaceDimension
                      ? `${c.sharedSpaceDimension}-d shared`
                      : 'NONE — audio only' }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">TEXT ENCODER</dt>
                  <dd class="text-small text-fg">{{ c.textEncoder ?? 'NONE' }}</dd>
                </div>
              </dl>

              <div>
                <p class="label text-fg-muted">CHECKPOINT</p>
                <dl class="mt-1 space-y-1">
                  <div class="flex flex-wrap gap-2">
                    <dt class="text-small text-fg-muted">NAME:</dt>
                    <dd class="text-small text-fg font-mono">{{ c.checkpointIdentifier }}</dd>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <dt class="text-small text-fg-muted">SOURCE:</dt>
                    <dd class="text-small text-fg">{{ c.checkpointSource }}</dd>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <dt class="text-small text-fg-muted">HASH:</dt>
                    <dd class="text-small text-fg font-mono">{{ c.checkpointHash }}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <p class="label text-fg-muted">ONNX / INPUT CONTRACT</p>
                <p class="mt-1 text-small text-fg leading-relaxed max-w-[76ch]">{{ c.onnxNote }}</p>
              </div>

              <div>
                <p class="label text-fg-muted">ANDROID + CPU FEASIBILITY</p>
                <p class="mt-1 text-small text-fg leading-relaxed max-w-[76ch]">
                  {{ c.androidCpuFeasibility }}
                </p>
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p class="label text-fg-muted">QUANTIZATION</p>
                  <p class="mt-1 text-small text-fg leading-relaxed">{{ c.quantizationNote }}</p>
                </div>
                <div>
                  <p class="label text-fg-muted">MEMORY</p>
                  <p class="mt-1 text-small text-fg leading-relaxed">{{ c.memoryNote }}</p>
                </div>
              </div>

              <div>
                <p class="label text-fg-muted">LICENSING</p>
                <dl class="mt-1 space-y-1">
                  <div class="flex flex-wrap gap-2">
                    <dt class="text-small text-fg-muted">CODE:</dt>
                    <dd class="text-small text-fg">{{ c.codeLicense }}</dd>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <dt class="text-small text-fg-muted">WEIGHTS:</dt>
                    <dd class="text-small text-fg">{{ c.weightsLicense }}</dd>
                  </div>
                </dl>
                <p class="mt-2 text-small text-fg leading-relaxed max-w-[76ch]">
                  {{ c.licenseNote }}
                </p>
              </div>

              <!-- The two evidence rows, kept visually distinct -->
              <div class="border border-line bg-surface p-3 space-y-2">
                <p class="label text-fg-muted">EVIDENCE</p>
                <div class="flex flex-wrap gap-2">
                  <span class="text-small text-fg-muted">AUDIO→AUDIO:</span>
                  <span class="text-small text-fg">{{ c.measuredAudioAudio }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="text-small text-fg-muted">TEXT→AUDIO:</span>
                  <span class="text-small text-fg">{{ c.measuredTextAudio }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="text-small text-fg-muted">QUALITY STATUS:</span>
                  <span
                    class="label"
                    :class="c.qualityStatus === 'MEASURED_ON_LABELLED_SET' ? 'text-success' : 'text-warning'"
                  >{{ label(c.qualityStatus) }}</span>
                </div>
              </div>

              <div>
                <p class="label text-fg-muted">SOURCES — {{ c.confidence }}</p>
                <ul class="mt-1 space-y-0.5">
                  <li
                    v-for="s in c.sources"
                    :key="s"
                    class="text-small text-fg-muted leading-relaxed"
                  >— {{ s }}</li>
                </ul>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- ---- What would unblock this ---------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">WHAT WOULD UNBLOCK A REAL MEASUREMENT</p>
        </div>
        <ol class="divide-y divide-line">
          <li
            v-for="(step, i) in UNBLOCK_STEPS"
            :key="step"
            class="flex gap-3 px-5 py-3"
          >
            <span class="label text-fg-muted shrink-0">{{ i + 1 }}</span>
            <span class="text-small text-fg leading-relaxed">{{ step }}</span>
          </li>
        </ol>
      </section>

      <p class="text-small text-fg-muted leading-relaxed max-w-[76ch]">
        Phase 18 is an evaluation. It deliberately does not build library
        indexing, background embedding, a recommendation engine, semantic
        search or playlist generation, and it does not select a model.
      </p>
    </div>
  </div>
</template>
