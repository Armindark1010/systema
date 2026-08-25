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
          description="A full device scan requires the Android MediaStore adapter."
          coming-soon="NOT AVAILABLE IN THIS BUILD"
        >
          <button class="sys-btn-outline !h-8" disabled>
            SCAN
          </button>
        </SettingRow>
      </div>
      <SettingsNote>
        NO MOCK SCANNER. WHEN THE NATIVE INDEX EXISTS, THIS BUTTON WILL SHOW REAL PROGRESS — FOR EXAMPLE 128 / 642.
      </SettingsNote>
    </SettingsSection>
  </div>
</template>
