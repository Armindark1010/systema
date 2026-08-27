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
  pickAndImportModel,
  declareModelContract,
  deleteImportedModel,
  describeMemoryTrend,
  describeEnvironment,
  InferenceServiceError,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  RUNTIME_ONNX,
  type RuntimeId,
  type CandidateSpec,
  type ImportResult,
  type InferenceCapabilities,
  type MemoryLifecycleReport,
  type NativeModelInfo,
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

// ---- Model import -------------------------------------------------
// The whole point of this section: get a .onnx onto the device
// without adb. Nothing here scans anything — the native side opens
// the system picker and reads exactly the one file the user taps.
const importing = ref(false)
const importResult = ref<ImportResult | null>(null)
const importError = ref<{ code: string, message: string } | null>(null)

/** Models already installed, from the existing capabilities call. */
const installedModels = computed<NativeModelInfo[]>(() => caps.value?.models ?? [])
const importedModels = computed(
  () => installedModels.value.filter(m => m.kind !== 'test'),
)

async function onImportModel() {
  importing.value = true
  importError.value = null
  importResult.value = null
  try {
    const res = await pickAndImportModel()
    // A dismissed picker is not a failure and must not look like one.
    if (res.cancelled) return
    importResult.value = res
    if (!res.ok) {
      importError.value = {
        code: res.errorCode ?? 'MODEL_INVALID',
        message: res.message ?? 'The file was rejected.',
      }
      return
    }
    // Refresh the catalog so the new model appears in the selector.
    caps.value = await getCapabilities()
    if (res.modelId) contractModelId.value = res.modelId
  } catch (e) {
    importError.value = e instanceof InferenceServiceError
      ? { code: e.code, message: e.message }
      : { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
  } finally {
    importing.value = false
  }
}

// ---- Contract declaration -----------------------------------------
// Sample rate and input format are NOT in an ONNX graph, so they have
// to be stated. Until they are, the audio benchmark refuses with
// PREPROCESSING_UNAVAILABLE rather than guessing.
const contractModelId = ref('')
const contractSampleRate = ref<number>(16000)
const contractFormat = ref('RAW_WAVEFORM')
const contractSaving = ref(false)
const contractError = ref<{ code: string, message: string } | null>(null)
const contractSaved = ref(false)

const contractTarget = computed(
  () => installedModels.value.find(m => m.id === contractModelId.value) ?? null,
)

async function onDeclareContract() {
  contractSaving.value = true
  contractError.value = null
  contractSaved.value = false
  try {
    await declareModelContract({
      modelId: contractModelId.value,
      sampleRate: contractSampleRate.value,
      inputFormat: contractFormat.value,
    })
    caps.value = await getCapabilities()
    contractSaved.value = true
  } catch (e) {
    contractError.value = e instanceof InferenceServiceError
      ? { code: e.code, message: e.message }
      : { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
  } finally {
    contractSaving.value = false
  }
}

async function onDeleteModel(modelId: string) {
  try {
    await deleteImportedModel(modelId)
    caps.value = await getCapabilities()
    if (contractModelId.value === modelId) contractModelId.value = ''
  } catch (e) {
    importError.value = e instanceof InferenceServiceError
      ? { code: e.code, message: e.message }
      : { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
  }
}

function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || bytes < 0) return 'UNKNOWN'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** -1 / dynamic dimensions are shown as such, never as a number. */
function formatShape(shape: number[] | undefined): string {
  if (!shape || !shape.length) return 'UNKNOWN'
  return `[${shape.map(d => (d <= 0 ? 'dynamic' : String(d))).join(', ')}]`
}

function statusToneFor(status: string | undefined): string {
  if (status === 'VERIFIED') return 'text-success'
  if (status === 'BLOCKED') return 'text-danger'
  return 'text-warning'
}

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
        <!-- ---- Import a model from the device ----------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              IMPORT ONNX MODEL
            </p>
          </div>

          <div class="px-5 py-4 space-y-3">
            <p class="text-small text-fg-muted max-w-[76ch] leading-relaxed">
              Pick a <code class="text-fg">.onnx</code> file from device storage. It is
              copied into SYSTEMA's private model directory — the same one adb pushes
              to — and validated by
              <strong class="text-fg">actually loading it</strong> through ONNX
              Runtime. A file that will not build a session is deleted, not
              registered.
            </p>
            <p class="text-micro text-fg-faint max-w-[76ch] leading-relaxed">
              Only the single file you tap is read. Nothing scans storage, nothing
              enumerates your library, and importing never runs inference or changes
              the production model.
            </p>

            <button
              type="button"
              class="sys-btn"
              :disabled="importing"
              @click="onImportModel"
            >
              {{ importing ? 'IMPORTING…' : 'IMPORT ONNX MODEL' }}
            </button>
          </div>
        </section>

        <div v-if="importError" class="border border-danger/40 bg-danger/5 px-5 py-4">
          <p class="label text-danger">
            {{ importError.code }}
          </p>
          <p class="mt-1 text-small text-fg-muted leading-relaxed">
            {{ importError.message }}
          </p>
        </div>

        <!-- ---- Import result --------------------------- -->
        <section
          v-if="importResult && importResult.ok"
          class="border border-line bg-surface"
        >
          <div class="border-b border-line px-5 py-3 flex items-center justify-between gap-3">
            <p class="label text-fg-muted">
              IMPORTED — {{ importResult.fileName }}
            </p>
            <span class="label text-success">
              {{ importResult.validation }}
            </span>
          </div>

          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                FILE SIZE
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ formatBytes(importResult.sizeBytes) }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                RUNTIME
              </dt>
              <dd class="mt-1 text-small font-bold text-fg">
                {{ importResult.runtimeLabel }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                EMBEDDING DIM
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ importResult.contract?.embeddingDimension ?? 'UNKNOWN' }}
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                PREPROCESSING
              </dt>
              <dd
                class="mt-1 text-small font-bold"
                :class="statusToneFor(importResult.contract?.preprocessingStatus)"
              >
                {{ importResult.contract?.preprocessingStatus ?? 'UNKNOWN' }}
              </dd>
            </div>
          </dl>

          <div class="border-t border-line px-5 py-4 space-y-2">
            <p class="label text-fg-muted">
              GRAPH SIGNATURE — READ FROM THE FILE
            </p>
            <p
              v-for="sig in importResult.inputs"
              :key="`in-${sig.name}`"
              class="text-micro text-fg-faint tnum"
            >
              input <span class="text-fg">{{ sig.name }}</span> ·
              {{ formatShape(sig.shape) }} · {{ sig.type }}
            </p>
            <p
              v-for="sig in importResult.outputs"
              :key="`out-${sig.name}`"
              class="text-micro text-fg-faint tnum"
            >
              output <span class="text-fg">{{ sig.name }}</span> ·
              {{ formatShape(sig.shape) }} · {{ sig.type }}
            </p>
            <p class="pt-1 text-micro text-fg-muted leading-relaxed max-w-[76ch]">
              {{ importResult.message }}
            </p>
          </div>

          <LabBanner tone="warning" title="LOADING IS NOT ENDORSEMENT">
            This model builds a session. That is all it proves. It is not
            production-ready, it has not been benchmarked, and it has not been
            selected for anything.
          </LabBanner>
        </section>

        <!-- ---- Declare the preprocessing contract ------- -->
        <section v-if="importedModels.length" class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              DECLARE PREPROCESSING CONTRACT
            </p>
          </div>

          <div class="px-5 py-4 space-y-3">
            <p class="text-small text-fg-muted max-w-[76ch] leading-relaxed">
              An ONNX graph records shapes but
              <strong class="text-fg">not sample rate and not feature extraction</strong>.
              SYSTEMA will not guess them: until they are declared here, benchmarking
              this model against real audio fails with
              <code class="text-fg">PREPROCESSING_UNAVAILABLE</code>.
            </p>
            <p class="text-micro text-fg-faint max-w-[76ch] leading-relaxed">
              For YAMNet that is 16000 Hz raw waveform — and only if your export keeps
              the log-mel front end inside the graph. An export expecting a 96×64
              patch needs a mel front end SYSTEMA does not implement, and declaring
              log-mel here records it as BLOCKED rather than pretending otherwise.
            </p>

            <div class="flex flex-wrap items-end gap-4 pt-1">
              <label class="block">
                <span class="label text-fg-muted block mb-1">MODEL</span>
                <select v-model="contractModelId" class="sys-input">
                  <option value="">
                    — choose —
                  </option>
                  <option v-for="m in importedModels" :key="m.id" :value="m.id">
                    {{ m.name }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="label text-fg-muted block mb-1">INPUT FORMAT</span>
                <select v-model="contractFormat" class="sys-input">
                  <option value="RAW_WAVEFORM">
                    RAW_WAVEFORM
                  </option>
                  <option value="LOG_MEL_SPECTROGRAM">
                    LOG_MEL_SPECTROGRAM
                  </option>
                  <option value="MEL_SPECTROGRAM">
                    MEL_SPECTROGRAM
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="label text-fg-muted block mb-1">SAMPLE RATE (Hz)</span>
                <input
                  v-model.number="contractSampleRate"
                  type="number"
                  min="8000"
                  max="48000"
                  step="1"
                  class="sys-input w-32"
                >
              </label>
              <button
                type="button"
                class="sys-btn"
                :disabled="contractSaving || !contractModelId"
                @click="onDeclareContract"
              >
                {{ contractSaving ? 'SAVING…' : 'DECLARE CONTRACT' }}
              </button>
            </div>

            <p v-if="contractTarget" class="text-micro text-fg-faint">
              Current status for {{ contractTarget.name }}:
              <span :class="statusToneFor(contractTarget.preprocessingStatus)">
                {{ contractTarget.preprocessingStatus ?? 'UNKNOWN' }}
              </span>
              <span v-if="contractTarget.sampleRate">
                · {{ contractTarget.sampleRate }} Hz
              </span>
            </p>

            <p v-if="contractSaved" class="text-micro text-success">
              Contract recorded as DEVELOPER_DECLARED. SYSTEMA did not verify it —
              it recorded what you asserted.
            </p>

            <div v-if="contractError" class="border border-danger/40 bg-danger/5 px-4 py-3">
              <p class="label text-danger">
                {{ contractError.code }}
              </p>
              <p class="mt-1 text-small text-fg-muted leading-relaxed">
                {{ contractError.message }}
              </p>
            </div>
          </div>

          <!-- ---- Installed models -------------------- -->
          <div class="border-t border-line">
            <div class="px-5 py-3">
              <p class="label text-fg-muted">
                INSTALLED MODELS
              </p>
            </div>
            <ul class="divide-y divide-line border-t border-line">
              <li
                v-for="m in importedModels"
                :key="m.id"
                class="px-5 py-3 flex items-center justify-between gap-3"
              >
                <div class="min-w-0">
                  <p class="text-small text-fg truncate">
                    {{ m.name }}
                  </p>
                  <p class="text-micro text-fg-faint tnum">
                    {{ formatBytes(m.sizeBytes) }} · {{ m.kind }} ·
                    <span :class="statusToneFor(m.preprocessingStatus)">
                      {{ m.preprocessingStatus ?? 'UNKNOWN' }}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  class="label text-fg-muted hover:text-danger t-col shrink-0"
                  @click="onDeleteModel(m.id)"
                >
                  DELETE
                </button>
              </li>
            </ul>
            <div class="px-5 py-3 border-t border-line">
              <button
                type="button"
                class="sys-btn-outline"
                @click="router.push('/dev/ai-benchmark/onnx')"
              >
                GO TO ONNX LAB TO BENCHMARK →
              </button>
            </div>
          </div>
        </section>

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
