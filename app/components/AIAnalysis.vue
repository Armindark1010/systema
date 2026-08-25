<script setup lang="ts">
// ============================================================
// AIAnalysis — library analysis telemetry (frontend only)
// 3,921 TRACKS · 3,421 ANALYZED · 500 REMAINING
// Modes: CHARGING ONLY · CHARGING + IDLE · MANUAL
// ============================================================

import type { AnalysisMode } from '~/types'

const emit = defineEmits<{ start: [] }>()
const { analysis } = useAI()
const { state } = analysis

const modes: { value: AnalysisMode; label: string; desc: string }[] = [
  { value: 'charging', label: 'CHARGING ONLY', desc: 'ANALYZE WHILE DEVICE CHARGES' },
  { value: 'charging-idle', label: 'CHARGING + IDLE', desc: 'ALSO WHEN SCREEN OFF & IDLE' },
  { value: 'manual', label: 'MANUAL', desc: 'ONLY WHEN YOU START IT' },
]

const remaining = computed(() => Math.max(0, state.value.total - state.value.analyzed))
</script>

<template>
  <section class="ai-panel" aria-label="Library analysis">
    <div class="grid lg:grid-cols-[1fr_auto] gap-6 p-5 md:p-6">
      <div>
        <div class="flex items-baseline justify-between gap-4">
          <p class="label-ai">LIBRARY ANALYSIS</p>
          <span class="label text-ai-fg-faint tnum">{{ remaining }} REMAINING</span>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-4">
          <div>
            <p class="text-display font-bold tnum text-ai-fg">{{ state.total.toLocaleString() }}</p>
            <p class="label text-ai-fg-faint">TRACKS</p>
          </div>
          <div>
            <p class="text-display font-bold tnum text-ai-primary">{{ state.analyzed.toLocaleString() }}</p>
            <p class="label text-ai-fg-faint">ANALYZED</p>
          </div>
          <div>
            <p class="text-display font-bold tnum text-ai-accent">{{ remaining.toLocaleString() }}</p>
            <p class="label text-ai-fg-faint">REMAINING</p>
          </div>
        </div>

        <div class="mt-5 max-w-[420px]">
          <Meter
            :value="state.progress"
            label="TELEMETRY PROGRESS"
            color="bg-ai-primary"
            ai
          />
        </div>
        <p class="mt-3 text-[11px] text-ai-fg-faint leading-relaxed">
          MOCK TELEMETRY — WORKMANAGER + ON-DEVICE INFERENCE PLUG IN HERE LATER.
        </p>
      </div>

      <div class="lg:w-[300px] border-t lg:border-t-0 lg:border-l border-ai-line pt-5 lg:pt-0 lg:pl-6">
        <p class="label-ai mb-3">ANALYSIS MODE</p>
        <div class="space-y-2" role="radiogroup" aria-label="Analysis mode">
          <button
            v-for="m in modes"
            :key="m.value"
            class="w-full text-left px-3 py-2.5 border t-all pressable focus-ring-ai"
            :class="state.mode === m.value ? 'border-ai-primary bg-ai-muted shadow-ai-glow' : 'border-ai-line text-ai-fg-muted hover:(border-ai-line-strong text-ai-fg)'"
            role="radio"
            :aria-checked="state.mode === m.value"
            @click="analysis.setMode(m.value)"
          >
            <p class="text-[11px] font-bold tracking-[0.14em] text-ai-fg">{{ m.label }}</p>
            <p class="text-[10px] text-ai-fg-faint mt-0.5">{{ m.desc }}</p>
          </button>
        </div>
        <button
          class="ai-btn-primary w-full mt-4"
          :disabled="state.running || state.progress >= 100"
          @click="emit('start')"
        >
          <UIcon :name="state.running ? 'lucide:loader-circle' : 'lucide:play'" class="w-4 h-4" :class="state.running ? 'animate-spin' : ''" />
          {{ state.running ? 'ANALYZING…' : state.progress >= 100 ? 'COMPLETE' : 'START ANALYSIS' }}
        </button>
      </div>
    </div>
  </section>
</template>
