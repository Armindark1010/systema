<script setup lang="ts">
// ============================================================
// SYSTEMA — ONNX runtime lab (Phase 15)
// ============================================================
// Where a developer explicitly chooses a RUNTIME and a MODEL and
// presses MEASURE (§9).
//
// Two things happen on this page, and they are kept visibly separate:
//
//   1. THE INTEGRATION PROOF — run the deterministic test model and
//      check its output against [9,25,49,81], a value known before
//      the run. If ONNX Runtime is not genuinely executing a real
//      .onnx file, this cannot pass.
//
//   2. THE REAL-AUDIO BENCHMARK — decode chosen tracks and push them
//      through the chosen model, timing each stage separately.
//
// What this page will not do
// --------------------------
// It never selects tracks for you, never runs on the whole library,
// never falls back to another runtime when the chosen one fails, and
// never displays a number it did not receive from native code. A
// failed run shows the error code, not a blank or a zero.
// ============================================================

import { useLibraryStore } from '~/stores/library'
import {
  getCapabilities,
  runTestModel,
  runRealAudio,
  describeEnvironment,
  MAX_BENCHMARK_TRACKS,
  InferenceServiceError,
} from '~/services/native/inferenceService'
import {
  isInferenceAvailable,
  matchesExpected,
  expectedTestOutput,
  TEST_MODEL_INPUT,
  TEST_MODEL_EXPECTED_OUTPUT,
  RUNTIME_ONNX,
  RUNTIME_REFERENCE,
  type RuntimeId,
  type InferenceCapabilities,
  type OutputContractReport,
  type RealAudioResult,
  type TestModelResult,
} from '~/services/native/inferencePlugin'

definePageMeta({ layout: 'dev' })
useHead({ title: 'ONNX runtime lab' })

const library = useLibraryStore()
const router = useRouter()

const available = isInferenceAvailable()

// ---- Capabilities -------------------------------------------------
const caps = ref<InferenceCapabilities | null>(null)
const capsError = ref<string | null>(null)

async function loadCapabilities() {
  if (!available) return
  try {
    caps.value = await getCapabilities()

    // Default to ONNX using the CANONICAL id, not a literal.
    //
    // This line previously compared against 'onnx' while native
    // advertised 'onnxruntime', so the match silently failed and the
    // page fell through to `runtimes[0]`. Using the shared constant
    // means a rename cannot reintroduce that.
    const onnx = caps.value.runtimes.find(r => r.id === RUNTIME_ONNX)
    runtimeId.value = onnx?.id ?? RUNTIME_ONNX

    // NOTE: deliberately no `?? runtimes[0]?.id`. Picking whatever
    // runtime happens to be first would quietly select the reference
    // runtime when ONNX is unavailable — precisely the silent fallback
    // §13 forbids. If ONNX is missing, the selection stays on ONNX,
    // its button renders as UNAVAILABLE, and pressing MEASURE fails
    // with RUNTIME_UNAVAILABLE. Visible failure beats a quiet swap.
    modelId.value = caps.value.models[0]?.id ?? ''
  } catch (e) {
    capsError.value = (e as Error).message
  }
}

onMounted(() => {
  void loadCapabilities()
  if (available && !library.tracks.length) void library.loadFirstPage().catch(() => {})
})

// ---- Explicit selection (§9) --------------------------------------
const runtimeId = ref<RuntimeId>(RUNTIME_ONNX)
const modelId = ref('')

const selectedRuntime = computed(() =>
  caps.value?.runtimes.find(r => r.id === runtimeId.value) ?? null)
const selectedModel = computed(() =>
  caps.value?.models.find(m => m.id === modelId.value) ?? null)

/**
 * The reference runtime implements only the test transform, so
 * pairing it with a side-loaded model is a guaranteed failure. Saying
 * so up front is better than letting someone hit MEASURE and read an
 * error.
 */
const pairingWarning = computed(() => {
  if (runtimeId.value !== RUNTIME_REFERENCE) return null
  if (!selectedModel.value || selectedModel.value.kind === 'test') return null
  return 'The reference runtime only computes the deterministic test transform. '
    + 'It cannot execute a side-loaded model, and it will refuse rather than '
    + 'return a fabricated number. Choose the ONNX runtime for real models.'
})

