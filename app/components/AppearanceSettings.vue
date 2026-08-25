<script setup lang="ts">
// Appearance — the three SYSTEMA themes. Switching = token swap.
const { theme, setTheme } = useTheme()

const themes = [
  {
    id: 'default' as const,
    name: 'DEFAULT',
    tag: 'WHITE / BLUE',
    desc: 'THE MAIN SYSTEMA MUSIC IDENTITY — ARCHITECTURAL BLUE ON WHITE.',
    swatch: ['#ffffff', '#1d4ed8', '#0c1424', '#e3e7ed'],
  },
  {
    id: 'premium' as const,
    name: 'PREMIUM',
    tag: 'WHITE / GOLD',
    desc: 'RESTRAINED GOLD ON IVORY — MINIMAL LUXURY, NO EXCESS.',
    swatch: ['#fffdf7', '#9c7d28', '#17140c', '#e9e4d3'],
  },
  {
    id: 'dark' as const,
    name: 'DARK',
    tag: 'DARK / MONOCHROME',
    desc: 'NEAR-BLACK ARCHITECTURAL MONOCHROME — HIGH CONTRAST.',
    swatch: ['#0a0c10', '#86aefb', '#eef1f5', '#212833'],
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
