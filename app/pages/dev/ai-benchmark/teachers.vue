<script setup lang="ts">
// ============================================================
// SYSTEMA — Phase 19 teacher & distillation lab
// ============================================================
// Shows the teacher registry, the shared-space contract check, and
// the distillation pipeline status.
//
// THE THING THIS PAGE MUST NOT DO
// -------------------------------
// Look like an experiment that ran. No teacher could be obtained, so
// there are no music results here. The page leads with that, and every
// evidence grade (FACT / MEASURED / UNVERIFIED / BLOCKED) is rendered
// as a chip next to the value it qualifies, so a published number can
// never be read as a measured one.
//
// INCREMENTAL PROGRESS (UI requirement)
// -------------------------------------
// The run log emits one entry per step and renders as it goes, with a
// bounded history, so a long experiment never looks frozen and never
// grows the DOM without limit. Nothing waits for a whole phase to
// finish before showing anything.
//
// STATE DISCIPLINE (carried from Phase 18)
// ----------------------------------------
// No embeddings, tensors or matrices in reactive state — only small
// summary records.
// ============================================================

import {
  TEACHERS,
  PHASE_19_NETWORK_PROBE,
  TEACHER_WEIGHTS_STATUS,
  PHASE_19_DECISION,
  PHASE_19_DECISION_REASON,
  PHASE_19_ANSWERS,
  NO_AUTO_SELECTION_NOTICE,
  STUDENT_DIMENSION_CANDIDATES,
  makeStudentContract,
  validateTeacherContract,
  type Evidence,
} from '~/data/phase19Teachers'

definePageMeta({ layout: 'dev' })
useHead({ title: 'Teacher & distillation lab' })

const router = useRouter()

// ---- Bounded, incremental run log --------------------------------
interface LogEntry { id: number; label: string; status: 'OK' | 'BLOCKED' | 'INFO' }
const MAX_LOG = 60
const runLog = ref<LogEntry[]>([])
const running = ref(false)
let seq = 0

function emit(label: string, status: LogEntry['status']) {
  runLog.value.push({ id: seq++, label, status })
  // Bounded history: old entries are dropped rather than accumulating.
  if (runLog.value.length > MAX_LOG) runLog.value.splice(0, runLog.value.length - MAX_LOG)
}

/** Yield to the browser so each step paints — never a frozen page. */
const tick = () => new Promise(r => setTimeout(r, 90))

async function runContractCheck() {
  if (running.value) return
  running.value = true
  runLog.value = []

  emit('Phase 19 shared-space contract check — starting', 'INFO')
  await tick()

  for (const t of TEACHERS) {
    const res = validateTeacherContract({
      teacherId: t.teacherId,
      audioDim: t.audioEmbeddingDim.value,
      textDim: t.textEmbeddingDim.value,
      l2Normalized: true,
    })
    if (res.ok) emit(`${t.displayName}: shared space ${res.sharedDim}-d — CONTRACT OK`, 'OK')
    else emit(`${t.displayName}: ${res.reason}`, 'BLOCKED')
    await tick()
  }

  emit('Teacher weight availability', 'INFO')
  await tick()
  for (const t of TEACHERS) {
    emit(`${t.displayName}: ${t.weightsAvailability}`, 'BLOCKED')
    await tick()
  }

  emit('Teacher audio→audio: BLOCKED — WEIGHTS UNAVAILABLE', 'BLOCKED')
  await tick()
  emit('Teacher text→audio: BLOCKED — WEIGHTS UNAVAILABLE', 'BLOCKED')
  await tick()

  for (const d of STUDENT_DIMENSION_CANDIDATES) {
    const c = makeStudentContract(d)
    emit(`${c.studentId}: contract ${c.outputName}[1, ${c.embeddingDimension}], L2=${c.l2Normalized} — declared, NOT benchmarked on device`, 'INFO')
    await tick()
  }

  emit('Run complete — no music measurement was produced', 'INFO')
  running.value = false
}

