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
          label="AUTO SCAN"
          description="AUTOMATICALLY DETECT NEW MUSIC FILES."
          coming-soon="REQUIRES MEDIASTORE — NOT AVAILABLE IN THIS BUILD"
        >
          <USwitch
            :model-value="settings.library.autoScan"
            aria-label="Auto scan"
            @update:model-value="(value: boolean) => settings.patchLibrary({ autoScan: value })"
          />
        </SettingRow>
        <SettingRow
          label="SCAN ON STARTUP"
          description="RESYNC THE INDEX WHEN SYSTEMA OPENS."
          coming-soon="REQUIRES MEDIASTORE — NOT AVAILABLE IN THIS BUILD"
        >
          <USwitch
            :model-value="settings.library.scanOnStartup"
            aria-label="Scan on startup"
            @update:model-value="(value: boolean) => settings.patchLibrary({ scanOnStartup: value })"
          />
        </SettingRow>
        <SettingRow
          label="INCLUDE SUBDIRECTORIES"
          description="WALK NESTED FOLDERS WHEN A NATIVE SCAN RUNS."
        >
          <USwitch
            :model-value="settings.library.includeSubdirectories"
            aria-label="Include subdirectories"
            @update:model-value="(value: boolean) => settings.patchLibrary({ includeSubdirectories: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="sorting" index="02" label="SORTING" description="DEFAULT ARCHIVE ORDER">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="DEFAULT SORT" description="THE LIBRARY STORE OPENS WITH THIS ORDER. YOU CAN STILL CHANGE IT IN THE ARCHIVE.">
          <SettingsSegmented
            :model-value="settings.library.defaultSort"
            :options="sortOptions"
            aria-label="Default library sort"
            compact
            @update:model-value="value => settings.patchLibrary({ defaultSort: value })"
          />
        </SettingRow>
        <SettingRow label="CURRENT LIBRARY ORDER" description="LIVE VALUE FROM THE LIBRARY STORE.">
          <span class="label text-fg">{{ librarySortOptions.find(option => option.id === library.sortBy)?.label }}</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="metadata" index="03" label="METADATA" description="TAGS AND USER EDITS">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          label="READ EMBEDDED METADATA"
          description="PREFER ID3 / VORBIS / MP4 ATOMS WHEN THE NATIVE PARSER RUNS."
        >
          <USwitch
            :model-value="settings.library.readEmbeddedMetadata"
            aria-label="Read embedded metadata"
            @update:model-value="(value: boolean) => settings.patchLibrary({ readEmbeddedMetadata: value })"
          />
        </SettingRow>
        <SettingRow
          label="AUTO FETCH ARTWORK"
          description="ALLOW A NETWORK FALLBACK ONLY WHEN EMBEDDED ART IS MISSING."
          coming-soon="NETWORK ARTWORK IS NOT ACTIVE IN THIS BUILD"
        >
          <USwitch
            :model-value="settings.library.autoFetchArtwork"
            aria-label="Auto fetch artwork"
            @update:model-value="(value: boolean) => settings.patchLibrary({ autoFetchArtwork: value })"
          />
        </SettingRow>
        <SettingRow
          label="PRESERVE USER EDITS"
          description="MANUALLY EDITED METADATA IS NEVER OVERWRITTEN AUTOMATICALLY."
        >
          <USwitch
            :model-value="settings.library.preserveUserEdits"
            aria-label="Preserve user edits"
            @update:model-value="(value: boolean) => settings.patchLibrary({ preserveUserEdits: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="artwork" index="04" label="ARTWORK" description="COVER SOURCE PREFERENCE">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          label="ARTWORK SOURCE"
          description="EMBEDDED FIRST, THEN EXTERNAL FILES, OR GENERATE A PLACEHOLDER. LOCAL PROCESSING COMES WITH THE NATIVE LAYER."
        >
          <SettingsSegmented
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
          label="SCAN MUSIC LIBRARY"
          description="A FULL DEVICE SCAN REQUIRES THE ANDROID MEDIASTORE ADAPTER."
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
