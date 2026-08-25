<script setup lang="ts">
import { THEME_META, THEMES } from '~/composables/useAppearance'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
</script>

<template>
  <div class="grid sm:grid-cols-2 gap-px bg-line border border-line" role="radiogroup" aria-label="Theme">
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
        <span class="block text-small font-bold tracking-[0.12em] text-fg">{{ THEME_META[id].name }}</span>
        <span class="block text-micro font-semibold tracking-[0.12em] uppercase text-fg-muted mt-1">{{ THEME_META[id].tag }}</span>
        <span class="block text-small text-fg-muted mt-1 leading-relaxed">{{ THEME_META[id].desc }}</span>
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
</template>
