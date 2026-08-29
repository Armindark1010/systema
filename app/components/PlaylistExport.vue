<script setup lang="ts">
// ============================================================
// PlaylistExport — real M3U and JSON playlist exporter
// Generates standard Extended M3U (#EXTM3U) and triggers download
// ============================================================

import type { Playlist } from '~/types'

const props = defineProps<{
  open: boolean
  playlistTitle?: string
  playlistId?: string
}>()

const emit = defineEmits<{ 'update:open': [v: boolean] }>()

const pl = usePlaylists()
const { playlists, exportStep, exportFormat, setExportFormat, exportPlaylist, resetExport } = pl
const { tracks } = useMusicLibrary()
const toast = useToast()

const formats = ['M3U', 'SYSTEMA JSON']
const selectedPlaylistId = ref<string>(props.playlistId || playlists.value[0]?.id || '')

watch(() => props.playlistId, (newId) => {
  if (newId) selectedPlaylistId.value = newId
}, { immediate: true })

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    if (props.playlistId) {
      selectedPlaylistId.value = props.playlistId
    } else if (!selectedPlaylistId.value && playlists.value.length) {
      selectedPlaylistId.value = playlists.value[0].id
    }
  } else {
    resetExport()
  }
})

const activePlaylist = computed<Playlist | undefined>(() => {
  if (props.playlistId) {
    return pl.getPlaylist(props.playlistId) || playlists.value.find(p => p.id === props.playlistId)
  }
  if (props.playlistTitle) {
    return playlists.value.find(p => p.title.toLowerCase() === props.playlistTitle?.toLowerCase()) || playlists.value[0]
  }
  return playlists.value.find(p => p.id === selectedPlaylistId.value) || playlists.value[0]
})

const activeTracks = computed(() => {
  if (!activePlaylist.value) return []
  return activePlaylist.value.trackIds
    .map(id => tracks.value.find(t => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
})

const estimatedSize = computed(() => {
  const count = activePlaylist.value?.trackIds.length || 0
  const bytes = count * 95 + 60
  return bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
})

function onExport() {
  if (!activePlaylist.value) return
  exportPlaylist(activePlaylist.value, tracks.value, exportFormat.value === 'M3U' ? 'M3U' : 'JSON')
  toast.add({
    title: 'Playlist exported',
    description: `${activePlaylist.value.title}.${exportFormat.value === 'M3U' ? 'm3u' : 'json'} downloaded`,
    icon: 'lucide:download',
  })
}

function onDone() {
  emit('update:open', false)
  resetExport()
}
</script>

<template>
  <UModal
    :model-value="open"
    :ui="{ width: 'max-w-[520px]', content: 'bg-surface text-fg' }"
    title="EXPORT PLAYLIST"
    description="GENERATE & DOWNLOAD M3U AUDIO PLAYLIST"
    @update:model-value="(v: boolean) => { emit('update:open', v); if (!v) resetExport() }"
  >
    <template #body>
      <!-- Playlist selection if not provided by prop -->
      <div v-if="!playlistTitle && !playlistId && playlists.length > 1" class="mb-5">
        <label class="label-muted block mb-2">SELECT PLAYLIST</label>
        <select
          v-model="selectedPlaylistId"
          class="sys-input w-full bg-surface text-fg border border-line h-10 px-3 text-small"
        >
          <option v-for="p in playlists" :key="p.id" :value="p.id">
            {{ p.title }} ({{ p.trackIds.length }} tracks)
          </option>
        </select>
      </div>

      <div v-else-if="activePlaylist" class="sys-panel p-3.5 mb-5 flex items-center justify-between">
        <div>
          <p class="text-small font-bold text-fg">{{ activePlaylist.title }}</p>
          <p class="text-[11.5px] text-fg-muted mt-0.5">{{ activePlaylist.trackIds.length }} TRACKS · {{ estimatedSize }}</p>
        </div>
        <span class="label text-primary">READY</span>
      </div>

      <p class="label-muted mb-2">FORMAT</p>
      <div class="grid grid-cols-2 gap-2 mb-6" role="radiogroup" aria-label="Export format">
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

      <div v-if="exportStep === 'idle'" class="flex justify-end gap-2">
        <button class="sys-btn-ghost" @click="emit('update:open', false)">CANCEL</button>
        <button class="sys-btn-primary" :disabled="!activePlaylist" @click="onExport">
          <UIcon name="lucide:download" class="w-4 h-4" />
          DOWNLOAD {{ exportFormat === 'M3U' ? '.M3U' : '.JSON' }}
        </button>
      </div>

      <div v-else-if="exportStep === 'preparing'" class="py-6" aria-live="polite">
        <Meter :value="80" label="GENERATING M3U PLAYLIST" color="bg-primary" />
        <p class="text-center text-micro text-fg-faint mt-3">Writing Extended M3U directives & track entries...</p>
      </div>

      <div v-else class="py-4 flex items-center gap-4">
        <span class="inline-grid place-items-center w-10 h-10 border border-success text-success shrink-0">
          <UIcon name="lucide:file-check" class="w-4.5 h-4.5" />
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-small font-semibold text-fg truncate">{{ activePlaylist?.title ?? 'PLAYLIST' }}.{{ exportFormat === 'M3U' ? 'm3u' : 'json' }}</p>
          <p class="text-[11.5px] text-fg-muted tnum">{{ estimatedSize }} · {{ activePlaylist?.trackIds.length }} TRACKS · UTF-8</p>
        </div>
        <button class="sys-btn-primary" @click="onDone">DONE</button>
      </div>
    </template>
  </UModal>
</template>
