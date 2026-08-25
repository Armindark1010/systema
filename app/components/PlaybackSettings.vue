<script setup lang="ts">
import type { CrossfadeSeconds, QueueAfterPlaylist, ReplayGainMode } from '~/types/settings'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()

const crossfadeOptions = [
  { value: 0 as CrossfadeSeconds, label: 'OFF' },
  { value: 2 as CrossfadeSeconds, label: '2S' },
  { value: 4 as CrossfadeSeconds, label: '4S' },
  { value: 6 as CrossfadeSeconds, label: '6S' },
  { value: 8 as CrossfadeSeconds, label: '8S' },
  { value: 10 as CrossfadeSeconds, label: '10S' },
]

const replayGainOptions = [
  { value: 'off' as ReplayGainMode, label: 'OFF' },
  { value: 'track' as ReplayGainMode, label: 'TRACK' },
  { value: 'album' as ReplayGainMode, label: 'ALBUM' },
]

const queueOptions = [
  { value: 'replace' as QueueAfterPlaylist, label: 'REPLACE' },
  { value: 'append' as QueueAfterPlaylist, label: 'APPEND' },
]
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="playback" index="01" label="PLAYBACK" description="TRANSPORT CONTRACT FOR THE PLAYER STORE">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="AUTOPLAY" description="CONTINUE WITH RELATED MUSIC FROM THE LOCAL CATALOG AFTER THE QUEUE ENDS.">
          <USwitch
            :model-value="settings.playback.autoplay"
            aria-label="Autoplay"
            @update:model-value="(value: boolean) => settings.patchPlayback({ autoplay: value })"
          />
        </SettingRow>
        <SettingRow
          label="GAPLESS PLAYBACK"
          description="REDUCE SILENCE BETWEEN CONSECUTIVE TRACKS."
          coming-soon="PREPARED FOR MEDIA3 — NOT APPLIED IN THE WEB ENGINE"
        >
          <USwitch
            :model-value="settings.playback.gapless"
            aria-label="Gapless playback"
            @update:model-value="(value: boolean) => settings.patchPlayback({ gapless: value })"
          />
        </SettingRow>
        <SettingRow
          label="CROSSFADE"
          :description="settings.playback.crossfade === 0 ? 'NO OVERLAP BETWEEN TRACKS.' : `${settings.playback.crossfade} SECONDS OF OVERLAP BETWEEN TRACKS.`"
          coming-soon="PREPARED FOR THE NATIVE AUDIO ENGINE"
        >
          <SettingsSegmented
            :model-value="settings.playback.crossfade"
            :options="crossfadeOptions"
            aria-label="Crossfade duration"
            compact
            @update:model-value="value => settings.patchPlayback({ crossfade: value })"
          />
        </SettingRow>
        <SettingRow
          label="REPLAY GAIN"
          description="NORMALIZE PERCEIVED LOUDNESS BETWEEN TRACKS. NO DSP RUNS IN THE NUXT LAYER."
          coming-soon="CONSUMED LATER BY THE NATIVE AUDIO ENGINE"
        >
          <SettingsSegmented
            :model-value="settings.playback.replayGain"
            :options="replayGainOptions"
            aria-label="Replay gain"
            @update:model-value="value => settings.patchPlayback({ replayGain: value })"
          />
        </SettingRow>
        <SettingRow
          label="RESUME PLAYBACK"
          description="WHEN ENABLED, THE NATIVE LAYER WILL RESTORE THE LAST POSITION ON LAUNCH."
          coming-soon="POSITION PERSISTENCE IS NOT IMPLEMENTED IN THIS BUILD"
        >
          <USwitch
            :model-value="settings.playback.resumePlayback"
            aria-label="Resume playback"
            @update:model-value="(value: boolean) => settings.patchPlayback({ resumePlayback: value })"
          />
        </SettingRow>
        <SettingRow label="QUEUE AFTER PLAYLIST" description="REPLACE THE CURRENT QUEUE, OR APPEND THE PLAYLIST TO WHAT IS ALREADY QUEUED. THE PLAYER STORE READS THIS DIRECTLY.">
          <SettingsSegmented
            :model-value="settings.playback.queueAfterPlaylist"
            :options="queueOptions"
            aria-label="Queue after playlist"
            @update:model-value="value => settings.patchPlayback({ queueAfterPlaylist: value })"
          />
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="audio" index="02" label="AUDIO" description="OUTPUT AND ENGINE">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          label="OUTPUT"
          description="ROUTE PLAYBACK TO A SPECIFIC DEVICE."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <span class="label text-fg-faint">SYSTEM DEFAULT</span>
        </SettingRow>
        <SettingRow
          label="VOLUME NORMALIZATION"
          description="EVEN LOUDNESS ACROSS THE ARCHIVE."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <USwitch
            :model-value="settings.audio.volumeNormalization"
            aria-label="Volume normalization"
            @update:model-value="(value: boolean) => settings.patchAudio({ volumeNormalization: value })"
          />
        </SettingRow>
        <SettingRow
          label="AUDIO QUALITY"
          description="PREFERRED DECODE QUALITY."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <SettingsSegmented
            :model-value="settings.audio.quality"
            :options="[
              { value: 'lossless', label: 'LOSSLESS' },
              { value: 'high', label: 'HIGH' },
              { value: 'standard', label: 'STANDARD' },
            ]"
            aria-label="Audio quality"
            @update:model-value="value => settings.patchAudio({ quality: value })"
          />
        </SettingRow>
        <SettingRow
          label="PLAYBACK ENGINE"
          description="THE WEB BUILD USES THE BROWSER AUDIO ELEMENT."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <span class="label text-fg">WEB</span>
        </SettingRow>
      </div>
      <SettingsNote>
        THESE CONTROLS PERSIST AND FORM THE CONTRACT FOR MEDIA3. THEY DO NOT PRETEND TO MODIFY ANDROID AUDIO FROM NUXT.
      </SettingsNote>
    </SettingsSection>
  </div>
</template>
