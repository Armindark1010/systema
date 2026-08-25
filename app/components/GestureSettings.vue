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
        <SettingRow
          id="swipe-player"
          icon="lucide:move-horizontal"
          label="SWIPE PLAYER"
          description="Swipe left or right on the mini player and full player to change tracks. Uses the existing player gesture, not a second system."
        >
          <SettingsToggle
            :model-value="settings.gestures.swipePlayer"
            aria-label="Swipe player"
            @update:model-value="value => settings.patchGestures({ swipePlayer: value })"
          />
        </SettingRow>
        <SettingRow
          id="swipe-queue"
          icon="lucide:chevrons-down"
          label="SWIPE QUEUE"
          description="Swipe down on the queue sheet to dismiss it."
        >
          <SettingsToggle
            :model-value="settings.gestures.swipeQueue"
            aria-label="Swipe queue"
            @update:model-value="value => settings.patchGestures({ swipeQueue: value })"
          />
        </SettingRow>
        <SettingRow
          id="double-tap"
          icon="lucide:pointer"
          label="DOUBLE TAP"
          description="Double tap artwork in the full player to like the track."
        >
          <SettingsToggle
            :model-value="settings.gestures.doubleTap"
            aria-label="Double tap"
            @update:model-value="value => settings.patchGestures({ doubleTap: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="long-press" index="02" label="LONG PRESS" description="TRACK CONTEXT">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:hand"
          label="LONG PRESS ON TRACK"
          description="Choose which action set opens. The existing library actions sheet is reused."
        >
          <SettingsSelect
            :model-value="settings.gestures.longPress"
            :options="longPressOptions"
            aria-label="Long press on track"
            title="LONG PRESS"
            @update:model-value="value => settings.patchGestures({ longPress: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="haptics" index="03" label="HAPTIC FEEDBACK" description="NATIVE ONLY">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          icon="lucide:vibrate"
          label="HAPTIC FEEDBACK"
          description="Prepared for Capacitor / Kotlin haptics."
          coming-soon="NOT ACTIVE IN THIS WEB BUILD"
        >
          <SettingsToggle
            :model-value="settings.gestures.hapticFeedback"
            aria-label="Haptic feedback"
            @update:model-value="value => settings.patchGestures({ hapticFeedback: value })"
          />
        </SettingRow>
      </div>
      <SettingsNote>
        THE SETTING PERSISTS. IT DOES NOT TRIGGER BROWSER VIBRATION AND DOES NOT PRETEND A NATIVE HAPTIC ENGINE IS INSTALLED.
      </SettingsNote>
    </SettingsSection>
  </div>
</template>
