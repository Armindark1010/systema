<script setup lang="ts">
// Library — archive behavior
import type { LibrarySort, ViewMode } from '~/types'

const settings = reactive({
  defaultView: 'list' as ViewMode,
  defaultSort: 'title' as LibrarySort,
  ignoreArticles: true,
  artworkProvider: 'LOCAL',
})

const toast = useToast()
</script>

<template>
  <SettingsSection id="library" index="03" label="LIBRARY" description="ARCHIVE BEHAVIOR — MEDIASTORE SCAN LATER">
    <div class="border border-line divide-y divide-line">
      <SettingRow label="DEFAULT VIEW" description="HOW THE TRACKS ARCHIVE OPENS.">
        <div class="flex border border-line" role="radiogroup" aria-label="Default view">
          <button
            v-for="v in (['list', 'grid'] as const)"
            :key="v"
            class="h-8 px-3 text-[10px] font-bold tracking-[0.14em] t-all pressable focus-ring"
            :class="settings.defaultView === v ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg'"
            role="radio"
            :aria-checked="settings.defaultView === v"
            @click="settings.defaultView = v"
          >
            {{ v.toUpperCase() }}
          </button>
        </div>
      </SettingRow>
      <SettingRow label="DEFAULT SORT" description="INITIAL SORTING OF THE TRACK LIST.">
        <select
          v-model="settings.defaultSort"
          class="h-8 pl-3 pr-8 text-[11px] font-bold tracking-[0.12em] bg-surface border border-line text-fg-muted appearance-none cursor-pointer t-col focus-ring"
          aria-label="Default sort"
        >
          <option value="title">TITLE</option>
          <option value="artist">ARTIST</option>
          <option value="album">ALBUM</option>
          <option value="added">DATE ADDED</option>
        </select>
      </SettingRow>
      <SettingRow label="IGNORE ARTICLES IN SORTING" description="‘THE’, ‘A’ — SKIPPED WHEN SORTING TITLES.">
        <USwitch v-model="settings.ignoreArticles" aria-label="Ignore articles" />
      </SettingRow>
      <SettingRow label="ARTWORK PROVIDER" description="LOCAL EMBEDDED ART PREFERRED; NETWORK FALLBACK LATER.">
        <select
          v-model="settings.artworkProvider"
          class="h-8 pl-3 pr-8 text-[11px] font-bold tracking-[0.12em] bg-surface border border-line text-fg-muted appearance-none cursor-pointer t-col focus-ring"
          aria-label="Artwork provider"
        >
          <option>LOCAL</option>
          <option>NETWORK</option>
          <option>HYBRID</option>
        </select>
      </SettingRow>
      <SettingRow label="SCAN LIBRARY" description="FULL MEDIASTORE RESCAN — MOCK ACTION.">
        <button class="sys-btn-outline !h-8" @click="toast.add({ title: 'Scan requested', description: 'MediaStore integration is planned — no native scan yet.', icon: 'lucide:info' })">
          SCAN
        </button>
      </SettingRow>
    </div>
  </SettingsSection>
</template>
