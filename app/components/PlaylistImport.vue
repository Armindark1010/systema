<script setup lang="ts">
// ============================================================
// PlaylistImport — real M3U playlist importer
// Parses M3U/M3U8 playlists and matches with the music library
// ============================================================

import type { ImportedEntry, Track } from '~/types'
import { useLibraryStore } from '~/stores/library'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()

const pl = usePlaylists()
const {
  importStep,
  importProgress,
  importEntries,
  importFormat,
  importTitle,
  importError,
  startImport,
  processM3UFile,
  processM3UText,
  selectSampleFile,
  resolveMissing,
  finishImport,
  resetImport,
} = pl

const libraryStore = useLibraryStore()
const libraryTracks = computed(() => libraryStore.tracks)
const toast = useToast()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const showPasteArea = ref(false)
const pastedText = ref('')
const manualSearchQuery = ref('')
const selectedMissingId = ref<string | null>(null)

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    startImport('M3U')
    showPasteArea.value = false
    pastedText.value = ''
    selectedMissingId.value = null
    // Ensure all tracks are loaded into memory for accurate matching
    if (libraryStore.isNativeLibrary) {
      void libraryStore.loadAllTracks()
    }
  } else {
    resetImport()
  }
})

function triggerFileInput() {
  fileInput.value?.click()
}

async function getAvailableLibraryTracks(): Promise<Track[]> {
  if (libraryStore.isNativeLibrary) {
    const all = await libraryStore.loadAllTracks()
    if (all.length) return all
  }
  return libraryStore.tracks.length ? libraryStore.tracks : libraryTracks.value
}

async function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const tracksToMatch = await getAvailableLibraryTracks()
  await processM3UFile(file, tracksToMatch)
  target.value = ''
}

async function onDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  const tracksToMatch = await getAvailableLibraryTracks()
  await processM3UFile(file, tracksToMatch)
}

async function onProcessPastedText() {
  if (!pastedText.value.trim()) return
  const tracksToMatch = await getAvailableLibraryTracks()
  await processM3UText(pastedText.value, tracksToMatch, 'Pasted M3U')
}

async function onTrySample() {
  const tracksToMatch = await getAvailableLibraryTracks()
  await selectSampleFile(tracksToMatch)
}

function onImport() {
  const created = finishImport(importTitle.value)
  toast.add({
    title: 'Playlist imported',
    description: `${created.title} — ${created.trackIds.length} tracks matched`,
    icon: 'lucide:check',
  })
  emit('update:open', false)
  navigateTo(`/playlists/${created.id}`)
}

function statusCounts() {
  const matched = importEntries.value.filter((e) => e.status === 'matched').length
  const missing = importEntries.value.filter((e) => e.status !== 'matched').length
  return { matched, missing, total: importEntries.value.length }
}

const filteredManualCandidates = computed<Track[]>(() => {
  const q = manualSearchQuery.value.trim().toLowerCase()
  const list = libraryStore.tracks
  if (!q) return list.slice(0, 8)
  return list.filter(t =>
    t.title.toLowerCase().includes(q) || (t.artist && t.artist.toLowerCase().includes(q)),
  ).slice(0, 8)
})

