<script setup lang="ts">
// Privacy — local-first posture
const settings = reactive({
  analytics: false,
  networkUsage: false,
  biometrics: true,
})
</script>

<template>
  <SettingsSection id="privacy" index="07" label="PRIVACY" description="LOCAL-FIRST — YOUR ARCHIVE STAYS ON DEVICE">
    <div class="border border-line divide-y divide-line">
      <SettingRow label="ANONYMIZED ANALYTICS" description="DISABLED BY DEFAULT — NOTHING LEAVES THE DEVICE.">
        <USwitch v-model="settings.analytics" aria-label="Anonymized analytics" />
      </SettingRow>
      <SettingRow label="NETWORK ACCESS" description="ARTWORK + METADATA FETCHING ONLY. NO TELEMETRY.">
        <USwitch v-model="settings.networkUsage" aria-label="Network access" />
      </SettingRow>
      <SettingRow label="BIOMETRIC LOCK" description="FINGERPRINT GATE FOR THE APP — PLANNED (CAPACITOR).">
        <USwitch v-model="settings.biometrics" aria-label="Biometric lock" />
      </SettingRow>
    </div>
    <p class="mt-3 text-[11px] text-fg-faint leading-relaxed">
      ALL DATA (LIBRARY, PLAYLISTS, AI ANALYSIS) REMAINS LOCAL. FUTURE AI INFERENCE RUNS
      ON-DEVICE VIA ONNX RUNTIME — NO CLOUD ACCOUNT REQUIRED.
    </p>
  </SettingsSection>
</template>
