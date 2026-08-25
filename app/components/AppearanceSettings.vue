<script setup lang="ts">
import type { AccentId, DensityId, MotionId } from '~/types/settings'
import { ACCENT_SWATCHES } from '~/data/settings'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()

const densityOptions = [
  { value: 'compact' as DensityId, label: 'COMPACT' },
  { value: 'default' as DensityId, label: 'DEFAULT' },
  { value: 'comfortable' as DensityId, label: 'COMFORTABLE' },
]

const motionOptions = [
  { value: 'full' as MotionId, label: 'FULL' },
  { value: 'reduced' as MotionId, label: 'REDUCED' },
  { value: 'off' as MotionId, label: 'OFF' },
]
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="theme" index="01" label="THEME" description="TOKEN SWAP — THE WHOLE SYSTEM FOLLOWS">
      <ThemeSelector />
      <SettingsNote>
        AI PAGES KEEP THE INTELLIGENCE VISUAL SYSTEM. EVERY OTHER SURFACE — HEADER, HOME, LIBRARY, SEARCH, PLAYER, DIALOGS — FOLLOWS THESE TOKENS.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="accent" index="02" label="ACCENT" description="PRIMARY SIGNAL COLOR">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:paintbrush"
          label="ACCENT"
          description="Updates primary controls, focus rings, and active states globally."
        >
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
            <button
              v-for="accent in ACCENT_SWATCHES"
              :key="accent.id"
              type="button"
              class="flex items-center gap-2 h-8 px-2 border t-all pressable focus-ring"
              :class="settings.appearance.accent === accent.id ? 'border-primary bg-primary-muted' : 'border-line hover:border-line-strong'"
              role="radio"
              :aria-checked="settings.appearance.accent === accent.id"
              :aria-label="accent.label"
              @click="settings.patchAppearance({ accent: accent.id as AccentId })"
            >
              <span class="w-3.5 h-3.5 border border-line-strong" :style="{ backgroundColor: accent.sample }" />
              <span class="text-[10px] font-bold tracking-[0.1em] text-fg">{{ accent.label }}</span>
            </button>
          </div>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="density" index="03" label="INTERFACE DENSITY" description="SPACING TOKENS, NOT PER-COMPONENT HACKS">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:rows-3"
          label="DENSITY"
          description="Controls card spacing, list rows, and control height through design tokens."
        >
          <SettingsSegmentedControl
            :model-value="settings.appearance.density"
            :options="densityOptions"
            aria-label="Interface density"
            @update:model-value="value => settings.patchAppearance({ density: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="motion" index="04" label="MOTION" description="GLOBAL TRANSITIONS">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:activity"
          label="MOTION"
          description="Full keeps SYSTEMA transitions. Reduced shortens them. Off disables non-essential animation. The operating system preference is always respected."
        >
          <SettingsSegmentedControl
            :model-value="settings.appearance.motion"
            :options="motionOptions"
            aria-label="Motion"
            @update:model-value="value => settings.patchAppearance({ motion: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="typography" index="05" label="TYPOGRAPHY" description="NEO-GROTESK SYSTEM">
      <div class="border border-line divide-y divide-line">
        <SettingRow icon="lucide:type" label="LATIN" description="Inter — neo-grotesk, the SYSTEMA default.">
          <span class="label text-fg">INTER</span>
        </SettingRow>
        <SettingRow icon="lucide:languages" label="PERSIAN" description="Vazirmatn is first-class for Persian strings. No substitute fonts.">
          <span class="label text-fg font-persian">وزیرمتن</span>
        </SettingRow>
        <SettingRow icon="lucide:ruler" label="SCALE" description="Micro → small → body → lead → title → h2 → h1 → display. Locked to the design system.">
          <span class="label text-fg-muted">SYSTEM</span>
        </SettingRow>
      </div>
    </SettingsSection>
  </div>
</template>