function selectManualTrack(missingEntryId: string, track: Track) {
  resolveMissing(missingEntryId, 'manual', track.id)
  selectedMissingId.value = null
  manualSearchQuery.value = ''
}
const isOpen = computed({
  get: () => props.open,
  set: (val: boolean) => {
    emit('update:open', val)
    if (!val) resetImport()
  },
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ width: 'max-w-[640px]', content: 'bg-surface text-fg' }"
    title="IMPORT PLAYLIST"
    description="UPLOAD .M3U FILE → PARSE → MATCH WITH ARCHIVE"
  >
    <template #body>
      <!-- Hidden file input -->
      <input
        ref="fileInput"
        type="file"
        accept=".m3u,.m3u8,audio/x-mpegurl,text/plain,.json"
        class="hidden"
        @change="onFileSelected"
      >

      <!-- 01 — SELECT FILE -->
      <section v-if="importStep === 'idle' || importStep === 'select'" class="py-4 space-y-4">
        <div v-if="importError" class="p-3 border border-danger/40 bg-danger/10 text-danger text-small">
          <p class="font-semibold">Error: {{ importError }}</p>
        </div>

        <!-- Drag & Drop Zone -->
        <div
          class="border-2 border-dashed rounded-none p-8 text-center transition-all cursor-pointer"
          :class="isDragging ? 'border-primary bg-primary-muted/20' : 'border-line hover:border-line-strong bg-surface-muted/30'"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="triggerFileInput"
        >
          <div class="inline-grid place-items-center w-12 h-12 border border-line text-primary mb-3 bg-surface">
            <UIcon name="lucide:upload" class="w-6 h-6" />
          </div>
          <p class="text-small font-bold text-fg">CLICK TO BROWSE OR DRAG & DROP M3U FILE</p>
          <p class="text-micro text-fg-muted mt-1">Supports standard .m3u and .m3u8 playlist files</p>
        </div>

        <!-- Quick options -->
        <div class="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            class="sys-panel p-3.5 text-left t-col pressable focus-ring hover:(border-primary)"
            @click="onTrySample"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="lucide:sparkles" class="w-4 h-4 text-primary" />
              <p class="text-small font-semibold text-fg">Load Sample M3U</p>
            </div>
            <p class="text-[11.5px] text-fg-muted">Try importing with a built-in demo playlist</p>
          </button>

          <button
            type="button"
            class="sys-panel p-3.5 text-left t-col pressable focus-ring hover:(border-primary)"
            @click="showPasteArea = !showPasteArea"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="lucide:clipboard-paste" class="w-4 h-4 text-primary" />
              <p class="text-small font-semibold text-fg">Paste M3U Text</p>
            </div>
            <p class="text-[11.5px] text-fg-muted">Paste raw #EXTM3U text directly</p>
          </button>
        </div>

        <!-- Paste Text Area -->
        <div v-if="showPasteArea" class="space-y-3 pt-2">
          <label class="label-muted block">PASTE M3U TEXT</label>
          <textarea
            v-model="pastedText"
            rows="5"
            placeholder="#EXTM3U&#10;#EXTINF:180,Artist - Track Title&#10;track.mp3"
            class="sys-input w-full font-mono text-micro leading-relaxed"
          />
          <div class="flex justify-end">
            <button
              type="button"
              class="sys-btn-primary"
              :disabled="!pastedText.trim()"
              @click="onProcessPastedText"
            >
              PARSE M3U TEXT
            </button>
          </div>
        </div>
      </section>

      <!-- 02 — READING -->
      <section v-else-if="importStep === 'reading'" class="py-10" aria-live="polite">
        <p class="label-muted mb-6">02 — READING & PARSING M3U</p>
        <Meter :value="importProgress" label="PARSING M3U DIRECTIVES" color="bg-primary" />
        <p class="tnum text-center mt-4 text-small text-fg-faint">{{ Math.round(importProgress) }}%</p>
      </section>

      <!-- 03 — MATCHING -->
      <section v-else-if="importStep === 'matching'" class="py-10" aria-live="polite">
        <p class="label-muted mb-6">03 — MATCHING TRACKS</p>
        <Meter :value="importProgress" label="MATCHING AGAINST CATALOG" color="bg-primary" />
        <p class="tnum text-center mt-4 text-small text-fg-muted">
          {{ statusCounts().matched }} FOUND · {{ statusCounts().missing }} MISSING
        </p>
      </section>

      <!-- 04 — RESOLVE / REVIEW -->
      <section v-else-if="importStep === 'resolve'" class="py-4 space-y-4">
        <!-- Playlist Title Editing -->
        <div>
          <label class="label-muted block mb-1.5">PLAYLIST TITLE</label>
          <input
            v-model="importTitle"
            type="text"
            class="sys-input w-full text-small font-bold"
            placeholder="PLAYLIST TITLE"
          >
        </div>

        <div class="flex items-center justify-between text-micro text-fg-muted hairline-b pb-2">
          <span>{{ statusCounts().matched }} OF {{ statusCounts().total }} TRACKS MATCHED</span>
          <span v-if="statusCounts().missing > 0" class="text-warning font-semibold">
            {{ statusCounts().missing }} MISSING
          </span>
          <span v-else class="text-success font-semibold">ALL TRACKS MATCHED</span>
        </div>

        <!-- Track list -->
        <ul class="border border-line divide-y divide-line max-h-[300px] overflow-y-auto">
          <li
            v-for="e in importEntries"
            :key="e.id"
            class="px-3 py-2.5 flex items-center justify-between gap-3 text-small"
            :class="e.status === 'matched' ? 'bg-surface' : 'bg-surface-muted/30'"
          >
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-fg truncate">{{ e.title }}</p>
              <p class="text-[11px] text-fg-muted truncate">{{ e.artist ?? 'UNKNOWN ARTIST' }}</p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <span
                class="chip text-[10px]"
                :class="e.status === 'matched' ? 'border-success text-success' : 'border-warning text-warning'"
              >
                {{ e.status === 'matched' ? 'MATCHED' : e.status === 'skip' ? 'SKIPPED' : 'MISSING' }}
              </span>

              <button
                v-if="e.status !== 'matched' && selectedMissingId !== e.id"
                class="sys-btn-ghost !h-7 !px-2 !text-[10px]"
                @click="selectedMissingId = e.id"
              >
                MANUAL MATCH
              </button>
              <button
                v-if="e.status !== 'matched' && e.status !== 'skip'"
                class="sys-btn-ghost !h-7 !px-2 !text-[10px]"
                @click="resolveMissing(e.id, 'skip')"
              >
                SKIP
              </button>
            </div>
          </li>
        </ul>

        <!-- Manual track picker if selected -->
        <div v-if="selectedMissingId" class="sys-panel p-3 border border-primary space-y-2">
          <div class="flex items-center justify-between">
            <p class="label text-primary">SELECT MATCHING TRACK FROM LIBRARY</p>
            <button class="text-micro text-fg-muted hover:text-fg" @click="selectedMissingId = null">CLOSE</button>
          </div>
          <input
            v-model="manualSearchQuery"
            type="text"
            class="sys-input w-full text-micro"
            placeholder="Search library tracks..."
            autofocus
          >
          <div class="max-h-36 overflow-y-auto divide-y divide-line border border-line">
            <div
              v-for="cand in filteredManualCandidates"
              :key="cand.id"
              class="p-2 flex items-center justify-between hover:bg-primary-muted/20 cursor-pointer text-micro"
              @click="selectManualTrack(selectedMissingId, cand)"
            >
              <div>
                <p class="font-bold text-fg">{{ cand.title }}</p>
                <p class="text-fg-muted">{{ cand.artist || 'Unknown' }}</p>
              </div>
              <UIcon name="lucide:check" class="w-3.5 h-3.5 text-primary" />
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button class="sys-btn-ghost" @click="emit('update:open', false)">CANCEL</button>
          <button
            class="sys-btn-primary"
            :disabled="statusCounts().matched === 0"
            @click="onImport"
          >
            <UIcon name="lucide:check" class="w-4 h-4" />
            IMPORT {{ statusCounts().matched }} TRACKS
          </button>
        </div>
      </section>

      <!-- 05 — COMPLETED -->
      <section v-else-if="importStep === 'done'" class="py-8 text-center">
        <span class="inline-grid place-items-center w-12 h-12 border border-success text-success mb-4">
          <UIcon name="lucide:check" class="w-5 h-5" />
        </span>
        <p class="text-h2 font-bold text-fg">PLAYLIST IMPORTED</p>
        <p class="mt-2 text-small text-fg-muted">
          {{ statusCounts().matched }} TRACKS READY IN YOUR ARCHIVE
        </p>
        <button class="mt-6 sys-btn-primary" @click="onImport">
          OPEN IMPORTED PLAYLIST →
        </button>
      </section>
    </template>
  </UModal>
</template>
