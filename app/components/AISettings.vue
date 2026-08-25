<script setup lang="ts">
import type { AILanguage, AIPrivacyMode, AnalysisDepth, BatteryThreshold } from '~/types/settings'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
const { analysis } = useAI()
const trackAnalysis = useTrackAnalysis()

const languageOptions = [
  { value: 'auto' as AILanguage, label: 'AUTO' },
  { value: 'fa' as AILanguage, label: 'PERSIAN' },
  { value: 'en' as AILanguage, label: 'ENGLISH' },
]

const depthOptions = [
  { value: 'quick' as AnalysisDepth, label: 'QUICK' },
  { value: 'standard' as AnalysisDepth, label: 'STANDARD' },
  { value: 'deep' as AnalysisDepth, label: 'DEEP' },
]

const privacyOptions = [
  { value: 'local-only' as AIPrivacyMode, label: 'LOCAL ONLY' },
  { value: 'allow-cloud' as AIPrivacyMode, label: 'ALLOW CLOUD' },
  { value: 'ask' as AIPrivacyMode, label: 'ASK FIRST' },
]

const batteryOptions = [
  { value: 20 as BatteryThreshold, label: '20%' },
  { value: 30 as BatteryThreshold, label: '30%' },
  { value: 40 as BatteryThreshold, label: '40%' },
  { value: 50 as BatteryThreshold, label: '50%' },
]

const confirmClear = ref(false)

const cachedCount = computed(() => trackAnalysis.cachedCount())

