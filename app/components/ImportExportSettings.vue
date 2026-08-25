<script setup lang="ts">
// Import / Export — entry points to the playlist transfer state machines
const emit = defineEmits<{ import: []; export: [] }>()
</script>

<template>
  <SettingsSection id="import-export" index="05" label="IMPORT / EXPORT" description="PLAYLIST TRANSFER — UI ARCHITECTURE ONLY">
    <div class="border border-line divide-y divide-line">
      <SettingRow label="IMPORT PLAYLIST" description="M3U · JSON · SYSTEMA FORMAT — PARSE, MATCH, RESOLVE MISSING TRACKS.">
        <button class="sys-btn-outline !h-8" @click="emit('import')">
          <UIcon name="lucide:file-input" class="w-3.5 h-3.5" /> IMPORT
        </button>
      </SettingRow>
      <SettingRow label="EXPORT PLAYLIST" description="SYSTEMA JSON · JSON · M3U — NATIVE FILE HANDLING LATER.">
        <button class="sys-btn-outline !h-8" @click="emit('export')">
          <UIcon name="lucide:file-output" class="w-3.5 h-3.5" /> EXPORT
        </button>
      </SettingRow>
    </div>
    <p class="mt-3 text-[11px] text-fg-faint leading-relaxed">
      FORMAT PIPELINES: SYSTEMA JSON (FULL METADATA) → JSON (COMPACT) → M3U (PORTABLE).
      THE IMPORT STATE MACHINE COVERS SELECT → READING → MATCHING → MISSING RESOLUTION → COMPLETED.
    </p>
  </SettingsSection>
</template>
