<script setup lang="ts">
// ============================================================
// SettingsLayout — structured settings: rail nav (desktop)
// + anchor sections. No cards — hairlines and rows.
// ============================================================

const categories = [
  { id: 'appearance', label: 'APPEARANCE', index: '01' },
  { id: 'playback', label: 'PLAYBACK', index: '02' },
  { id: 'library', label: 'LIBRARY', index: '03' },
  { id: 'ai', label: 'AI', index: '04' },
  { id: 'import-export', label: 'IMPORT / EXPORT', index: '05' },
  { id: 'storage', label: 'STORAGE', index: '06' },
  { id: 'privacy', label: 'PRIVACY', index: '07' },
  { id: 'about', label: 'ABOUT', index: '08' },
]

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="sys-container mt-6 md:mt-10">
    <header class="flex flex-wrap items-end justify-between gap-4 hairline-b pb-4">
      <div class="flex items-baseline gap-4">
        <h1 class="text-h1 font-bold tracking-tight text-fg">SETTINGS</h1>
        <span class="label tnum text-fg-faint">08 CATEGORIES</span>
      </div>
      <p class="text-small text-fg-muted">SYSTEM CONFIGURATION — ALL LOCAL, ALL MOCK.</p>
    </header>

    <div class="grid lg:grid-cols-[220px_1fr] gap-8 mt-6">
      <!-- rail -->
      <nav class="lg:sticky lg:top-8 self-start hidden lg:block" aria-label="Settings categories">
        <ul class="border border-line bg-surface">
          <li v-for="c in categories" :key="c.id">
            <button
              class="w-full flex items-center gap-3 h-9 px-3 text-left text-[12px] font-semibold tracking-[0.12em] t-col pressable focus-ring hover:bg-hover"
              @click="scrollTo(c.id)"
            >
              <span class="tnum text-[10px] text-fg-faint w-5 shrink-0 text-right">{{ c.index }}</span>
              <span class="text-fg-muted hover:text-fg">{{ c.label }}</span>
            </button>
          </li>
        </ul>
      </nav>

      <!-- sections -->
      <div class="min-w-0 space-y-12">
        <slot />
      </div>
    </div>
  </div>
</template>