// ---- 1. Integration proof -----------------------------------------
const testResult = ref<TestModelResult | null>(null)
const testError = ref<{ code: string, message: string } | null>(null)
const testRunning = ref(false)
const iterations = ref(10)

const testPassed = computed(() => {
  if (!testResult.value) return null
  return matchesExpected(testResult.value.output, TEST_MODEL_EXPECTED_OUTPUT)
    && testResult.value.deterministic
})

async function onRunTest() {
  if (testRunning.value) return
  testRunning.value = true
  testError.value = null
  testResult.value = null
  try {
    testResult.value = await runTestModel({
      runtimeId: runtimeId.value,
      input: [...TEST_MODEL_INPUT],
      iterations: iterations.value,
    })
  } catch (e) {
    const err = e as InferenceServiceError
    testError.value = { code: err.code ?? 'UNKNOWN', message: err.message }
  } finally {
    testRunning.value = false
  }
}

// ---- 2. Real-audio benchmark --------------------------------------
const tracks = computed(() => library.tracks.slice(0, 100))
const selected = ref<string[]>([])
const atCap = computed(() => selected.value.length >= MAX_BENCHMARK_TRACKS)

function toggle(trackId: string) {
  if (selected.value.includes(trackId)) {
    selected.value = selected.value.filter(id => id !== trackId)
    return
  }
  if (atCap.value) return
  selected.value = [...selected.value, trackId]
}

const audioResult = ref<RealAudioResult | null>(null)
const audioError = ref<{ code: string, message: string } | null>(null)
const audioRunning = ref(false)

