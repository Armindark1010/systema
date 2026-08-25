<script setup lang="ts">
// ============================================================
// PlaylistExport — export state machine (UI only)
// Future: SYSTEMA JSON · M3U · JSON — native export later.
// ============================================================

const props = defineProps<{ open: boolean; playlistTitle?: string }>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()

const pl = usePlaylists()
const { exportStep, exportFormat, startExport, resetExport, setExportFormat } = pl
const toast = useToast()

const formats = ['SYSTEMA JSON', 'JSON', 'M3U']

function onExport() {
  startExport()
}

function onDone() {
  toast.add({ title: 'Playlist exported', description: `${props.playlistTitle ?? 'PLAYLIST'}.${exportFormat.value === 'M3U' ? 'm3u' : 'json'} — ready`, icon: 'lucide:download' })
  emit('update:open', false)
  resetExport()
}
</script>

<template>
  <UModal
    :model-value="open"
    :ui="{ width: 'max-w-[520px]', content: 'bg-surface text-fg' }"
    title="EXPORT PLAYLIST"
    description="PREPARING → READY — NATIVE FILE HANDLING LATER"
    @update:model-value="(v: boolean) => { emit('update:open', v); if (!v) resetExport() }"
  >
    <template #body>
      <p v-if="playlistTitle" class="text-small font-semibold text-fg mb-5">{{ playlistTitle }}</p>

      <p class="label-muted mb-2">FORMAT</p>
      <div class="grid grid-cols-3 gap-2 mb-6" role="radiogroup" aria-label="Export format">
        <button
          v-for="f in formats"
          :key="f"
          class="h-10 border text-[11px] font-bold tracking-[0.12em] uppercase t-all pressable focus-ring"
          :class="exportFormat === f ? 'border-primary bg-primary-muted text-primary' : 'border-line text-fg-muted hover:(border-line-strong text-fg)'"
          role="radio"
          :aria-checked="exportFormat === f"
          @click="setExportFormat(f)"
        >
          {{ f }}
        </button>
      </div>

      <div v-if="exportStep === 'idle'" class="flex justify-end">
        <button class="sys-btn-primary" @click="onExport()">
          <UIcon name="lucide:download" class="w-4 h-4" />
          EXPORT PLAYLIST
        </button>
      </div>

      <div v-else-if="exportStep === 'preparing'" class="py-6" aria-live="polite">
        <Meter :value="65" label="PREPARING" color="bg-primary" />
      </div>

      <div v-else class="py-4 flex items-center gap-4">
        <span class="inline-grid place-items-center w-10 h-10 border border-success text-success shrink-0">
          <UIcon name="lucide:file-check" class="w-4.5 h-4.5" />
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-small font-semibold text-fg">{{ playlistTitle ?? 'PLAYLIST' }}.{{ exportFormat === 'M3U' ? 'm3u' : 'json' }}</p>
          <p class="text-[11.5px] text-fg-muted tnum">4.2 KB · 18 TRACKS · UTF-8</p>
        </div>
        <button class="sys-btn-primary" @click="onDone()">DONE</button>
      </div>
    </template>
  </UModal>
</template>
