<script setup lang="ts">
import type { ArtworkPreference, LibraryDefaultSort } from '~/types/settings'
import { librarySortOptions, useLibraryStore } from '~/stores/library'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
const library = useLibraryStore()

const sortOptions = [
  { value: 'recently-added' as LibraryDefaultSort, label: 'RECENTLY ADDED' },
  { value: 'alphabetical' as LibraryDefaultSort, label: 'ALPHABETICAL' },
  { value: 'artist' as LibraryDefaultSort, label: 'ARTIST' },
  { value: 'album' as LibraryDefaultSort, label: 'ALBUM' },
  { value: 'duration' as LibraryDefaultSort, label: 'DURATION' },
]

const artworkOptions = [
  { value: 'embedded' as ArtworkPreference, label: 'EMBEDDED' },
  { value: 'external' as ArtworkPreference, label: 'EXTERNAL' },
  { value: 'placeholder' as ArtworkPreference, label: 'PLACEHOLDER' },
]

// ---- Native library scan (Android only) --------------------
// On the web every one of these stays inert and the row keeps its
// existing "not available in this build" presentation.
const isNativeLibrary = computed(() => library.isNativeLibrary)
const isScanning = computed(() => library.isScanning)
const scanState = computed(() => library.scanState)
const scanLabel = computed(() => library.scanLabel)
const scanPercent = computed(() => library.scanPercent)
const libraryError = computed(() => library.libraryError)

const scanButtonLabel = computed(() => {
  if (!isNativeLibrary.value) return 'SCAN'
  if (isScanning.value) return 'CANCEL'
  if (scanState.value === 'REQUESTING_PERMISSION') return 'WAITING'
  return 'SCAN'
})

const scanStatusText = computed(() => {
  if (!isNativeLibrary.value) return 'NOT AVAILABLE IN THIS BUILD'
  if (libraryError.value) return libraryError.value.message
  return scanLabel.value || undefined
})

// ---- Integration diagnostics -------------------------------
// Reports what the native chain actually did, on the device.
const diagnostics = ref<{ step: string; value: string; ok: boolean | null }[]>([])
const diagnosticsRunning = ref(false)

async function runDiagnostics() {
  diagnosticsRunning.value = true
  try {
    const { runLibraryDiagnostics } = await import('~/services/native/musicLibraryDiagnostics')
    diagnostics.value = await runLibraryDiagnostics()
  } catch (error) {
    diagnostics.value = [{
      step: 'diagnostics',
      value: `Failed to run: ${String(error)}`,
      ok: false,
    }]
  } finally {
    diagnosticsRunning.value = false
  }
}

function onScanClick() {
  if (!isNativeLibrary.value) return
  if (isScanning.value) void library.cancelLibraryScan()
  else void library.scanLibrary()
}

