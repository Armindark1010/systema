<script setup lang="ts">
// ============================================================
// SYSTEMA — CLAP lab (Phase 21)
// ============================================================
// The lifecycle for an EXTERNALLY SUPPLIED CLAP model, stepped
// through one stage at a time:
//
//   IMPORT -> VALIDATE -> LOAD -> SINGLE TEST -> RELEASE -> MEMORY
//
// Each stage is its own button. There is deliberately no "run
// everything" control: a previous model froze the device, and the
// cure for that is a human looking at the result of each stage
// before authorising the next.
//
// THE SINGLE-TRACK GATE
// ---------------------
// The first test processes exactly ONE manually chosen file. The
// multi-track control does not exist on this page at all — it is
// unlocked in the other labs only after a single-track test has
// genuinely passed on this device, and that flag is owned by native
// code, not by this component.
//
// What this page will not do
// --------------------------
// It never downloads a model, never picks a model or a track for
// you, never runs on the whole library, never runs anything on
// mount, and never shows a number it did not receive from native
// code. Nothing here can reach PlayerEngine (§8).
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  clapLoadModel,
  clapMemoryCheck,
  clapRelease,
  clapTestOneTrack,
  clapValidateModel,
  getCapabilities,
  getClapStatus,
  pickAndImportModel,
  InferenceServiceError,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  type ClapLoadResult,
  type ClapMemoryCheck,
  type ClapReleaseResult,
  type ClapSingleTrackResult,
  type ClapStatus,
  type ClapValidationReport,
  type ImportResult,
  type InferenceCapabilities,
} from '~/services/native/inferencePlugin'

definePageMeta({ layout: 'dev' })
useHead({ title: 'CLAP lab' })

const library = useLibraryStore()
const available = isInferenceAvailable()

type Err = { code: string, message: string } | null
function asErr(e: unknown): Err {
  const err = e as InferenceServiceError
  return { code: err?.code ?? 'UNKNOWN', message: err?.message ?? String(e) }
}

// ---- Capabilities and status --------------------------------------
// Reads only. Neither of these loads a model or touches audio.
const caps = ref<InferenceCapabilities | null>(null)
const status = ref<ClapStatus | null>(null)
const statusError = ref<Err>(null)

async function refreshStatus() {
  if (!available) return
  try {
    status.value = await getClapStatus()
    statusError.value = null
  } catch (e) {
    statusError.value = asErr(e)
  }
}

async function refreshCaps() {
  if (!available) return
  try {
    caps.value = await getCapabilities()
  } catch {
    // A capabilities failure must not blank the page; the stage
    // buttons report their own errors.
  }
}

onMounted(() => {
  if (!available) return
  void refreshCaps()
  void refreshStatus()
  if (!library.tracks.length) void library.loadFirstPage().catch(() => {})
})

// Side-loaded models only. The bundled arithmetic test model is not a
// CLAP candidate and offering it here would invite a meaningless run.
const importedModels = computed(
  () => caps.value?.models.filter(m => m.kind !== 'test') ?? [],
)
const modelId = ref('')

// ---- Stage 1: IMPORT ----------------------------------------------
const importing = ref(false)
const importResult = ref<ImportResult | null>(null)
const importError = ref<Err>(null)

async function onImport() {
  if (importing.value) return
  importing.value = true
  importError.value = null
  importResult.value = null
  try {
    const res = await pickAndImportModel()
    importResult.value = res
    if (res.ok && res.modelId) {
      modelId.value = res.modelId
      await refreshCaps()
    }
  } catch (e) {
    importError.value = asErr(e)
  } finally {
    importing.value = false
  }
}

// ---- Stage 2: MEMORY CHECK ----------------------------------------
const memCheck = ref<ClapMemoryCheck | null>(null)
const memChecking = ref(false)
const memError = ref<Err>(null)

async function onMemoryCheck() {
  if (memChecking.value) return
  memChecking.value = true
  memError.value = null
  try {
    memCheck.value = await clapMemoryCheck(modelId.value || undefined)
  } catch (e) {
    memError.value = asErr(e)
  } finally {
    memChecking.value = false
  }
}

// ---- Stage 3: LOAD ------------------------------------------------
const loading = ref(false)
const loadResult = ref<ClapLoadResult | null>(null)
const loadError = ref<Err>(null)