function evidenceClass(e: Evidence): string {
  switch (e) {
    case 'MEASURED': return 'bg-success/15 text-success border-success/40'
    case 'FACT': return 'bg-primary/15 text-primary border-primary/40'
    case 'BLOCKED': return 'bg-danger/15 text-danger border-danger/40'
    default: return 'bg-warning/15 text-warning border-warning/40'
  }
}

function statusClass(s: LogEntry['status']): string {
  if (s === 'OK') return 'text-success'
  if (s === 'BLOCKED') return 'text-danger'
  return 'text-fg-muted'
}

function fmt(v: number | null): string {
  return v === null ? 'UNKNOWN' : String(v)
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
          Teacher models &amp; distillation
        </h1>
        <p class="mt-2 text-small text-fg-muted max-w-[76ch] leading-relaxed">
          Developer Diagnostic — Not a Production Feature. Phase 19
          investigation into distilling a music/text-aware teacher into a
          small on-device student.
        </p>
      </div>
    </header>

    <div class="sys-container py-8 space-y-8">
      <LabBanner tone="danger" :title="`PHASE 19 RESULT — ${PHASE_19_DECISION}`">
        <p class="leading-relaxed">{{ PHASE_19_DECISION_REASON }}</p>
        <p class="mt-3 font-bold text-fg">{{ NO_AUTO_SELECTION_NOTICE }}</p>
      </LabBanner>

      <LabBanner tone="warning" title="BLOCKED — WEIGHTS UNAVAILABLE">
        <p class="leading-relaxed">{{ TEACHER_WEIGHTS_STATUS }}</p>
        <p class="mt-3 leading-relaxed">
          YAMNet remains the only device-verified model and is
          <strong class="text-fg">not replaced</strong>. Its measured
          SIMILAR-vs-DIFFERENT AUC of
          <strong class="text-fg">0.3125</strong> still stands as the
          baseline to beat.
        </p>
      </LabBanner>

      <!-- ---- Network probe ------------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">NETWORK PROBE — RE-RUN FOR PHASE 19</p>
        </div>
        <ul class="divide-y divide-line">
          <li
            v-for="p in PHASE_19_NETWORK_PROBE"
            :key="p.host"
            class="flex items-center justify-between gap-4 px-5 py-2.5"
          >
            <span class="font-mono text-small text-fg">{{ p.host }}</span>
            <span
              class="label"
              :class="p.result.startsWith('REACHABLE') ? 'text-success' : 'text-danger'"
            >{{ p.result }}</span>
          </li>
        </ul>
      </section>

      <!-- ---- Teacher registry ---------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">
            TEACHER REGISTRY — EVERY VALUE CARRIES ITS EVIDENCE GRADE
          </p>
        </div>
        <ul class="divide-y divide-line">
          <li v-for="t in TEACHERS" :key="t.teacherId" class="px-5 py-4 space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <p class="font-bold text-fg">{{ t.displayName }}</p>
              <div class="flex flex-wrap gap-2">
                <span class="label px-2 py-0.5 border border-danger/40 bg-danger/15 text-danger">
                  {{ t.weightsAvailability }}
                </span>
                <span
                  class="label px-2 py-0.5 border"
                  :class="t.licenseConcern === 'NONE'
                    ? 'border-success/40 bg-success/15 text-success'
                    : 'border-warning/40 bg-warning/15 text-warning'"
                >{{ t.licenseConcern }}</span>
              </div>
            </div>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <div>
                <dt class="label text-fg-muted">AUDIO DIM</dt>
                <dd class="text-small font-mono text-fg">
                  {{ fmt(t.audioEmbeddingDim.value) }}
                  <span class="label ml-1 px-1 border" :class="evidenceClass(t.audioEmbeddingDim.evidence)">
                    {{ t.audioEmbeddingDim.evidence }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">TEXT DIM</dt>
                <dd class="text-small font-mono text-fg">
                  {{ fmt(t.textEmbeddingDim.value) }}
                  <span class="label ml-1 px-1 border" :class="evidenceClass(t.textEmbeddingDim.evidence)">
                    {{ t.textEmbeddingDim.evidence }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">SHARED DIM</dt>
                <dd class="text-small font-mono text-fg">
                  {{ fmt(t.sharedEmbeddingDim.value) }}
                  <span class="label ml-1 px-1 border" :class="evidenceClass(t.sharedEmbeddingDim.evidence)">
                    {{ t.sharedEmbeddingDim.evidence }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">LICENSE</dt>
                <dd class="text-small text-fg">
                  {{ t.license.value }}
                  <span class="label ml-1 px-1 border" :class="evidenceClass(t.license.evidence)">
                    {{ t.license.evidence }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="label text-fg-muted">SAMPLE RATE</dt>
                <dd class="text-small font-mono text-fg">{{ fmt(t.inputSampleRateHz.value) }}</dd>
              </div>
              <div>
                <dt class="label text-fg-muted">WINDOW</dt>
                <dd class="text-small font-mono text-fg">{{ fmt(t.audioWindowSeconds.value) }}s</dd>
              </div>
              <div>
                <dt class="label text-fg-muted">SIZE MB</dt>
                <dd class="text-small font-mono text-fg">{{ fmt(t.modelSizeMb.value) }}</dd>
              </div>
              <div>
                <dt class="label text-fg-muted">ONNX</dt>
                <dd class="text-small text-fg">{{ t.onnxAvailable.value }}</dd>
              </div>
            </dl>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <p class="text-small text-fg-muted leading-relaxed">
                <span class="label">AUDIO→AUDIO:</span> {{ t.measuredAudioAudio }}
              </p>
              <p class="text-small text-fg-muted leading-relaxed">
                <span class="label">TEXT→AUDIO:</span> {{ t.measuredTextAudio }}
              </p>
            </div>

            <p class="text-small text-warning leading-relaxed">
              PERSIAN: {{ t.persianTextSupport }} — {{ t.persianNote }}
            </p>
            <p class="text-small text-fg-muted leading-relaxed max-w-[76ch]">
              DISTILLABLE: {{ t.distillable.value }}
            </p>
          </li>
        </ul>
      </section>

      <!-- ---- Incremental run ----------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <p class="label text-fg-muted">CONTRACT CHECK — INCREMENTAL</p>
          <button
            type="button"
            class="sys-btn-outline"
            :disabled="running"
            @click="runContractCheck"
          >
            {{ running ? 'RUNNING…' : 'RUN CHECK' }}
          </button>
        </div>
        <p v-if="!runLog.length" class="px-5 py-4 text-small text-fg-muted">
          Validates each teacher's audio/text shared-space contract and reports
          weight availability, one step at a time.
        </p>
        <ul v-else class="divide-y divide-line max-h-[420px] overflow-y-auto">
          <li v-for="e in runLog" :key="e.id" class="flex gap-3 px-5 py-2">
            <span class="label shrink-0" :class="statusClass(e.status)">
              {{ e.status === 'OK' ? '✓' : e.status === 'BLOCKED' ? '✕' : '•' }}
            </span>
            <span class="text-small text-fg leading-relaxed">{{ e.label }}</span>
          </li>
        </ul>
      </section>

      <!-- ---- The ten questions --------------------------------- -->
      <section class="border border-line bg-surface">
        <div class="border-b border-line px-5 py-3">
          <p class="label text-fg-muted">THE TEN PHASE 19 QUESTIONS</p>
        </div>
        <ol class="divide-y divide-line">
          <li v-for="(item, i) in PHASE_19_ANSWERS" :key="item.q" class="px-5 py-3">
            <div class="flex items-start gap-3">
              <span class="label text-fg-muted shrink-0">{{ i + 1 }}</span>
              <div class="min-w-0">
                <p class="text-small font-bold text-fg">{{ item.q }}</p>
                <p class="mt-1 text-small text-fg-muted leading-relaxed">{{ item.a }}</p>
              </div>
              <span
                class="label px-2 py-0.5 border shrink-0"
                :class="evidenceClass(item.status)"
              >{{ item.status }}</span>
            </div>
          </li>
        </ol>
      </section>

      <p class="text-small text-fg-muted leading-relaxed max-w-[76ch]">
        Phase 19 is an investigation. Training never runs on device — the
        Android app is inference-only, and the distillation pipeline lives in
        scripts/phase19/. No production model was selected.
      </p>
    </div>
  </div>
</template>
