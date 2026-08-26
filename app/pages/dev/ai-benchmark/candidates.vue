<script setup lang="ts">
// ============================================================
// SYSTEMA — Audio embedding candidate lab (Phase 16)
// ============================================================
// Two separate things live here, and the page works hard to keep
// them from being confused with each other:
//
//   1. THE CANDIDATE MATRIX — researched, published specifications
//      for YAMNet, VGGish, OpenL3, PANNs CNN14 and CLAP. NOT
//      measurements. No candidate model has been downloaded or
//      executed. Every latency, memory and quality cell reads
//      UNKNOWN, and it stays that way until something actually runs
//      on the device.
//
//   2. THE MEMORY LIFECYCLE TEST — a real measurement, run manually,
//      on whatever model is currently loadable (in practice the
//      423-byte deterministic test model). This is the Phase 15 gap:
//      "unloadModel releases native memory" was code-verified only.
//
// The page never blends the two. A researched size is never shown in
// the same column as a measured latency.
// ============================================================

import {
  getCapabilities,
  getCandidates,
  runMemoryLifecycle,
  describeMemoryTrend,
  describeEnvironment,
  InferenceServiceError,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  RUNTIME_ONNX,
  type RuntimeId,
  type CandidateSpec,
  type InferenceCapabilities,
  type MemoryLifecycleReport,
} from '~/services/native/inferencePlugin'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Embedding candidates' })

const router = useRouter()
const available = isInferenceAvailable()

// ---- Capabilities -------------------------------------------------
const caps = ref<InferenceCapabilities | null>(null)
const capsError = ref<string | null>(null)

// ---- Candidate matrix ---------------------------------------------
// Falls back to nothing rather than to invented rows: if the native
// side cannot be reached, the table is absent, not fabricated.
const candidates = ref<CandidateSpec[]>([])
const candidatesNote = ref<string>('')

async function loadAll() {
  if (!available) return
  try {
    caps.value = await getCapabilities()
  } catch (e) {
    capsError.value = e instanceof Error ? e.message : String(e)
  }
  try {
    const matrix = await getCandidates()
    candidates.value = matrix.candidates
    candidatesNote.value = matrix.note
  } catch {
    // Leave the table empty. An empty table is honest; a guessed one
    // is not.
  }
}
onMounted(loadAll)

const runnableCount = computed(
  () => candidates.value.filter(c => c.status === 'RUNNABLE').length,
)

function statusTone(status: string): string {
  return status === 'RUNNABLE' ? 'text-success' : 'text-warning'
}

function statusLabel(status: string): string {
  switch (status) {
    case 'RUNNABLE': return 'RUNNABLE'
    case 'BLOCKED_LICENSE': return 'BLOCKED — LICENCE'
    case 'BLOCKED_PREPROCESSING': return 'BLOCKED — PREPROCESSING'
    case 'BLOCKED_NO_ONNX': return 'BLOCKED — NO ONNX'
    default: return status
  }
}

// ---- Memory lifecycle test ----------------------------------------
const runtimeId = ref<RuntimeId>(RUNTIME_ONNX)
const memModelId = ref('')
const memCycles = ref(5)
const memPerCycle = ref(3)
const memRunning = ref(false)
const memReport = ref<MemoryLifecycleReport | null>(null)
const memError = ref<{ code: string, message: string } | null>(null)

watchEffect(() => {
  if (!memModelId.value && caps.value?.models.length) {
    memModelId.value = caps.value.models[0]!.modelId
  }
})

