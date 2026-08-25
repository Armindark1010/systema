<script setup lang="ts">
// ============================================================
// PlaylistImport — playlist import state machine (UI only)
//   SELECT FILE → READING → MATCHING → RESOLVE → COMPLETED
// Native file access plugs into `selectFile()` later.
// ============================================================

import type { ImportedEntry } from '~/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()

const pl = usePlaylists()
const { importStep, importProgress, importEntries, importFormat, startImport, selectFile, resolveMissing, finishImport, resetImport } = pl
const toast = useToast()

function onImport() {
  const created = finishImport()
  toast.add({ title: 'Playlist imported', description: `${created.title} — ${created.trackIds.length} tracks`, icon: 'lucide:check' })
  emit('update:open', false)
  navigateTo(`/playlists/${created.id}`)
}

function statusCounts() {
  const matched = importEntries.value.filter((e) => e.status === 'matched').length
  const missing = importEntries.value.filter((e) => e.status !== 'matched').length
  return { matched, missing }
}

function stepOf(e: ImportedEntry) {
  return e.status === 'matched' ? 'MATCHED' : 'MISSING'
}

function toResolve() {
  importStep.value = 'resolve'
}
</script>

<template>
  <UModal
    :model-value="open"
    :ui="{ width: 'max-w-[640px]', content: 'bg-surface text-fg' }"
    title="IMPORT PLAYLIST"
    description="SELECT FILE → READING → MATCHING → RESOLVE → COMPLETED"
    @update:model-value="(v: boolean) => { emit('update:open', v); if (!v) resetImport() }"
  >
    <template #body>
      <!-- 01 — SELECT FILE -->
      <section v-if="importStep === 'idle' || importStep === 'select'" class="py-6">
        <p class="label-muted mb-4">01 — SELECT FILE</p>
        <div class="grid sm:grid-cols-2 gap-3">
          <button
            class="sys-panel p-4 text-left t-col pressable focus-ring hover:(border-primary)"
            @click="startImport('M3U'); selectFile()"
          >
            <UIcon name="lucide:file-audio" class="w-5 h-5 text-primary mb-3" />
            <p class="text-small font-semibold text-fg">sample.m3u</p>
            <p class="text-[11.5px] text-fg-muted mt-0.5">M3U · 18 TRACKS · 4.2 KB</p>
          </button>
          <button
            class="sys-panel p-4 text-left t-col pressable focus-ring hover:(border-primary)"
            @click="startImport('SYSTEMA JSON'); selectFile()"
          >
            <UIcon name="lucide:braces" class="w-5 h-5 text-primary mb-3" />
            <p class="text-small font-semibold text-fg">playlist.systema.json</p>
            <p class="text-[11.5px] text-fg-muted mt-0.5">SYSTEMA JSON · 18 TRACKS</p>
          </button>
        </div>
        <p class="mt-4 text-[11px] text-fg-faint leading-relaxed">
          NATIVE FILE PICKER PLUGS IN HERE (CAPACITOR / MEDIASTORE). THE STATE MACHINE IS FINAL.
        </p>
      </section>

      <!-- 02 — READING -->
      <section v-else-if="importStep === 'reading'" class="py-10" aria-live="polite">
        <p class="label-muted mb-6">02 — READING PLAYLIST</p>
        <Meter :value="importProgress" label="PARSING" color="bg-primary" />
        <p class="tnum text-center mt-4 text-small text-fg-faint">{{ Math.round(importProgress) }}%</p>
      </section>

      <!-- 03 — MATCHING -->
      <section v-else-if="importStep === 'matching'" class="py-10" aria-live="polite">
        <p class="label-muted mb-6">03 — MATCHING TRACKS</p>
        <Meter :value="84" label="CATALOG MATCH" color="bg-primary" />
        <p class="tnum text-center mt-4 text-small text-fg-muted">
          {{ statusCounts().matched }} FOUND · {{ statusCounts().missing }} MISSING
        </p>
        <button class="mt-8 sys-btn-primary w-full" @click="toResolve()">
          REVIEW MISSING TRACKS
        </button>
      </section>

      <!-- 04 — RESOLVE -->
      <section v-else-if="importStep === 'resolve'" class="py-6">
        <p class="label-muted mb-4">04 — MISSING TRACKS</p>
        <ul class="border border-line divide-y divide-line max-h-[320px] overflow-y-auto">
          <li
            v-for="e in importEntries.filter((x) => x.status !== 'matched')"
            :key="e.id"
            class="px-3 py-3 flex items-center gap-3"
          >
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-fg truncate">{{ e.title }}</p>
              <p class="text-[11px] text-fg-muted truncate">{{ e.artist ?? 'UNKNOWN ARTIST' }}</p>
            </div>
            <span class="label text-fg-faint shrink-0">{{ stepOf(e) }}</span>
            <div class="flex gap-1.5 shrink-0">
              <button class="sys-btn-ghost !h-7 !px-2 !text-[10px]" @click="resolveMissing(e.id, 'manual')">MATCH MANUALLY</button>
              <button class="sys-btn-ghost !h-7 !px-2 !text-[10px]" @click="resolveMissing(e.id, 'skip')">SKIP</button>
            </div>
          </li>
        </ul>
        <p class="mt-3 text-[11px] text-fg-faint">SEARCH LIBRARY — MATCH MANUALLY — SKIP: RESOLUTION PLUGS INTO THE CATALOG LATER.</p>
        <button class="mt-5 sys-btn-primary w-full" @click="onImport">
          IMPORT {{ statusCounts().matched }} MATCHED TRACKS
        </button>
      </section>

      <!-- 05 — COMPLETED -->
      <section v-else-if="importStep === 'done'" class="py-10 text-center">
        <span class="inline-grid place-items-center w-12 h-12 border border-success text-success mb-4">
          <UIcon name="lucide:check" class="w-5 h-5" />
        </span>
        <p class="text-h2 font-bold text-fg">IMPORT COMPLETED</p>
        <p class="mt-2 text-small text-fg-muted">
          {{ statusCounts().matched }} TRACKS MATCHED · {{ statusCounts().missing }} SKIPPED
        </p>
        <button class="mt-6 sys-btn-primary" @click="onImport">
          OPEN IMPORTED PLAYLIST →
        </button>
      </section>
    </template>
  </UModal>
</template>