watch(() => settings.library.defaultSort, (value) => {
  const map: Record<LibraryDefaultSort, typeof library.sortBy.value> = {
    'recently-added': 'recently-added',
    alphabetical: 'title',
    artist: 'artist',
    album: 'album',
    duration: 'duration',
  }
  library.setSortBy(map[value])
})
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="music-library" index="01" label="MUSIC LIBRARY" description="ARCHIVE DISCOVERY">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="auto-scan"
          icon="lucide:radar"
          label="AUTO SCAN"
          description="Automatically detect new music files."
          coming-soon="REQUIRES MEDIASTORE — NOT AVAILABLE IN THIS BUILD"
        >
          <SettingsToggle
            :model-value="settings.library.autoScan"
            aria-label="Auto scan"
            @update:model-value="value => settings.patchLibrary({ autoScan: value })"
          />
        </SettingRow>
        <SettingRow
          id="scan-startup"
          icon="lucide:power"
          label="SCAN ON STARTUP"
          description="Resync the index when SYSTEMA opens."
          coming-soon="REQUIRES MEDIASTORE — NOT AVAILABLE IN THIS BUILD"
        >
          <SettingsToggle
            :model-value="settings.library.scanOnStartup"
            aria-label="Scan on startup"
            @update:model-value="value => settings.patchLibrary({ scanOnStartup: value })"
          />
        </SettingRow>
        <SettingRow
          id="subdirectories"
          icon="lucide:folder-tree"
          label="INCLUDE SUBDIRECTORIES"
          description="Walk nested folders when a native scan runs."
        >
          <SettingsToggle
            :model-value="settings.library.includeSubdirectories"
            aria-label="Include subdirectories"
            @update:model-value="value => settings.patchLibrary({ includeSubdirectories: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="sorting" index="02" label="SORTING" description="DEFAULT ARCHIVE ORDER">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="default-sort"
          icon="lucide:arrow-up-down"
          label="DEFAULT SORT"
          description="The library store opens with this order. You can still change it in the archive."
        >
          <SettingsSelect
            :model-value="settings.library.defaultSort"
            :options="sortOptions"
            aria-label="Default library sort"
            title="DEFAULT SORT"
            @update:model-value="value => settings.patchLibrary({ defaultSort: value })"
          />
        </SettingRow>
        <SettingRow icon="lucide:list-ordered" label="CURRENT LIBRARY ORDER" description="Live value from the library store.">
          <span class="label text-fg">{{ librarySortOptions.find(option => option.id === library.sortBy)?.label }}</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="metadata" index="03" label="METADATA" description="TAGS AND USER EDITS">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="embedded-metadata"
          icon="lucide:file-text"
          label="READ EMBEDDED METADATA"
          description="Prefer ID3 / Vorbis / MP4 atoms when the native parser runs."
        >
          <SettingsToggle
            :model-value="settings.library.readEmbeddedMetadata"
            aria-label="Read embedded metadata"
            @update:model-value="value => settings.patchLibrary({ readEmbeddedMetadata: value })"
          />
        </SettingRow>
        <SettingRow
          id="auto-artwork"
          icon="lucide:image"
          label="AUTO FETCH ARTWORK"
          description="Allow a network fallback only when embedded art is missing."
          coming-soon="NETWORK ARTWORK IS NOT ACTIVE IN THIS BUILD"
        >
          <SettingsToggle
            :model-value="settings.library.autoFetchArtwork"
            aria-label="Auto fetch artwork"
            @update:model-value="value => settings.patchLibrary({ autoFetchArtwork: value })"
          />
        </SettingRow>
        <SettingRow
          id="preserve-edits"
          icon="lucide:lock"
          label="PRESERVE USER EDITS"
          description="Manually edited metadata is never overwritten automatically."
        >
          <SettingsToggle
            :model-value="settings.library.preserveUserEdits"
            aria-label="Preserve user edits"
            @update:model-value="value => settings.patchLibrary({ preserveUserEdits: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="artwork" index="04" label="ARTWORK" description="COVER SOURCE PREFERENCE">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:image-plus"
          label="ARTWORK SOURCE"
          description="Embedded first, then external files, or generate a placeholder. Local processing comes with the native layer."
        >
          <SettingsSegmentedControl
            :model-value="settings.library.artworkPreference"
            :options="artworkOptions"
            aria-label="Artwork source"
            @update:model-value="value => settings.patchLibrary({ artworkPreference: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="scan" index="05" label="SCAN LIBRARY" description="MEDIASTORE">
      <div class="border border-line">
        <SettingRow
          id="scan-library"
          icon="lucide:scan-search"
          label="SCAN MUSIC LIBRARY"
          :description="isNativeLibrary
            ? 'Indexes audio on this device through Android MediaStore. Incremental — only new, changed and removed files are written.'
            : 'A full device scan requires the Android MediaStore adapter.'"
          :coming-soon="scanStatusText"
        >
          <button
            class="sys-btn-outline !h-8"
            :disabled="!isNativeLibrary || scanState === 'REQUESTING_PERMISSION'"
            @click="onScanClick"
          >
            {{ scanButtonLabel }}
          </button>
        </SettingRow>
        <div
          v-if="isNativeLibrary && isScanning"
          class="h-0.5 w-full bg-surface-muted overflow-hidden"
          role="progressbar"
          :aria-valuenow="scanPercent ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <!-- Determinate only when MediaStore reported a real total. -->
          <div
            class="h-full bg-fg transition-[width] duration-300"
            :class="scanPercent === null ? 'w-1/3 animate-pulse' : ''"
            :style="scanPercent === null ? undefined : { width: `${scanPercent}%` }"
          />
        </div>
      </div>
      <div class="mt-4 border border-line">
        <SettingRow
          id="library-diagnostics"
          icon="lucide:stethoscope"
          label="INTEGRATION DIAGNOSTICS"
          description="Runs the full native chain and reports where it stops."
        >
          <button
            class="sys-btn-outline !h-8"
            :disabled="diagnosticsRunning"
            @click="runDiagnostics"
          >
            {{ diagnosticsRunning ? 'RUNNING' : 'RUN' }}
          </button>
        </SettingRow>
        <div v-if="diagnostics.length" class="border-t border-line p-3 space-y-1.5">
          <div
            v-for="entry in diagnostics"
            :key="entry.step"
            class="flex items-start gap-2 text-micro font-mono leading-relaxed"
          >
            <span
              class="shrink-0 w-3 text-center"
              :class="entry.ok === null ? 'text-fg-muted' : entry.ok ? 'text-success' : 'text-danger'"
            >{{ entry.ok === null ? '·' : entry.ok ? '✓' : '✗' }}</span>
            <span class="shrink-0 text-fg-muted">{{ entry.step }}</span>
            <span class="min-w-0 break-all text-fg">{{ entry.value }}</span>
          </div>
        </div>
      </div>

      <SettingsNote>
        {{ isNativeLibrary
          ? 'REAL PROGRESS FROM THE NATIVE INDEX. COUNTS REFLECT ACTUAL MEDIASTORE ROWS PROCESSED.'
          : 'NO MOCK SCANNER. WHEN THE NATIVE INDEX EXISTS, THIS BUTTON WILL SHOW REAL PROGRESS — FOR EXAMPLE 128 / 642.' }}
      </SettingsNote>
    </SettingsSection>
  </div>
</template>
