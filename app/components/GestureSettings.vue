<script setup lang="ts">
import type { LongPressTarget } from '~/types/settings'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()

const longPressOptions = [
  { value: 'track' as LongPressTarget, label: 'TRACK' },
  { value: 'queue' as LongPressTarget, label: 'QUEUE' },
  { value: 'playlist' as LongPressTarget, label: 'PLAYLIST' },
]
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="player-swipe" index="01" label="PLAYER" description="EXISTING PLAYER GESTURES">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="SWIPE PLAYER" description="SWIPE LEFT OR RIGHT ON THE MINI PLAYER AND FULL PLAYER TO CHANGE TRACKS. USES THE EXISTING PLAYER GESTURE, NOT A SECOND SYSTEM.">
          <USwitch
            :model-value="settings.gestures.swipePlayer"
            aria-label="Swipe player"
            @update:model-value="(value: boolean) => settings.patchGestures({ swipePlayer: value })"
          />
        </SettingRow>
        <SettingRow label="SWIPE QUEUE" description="SWIPE DOWN ON THE QUEUE SHEET TO DISMISS IT.">
          <USwitch
            :model-value="settings.gestures.swipeQueue"
            aria-label="Swipe queue"
            @update:model-value="(value: boolean) => settings.patchGestures({ swipeQueue: value })"
          />
        </SettingRow>
        <SettingRow label="DOUBLE TAP" description="DOUBLE TAP ARTWORK IN THE FULL PLAYER TO LIKE THE TRACK.">
          <USwitch
            :model-value="settings.gestures.doubleTap"
            aria-label="Double tap"
            @update:model-value="(value: boolean) => settings.patchGestures({ doubleTap: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="long-press" index="02" label="LONG PRESS" description="TRACK CONTEXT">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="LONG PRESS ON TRACK" description="CHOOSE WHICH ACTION SET OPENS. THE EXISTING LIBRARY ACTIONS SHEET IS REUSED.">
          <SettingsSegmented
            :model-value="settings.gestures.longPress"
            :options="longPressOptions"
            aria-label="Long press on track"
            @update:model-value="value => settings.patchGestures({ longPress: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="haptics" index="03" label="HAPTIC FEEDBACK" description="NATIVE ONLY">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          label="HAPTIC FEEDBACK"
          description="PREPARED FOR CAPACITOR / KOTLIN HAPTICS."
          coming-soon="NOT ACTIVE IN THIS WEB BUILD"
        >
          <USwitch
            :model-value="settings.gestures.hapticFeedback"
            aria-label="Haptic feedback"
            @update:model-value="(value: boolean) => settings.patchGestures({ hapticFeedback: value })"
          />
        </SettingRow>
      </div>
      <SettingsNote>
        THE SETTING PERSISTS. IT DOES NOT TRIGGER BROWSER VIBRATION AND DOES NOT PRETEND A NATIVE HAPTIC ENGINE IS INSTALLED.
      </SettingsNote>
    </SettingsSection>
  </div>
</template>
