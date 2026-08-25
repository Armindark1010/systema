<script setup lang="ts">
import type { AccentId, DensityId, MotionId } from '~/types/settings'
import { ACCENT_SWATCHES } from '~/data/settings'
import { THEME_META, THEMES } from '~/composables/useAppearance'
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
      <div class="grid sm:grid-cols-2 gap-px bg-line border border-line">
        <button
          v-for="id in THEMES"
          :key="id"
          type="button"
          class="bg-surface flex items-start gap-4 px-4 py-4 text-left t-all pressable focus-ring hover:bg-hover"
          role="radio"
          :aria-checked="settings.appearance.theme === id"
          :aria-label="`Theme ${THEME_META[id].name}`"
          @click="settings.setTheme(id)"
        >
          <span
            class="grid grid-cols-2 gap-[2px] w-14 h-14 border border-line shrink-0 p-1"
            :style="{ backgroundColor: THEME_META[id].swatch[0] }"
            aria-hidden="true"
          >
            <span :style="{ backgroundColor: THEME_META[id].swatch[1] }" />
            <span :style="{ backgroundColor: THEME_META[id].swatch[2] }" />
            <span :style="{ backgroundColor: THEME_META[id].swatch[3] }" />
            <span :style="{ backgroundColor: THEME_META[id].swatch[0] }" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="text-[13px] font-bold tracking-[0.12em] text-fg">{{ THEME_META[id].name }}</span>
            </span>
            <span class="block label text-fg-faint mt-1">{{ THEME_META[id].tag }}</span>
            <span class="block text-[11px] text-fg-muted mt-1 leading-relaxed">{{ THEME_META[id].desc }}</span>
          </span>
          <span
            class="w-4 h-4 shrink-0 grid place-items-center border t-all mt-1"
            :class="settings.appearance.theme === id ? 'border-primary bg-primary' : 'border-line-strong'"
            aria-hidden="true"
          >
            <UIcon v-if="settings.appearance.theme === id" name="lucide:check" class="w-3 h-3 text-primary-fg" />
          </span>
        </button>
      </div>
      <SettingsNote>
        AI PAGES KEEP THE INTELLIGENCE VISUAL SYSTEM. EVERY OTHER SURFACE — HEADER, HOME, LIBRARY, SEARCH, PLAYER, DIALOGS — FOLLOWS THESE TOKENS.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="accent" index="02" label="ACCENT" description="PRIMARY SIGNAL COLOR">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="ACCENT" description="UPDATES PRIMARY CONTROLS, FOCUS RINGS, AND ACTIVE STATES GLOBALLY.">
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
        <SettingRow label="DENSITY" description="CONTROLS CARD SPACING, LIST ROWS, AND CONTROL HEIGHT THROUGH DESIGN TOKENS.">
          <SettingsSegmented
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
        <SettingRow label="MOTION" description="FULL KEEPS SYSTEMA TRANSITIONS. REDUCED SHORTENS THEM. OFF DISABLES NON-ESSENTIAL ANIMATION. THE OPERATING SYSTEM PREFERENCE IS ALWAYS RESPECTED.">
          <SettingsSegmented
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
        <SettingRow label="LATIN" description="INTER — NEO-GROTESK, THE SYSTEMA DEFAULT.">
          <span class="label text-fg">INTER</span>
        </SettingRow>
        <SettingRow label="PERSIAN" description="VAZIRMATN IS FIRST-CLASS FOR PERSIAN STRINGS. NO SUBSTITUTE FONTS.">
          <span class="label text-fg font-persian">وزیرمتن</span>
        </SettingRow>
        <SettingRow label="SCALE" description="MICRO → SMALL → BODY → LEAD → TITLE → H2 → H1 → DISPLAY. LOCKED TO THE DESIGN SYSTEM.">
          <span class="label text-fg-faint">SYSTEM</span>
        </SettingRow>
      </div>
    </SettingsSection>
  </div>
</template>