async function onLoad() {
  if (loading.value || !modelId.value) return
  loading.value = true
  loadError.value = null
  loadResult.value = null
  try {
    loadResult.value = await clapLoadModel({ modelId: modelId.value })
  } catch (e) {
    loadError.value = asErr(e)
  } finally {
    loading.value = false
    await refreshStatus()
  }
}

// ---- Stage 4: VALIDATE --------------------------------------------
const validating = ref(false)
const validation = ref<ClapValidationReport | null>(null)
const validateError = ref<Err>(null)

async function onValidate() {
  if (validating.value) return
  validating.value = true
  validateError.value = null
  validation.value = null
  try {
    validation.value = await clapValidateModel()
  } catch (e) {
    validateError.value = asErr(e)
  } finally {
    validating.value = false
    await refreshStatus()
  }
}

// ---- Stage 5: TEST ONE TRACK --------------------------------------
const tracks = computed(() => library.tracks.slice(0, 100))
// A single id, not an array. The type itself refuses a batch.
const selectedTrackId = ref<string | null>(null)
const selectedTrack = computed(
  () => tracks.value.find(t => t.id === selectedTrackId.value) ?? null,
)

const testing = ref(false)
const testResult = ref<ClapSingleTrackResult | null>(null)
const testError = ref<Err>(null)

const canTest = computed(
  () => !!status.value?.validated && !!selectedTrack.value?.uri && !testing.value,
)

async function onTestOneTrack() {
  const track = selectedTrack.value
  if (!canTest.value || !track?.uri) return
  testing.value = true
  testError.value = null
  testResult.value = null
  try {
    testResult.value = await clapTestOneTrack({
      trackId: track.id,
      uri: track.uri,
      releaseAfter: true,
    })
  } catch (e) {
    testError.value = asErr(e)
  } finally {
    testing.value = false
    await refreshStatus()
  }
}

// ---- Stage 6: RELEASE ---------------------------------------------
const releasing = ref(false)
const releaseResult = ref<ClapReleaseResult | null>(null)
const releaseError = ref<Err>(null)

async function onRelease() {
  if (releasing.value) return
  releasing.value = true
  releaseError.value = null
  try {
    releaseResult.value = await clapRelease()
  } catch (e) {
    releaseError.value = asErr(e)
  } finally {
    releasing.value = false
    await refreshStatus()
  }
}

