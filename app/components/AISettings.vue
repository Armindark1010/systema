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
        <SettingRow
          id="ai-enabled"
          icon="lucide:sparkles"
          label="AI FEATURES"
          description="Disable interactions without destroying stored analysis."
        >
          <SettingsToggle
            :model-value="settings.ai.enabled"
            aria-label="AI features"
            @update:model-value="value => settings.patchAI({ enabled: value })"
          />
        </SettingRow>
        <SettingRow
          id="ai-model"
          icon="lucide:box"
          label="MODEL CONFIGURATION"
          description="No on-device model is installed in this frontend build."
        >
          <span class="label text-fg-muted">NOT CONFIGURED</span>
        </SettingRow>
        <SettingRow icon="lucide:circle-dot" label="STATUS" description="The UI is ready. Inference is not running.">
          <span class="label text-fg">STANDBY</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="analysis" index="02" label="ANALYSIS" description="WHEN AND HOW DEEP">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="auto-analysis"
          icon="lucide:scan-line"
          label="AUTOMATIC ANALYSIS"
          description="Analyze newly discovered music when the pipeline exists."
        >
          <SettingsToggle
            :model-value="settings.ai.autoAnalysis"
            aria-label="Automatic analysis"
            @update:model-value="value => settings.patchAI({ autoAnalysis: value })"
          />
        </SettingRow>
        <SettingRow
          id="analyze-charging"
          icon="lucide:battery-charging"
          label="ANALYZE WHILE CHARGING"
          description="Allow background analysis when the device is charging."
          coming-soon="PREPARED FOR ANDROID WORKMANAGER — NUXT CANNOT RUN DEVICE BACKGROUND WORK"
        >
          <SettingsToggle
            :model-value="settings.ai.analyzeWhileCharging"
            aria-label="Analyze while charging"
            @update:model-value="value => settings.patchAI({ analyzeWhileCharging: value })"
          />
        </SettingRow>
        <SettingRow
          id="analysis-depth"
          icon="lucide:layers"
          label="ANALYSIS DEPTH"
          description="Quick: basic metadata. Standard: mood, genre, energy, tempo, language, instruments. Deep: additional semantic analysis."
        >
          <SettingsSegmentedControl
            :model-value="settings.ai.depth"
            :options="depthOptions"
            aria-label="Analysis depth"
            @update:model-value="value => settings.patchAI({ depth: value })"
          />
        </SettingRow>
        <SettingRow icon="lucide:loader" label="ANALYSIS PROGRESS" description="Local session counters only — not a device-wide index.">
          <span class="tnum text-[12px] font-semibold text-fg">
            {{ analysis.state.value.analyzed }} / {{ analysis.state.value.total }}
          </span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="conditions" index="03" label="ANALYSIS CONDITIONS" description="FUTURE BACKGROUND WORKER">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="charging-required"
          icon="lucide:plug"
          label="CHARGING REQUIRED"
          description="Only schedule analysis while plugged in."
        >
          <SettingsToggle
            :model-value="settings.ai.chargingRequired"
            aria-label="Charging required"
            @update:model-value="value => settings.patchAI({ chargingRequired: value })"
          />
        </SettingRow>
        <SettingRow
          id="wifi-required"
          icon="lucide:wifi"
          label="WI-FI REQUIRED"
          description="Reserved for optional cloud analysis. Local analysis does not need a network."
        >
          <SettingsToggle
            :model-value="settings.ai.wifiRequired"
            aria-label="Wi-Fi required"
            @update:model-value="value => settings.patchAI({ wifiRequired: value })"
          />
        </SettingRow>
        <SettingRow
          id="battery-threshold"
          icon="lucide:battery"
          label="BATTERY THRESHOLD"
          description="Do not start background analysis below this level."
        >
          <SettingsSelect
            :model-value="settings.ai.batteryThreshold"
            :options="batteryOptions"
            aria-label="Battery threshold"
            title="BATTERY THRESHOLD"
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
        <SettingRow
          id="ai-language"
          icon="lucide:languages"
          label="AI LANGUAGE"
          description="Auto follows the query. Persian and English are equal output targets."
        >
          <SettingsSegmentedControl
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
        <SettingRow
          id="ai-privacy"
          icon="lucide:shield"
          label="PRIVACY MODE"
          description="Keep music analysis on the device whenever possible."
        >
          <SettingsSelect
            :model-value="settings.ai.privacy"
            :options="privacyOptions"
            aria-label="AI privacy"
            title="PRIVACY MODE"
            @update:model-value="value => settings.patchAI({ privacy: value })"
          />
        </SettingRow>
        <SettingRow
          icon="lucide:save"
          label="KEEP ANALYSIS"
          description="Retain completed analyses between sessions when native storage exists."
        >
          <SettingsToggle
            :model-value="settings.ai.keepAnalysis"
            aria-label="Keep analysis"
            @update:model-value="value => settings.patchAI({ keepAnalysis: value })"
          />
        </SettingRow>
        <SettingRow
          icon="lucide:trash-2"
          label="DELETE ANALYSIS AFTER RESET"
          description="If enabled, reset AI data will clear analysis. Toggling this does not delete anything now."
        >
          <SettingsToggle
            :model-value="settings.ai.deleteAnalysisAfterReset"
            aria-label="Delete analysis after reset"
            @update:model-value="value => settings.patchAI({ deleteAnalysisAfterReset: value })"
          />
        </SettingRow>
      </div>
      <SettingsNote>
        THIS IS A POLICY SETTING. NO CLOUD PIPELINE IS CONNECTED, SO NOTHING LEAVES THE DEVICE IN THIS BUILD.
      </SettingsNote>
    </SettingsSection>

    <SettingsSection id="cache" index="06" label="AI CACHE" description="IN-MEMORY ANALYSES ONLY">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="ai-cache"
          icon="lucide:database"
          label="CACHED ANALYSES"
          description="Results held in the current session."
        >
          <span class="tnum text-[12px] font-semibold text-fg">{{ cachedCount }}</span>
        </SettingRow>
        <SettingRow icon="lucide:hard-drive" label="STORAGE USED" description="Byte accounting requires native storage.">
          <span class="label text-fg-muted">UNAVAILABLE</span>
        </SettingRow>
        <SettingRow icon="lucide:eraser" label="CLEAR AI CACHE" description="Removes session analysis results. Music files are never touched.">
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
    @update:open="value => (confirmClear = value)"
    @confirm="clearCache"
  />
</template>
