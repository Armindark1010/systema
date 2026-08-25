<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useLibraryStore } from '~/stores/library'

const settings = useSettingsStore()
const { reset: resetAISession } = useAI()
const trackAnalysis = useTrackAnalysis()
const library = useLibraryStore()
const toast = useToast()

const importOpen = ref(false)
const exportOpen = ref(false)
const confirm = ref<null | 'settings' | 'ai' | 'ai-cache' | 'library' | 'everything'>(null)

const storageRows = [
  { label: 'MUSIC', note: 'FILE SIZE REQUIRES NATIVE STORAGE ACCESS' },
  { label: 'PLAYLISTS', note: 'PLAYLIST BLOBS ARE IN-MEMORY UNTIL ROOM EXISTS' },
  { label: 'AI ANALYSIS', note: 'NO PERSISTENT ANALYSIS STORE IN THIS BUILD' },
  { label: 'CACHE', note: 'NO APP CACHE API IS WIRED' },
]

function exportSettingsFile() {
  if (!import.meta.client) return
  const snapshot = settings.exportSnapshot()
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'systema-settings.json'
  anchor.click()
  URL.revokeObjectURL(url)
  toast.add({ title: 'Settings exported', description: 'systema-settings.json', icon: 'lucide:download' })
}

function resetSettingsOnly() {
  settings.resetSettings()
  toast.add({ title: 'Settings reset', icon: 'lucide:rotate-ccw' })
}

function resetAIData() {
  resetAISession()
  if (settings.ai.deleteAnalysisAfterReset) {
    trackAnalysis.clearCache()
  }
  toast.add({ title: 'AI data reset', description: 'Interactions cleared. Music files untouched.', icon: 'lucide:sparkles' })
}

function resetLibraryIndex() {
  library.resetPresentation()
  toast.add({ title: 'Library index reset', description: 'Presentation state only. Music files untouched.', icon: 'lucide:library' })
}

function resetEverything() {
  resetSettingsOnly()
  resetAISession()
  trackAnalysis.clearCache()
  library.resetPresentation()
  toast.add({ title: 'SYSTEMA reset', description: 'Settings, AI session data, and library presentation restored. Music files were not deleted.', icon: 'lucide:rotate-ccw' })
}

function clearAICache() {
  trackAnalysis.clearCache()
  toast.add({ title: 'AI cache cleared', description: 'Session analyses removed. Music files untouched.', icon: 'lucide:trash-2' })
}

