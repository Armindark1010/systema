<script setup lang="ts">
// AI — inference preferences (mock; ONNX Runtime later)
import type { AnalysisMode } from '~/types'

const { analysis } = useAI()

const settings = reactive({
  autoInsights: true,
  semanticSearch: true,
  model: 'SYSTEMA-NANO (ONNX)',
  allowIdle: false,
})

const modes: { value: AnalysisMode; label: string }[] = [
  { value: 'charging', label: 'CHARGING ONLY' },
  { value: 'charging-idle', label: 'CHARGING + IDLE' },
  { value: 'manual', label: 'MANUAL' },
]
</script>

<template>
  <SettingsSection id="ai" index="04" label="AI" description="INFERENCE — LOCAL, ON-DEVICE, MOCKED">
    <div class="border border-line divide-y divide-line">
      <SettingRow label="ANALYSIS MODE" description="WHEN THE TELEMETRY RUNS — WORKMANAGER LATER.">
        <div class="flex border border-line" role="radiogroup" aria-label="Analysis mode">
          <button
            v-for="m in modes"
            :key="m.value"
            class="h-8 px-2.5 text-[9px] font-bold tracking-[0.1em] t-all pressable focus-ring"
            :class="analysis.state.value.mode === m.value ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg'"
            role="radio"
            :aria-checked="analysis.state.value.mode === m.value"
            @click="analysis.setMode(m.value)"
          >
            {{ m.label }}
          </button>
        </div>
      </SettingRow>
      <SettingRow label="AUTO INSIGHTS" description="REFRESH YOUR MUSIC PROFILE WEEKLY.">
        <USwitch v-model="settings.autoInsights" aria-label="Auto insights" />
      </SettingRow>
      <SettingRow label="AI SEMANTIC SEARCH" description="DESCRIPTIVE QUERIES ROUTED TO THE SEMANTIC ENGINE.">
        <USwitch v-model="settings.semanticSearch" aria-label="AI semantic search" />
      </SettingRow>
      <SettingRow label="MODEL" description="ON-DEVICE INFERENCE MODEL — NOT INSTALLED YET.">
        <select
          v-model="settings.model"
          class="h-8 pl-3 pr-8 text-[11px] font-bold tracking-[0.12em] bg-surface border border-line text-fg-muted appearance-none cursor-pointer t-col focus-ring"
          aria-label="AI model"
        >
          <option>SYSTEMA-NANO (ONNX)</option>
          <option>SYSTEMA-STANDARD</option>
        </select>
      </SettingRow>
    </div>
    <p class="mt-3 text-[11px] text-fg-faint leading-relaxed">
      ALL AI FUNCTIONALITY IS FRONTEND REPRESENTATION. ON-DEVICE INFERENCE (ONNX RUNTIME) AND
      BACKGROUND JOBS (WORKMANAGER) INTEGRATE LATER WITHOUT UI CHANGES.
    </p>
  </SettingsSection>
</template>
