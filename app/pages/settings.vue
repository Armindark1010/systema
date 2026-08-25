<script setup lang="ts">
// ============================================================
// SETTINGS — playback · library · AI · appearance · transfer ·
// storage · privacy · about. Structured, no cards.
// ============================================================

useHead({ title: 'Settings' })

const pl = usePlaylists()
const importOpen = ref(false)
const exportOpen = ref(false)
</script>

<template>
  <div class="pb-14">
    <SettingsLayout>
      <AppearanceSettings />
      <PlaybackSettings />
      <LibrarySettings />
      <AISettings />
      <ImportExportSettings
        @import="importOpen = true"
        @export="exportOpen = true"
      />
      <StorageSettings />
      <PrivacySettings />
      <AboutSettings />
    </SettingsLayout>

    <PlaylistImport :open="importOpen" @update:open="(v: boolean) => (importOpen = v)" />
    <PlaylistExport :open="exportOpen" :playlist-title="pl.playlists.value[0]?.title" @update:open="(v: boolean) => (exportOpen = v)" />
  </div>
</template>
