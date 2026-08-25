<script setup lang="ts">
// Storage — mock capacity telemetry
const items = [
  { label: 'MUSIC FILES', value: 18.4, unit: 'GB', pct: 61, color: 'bg-primary' },
  { label: 'CACHE', value: 1.2, unit: 'GB', pct: 4, color: 'bg-fg-faint' },
  { label: 'AI MODELS', value: 0, unit: 'GB', pct: 0, color: 'bg-ai-primary', note: 'NOT INSTALLED' },
  { label: 'FREE SPACE', value: 10.4, unit: 'GB', pct: 35, color: 'bg-success' },
]
const toast = useToast()
</script>

<template>
  <SettingsSection id="storage" index="06" label="STORAGE" description="DEVICE CAPACITY — MOCK TELEMETRY">
    <div class="border border-line divide-y divide-line">
      <SettingRow v-for="s in items" :key="s.label" :label="s.label" :description="s.note ? `${s.note} — ON-DEVICE INFERENCE LATER` : undefined">
        <div class="flex items-center gap-3 w-44">
          <Meter :value="s.pct" :color="s.color" />
          <span class="tnum text-[12px] font-semibold text-fg w-20 text-right shrink-0">{{ s.value }} {{ s.unit }}</span>
        </div>
      </SettingRow>
    </div>
    <button class="sys-btn-outline mt-4" @click="toast.add({ title: 'Cache cleared', description: '1.2 GB recovered (mock)', icon: 'lucide:trash-2' })">
      <UIcon name="lucide:trash-2" class="w-3.5 h-3.5" /> CLEAR CACHE
    </button>
  </SettingsSection>
</template>
