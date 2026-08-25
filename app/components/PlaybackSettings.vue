<script setup lang="ts">
import type { CrossfadeSeconds, QueueAfterPlaylist, ReplayGainMode } from '~/types/settings'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()

const crossfadeOptions: CrossfadeSeconds[] = [0, 2, 4, 6, 8, 10]

const replayGainOptions = [
  { value: 'off' as ReplayGainMode, label: 'OFF' },
  { value: 'track' as ReplayGainMode, label: 'TRACK' },
  { value: 'album' as ReplayGainMode, label: 'ALBUM' },
]

const queueOptions = [
  { value: 'replace' as QueueAfterPlaylist, label: 'REPLACE' },
  { value: 'append' as QueueAfterPlaylist, label: 'APPEND' },
]

function setCrossfade(value: number) {
  const next = crossfadeOptions.reduce((closest, option) =>
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest,
  0)
  settings.patchPlayback({ crossfade: next })
}
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="playback" index="01" label="PLAYBACK" description="TRANSPORT CONTRACT FOR THE PLAYER STORE">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          id="autoplay"
          icon="lucide:play"
          label="AUTOPLAY"
          description="Continue with related music from the local catalog after the queue ends."
        >
          <SettingsToggle
            :model-value="settings.playback.autoplay"
            aria-label="Autoplay"
            @update:model-value="value => settings.patchPlayback({ autoplay: value })"
          />
        </SettingRow>
        <SettingRow
          id="gapless"
          icon="lucide:link"
          label="GAPLESS PLAYBACK"
          description="Reduce silence between consecutive tracks."
          coming-soon="PREPARED FOR MEDIA3 — NOT APPLIED IN THE WEB ENGINE"
        >
          <SettingsToggle
            :model-value="settings.playback.gapless"
            aria-label="Gapless playback"
            @update:model-value="value => settings.patchPlayback({ gapless: value })"
          />
        </SettingRow>
        <SettingRow
          id="crossfade"
          icon="lucide:blend"
          label="CROSSFADE"
          :description="settings.playback.crossfade === 0 ? 'No overlap between tracks.' : `${settings.playback.crossfade} seconds of overlap between tracks.`"
          coming-soon="PREPARED FOR THE NATIVE AUDIO ENGINE"
        >
          <SettingsSlider
            :model-value="settings.playback.crossfade"
            :min="0"
            :max="10"
            :step="2"
            aria-label="Crossfade duration"
            suffix="s"
            @update:model-value="setCrossfade"
          />
        </SettingRow>
        <SettingRow
          id="replay-gain"
          icon="lucide:audio-lines"
          label="REPLAY GAIN"
          description="Normalize perceived loudness between tracks. No DSP runs in the Nuxt layer."
          coming-soon="CONSUMED LATER BY THE NATIVE AUDIO ENGINE"
        >
          <SettingsSegmentedControl
            :model-value="settings.playback.replayGain"
            :options="replayGainOptions"
            aria-label="Replay gain"
            @update:model-value="value => settings.patchPlayback({ replayGain: value })"
          />
        </SettingRow>
        <SettingRow
          id="resume"
          icon="lucide:rotate-ccw"
          label="RESUME PLAYBACK"
          description="When enabled, the native layer will restore the last position on launch."
          coming-soon="POSITION PERSISTENCE IS NOT IMPLEMENTED IN THIS BUILD"
        >
          <SettingsToggle
            :model-value="settings.playback.resumePlayback"
            aria-label="Resume playback"
            @update:model-value="value => settings.patchPlayback({ resumePlayback: value })"
          />
        </SettingRow>
        <SettingRow
          id="queue-behavior"
          icon="lucide:list-plus"
          label="QUEUE AFTER PLAYLIST"
          description="Replace the current queue, or append the playlist to what is already queued. The player store reads this directly."
        >
          <SettingsSegmentedControl
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
          icon="lucide:speaker"
          label="OUTPUT"
          description="Route playback to a specific device."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <span class="label text-fg-muted">SYSTEM DEFAULT</span>
        </SettingRow>
        <SettingRow
          icon="lucide:volume-2"
          label="VOLUME NORMALIZATION"
          description="Even loudness across the archive."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <SettingsToggle
            :model-value="settings.audio.volumeNormalization"
            aria-label="Volume normalization"
            @update:model-value="value => settings.patchAudio({ volumeNormalization: value })"
          />
        </SettingRow>
        <SettingRow
          icon="lucide:gauge"
          label="AUDIO QUALITY"
          description="Preferred decode quality."
          coming-soon="COMING WITH ANDROID AUDIO ENGINE"
        >
          <SettingsSelect
            :model-value="settings.audio.quality"
            :options="[
              { value: 'lossless', label: 'LOSSLESS' },
              { value: 'high', label: 'HIGH' },
              { value: 'standard', label: 'STANDARD' },
            ]"
            aria-label="Audio quality"
            title="AUDIO QUALITY"
            @update:model-value="value => settings.patchAudio({ quality: value })"
          />
        </SettingRow>
        <SettingRow
          icon="lucide:cpu"
          label="PLAYBACK ENGINE"
          description="The web build uses the browser audio element."
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