function onConfirm() {
  if (confirm.value === 'settings') resetSettingsOnly()
  else if (confirm.value === 'ai') resetAIData()
  else if (confirm.value === 'ai-cache') clearAICache()
  else if (confirm.value === 'library') resetLibraryIndex()
  else if (confirm.value === 'everything') resetEverything()
}
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="storage" index="01" label="STORAGE" description="DEVICE TELEMETRY">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          v-for="row in storageRows"
          :key="row.label"
          icon="lucide:hard-drive"
          :label="row.label"
          :description="row.note"
        >
          <span class="label text-fg-muted">UNAVAILABLE</span>
        </SettingRow>
      </div>
      <SettingsNote>
        NO ESTIMATED GIGABYTES. WHEN THE NATIVE STORAGE ADAPTER EXISTS, THESE ROWS WILL SHOW MEASURED VALUES.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="import" index="02" label="IMPORT" description="EXISTING PLAYLIST PIPELINE">
      <div class="border border-line divide-y divide-line">
        <SettingRow id="import-playlist" icon="lucide:file-input" label="IMPORT PLAYLIST" description="M3U · JSON · SYSTEMA format — the existing import state machine.">
          <button class="sys-btn-outline !h-8" @click="importOpen = true">
            <UIcon name="lucide:file-input" class="w-3.5 h-3.5" /> IMPORT
          </button>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="export" index="03" label="EXPORT" description="PLAYLISTS AND SETTINGS">
      <div class="border border-line divide-y divide-line">
        <SettingRow id="export-playlist" icon="lucide:file-output" label="EXPORT PLAYLISTS" description="Reuses the existing playlist export system.">
          <button class="sys-btn-outline !h-8" @click="exportOpen = true">
            <UIcon name="lucide:file-output" class="w-3.5 h-3.5" /> EXPORT
          </button>
        </SettingRow>
        <SettingRow icon="lucide:download" label="EXPORT SETTINGS" description="Download the current settings snapshot as JSON.">
          <button class="sys-btn-outline !h-8" @click="exportSettingsFile">
            <UIcon name="lucide:download" class="w-3.5 h-3.5" /> EXPORT
          </button>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="cache" index="04" label="CACHE" description="SELECTIVE CLEARS">
      <div class="border border-line divide-y divide-line">
        <SettingRow icon="lucide:image-off" label="CLEAR IMAGE CACHE" description="Artwork disk cache is a native concern." coming-soon="NO IMAGE CACHE API">
          <button class="sys-btn-outline !h-8" disabled>CLEAR</button>
        </SettingRow>
        <SettingRow icon="lucide:sparkles" label="CLEAR AI CACHE" description="Session analyses only.">
          <button class="sys-btn-outline !h-8" :disabled="trackAnalysis.cachedCount() === 0" @click="confirm = 'ai-cache'">
            CLEAR
          </button>
        </SettingRow>
        <SettingRow icon="lucide:eraser" label="CLEAR APP CACHE" description="No application cache layer is installed." coming-soon="UNAVAILABLE">
          <button class="sys-btn-outline !h-8" disabled>CLEAR</button>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="reset" index="05" label="RESET SYSTEMA" description="DANGER ZONE">
      <SettingsDangerZone title="IRREVERSIBLE ACTIONS">
        <div class="divide-y divide-danger">
          <SettingRow icon="lucide:sliders-horizontal" label="RESET SETTINGS" description="Restore default configuration. Does not touch music files.">
            <button class="sys-btn-outline !h-8" @click="confirm = 'settings'">RESET</button>
          </SettingRow>
          <SettingRow icon="lucide:sparkles" label="RESET AI DATA" description="Clears AI session state. Deletes cached analysis only if that policy is enabled.">
            <button class="sys-btn-outline !h-8" @click="confirm = 'ai'">RESET</button>
          </SettingRow>
          <SettingRow icon="lucide:library" label="RESET LIBRARY INDEX" description="Restores library presentation (section and sort). Does not delete music files.">
            <button class="sys-btn-outline !h-8" @click="confirm = 'library'">RESET</button>
          </SettingRow>
          <SettingRow icon="lucide:triangle-alert" label="RESET EVERYTHING" description="Settings + AI session data + library presentation. Music files on disk are never deleted.">
            <button class="sys-btn-outline !h-8 !border-danger !text-danger" @click="confirm = 'everything'">
              RESET
            </button>
          </SettingRow>
        </div>
      </SettingsDangerZone>
    </SettingsSection>
  </div>

  <PlaylistImport :open="importOpen" @update:open="(value: boolean) => (importOpen = value)" />
  <PlaylistExport :open="exportOpen" @update:open="(value: boolean) => (exportOpen = value)" />

  <SettingsConfirmDialog
    :open="confirm === 'settings'"
    title="RESET SETTINGS"
    description="Restore every SYSTEMA setting to its default. Theme, playback, AI policy, and gestures will reset. Music files stay on the device."
    confirm-label="RESET SETTINGS"
    danger
    @update:open="value => { if (!value) confirm = null }"
    @confirm="onConfirm"
  />
  <SettingsConfirmDialog
    :open="confirm === 'ai-cache'"
    title="CLEAR AI CACHE"
    description="Remove cached analyses from this session. Music files and playlists stay untouched."
    confirm-label="CLEAR CACHE"
    danger
    @update:open="value => { if (!value) confirm = null }"
    @confirm="onConfirm"
  />
  <SettingsConfirmDialog
    :open="confirm === 'ai'"
    title="RESET AI DATA"
    description="Clear AI session state. Cached analyses are removed only if Delete analysis after reset is enabled. Music files are not deleted."
    confirm-label="RESET AI DATA"
    danger
    @update:open="value => { if (!value) confirm = null }"
    @confirm="onConfirm"
  />
  <SettingsConfirmDialog
    :open="confirm === 'library'"
    title="RESET LIBRARY INDEX"
    description="Reset library presentation — active section and sort order. The catalog itself and your audio files are not deleted."
    confirm-label="RESET INDEX"
    danger
    @update:open="value => { if (!value) confirm = null }"
    @confirm="onConfirm"
  />
  <SettingsConfirmDialog
    :open="confirm === 'everything'"
    title="RESET EVERYTHING"
    description="This restores settings, AI session data, and library presentation. It does not uninstall SYSTEMA and it does not delete actual music files."
    confirm-label="RESET EVERYTHING"
    require-phrase="SYSTEMA"
    danger
    @update:open="value => { if (!value) confirm = null }"
    @confirm="onConfirm"
  />
</template>