async function onRunAudio() {
  if (audioRunning.value || !selected.value.length) return
  audioRunning.value = true
  audioError.value = null
  audioResult.value = null
  try {
    const chosen = selected.value
      .map(id => tracks.value.find(t => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t && !!t.uri)
      .map(t => ({ trackId: t.id, uri: t.uri as string }))

    if (!chosen.length) {
      audioError.value = {
        code: 'INPUT_SHAPE_MISMATCH',
        message: 'The selected tracks have no readable file URI.',
      }
      return
    }

    audioResult.value = await runRealAudio({
      runtimeId: runtimeId.value,
      modelId: modelId.value,
      tracks: chosen,
    })
  } catch (e) {
    const err = e as InferenceServiceError
    audioError.value = { code: err.code ?? 'UNKNOWN', message: err.message }
  } finally {
    audioRunning.value = false
  }
}

const okRows = computed(() => audioResult.value?.measurements.filter(m => m.ok) ?? [])

function median(values: number[]): number | null {
  const v = values.filter(n => Number.isFinite(n))
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * The number this whole phase exists to produce: what the MODEL
 * itself costs, separated from decode and preprocessing.
 */
const summary = computed(() => {
  const rows = okRows.value
  if (!rows.length) return null
  return {
    count: rows.length,
    decode: median(rows.map(r => r.decodeMs ?? NaN)),
    preprocessing: median(rows.map(r => r.preprocessingMs ?? NaN)),
    inference: median(rows.map(r => r.inferenceMs ?? NaN)),
    tensor: median(rows.map(r => r.tensorMs ?? NaN)),
    total: median(rows.map(r => r.totalMs ?? NaN)),
    rtf: median(rows.map(r => r.rtf ?? NaN)),
  }
})

function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}

/**
 * Green only when the run actually read the embedding tensor.
 *
 * For YAMNet it will be amber: the runtime reads output_0 (class
 * scores) while the embeddings sit in output_1, unread.
 */
/**
 * Raised when the tensor that was read is not the embedding.
 *
 * This is the YAMNet case: the timings are real, but they describe a
 * run that produced class scores. Presenting that without comment is
 * exactly how "out dim 208921" came to look like an embedding width.
 */
const contractWarning = computed(() => {
  const withContract = okRows.value.filter(m => m.outputContract)
  if (!withContract.length) return null
  const first = withContract[0]!.outputContract!
  if (first.embeddingOutputName === null) return null
  if (first.embeddingOutputIndex === first.selectedIndex) return null
  return `The benchmark read '${first.selectedName}' (${first.selectedRole}), not ` +
    `the embedding tensor '${first.embeddingOutputName}'. The timings are real, ` +
    `but the ${first.rawOutputElements} reported elements are a flattened ` +
    `${first.selectedRole.toLowerCase().replace('_', ' ')} tensor. Output ` +
    `selection has deliberately NOT been changed — this is an audit.`
})

function embeddingTone(contract: OutputContractReport): string {
  if (contract.embeddingOutputName === null) return 'text-fg-faint'
  return contract.embeddingOutputIndex === contract.selectedIndex
    ? 'text-success'
    : 'text-warning'
}

function titleFor(trackId: string): string {
  return tracks.value.find(t => t.id === trackId)?.title ?? trackId
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
          ONNX runtime lab
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Choose a runtime and a model, then measure. Nothing runs automatically.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <LabBanner tone="warning" title="NO PRODUCTION MODEL HAS BEEN CHOSEN">
        Phase 15 builds the runtime, not the model choice. The only model that
        ships with the app is a
        <strong class="text-fg">423-byte arithmetic test model</strong> that
        computes (x·2+1)² — it proves ONNX Runtime really executes, and it is not
        audio intelligence. Real candidate models must be side-loaded by hand;
        no weights are in the repository.
      </LabBanner>

      <LabBanner v-if="!available" tone="danger" title="NATIVE INFERENCE UNAVAILABLE">
        The inference plugin is not present in this environment. This page works
        on the Android build only — there is no browser ONNX runtime here, and a
        simulated one would produce numbers that mean nothing. No placeholder
        results are shown.
      </LabBanner>

      <LabBanner v-else-if="capsError" tone="danger" title="COULD NOT READ CAPABILITIES">
        {{ capsError }}
      </LabBanner>

      <template v-if="available && caps">
        <!-- ---- Environment ------------------------------- -->
        <LabBanner tone="info" title="MEASUREMENT CONDITIONS">
          {{ caps.environment.deviceManufacturer }} {{ caps.environment.deviceModel }} ·
          Android {{ caps.environment.androidVersion }} (API {{ caps.environment.apiLevel }}) ·
          {{ describeEnvironment(caps.environment) }}.
          <span class="block mt-1">
            Screen state matters: the same track measured
            <strong class="text-fg">2.32× slower with the screen off</strong> on this
            device in Phase 14. Never compare runs taken in different states.
          </span>
        </LabBanner>

        <!-- ---- Step 1: choose runtime + model ------------ -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              STEP 1 — CHOOSE RUNTIME AND MODEL
            </p>
          </div>
          <div class="px-5 py-4 space-y-5">
            <div>
              <p class="label text-fg-muted mb-2">
                RUNTIME
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="rt in caps.runtimes"
                  :key="rt.id"
                  type="button"
                  class="px-3 py-2 border text-small t-all"
                  :class="rt.id === runtimeId
                    ? 'border-fg bg-fg text-bg font-semibold'
                    : rt.available
                      ? 'border-line text-fg hover:border-fg'
                      : 'border-line text-fg-faint'"
                  :disabled="!rt.available"
                  @click="runtimeId = rt.id"
                >
                  {{ rt.label }}
                  <span v-if="!rt.available" class="ml-1 text-micro">UNAVAILABLE</span>
                </button>
              </div>
            </div>

            <div>
              <p class="label text-fg-muted mb-2">
                MODEL
              </p>
              <div v-if="!caps.models.length" class="text-small text-fg-muted">
                No models installed.
              </div>
              <div v-else class="flex flex-wrap gap-2">
                <button
                  v-for="m in caps.models"
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
                    {{ m.kind === 'test' ? 'TEST' : 'SIDE-LOADED' }} ·
                    {{ (m.sizeBytes / 1024).toFixed(0) }} KB
                  </span>
                </button>
              </div>
              <p class="mt-3 text-small text-fg-faint leading-relaxed">
                To add a candidate model, push a <code>.onnx</code> file to:<br>
                <code class="text-fg-muted break-all">{{ caps.sideloadPath }}</code>
              </p>
            </div>

            <LabBanner v-if="pairingWarning" tone="warning" title="RUNTIME / MODEL MISMATCH">
              {{ pairingWarning }}
            </LabBanner>
          </div>
        </section>

        <!-- ---- Step 2: integration proof ----------------- -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              STEP 2 — INTEGRATION PROOF (DETERMINISTIC TEST MODEL)
            </p>
          </div>
          <div class="px-5 py-4 space-y-4">
            <p class="text-small text-fg-muted max-w-[74ch] leading-relaxed">
              Runs <code>[1, 2, 3, 4]</code> through the real
              <code>.onnx</code> file. The correct answer —
              <code>[9, 25, 49, 81]</code> — is known before the run, so a wrong
              result is unambiguous. This is the check that separates
              "the code compiles" from "inference actually happened".
            </p>

            <div class="flex flex-wrap items-center gap-3">
              <label class="text-small text-fg-muted">
                Iterations
                <input
                  v-model.number="iterations"
                  type="number"
                  min="1"
                  max="100"
                  class="ml-2 w-20 bg-bg border border-line px-2 py-1 text-fg tnum"
                >
              </label>
              <button
                type="button"
                class="sys-btn"
                :disabled="testRunning"
                @click="onRunTest"
              >
                {{ testRunning ? 'RUNNING…' : 'RUN TEST MODEL' }}
              </button>
            </div>

            <div
              v-if="testError"
              class="border border-danger/40 bg-danger/5 px-4 py-3"
            >
              <p class="label text-danger">
                {{ testError.code }}
              </p>
              <p class="mt-1 text-small text-fg-muted leading-relaxed">
                {{ testError.message }}
              </p>
            </div>

            <div v-if="testResult" class="space-y-3">
              <div
                class="border px-4 py-3"
                :class="testPassed
                  ? 'border-success/40 bg-success/5'
                  : 'border-danger/40 bg-danger/5'"
              >
                <p class="label" :class="testPassed ? 'text-success' : 'text-danger'">
                  {{ testPassed ? 'REAL INFERENCE VERIFIED' : 'OUTPUT MISMATCH' }}
                </p>
                <p class="mt-1 text-small text-fg-muted tnum">
                  in [{{ testResult.input.join(', ') }}] →
                  out [{{ testResult.output.map(v => v.toFixed(2)).join(', ') }}]
                </p>
                <p class="mt-1 text-small text-fg-faint tnum">
                  expected [{{ expectedTestOutput(testResult.input).join(', ') }}]
                  · deterministic across {{ testResult.iterations }} runs:
                  {{ testResult.deterministic ? 'YES' : 'NO' }}
                </p>
              </div>

              <dl class="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line">
                <div class="bg-surface px-4 py-3">
                  <dt class="label text-fg-muted">
                    COLD LOAD
                  </dt>
                  <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                    {{ fmt(testResult.coldLoadMs) }} ms
                  </dd>
                </div>
                <div class="bg-surface px-4 py-3">
                  <dt class="label text-fg-muted">
                    FIRST INFERENCE
                  </dt>
                  <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                    {{ fmt(testResult.firstInferenceMs, 3) }} ms
                  </dd>
                </div>
                <div class="bg-surface px-4 py-3">
                  <dt class="label text-fg-muted">
                    WARM INFERENCE
                  </dt>
                  <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                    {{ fmt(testResult.warmInferenceMs, 3) }} ms
                  </dd>
                </div>
                <div class="bg-surface px-4 py-3">
                  <dt class="label text-fg-muted">
                    MODEL SIZE
                  </dt>
                  <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                    {{ testResult.modelSizeBytes }} B
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <!-- ---- Step 3: real audio ------------------------ -->
        <section class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3 flex items-center justify-between gap-3">
            <p class="label text-fg-muted">
              STEP 3 — REAL AUDIO ({{ selected.length }}/{{ MAX_BENCHMARK_TRACKS }})
            </p>
            <button
              v-if="selected.length"
              type="button"
              class="label text-fg-muted hover:text-fg t-col"
              @click="selected = []"
            >
              CLEAR
            </button>
          </div>

          <div class="px-5 py-4">
            <p class="text-small text-fg-muted max-w-[74ch] leading-relaxed">
              Decode a track, prepare it for the selected model, run inference.
              Each stage is timed separately so the model's own cost is visible
              rather than buried in decode time. Maximum
              {{ MAX_BENCHMARK_TRACKS }} tracks — this is a benchmark, never a
              library scan.
            </p>
          </div>

          <div v-if="!tracks.length" class="px-5 pb-4">
            <p class="text-small text-fg-muted">
              No tracks indexed. Scan your library from the
              <button
                type="button"
                class="underline hover:text-fg"
                @click="router.push('/dev/ai-benchmark/real-audio')"
              >
                real audio page
              </button>.
            </p>
          </div>

          <ul v-else class="max-h-80 overflow-y-auto divide-y divide-line border-t border-line">
            <li v-for="t in tracks" :key="t.id">
              <button
                type="button"
                class="w-full px-5 py-2.5 flex items-center gap-3 text-left t-col hover:bg-surface-2"
                :disabled="atCap && !selected.includes(t.id)"
                @click="toggle(t.id)"
              >
                <span
                  class="w-4 h-4 border shrink-0 t-all"
                  :class="selected.includes(t.id) ? 'bg-fg border-fg' : 'border-line'"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-small text-fg">{{ t.title }}</span>
                  <span class="block truncate text-micro text-fg-faint">{{ t.artist }}</span>
                </span>
              </button>
            </li>
          </ul>

          <div class="border-t border-line px-5 py-4">
            <button
              type="button"
              class="sys-btn"
              :disabled="audioRunning || !selected.length || !modelId"
              @click="onRunAudio"
            >
              {{ audioRunning ? 'MEASURING…' : `MEASURE ${selected.length} TRACK(S)` }}
            </button>
          </div>
        </section>

        <!-- ---- Results ----------------------------------- -->
        <div
          v-if="audioError"
          class="border border-danger/40 bg-danger/5 px-5 py-4"
        >
          <p class="label text-danger">
            {{ audioError.code }}
          </p>
          <p class="mt-1 text-small text-fg-muted leading-relaxed">
            {{ audioError.message }}
          </p>
        </div>

        <LabBanner
          v-if="contractWarning"
          tone="warning"
          title="THIS RUN DID NOT MEASURE AN EMBEDDING"
        >
          {{ contractWarning }}
        </LabBanner>

        <section v-if="audioResult" class="border border-line bg-surface">
          <div class="border-b border-line px-5 py-3">
            <p class="label text-fg-muted">
              RESULTS — {{ audioResult.runtimeLabel }} · {{ audioResult.modelId }}
            </p>
          </div>

          <div class="px-5 py-4 space-y-2">
            <p class="text-small text-fg-muted">
              Cold model load: <span class="tnum text-fg">{{ fmt(audioResult.coldLoadMs) }} ms</span>,
              paid once for the whole batch. Per-track figures below are warm inference.
            </p>
            <p class="text-micro text-fg-faint leading-relaxed">
              <strong class="text-fg-muted">TOTAL = decode + prep + inference + tensor.</strong>
              <span class="block">
                <strong class="text-fg-muted">inference</strong> times
                <code>session.run()</code> alone — it excludes decoding,
                preprocessing, tensor allocation, output conversion and UI
                rendering. <strong class="text-fg-muted">tensor</strong> is
                the allocation and read-back around it. Cold load is not in
                TOTAL, because it is paid once rather than per track.
              </span>
            </p>
            <p
              v-if="selectedModel?.kind === 'test'"
              class="text-micro text-warning leading-relaxed"
            >
              This is the arithmetic test model, which is element-wise: it
              emits one float per input sample, so <strong>raw output elements
                equals the decoded sample count, not an embedding size</strong>.
              It measures the pipeline, not audio understanding.
            </p>
          </div>

          <dl
            v-if="summary"
            class="grid grid-cols-2 md:grid-cols-6 gap-px bg-line border-y border-line"
          >
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN DECODE
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.decode, 0) }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN PREP
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.preprocessing, 1) }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN INFERENCE
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.inference, 1) }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN TENSOR
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.tensor, 1) }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN TOTAL
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.total, 0) }} ms
              </dd>
            </div>
            <div class="bg-surface px-4 py-3">
              <dt class="label text-fg-muted">
                MEDIAN RTF
              </dt>
              <dd class="mt-1 tnum text-[15px] font-bold text-fg">
                {{ fmt(summary.rtf, 3) }}
              </dd>
            </div>
          </dl>

          <ul class="divide-y divide-line">
            <li
              v-for="m in audioResult.measurements"
              :key="m.trackId"
              class="px-5 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <p class="text-small text-fg truncate">
                  {{ titleFor(m.trackId) }}
                </p>
                <span
                  class="label shrink-0"
                  :class="m.ok ? 'text-success' : 'text-danger'"
                >{{ m.ok ? 'OK' : (m.errorCode ?? 'FAILED') }}</span>
              </div>
              <p v-if="m.ok" class="mt-1 text-micro text-fg-faint tnum">
                decode {{ fmt(m.decodeMs, 0) }} ms ·
                prep {{ fmt(m.preprocessingMs, 1) }} ms ·
                inference {{ fmt(m.inferenceMs, 1) }} ms ·
                tensor {{ fmt(m.tensorMs, 1) }} ms ·
                total {{ fmt(m.totalMs, 0) }} ms ·
                rtf {{ fmt(m.rtf, 3) }} ·
                raw output elements {{ m.outputDimension }}
              </p>

              <!-- ---- OUTPUT CONTRACT (audit diagnostics) ---- -->
              <!--
                Added after "out dim 208921" was displayed for YAMNet
                with no way to tell it was 401 frames x 521 AudioSet
                classes rather than an embedding. Everything here is
                read from the tensors ONNX Runtime returned.
              -->
              <details v-if="m.ok && m.outputContract" class="mt-2">
                <summary class="label text-fg-muted hover:text-fg cursor-pointer t-col">
                  OUTPUT CONTRACT ({{ m.outputContract.outputs.length }} OUTPUTS)
                </summary>

                <div class="mt-2 space-y-2 border-l border-line pl-3">
                  <div
                    v-for="o in m.outputContract.outputs"
                    :key="o.name"
                    class="space-y-0.5"
                  >
                    <p class="text-micro">
                      <span class="text-fg font-bold">{{ o.name }}</span>
                      <span
                        v-if="o.selected"
                        class="ml-2 label text-warning"
                      >← READ BY THIS RUN</span>
                    </p>
                    <p class="text-micro text-fg-faint tnum">
                      shape: [{{ o.shape.join(', ') }}] ·
                      type: {{ o.type }} ·
                      elements: {{ o.elementCount ?? 'UNKNOWN' }}
                    </p>
                    <p class="text-micro text-fg-muted leading-relaxed">
                      meaning: {{ o.meaning }}
                    </p>
                  </div>

                  <dl class="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                    <div>
                      <dt class="label text-fg-muted">
                        SELECTED OUTPUT
                      </dt>
                      <dd class="text-micro text-fg tnum">
                        {{ m.outputContract.selectedName ?? 'UNKNOWN' }}
                        ({{ m.outputContract.selectedRole }})
                      </dd>
                    </div>
                    <div>
                      <dt class="label text-fg-muted">
                        EMBEDDING OUTPUT
                      </dt>
                      <dd class="text-micro tnum" :class="embeddingTone(m.outputContract)">
                        {{ m.outputContract.embeddingOutputName ?? 'NONE FOUND' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="label text-fg-muted">
                        FRAME COUNT
                      </dt>
                      <dd class="text-micro text-fg tnum">
                        {{ m.outputContract.frameCount ?? 'UNKNOWN' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="label text-fg-muted">
                        EMBEDDING DIMENSION
                      </dt>
                      <dd class="text-micro text-fg tnum">
                        {{ m.outputContract.embeddingDimension ?? 'UNKNOWN' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="label text-fg-muted">
                        RAW OUTPUT ELEMENTS
                      </dt>
                      <dd class="text-micro text-fg tnum">
                        {{ m.outputContract.rawOutputElements }}
                      </dd>
                    </div>
                    <div>
                      <dt class="label text-fg-muted">
                        IS ONE VECTOR?
                      </dt>
                      <dd
                        class="text-micro tnum"
                        :class="m.outputContract.isSingleEmbeddingVector
                          ? 'text-success' : 'text-warning'"
                      >
                        {{ m.outputContract.isSingleEmbeddingVector ? 'YES' : 'NO' }}
                      </dd>
                    </div>
                  </dl>

                  <p class="text-micro text-fg-muted leading-relaxed pt-1">
                    <span class="label text-fg-muted">EXPLANATION</span><br>
                    {{ m.outputContract.explanation }}
                  </p>

                  <p
                    v-if="m.outputContract.aggregationRequired"
                    class="text-micro text-warning leading-relaxed"
                  >
                    POOLING REQUIRED — these are per-frame embeddings. A track-level
                    vector needs aggregation across frames, which is NOT implemented.
                    No pooling has been applied to this measurement.
                  </p>
                </div>
              </details>
              <p v-else class="mt-1 text-micro text-fg-muted leading-relaxed">
                {{ m.errorMessage }}
              </p>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