async function onRunMemory() {
  memRunning.value = true
  memError.value = null
  memReport.value = null
  try {
    memReport.value = await runMemoryLifecycle({
      runtimeId: runtimeId.value,
      modelId: memModelId.value,
      iterations: memCycles.value,
      inferencesPerCycle: memPerCycle.value,
    })
  } catch (e) {
    memError.value = e instanceof InferenceServiceError
      ? { code: e.code, message: e.message }
      : { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
  } finally {
    memRunning.value = false
  }
}

/** -1 means the OS would not tell us. It must never render as 0. */
function mb(kb: number | undefined | null): string {
  if (kb === undefined || kb === null || kb < 0) return 'UNKNOWN'
  return `${(kb / 1024).toFixed(1)} MB`
}

function signedMb(kb: number | undefined | null): string {
  if (kb === undefined || kb === null) return 'UNKNOWN'
  const v = kb / 1024
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} MB`
}

function trendTone(trend: string): string {
  if (trend === 'STABLE') return 'text-success'
  if (trend === 'GROWING') return 'text-danger'
  return 'text-warning'
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
          Embedding candidates
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Developer Diagnostic — Not a Production Feature. Researched
          candidate specifications, and a manual native memory test.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <LabBanner tone="warning" title="NO PRODUCTION MODEL SELECTED">
        Phase 16 evaluates candidates; it does not choose one. No candidate
        model has been downloaded, converted, bundled or executed. Every
        specification below is
        <strong class="text-fg">quoted from published papers and repositories</strong>,
        not measured by SYSTEMA, and every performance cell reads UNKNOWN
        because nothing has run on hardware.
      </LabBanner>

      <LabBanner v-if="!available" tone="danger" title="NATIVE INFERENCE UNAVAILABLE">
        The inference plugin is not present here. The memory test needs the
        Android build — there is no browser equivalent, and a simulated memory
        figure would be worthless. The candidate table below is unavailable
        rather than guessed.
      </LabBanner>

      <LabBanner v-else-if="capsError" tone="danger" title="COULD NOT READ CAPABILITIES">
        {{ capsError }}
      </LabBanner>

      <!-- ---- Candidate matrix (§11) --------------------- -->
      <section v-if="candidates.length" class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            CANDIDATE MATRIX — PUBLISHED SPECIFICATIONS, NOT MEASUREMENTS
          </p>
        </div>

        <div class="px-5 py-4">
          <p class="text-small text-fg-muted max-w-[76ch] leading-relaxed">
            {{ candidatesNote }}
            {{ runnableCount }} of {{ candidates.length }} candidates could be
            benchmarked today if their weights were side-loaded; the rest are
            blocked, each for a stated reason.
          </p>
        </div>

        <ul class="divide-y divide-line border-t border-line">
          <li v-for="c in candidates" :key="c.candidateId" class="px-5 py-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[15px] font-bold text-fg">
                  {{ c.displayName }}
                </p>
                <p class="mt-0.5 text-micro text-fg-faint">
                  {{ c.architecture }}
                </p>
              </div>
              <span class="label shrink-0" :class="statusTone(c.status)">
                {{ statusLabel(c.status) }}
              </span>
            </div>

            <dl class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line">
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  EMBEDDING
                </dt>
                <dd class="mt-0.5 tnum text-small text-fg">
                  {{ c.embeddingDimension ?? 'UNKNOWN' }}
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  INPUT
                </dt>
                <dd class="mt-0.5 text-small text-fg">
                  {{ c.inputRepresentation }} @ {{ c.inputSampleRate / 1000 }} kHz
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  SIZE (PUBLISHED)
                </dt>
                <dd class="mt-0.5 tnum text-small text-fg">
                  {{ c.approximateSizeMb !== null ? `~${c.approximateSizeMb} MB` : 'UNKNOWN' }}
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  LICENCE
                </dt>
                <dd class="mt-0.5 text-small text-fg">
                  {{ c.license }}
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  COLD LOAD
                </dt>
                <dd class="mt-0.5 text-small text-fg-faint">
                  UNKNOWN
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  WARM INFERENCE
                </dt>
                <dd class="mt-0.5 text-small text-fg-faint">
                  UNKNOWN
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  PEAK RAM
                </dt>
                <dd class="mt-0.5 text-small text-fg-faint">
                  UNKNOWN
                </dd>
              </div>
              <div class="bg-surface px-3 py-2">
                <dt class="label text-fg-muted">
                  DEVICE VERIFIED
                </dt>
                <dd class="mt-0.5 text-small text-danger">
                  NO
                </dd>
              </div>
            </dl>

            <p class="mt-2 text-micro text-fg-muted leading-relaxed max-w-[76ch]">
              {{ c.statusReason }}
            </p>
          </li>
        </ul>
      </section>

      <template v-if="available && caps">
        <!-- ---- Memory lifecycle test (§8) --------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              NATIVE MEMORY LIFECYCLE TEST
            </p>
          </div>

          <div class="px-5 py-4 space-y-3">
            <p class="text-small text-fg-muted max-w-[76ch] leading-relaxed">
              Loads the model, runs inference, unloads it, and samples memory at
              each boundary — repeatedly. ONNX Runtime allocates
              <strong class="text-fg">natively</strong>, so total PSS is the
              headline figure; the Java heap would look almost empty even with a
              large model resident.
            </p>
            <p class="text-micro text-fg-faint max-w-[76ch] leading-relaxed">
              One clean cycle proves nothing — PSS drifts by a few MB on its own.
              Only a trend across cycles carries information, and even a stable
              trend is evidence rather than proof. This test will never report
              “no memory leak”.
            </p>

            <div class="flex flex-wrap items-end gap-4 pt-1">
              <label class="block">
                <span class="label text-fg-muted block mb-1">MODEL</span>
                <select v-model="memModelId" class="sys-input">
                  <option v-for="m in caps.models" :key="m.modelId" :value="m.modelId">
                    {{ m.modelName }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="label text-fg-muted block mb-1">CYCLES</span>
                <input
                  v-model.number="memCycles"
                  type="number"
                  min="3"
                  max="50"
                  class="sys-input w-24"
                >
              </label>
              <label class="block">
                <span class="label text-fg-muted block mb-1">INFER / CYCLE</span>
                <input
                  v-model.number="memPerCycle"
                  type="number"
                  min="1"
                  max="100"
                  class="sys-input w-24"
                >
              </label>
              <button
                type="button"
                class="sys-btn"
                :disabled="memRunning || !memModelId"
                @click="onRunMemory"
              >
                {{ memRunning ? 'MEASURING…' : 'RUN MEMORY TEST' }}
              </button>
            </div>
          </div>
        </section>

        <div v-if="memError" class="border border-danger/40 bg-danger/5 px-5 py-4">
          <p class="label text-danger">
            {{ memError.code }}
          </p>
          <p class="mt-1 text-small text-fg-muted leading-relaxed">
            {{ memError.message }}
          </p>
        </div>

        <section v-if="memReport" class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between gap-3">
            <p class="label text-fg-muted">
              MEMORY RESULT — {{ memReport.modelId }}
            </p>
            <span class="label" :class="trendTone(memReport.trend)">
              {{ memReport.trend }}
            </span>
          </div>

          <div class="px-5 py-4">
            <p class="text-small text-fg leading-relaxed max-w-[76ch]">
              {{ describeMemoryTrend(memReport) }}
            </p>
            <p class="mt-2 text-micro text-fg-faint leading-relaxed max-w-[76ch]">
              {{ memReport.caveat }}
            </p>
            <p class="mt-2 text-micro text-fg-faint">
              {{ describeEnvironment(memReport.environment) }}
            </p>
          </div>

          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-t border-line">
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                BASELINE PSS
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ mb(memReport.baseline.totalPssKb) }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                PEAK ABOVE BASELINE
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ signedMb(memReport.peakDeltaKb) }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                NET AFTER UNLOAD
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ signedMb(memReport.netDeltaKb) }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                CYCLES
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ memReport.iterations }}
              </dd>
            </div>
          </dl>

          <ul class="divide-y divide-line border-t border-line">
            <li v-for="c in memReport.cycles" :key="c.iteration" class="px-5 py-2.5">
              <p class="text-micro text-fg-faint tnum">
                cycle {{ c.iteration }} ·
                after load {{ mb(c.afterLoadKb) }} ·
                after inference {{ mb(c.afterInferenceKb) }} ·
                after unload {{ mb(c.afterUnloadKb) }} ·
                load {{ c.loadMs.toFixed(1) }} ms
              </p>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
