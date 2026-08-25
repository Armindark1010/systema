<script setup lang="ts">
import { SYSTEMA_ABOUT } from '~/data/about'

const versionLabel = SYSTEMA_ABOUT.version ?? 'UNVERSIONED'
</script>

<template>
  <div class="space-y-10">
    <SettingsSection id="about" index="01" label="SYSTEMA" description="PRODUCT IDENTITY">
      <div class="border border-line bg-surface p-6">
        <BrandMark />
        <p class="mt-4 text-small text-fg-muted max-w-[56ch] leading-relaxed">
          {{ SYSTEMA_ABOUT.description }}
        </p>
        <dl class="mt-6 grid sm:grid-cols-2 gap-px bg-line border border-line">
          <div class="bg-surface px-4 py-3 flex items-baseline justify-between gap-4">
            <dt class="label text-fg-muted">VERSION</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ versionLabel }}</dd>
          </div>
          <div class="bg-surface px-4 py-3 flex items-baseline justify-between gap-4">
            <dt class="label text-fg-muted">CHANNEL</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ SYSTEMA_ABOUT.channel.toUpperCase() }}</dd>
          </div>
          <div class="bg-surface px-4 py-3 flex items-baseline justify-between gap-4">
            <dt class="label text-fg-muted">PACKAGE</dt>
            <dd class="tnum text-[12px] font-bold text-fg">{{ SYSTEMA_ABOUT.packageName }}</dd>
          </div>
          <div class="bg-surface px-4 py-3 flex items-baseline justify-between gap-4">
            <dt class="label text-fg-muted">BUILD</dt>
            <dd class="tnum text-[12px] font-bold text-fg">FRONTEND</dd>
          </div>
        </dl>
        <p class="mt-4 text-small text-fg-muted leading-relaxed">
          This package is unpublished and has no version field. The number above is not invented.
        </p>
      </div>
    </SettingsSection>

    <SettingsSection id="stack" index="02" label="BUILD" description="DECLARED DEPENDENCIES">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          v-for="item in SYSTEMA_ABOUT.stack"
          :key="item.label"
          :label="item.label"
          description="Version taken from package.json."
        >
          <span class="tnum text-[12px] font-bold text-fg">{{ item.value }}</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="licenses" index="03" label="LICENSES" description="OPEN SOURCE">
      <div class="border border-line divide-y divide-line">
        <SettingRow label="APPLICATION LICENSE" description="No license file is published in this repository.">
          <span class="label text-fg-muted">UNDECLARED</span>
        </SettingRow>
        <SettingRow label="NUXT / VUE / PINIA" description="Upstream frameworks used by the frontend.">
          <span class="label text-fg">MIT</span>
        </SettingRow>
        <SettingRow label="UNOCSS / NUXT UI / VUEUSE" description="Interface and utility libraries.">
          <span class="label text-fg">MIT</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="credits" index="04" label="CREDITS" description="TYPE AND ICONS">
      <div class="border border-line divide-y divide-line">
        <SettingRow
          v-for="item in SYSTEMA_ABOUT.credits"
          :key="item.label"
          :label="item.label"
        >
          <span class="label text-fg">{{ item.value }}</span>
        </SettingRow>
      </div>
    </SettingsSection>

    <SettingsSection id="privacy" index="05" label="PRIVACY" description="LOCAL FIRST">
      <div class="border border-line bg-surface p-5">
        <p class="text-small text-fg-muted leading-relaxed max-w-[64ch]">
          SYSTEMA keeps the music archive, playlists, settings, and session analysis on the device.
          This build does not create an account, does not send telemetry, and does not upload audio.
          Optional cloud analysis exists only as a stored policy — no cloud endpoint is connected.
        </p>
      </div>
    </SettingsSection>

    <SettingsSection id="terms" index="06" label="TERMS" description="SCOPE OF THIS BUILD">
      <div class="border border-line bg-surface p-5">
        <p class="text-small text-fg-muted leading-relaxed max-w-[64ch]">
          This is a frontend architecture for a local music system. Reset actions never delete music files.
          Native adapters (Capacitor, Kotlin, Media3, Room, WorkManager, ONNX) are not installed here
          and are not simulated as if they were.
        </p>
      </div>
    </SettingsSection>
  </div>
</template>
