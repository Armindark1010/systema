<script setup lang="ts">
// Appearance — the three SYSTEMA themes. Switching = token swap.
const { theme, setTheme } = useTheme()

const themes = [
  {
    id: 'default' as const,
    name: 'DEFAULT',
    tag: 'WHITE / STEEL',
    desc: 'A WHITE DIAL — QUIET GENEVA STEEL BLUE ON PURE WHITE.',
    swatch: ['#ffffff', '#1e3a66', '#10141c', '#e6e9ee'],
  },
  {
    id: 'premium' as const,
    name: 'PREMIUM',
    tag: 'IVORY / GOLD',
    desc: 'DEEP CHAMPAGNE GOLD ON IVORY ENAMEL — MINIMAL LUXURY, NO EXCESS.',
    swatch: ['#fcfbf7', '#8a6d2c', '#181510', '#e8e3d3'],
  },
  {
    id: 'dark' as const,
    name: 'DARK',
    tag: 'ONYX / SILVER',
    desc: 'AN ONYX DIAL — APPLIED SILVER INDICES, NOTHING ELSE.',
    swatch: ['#0a0b0e', '#dde3ea', '#edf0f4', '#22262e'],
  },
]
</script>

<template>
  <SettingsSection id="appearance" index="01" label="APPEARANCE" description="THEME — TOKENS SWAP, COMPONENTS NEVER CHANGE">
    <div class="border border-line divide-y divide-line">
      <button
        v-for="t in themes"
        :key="t.id"
        class="w-full flex items-center gap-5 px-4 py-4 text-left t-all pressable focus-ring hover:bg-hover"
        role="radio"
        :aria-checked="theme === t.id"
        :aria-label="`Theme ${t.name}`"
        @click="setTheme(t.id)"
      >
        <!-- swatch -->
        <span class="grid grid-cols-2 gap-[2px] w-14 h-14 border border-line shrink-0 p-1" :style="{ backgroundColor: t.swatch[0] }" aria-hidden="true">
          <span :style="{ backgroundColor: t.swatch[1] }" />
          <span :style="{ backgroundColor: t.swatch[2] }" />
          <span :style="{ backgroundColor: t.swatch[3] }" />
          <span :style="{ backgroundColor: t.swatch[0] }" />
        </span>
        <span class="flex-1 min-w-0">
          <span class="flex items-baseline gap-3">
            <span class="text-[14px] font-bold tracking-[0.14em] text-fg">{{ t.name }}</span>
            <span class="label text-fg-faint">{{ t.tag }}</span>
          </span>
          <span class="block text-[11.5px] text-fg-muted mt-1">{{ t.desc }}</span>
        </span>
        <span
          class="w-4 h-4 shrink-0 grid place-items-center border t-all"
          :class="theme === t.id ? 'border-primary bg-primary' : 'border-line-strong'"
          aria-hidden="true"
        >
          <UIcon v-if="theme === t.id" name="lucide:check" class="w-3 h-3 text-primary-fg" />
        </span>
      </button>
    </div>
    <p class="mt-3 text-[11px] text-fg-faint leading-relaxed">
      AI PAGES RETAIN THE AI VISUAL SYSTEM REGARDLESS OF THEME — SWISS STRUCTURE + GENERATIVE LANGUAGE.
    </p>
  </SettingsSection>
</template>