function clearCache() {
  trackAnalysis.clearCache()
}
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="engine" index="01" label="AI ENGINE" description="INTELLIGENCE LAYER">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="AI FEATURES" description="DISABLE INTERACTIONS WITHOUT DESTROYING STORED ANALYSIS.">
          <USwitch
            :model-value="settings.ai.enabled"
            aria-label="AI features"
            @update:model-value="(value: boolean) => settings.patchAI({ enabled: value })"
          />
        </SettingRow>
        <SettingRow label="MODEL CONFIGURATION" description="NO ON-DEVICE MODEL IS INSTALLED IN THIS FRONTEND BUILD.">
          <span class="label text-fg-faint">NOT CONFIGURED</span>
        </SettingRow>
        <SettingRow label="STATUS" description="THE UI IS READY. INFERENCE IS NOT.">
          <span class="label text-fg">STANDBY</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="analysis" index="02" label="ANALYSIS" description="WHEN AND HOW DEEP">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="AUTOMATIC ANALYSIS" description="ANALYZE NEWLY DISCOVERED MUSIC WHEN THE PIPELINE EXISTS.">
          <USwitch
            :model-value="settings.ai.autoAnalysis"
            aria-label="Automatic analysis"
            @update:model-value="(value: boolean) => settings.patchAI({ autoAnalysis: value })"
          />
        </SettingRow>
        <SettingRow
          label="ANALYZE WHILE CHARGING"
          description="ALLOW BACKGROUND ANALYSIS WHEN THE DEVICE IS CHARGING."
          coming-soon="PREPARED FOR ANDROID WORKMANAGER — NUXT CANNOT RUN DEVICE BACKGROUND WORK"
        >
          <USwitch
            :model-value="settings.ai.analyzeWhileCharging"
            aria-label="Analyze while charging"
            @update:model-value="(value: boolean) => settings.patchAI({ analyzeWhileCharging: value })"
          />
        </SettingRow>
        <SettingRow label="ANALYSIS DEPTH" description="QUICK: BASIC METADATA. STANDARD: MOOD, GENRE, ENERGY, TEMPO, LANGUAGE, INSTRUMENTS. DEEP: ADDITIONAL SEMANTIC ANALYSIS.">
          <SettingsSegmented
            :model-value="settings.ai.depth"
            :options="depthOptions"
            aria-label="Analysis depth"
            @update:model-value="value => settings.patchAI({ depth: value })"
          />
        </SettingRow>
        <SettingRow label="ANALYSIS PROGRESS" description="LOCAL SESSION COUNTERS ONLY — NOT A DEVICE-WIDE INDEX.">
          <span class="tnum text-[12px] font-semibold text-fg">
            {{ analysis.state.value.analyzed }} / {{ analysis.state.value.total }}
          </span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="conditions" index="03" label="ANALYSIS CONDITIONS" description="FUTURE BACKGROUND WORKER">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          label="CHARGING REQUIRED"
          description="ONLY SCHEDULE ANALYSIS WHILE PLUGGED IN."
        >
          <USwitch
            :model-value="settings.ai.chargingRequired"
            aria-label="Charging required"
            @update:model-value="(value: boolean) => settings.patchAI({ chargingRequired: value })"
          />
        </SettingRow>
        <SettingRow
          label="WI-FI REQUIRED"
          description="RESERVED FOR OPTIONAL CLOUD ANALYSIS. LOCAL ANALYSIS DOES NOT NEED A NETWORK."
        >
          <USwitch
            :model-value="settings.ai.wifiRequired"
            aria-label="Wi-Fi required"
            @update:model-value="(value: boolean) => settings.patchAI({ wifiRequired: value })"
          />
        </SettingRow>
        <SettingRow label="BATTERY THRESHOLD" description="DO NOT START BACKGROUND ANALYSIS BELOW THIS LEVEL.">
          <SettingsSegmented
            :model-value="settings.ai.batteryThreshold"
            :options="batteryOptions"
            aria-label="Battery threshold"
            @update:model-value="value => settings.patchAI({ batteryThreshold: value })"
          />
        </SettingRow>
      </div>
      <SettingsNote>
        THESE VALUES ARE THE CONTRACT FOR A FUTURE NATIVE WORKER. THIS BUILD DOES NOT READ BATTERY, CHARGE, OR RADIO STATE.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="language" index="04" label="LANGUAGE" description="PERSIAN IS FIRST-CLASS">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="AI LANGUAGE" description="AUTO FOLLOWS THE QUERY. PERSIAN AND ENGLISH ARE EQUAL OUTPUT TARGETS.">
          <SettingsSegmented
            :model-value="settings.ai.language"
            :options="languageOptions"
            aria-label="AI language"
            @update:model-value="value => settings.patchAI({ language: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="privacy" index="05" label="AI PRIVACY" description="LOCAL FIRST">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="PRIVACY MODE" description="KEEP MUSIC ANALYSIS ON THE DEVICE WHENEVER POSSIBLE.">
          <SettingsSegmented
            :model-value="settings.ai.privacy"
            :options="privacyOptions"
            aria-label="AI privacy"
            compact
            @update:model-value="value => settings.patchAI({ privacy: value })"
          />
        </SettingRow>
        <SettingRow label="KEEP ANALYSIS" description="RETAIN COMPLETED ANALYSES BETWEEN SESSIONS WHEN NATIVE STORAGE EXISTS.">
          <USwitch
            :model-value="settings.ai.keepAnalysis"
            aria-label="Keep analysis"
            @update:model-value="(value: boolean) => settings.patchAI({ keepAnalysis: value })"
          />
        </SettingRow>
        <SettingRow label="DELETE ANALYSIS AFTER RESET" description="IF ENABLED, RESET AI DATA WILL CLEAR ANALYSIS. TOGGLING THIS DOES NOT DELETE ANYTHING NOW.">
          <USwitch
            :model-value="settings.ai.deleteAnalysisAfterReset"
            aria-label="Delete analysis after reset"
            @update:model-value="(value: boolean) => settings.patchAI({ deleteAnalysisAfterReset: value })"
          />
        </SettingRow>
      </div>
      <SettingsNote>
        THIS IS A POLICY SETTING. NO CLOUD PIPELINE IS CONNECTED, SO NOTHING LEAVES THE DEVICE IN THIS BUILD.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="cache" index="06" label="AI CACHE" description="IN-MEMORY ANALYSES ONLY">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="CACHED ANALYSES" description="RESULTS HELD IN THE CURRENT SESSION.">
          <span class="tnum text-[12px] font-semibold text-fg">{{ cachedCount }}</span>
        </SettingRow>
        <SettingRow label="STORAGE USED" description="BYTE ACCOUNTING REQUIRES NATIVE STORAGE.">
          <span class="label text-fg-faint">UNAVAILABLE</span>
        </SettingRow>
        <SettingRow label="CLEAR AI CACHE" description="REMOVES SESSION ANALYSIS RESULTS. MUSIC FILES ARE NEVER TOUCHED.">
          <button class="sys-btn-outline !h-8" :disabled="cachedCount === 0" @click="confirmClear = true">
            CLEAR
          </button>
        </SettingRow>
      </div>
    </SettingsSection>
  </div>

  <SettingsConfirmDialog
    :open="confirmClear"
    title="CLEAR AI CACHE"
    description="Remove cached analyses from this session. Music files and playlists stay untouched."
    confirm-label="CLEAR CACHE"
    danger
    @confirm="clearCache"
  />
</template>
