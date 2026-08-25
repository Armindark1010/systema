<script setup lang="ts">
// Playback — transport preferences (mock values)
const settings = reactive({
  gapless: true,
  normalize: true,
  crossfade: 4,
  eq: false,
  quality: 'LOSSLESS',
  bluetooth: true,
})

const toast = useToast()
</script>

<template>
  <SettingsSection id="playback" index="02" label="PLAYBACK" description="TRANSPORT — MOCK STATE, MEDIA3 LATER">
    <div class="border border-line divide-y divide-line">
      <SettingRow label="GAPLESS PLAYBACK" description="SEAMLESS TRANSITIONS BETWEEN CONSECUTIVE TRACKS.">
        <USwitch v-model="settings.gapless" aria-label="Gapless playback" />
      </SettingRow>
      <SettingRow label="NORMALIZE VOLUME" description="EVEN LOUDNESS ACROSS THE ARCHIVE (EBU R128).">
        <USwitch v-model="settings.normalize" aria-label="Normalize volume" />
      </SettingRow>
      <SettingRow label="CROSSFADE" :description="`${settings.crossfade} SECONDS — OVERLAP BETWEEN TRACKS.`">
        <div class="flex items-center gap-3 w-40">
          <USlider v-model="settings.crossfade" :min="0" :max="12" :step="1" size="sm" class="flex-1" aria-label="Crossfade seconds" />
          <span class="tnum text-[12px] font-semibold text-fg w-8 text-right">{{ settings.crossfade }}S</span>
        </div>
      </SettingRow>
      <SettingRow label="EQUALIZER" description="10-BAND EQ — FRONTEND MOCK, DSP NOT IMPLEMENTED.">
        <USwitch v-model="settings.eq" aria-label="Equalizer" />
      </SettingRow>
      <SettingRow label="OUTPUT QUALITY" description="PLAYBACK BITRATE PREFERENCE.">
        <select
          v-model="settings.quality"
          class="h-8 pl-3 pr-8 text-[11px] font-bold tracking-[0.12em] bg-surface border border-line text-fg-muted appearance-none cursor-pointer t-col focus-ring"
          aria-label="Output quality"
        >
          <option>LOSSLESS</option>
          <option>HIGH</option>
          <option>STANDARD</option>
        </select>
      </SettingRow>
      <SettingRow label="BLUETOOTH MEDIA CONTROLS" description="MEDIA SESSION HANDOFF TO HEADSETS / CARS — PLANNED.">
        <USwitch v-model="settings.bluetooth" aria-label="Bluetooth media controls" />
      </SettingRow>
    </div>
    <button class="sys-btn-outline mt-4" @click="toast.add({ title: 'Playback settings saved', icon: 'lucide:check' })">SAVE PLAYBACK SETTINGS</button>
  </SettingsSection>
</template>