// ---- Formatting ----------------------------------------------------
// Null and non-finite values render as a dash. A missing measurement
// must never be shown as 0.000, which reads as a real result.
function mb(kb: number | null | undefined): string {
  return typeof kb === 'number' && Number.isFinite(kb)
    ? `${(kb / 1024).toFixed(1)} MB`
    : '—'
}
function ms(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} ms` : '—'
}
function num(v: number | null | undefined, digits = 4): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
}
function sizeMb(bytes: number | null | undefined): string {
  return typeof bytes === 'number' && Number.isFinite(bytes)
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : '—'
}
</script>

<template>
  <div class="min-h-screen bg-bg">
    <header class="border-b border-line">
      <div class="sys-container py-8">
        <NuxtLink
          to="/dev/ai-benchmark"
          class="text-micro text-fg-muted hover:text-fg t-col"
        >
          ← AI BENCHMARK
        </NuxtLink>
        <h1 class="mt-3 text-display text-fg">
          CLAP LAB
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Import an external CLAP model, validate it, load it, and test it on
          exactly one track. Every stage is a separate button and nothing runs
          on its own.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <LabBanner tone="warning" title="NO PRODUCTION MODEL HAS BEEN CHOSEN">
        This lab can end with a model marked
        <strong class="text-fg">IMPORTED / VALIDATED / DEVICE TESTED</strong>.
        It cannot mark one PRODUCTION — that stays a separate, explicit human
        decision. No weights ship with the app and nothing is ever downloaded
        automatically.
      </LabBanner>

      <LabBanner v-if="!available" tone="danger" title="NATIVE INFERENCE UNAVAILABLE">
        The inference plugin is not present in this environment. This page works
        on the Android build only. Nothing is simulated here, because a
        simulated embedding would be indistinguishable from a real one on
        screen and would be worthless.
      </LabBanner>

      <template v-else>
        <!-- LIFECYCLE STATE -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line flex items-center justify-between">
            <h2 class="text-small font-semibold text-fg">
              LIFECYCLE
            </h2>
            <button
              type="button"
              class="text-micro text-fg-muted hover:text-fg t-col"
              @click="refreshStatus"
            >
              REFRESH
            </button>
          </div>
          <div v-if="statusError" class="px-5 py-4 text-small text-danger">
            {{ statusError.code }} — {{ statusError.message }}
          </div>
          <dl v-else-if="status" class="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <dt class="label text-fg-muted">
                STATE
              </dt>
              <dd class="mt-1 text-small text-fg font-semibold">
                {{ status.status }}
              </dd>
            </div>
            <div>
              <dt class="label text-fg-muted">
                SESSION
              </dt>
              <dd class="mt-1 text-small text-fg">
                {{ status.loaded ? 'LOADED' : 'NONE' }}
              </dd>
            </div>
            <div>
              <dt class="label text-fg-muted">
                VALIDATED
              </dt>
              <dd class="mt-1 text-small text-fg">
                {{ status.validated ? 'YES' : 'NO' }}
              </dd>
            </div>
            <div>
              <dt class="label text-fg-muted">
                MULTI-TRACK
              </dt>
              <dd class="mt-1 text-small text-fg">
                {{ status.multiTrackUnlocked ? 'UNLOCKED' : 'LOCKED' }}
              </dd>
            </div>
          </dl>
          <p v-if="status" class="px-5 pb-4 text-micro text-fg-faint max-w-[76ch]">
            {{ status.productionNote }}
          </p>
        </section>

        <!-- 1. IMPORT -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              1 · IMPORT
            </h2>
            <p class="mt-1 text-micro text-fg-muted max-w-[76ch]">
              Opens the system picker for one file. The file is copied into app
              storage, its SHA-256 recorded, and it is loaded once to prove it
              parses — then that session is closed again.
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <button
              type="button"
              class="px-4 py-2.5 border border-fg text-small text-fg hover:bg-fg hover:text-bg t-all disabled:opacity-40"
              :disabled="importing"
              @click="onImport"
            >
              {{ importing ? 'IMPORTING…' : 'IMPORT MODEL FILE' }}
            </button>

            <div v-if="importError" class="text-small text-danger">
              {{ importError.code }} — {{ importError.message }}
            </div>

            <div v-if="importResult?.cancelled" class="text-small text-fg-muted">
              Cancelled. Nothing was imported.
            </div>

            <div v-else-if="importResult" class="space-y-2">
              <p
                class="text-small font-semibold"
                :class="importResult.ok ? 'text-fg' : 'text-danger'"
              >
                {{ importResult.ok ? 'IMPORTED' : 'REJECTED' }}
                <span v-if="importResult.errorCode" class="ml-1 text-micro">
                  {{ importResult.errorCode }}
                </span>
              </p>
              <p class="text-small text-fg-muted max-w-[76ch]">
                {{ importResult.message }}
              </p>
              <dl v-if="importResult.ok" class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <dt class="label text-fg-muted">
                    MODEL ID
                  </dt>
                  <dd class="mt-1 text-micro text-fg break-all">
                    {{ importResult.modelId }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    SIZE
                  </dt>
                  <dd class="mt-1 text-micro text-fg">
                    {{ sizeMb(importResult.sizeBytes) }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    SHA-256
                  </dt>
                  <dd class="mt-1 text-micro text-fg break-all">
                    {{ importResult.sha256 || '—' }}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <!-- 2. MODEL + MEMORY -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              2 · CHOOSE MODEL &amp; CHECK MEMORY
            </h2>
          </div>
          <div class="px-5 py-4 space-y-4">
            <div v-if="!importedModels.length" class="text-small text-fg-muted">
              No side-loaded models. Import one first — the bundled arithmetic
              test model is not a CLAP candidate and is deliberately not listed.
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <button
                v-for="m in importedModels"
                :key="m.id"
                type="button"
                class="px-3 py-2 border text-small t-all text-left"
                :class="m.id === modelId
                  ? 'border-fg bg-fg text-bg font-semibold'
                  : 'border-line text-fg hover:border-fg'"
                @click="modelId = m.id"
              >
                {{ m.name }}
                <span class="ml-1 text-micro opacity-70">
                  {{ sizeMb(m.sizeBytes) }}
                </span>
              </button>
            </div>

            <button
              type="button"
              class="px-4 py-2.5 border border-line text-small text-fg hover:border-fg t-all disabled:opacity-40"
              :disabled="memChecking"
              @click="onMemoryCheck"
            >
              {{ memChecking ? 'CHECKING…' : 'CHECK MEMORY' }}
            </button>

            <div v-if="memError" class="text-small text-danger">
              {{ memError.code }} — {{ memError.message }}
            </div>

            <div v-if="memCheck" class="space-y-2">
              <p
                class="text-small font-semibold"
                :class="memCheck.guard.allowed ? 'text-fg' : 'text-danger'"
              >
                {{ memCheck.guard.allowed ? 'LOAD PERMITTED' : 'LOAD REFUSED' }}
                <span class="ml-1 text-micro">{{ memCheck.guard.reasonCode }}</span>
              </p>
              <p class="text-small text-fg-muted max-w-[76ch]">
                {{ memCheck.guard.explanation }}
              </p>
              <dl class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <dt class="label text-fg-muted">
                    AVAILABLE
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ memCheck.guard.availableMb }} MB
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    ESTIMATED NEED
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ memCheck.guard.estimatedRequiredMb }} MB
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    DEVICE TOTAL
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ memCheck.guard.totalMb }} MB
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    JAVA HEAP
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ memCheck.guard.javaHeapUsedMb }} /
                    {{ memCheck.guard.javaHeapLimitMb }} MB
                  </dd>
                </div>
              </dl>
              <p class="text-micro text-fg-faint max-w-[76ch]">
                {{ memCheck.guard.caveat }}
              </p>
            </div>
          </div>
        </section>

        <!-- 3. LOAD -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              3 · LOAD
            </h2>
            <p class="mt-1 text-micro text-fg-muted max-w-[76ch]">
              Creates the one and only session. The memory guard runs first and
              refuses rather than risking the freeze.
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <button
              type="button"
              class="px-4 py-2.5 border border-fg text-small text-fg hover:bg-fg hover:text-bg t-all disabled:opacity-40"
              :disabled="loading || !modelId || !!status?.loaded"
              @click="onLoad"
            >
              {{ loading ? 'LOADING…' : 'LOAD MODEL' }}
            </button>

            <div v-if="loadError" class="text-small text-danger">
              {{ loadError.code }} — {{ loadError.message }}
            </div>

            <div
              v-if="loadResult?.graphContract"
              class="border border-line bg-surface-2 px-4 py-3 space-y-1"
            >
              <p class="label text-fg-muted mb-2">
                MODEL CONTRACT (read from the graph)
              </p>
              <dl class="space-y-0.5 text-micro font-mono">
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    MODEL
                  </dt>
                  <dd class="text-fg break-all">
                    {{ loadResult.metadata.name }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    FORMAT
                  </dt>
                  <dd class="text-fg">
                    {{ loadResult.metadata.format.toUpperCase() }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    INPUT
                  </dt>
                  <dd class="text-fg break-all">
                    {{ loadResult.graphContract.inputName }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    INPUT SHAPE
                  </dt>
                  <dd class="text-fg">
                    [{{ (loadResult.graphContract.concreteInputShape
                      ?? loadResult.graphContract.inputShape).join(',') }}]
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    INPUT TYPE
                  </dt>
                  <dd class="text-fg">
                    {{ loadResult.graphContract.inputKind }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    SAMPLE RATE
                  </dt>
                  <dd class="text-fg">
                    {{ loadResult.metadata.sampleRate }} Hz
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="text-fg-muted w-32 shrink-0">
                    OUTPUT
                  </dt>
                  <dd class="text-fg">
                    [{{ loadResult.graphContract.outputShape.join(',') }}]
                  </dd>
                </div>
              </dl>
              <p class="pt-2 text-micro text-fg-faint max-w-[76ch] leading-relaxed">
                {{ loadResult.graphContract.rationale }}
              </p>
              <p
                v-if="loadResult.graphContract.inputKind === 'WAVEFORM'"
                class="text-micro text-fg-muted max-w-[76ch] leading-relaxed"
              >
                This graph computes its own mel spectrogram, so SYSTEMA feeds it
                raw 48 kHz mono samples and applies no log-mel transform.
              </p>
            </div>

            <dl v-if="loadResult" class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <dt class="label text-fg-muted">
                  LOAD TIME
                </dt>
                <dd class="mt-1 text-small text-fg">
                  {{ ms(loadResult.loadMs) }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  MODEL SIZE
                </dt>
                <dd class="mt-1 text-small text-fg">
                  {{ sizeMb(loadResult.sizeBytes) }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  INPUTS
                </dt>
                <dd class="mt-1 text-micro text-fg break-all">
                  {{ loadResult.inputNames.join(', ') || '—' }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  OUTPUTS
                </dt>
                <dd class="mt-1 text-micro text-fg break-all">
                  {{ loadResult.outputNames.join(', ') || '—' }}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- 4. VALIDATE -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              4 · VALIDATE
            </h2>
            <p class="mt-1 text-micro text-fg-muted max-w-[76ch]">
              Pushes a synthetic 440 Hz probe through the graph — not silence,
              which a broken model could pass by accident. No real audio yet.
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <button
              type="button"
              class="px-4 py-2.5 border border-fg text-small text-fg hover:bg-fg hover:text-bg t-all disabled:opacity-40"
              :disabled="validating || !status?.loaded"
              @click="onValidate"
            >
              {{ validating ? 'VALIDATING…' : 'VALIDATE MODEL' }}
            </button>

            <div v-if="validateError" class="text-small text-danger">
              {{ validateError.code }} — {{ validateError.message }}
            </div>

            <div v-if="validation" class="space-y-3">
              <p
                class="text-small font-semibold"
                :class="validation.ok ? 'text-fg' : 'text-danger'"
              >
                {{ validation.ok ? 'VALID' : 'INVALID' }}
                <span v-if="validation.failureCode" class="ml-1 text-micro">
                  {{ validation.failureCode }}
                </span>
              </p>
              <p v-if="validation.failureMessage" class="text-small text-danger max-w-[76ch]">
                {{ validation.failureMessage }}
              </p>
              <p v-if="validation.ok" class="text-small text-fg-muted">
                Embedding dimension measured from a real forward pass:
                <strong class="text-fg">{{ validation.embeddingDimension }}</strong>
                · NORMALIZED:
                <strong class="text-fg">
                  {{ validation.checks.some(c => /normali[sz]able/.test(c.name) && c.passed)
                    ? 'yes' : 'no' }}
                </strong>
              </p>
              <ul class="space-y-1">
                <li
                  v-for="c in validation.checks"
                  :key="c.name"
                  class="flex items-start gap-2 text-micro"
                >
                  <span :class="c.passed ? 'text-fg' : 'text-danger'">
                    {{ c.passed ? '✓' : '✗' }}
                  </span>
                  <span class="text-fg-muted">
                    <strong class="text-fg">{{ c.name }}</strong> — {{ c.detail }}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <!-- 5. TEST ONE TRACK -->
        <section class="border border-line" :class="status?.validated ? '' : 'opacity-60'">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              5 · TEST ONE TRACK
            </h2>
            <p class="mt-1 text-micro text-fg-muted max-w-[76ch]">
              Exactly one manually chosen file. There is no multi-track control
              on this page. Memory is sampled before and after, and the session
              is released automatically when the test finishes.
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <div v-if="!status?.validated" class="text-small text-fg-muted">
              Validate the model first. An unvalidated graph is never shown a
              real track.
            </div>

            <template v-else>
              <p class="label text-fg-muted">
                CHOOSE ONE TRACK
              </p>
              <div class="border border-line max-h-72 overflow-y-auto">
                <ul>
                  <li v-for="t in tracks" :key="t.id">
                    <button
                      type="button"
                      class="w-full px-5 py-2.5 flex items-center gap-3 text-left t-col hover:bg-surface-2"
                      @click="selectedTrackId = t.id"
                    >
                      <span
                        class="w-4 h-4 border shrink-0 rounded-full t-all"
                        :class="selectedTrackId === t.id ? 'bg-fg border-fg' : 'border-line'"
                      />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-small text-fg">{{ t.title }}</span>
                        <span class="block truncate text-micro text-fg-muted">
                          {{ t.artist }}
                        </span>
                      </span>
                    </button>
                  </li>
                </ul>
              </div>

              <button
                type="button"
                class="px-4 py-2.5 border border-fg text-small text-fg hover:bg-fg hover:text-bg t-all disabled:opacity-40"
                :disabled="!canTest"
                @click="onTestOneTrack"
              >
                {{ testing ? 'TESTING…' : 'TEST ONE TRACK' }}
              </button>
            </template>

            <div v-if="testError" class="text-small text-danger">
              {{ testError.code }} — {{ testError.message }}
            </div>

            <div v-if="testResult" class="space-y-4">
              <p
                class="text-small font-semibold"
                :class="testResult.outputValid ? 'text-fg' : 'text-danger'"
              >
                {{ testResult.outputValid ? 'EMBEDDING VALID' : 'EMBEDDING INVALID' }}
              </p>

              <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <dt class="label text-fg-muted">
                    DIMENSION
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ testResult.dimension }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    L2 NORM
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ num(testResult.l2NormAfterNormalisation) }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    WINDOWS
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ testResult.windowsProcessed }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    AUDIO
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ num(testResult.audioDurationSec, 1) }} s @
                    {{ testResult.audioSampleRate }} Hz
                  </dd>
                  <dd class="text-micro text-fg-faint">
                    source {{ testResult.sourceSampleRate }} Hz
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    DECODE
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ ms(testResult.decodeMs) }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    PREPROCESS
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ ms(testResult.preprocessingMs) }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    INFERENCE
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ ms(testResult.inferenceMs) }}
                  </dd>
                </div>
                <div>
                  <dt class="label text-fg-muted">
                    TOTAL
                  </dt>
                  <dd class="mt-1 text-small text-fg">
                    {{ ms(testResult.totalProcessingMs) }}
                  </dd>
                </div>
              </dl>

              <div class="border-t border-line pt-4">
                <p class="label text-fg-muted mb-2">
                  MEMORY LIFECYCLE
                </p>
                <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <dt class="label text-fg-muted">
                      BEFORE
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.memoryBeforeKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      PEAK
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.memoryPeakKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      AFTER
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.memoryAfterKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      RETAINED
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.retainedKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      NATIVE BEFORE
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.nativeBeforeKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      NATIVE AFTER
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ mb(testResult.nativeAfterKb) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      SESSION RELEASED
                    </dt>
                    <dd
                      class="mt-1 text-small"
                      :class="testResult.sessionReleased ? 'text-fg' : 'text-danger'"
                    >
                      {{ testResult.sessionReleased ? 'YES' : 'NO' }}
                    </dd>
                  </div>
                  <div>
                    <dt class="label text-fg-muted">
                      MULTI-TRACK
                    </dt>
                    <dd class="mt-1 text-small text-fg">
                      {{ testResult.multiTrackUnlocked ? 'UNLOCKED' : 'LOCKED' }}
                    </dd>
                  </div>
                </dl>
                <p
                  v-if="testResult.releaseError"
                  class="mt-2 text-small text-danger"
                >
                  Release error: {{ testResult.releaseError }}
                </p>
                <p class="mt-3 text-micro text-fg-faint max-w-[76ch]">
                  {{ testResult.retentionCaveat }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- 6. RELEASE -->
        <section class="border border-line">
          <div class="px-5 py-4 border-b border-line">
            <h2 class="text-small font-semibold text-fg">
              6 · RELEASE
            </h2>
            <p class="mt-1 text-micro text-fg-muted max-w-[76ch]">
              Closes the session and re-samples memory. Safe to press when
              nothing is loaded.
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <button
              type="button"
              class="px-4 py-2.5 border border-line text-small text-fg hover:border-fg t-all disabled:opacity-40"
              :disabled="releasing"
              @click="onRelease"
            >
              {{ releasing ? 'RELEASING…' : 'RELEASE SESSION' }}
            </button>

            <div v-if="releaseError" class="text-small text-danger">
              {{ releaseError.code }} — {{ releaseError.message }}
            </div>

            <dl v-if="releaseResult" class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <dt class="label text-fg-muted">
                  RELEASED
                </dt>
                <dd
                  class="mt-1 text-small"
                  :class="releaseResult.released ? 'text-fg' : 'text-danger'"
                >
                  {{ releaseResult.released ? 'YES' : 'NO' }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  BEFORE
                </dt>
                <dd class="mt-1 text-small text-fg">
                  {{ mb(releaseResult.memoryBeforeKb) }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  AFTER
                </dt>
                <dd class="mt-1 text-small text-fg">
                  {{ mb(releaseResult.memoryAfterKb) }}
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">
                  RETAINED
                </dt>
                <dd class="mt-1 text-small text-fg">
                  {{ mb(releaseResult.retainedKb) }}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
