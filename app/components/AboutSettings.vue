<script setup lang="ts">
const stack = [
  ['NUXT', '4.5.2'],
  ['VUE', '3.5'],
  ['TYPESCRIPT', 'STRICT'],
  ['PINIA', 'SETTINGS STORE'],
  ['UNOCSS', '66'],
  ['NUXT UI', '3.3'],
  ['VUEUSE', '14'],
  ['LUCIDE', 'ICON SET'],
]
</script>

<template>
  <SettingsSection id="about" index="01" label="SYSTEMA" description="V0.5.0 — CONTROL CENTER">
    <div class="border border-line bg-surface p-6">
      <BrandMark />
      <p class="mt-4 text-small text-fg-muted max-w-[56ch] leading-relaxed">
        SYSTEMA is a precise, intelligent music system. A Swiss music archive, a powerful
        playback engine and a futuristic AI studio — structured, systematic, intentional.
      </p>
      <dl class="mt-6 grid sm:grid-cols-2 gap-px bg-line border border-line">
        <div v-for="[key, value] in stack" :key="key" class="bg-surface px-4 py-3 flex items-baseline justify-between gap-4">
          <dt class="label text-fg-faint">{{ key }}</dt>
          <dd class="tnum text-[12px] font-bold text-fg">{{ value }}</dd>
        </div>
      </dl>
      <p class="mt-6 text-[11px] text-fg-faint leading-relaxed">
        FRONTEND ARCHITECTURE ONLY — NATIVE LAYER (CAPACITOR · KOTLIN · MEDIA3 · ROOM ·
        WORKMANAGER · ONNX) INTEGRATES THROUGH THE COMPOSABLE AND STORE CONTRACTS WITHOUT UI REWRITES.
      </p>
    </div>
  </SettingsSection>
</template>
