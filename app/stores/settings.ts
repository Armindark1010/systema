// ============================================================
// SYSTEMA — Settings Store (Pinia)
// ============================================================
// Central source of truth for system configuration.
// Persistence is adapter-backed. Appearance is applied
// deterministically whenever the store mutates.
// ============================================================

import { defineStore } from 'pinia'
import type { Theme } from '~/types'
import type {
  AISettingsState,
  AppearanceSettings,
  AudioSettingsState,
  GestureSettingsState,
  LibrarySettingsState,
  PlaybackSettingsState,
  SystemSettings,
} from '~/types/settings'
import { DEFAULT_SETTINGS } from '~/data/settings'
import { applyAppearance, readStoredAppearance } from '~/composables/useAppearance'
import { hydrateSettings } from '~/services/persistence/settingsHydrate'
import {
  LEGACY_THEME_KEY,
  SETTINGS_STORAGE_KEY,
  readJSON,
  removeKey,
  writeJSON,
} from '~/services/persistence/storageAdapter'

export { hydrateSettings } from '~/services/persistence/settingsHydrate'

export function readPersistedSettings(): SystemSettings {
  const stored = readJSON<unknown>(SETTINGS_STORAGE_KEY)
  if (stored) return hydrateSettings(stored)
  return hydrateSettings({ appearance: readStoredAppearance() })
}

export const useSettingsStore = defineStore('settings', () => {
  const state = reactive<SystemSettings>(readPersistedSettings())
  let persistReady = false

  function persist() {
    writeJSON(SETTINGS_STORAGE_KEY, toRaw(state))
    removeKey(LEGACY_THEME_KEY)
  }

  function applyVisual() {
    applyAppearance(state.appearance)
  }

  if (import.meta.client) {
    applyVisual()
    watch(state, () => {
      if (!persistReady) return
      persist()
      applyVisual()
    }, { deep: true })
    persistReady = true
  }

  function patchAppearance(patch: Partial<AppearanceSettings>) {
    Object.assign(state.appearance, patch)
    applyVisual()
    persist()
  }

  function patchPlayback(patch: Partial<PlaybackSettingsState>) {
    Object.assign(state.playback, patch)
  }

  function patchAudio(patch: Partial<AudioSettingsState>) {
    Object.assign(state.audio, patch)
  }

  function patchLibrary(patch: Partial<LibrarySettingsState>) {
    Object.assign(state.library, patch)
  }

  function patchAI(patch: Partial<AISettingsState>) {
    Object.assign(state.ai, patch)
  }

  function patchGestures(patch: Partial<GestureSettingsState>) {
    Object.assign(state.gestures, patch)
  }

  function setTheme(theme: Theme) {
    patchAppearance({ theme })
  }

  function resetSettings() {
    const next = hydrateSettings(DEFAULT_SETTINGS)
    Object.assign(state.appearance, next.appearance)
    Object.assign(state.playback, next.playback)
    Object.assign(state.audio, next.audio)
    Object.assign(state.library, next.library)
    Object.assign(state.ai, next.ai)
    Object.assign(state.gestures, next.gestures)
    Object.assign(state.interface, next.interface)
    state.data.lastResetAt = new Date().toISOString()
    applyVisual()
    persist()
  }

  function replaceAll(next: SystemSettings) {
    const hydrated = hydrateSettings(next)
    Object.assign(state.appearance, hydrated.appearance)
    Object.assign(state.playback, hydrated.playback)
    Object.assign(state.audio, hydrated.audio)
    Object.assign(state.library, hydrated.library)
    Object.assign(state.ai, hydrated.ai)
    Object.assign(state.gestures, hydrated.gestures)
    Object.assign(state.data, hydrated.data)
    Object.assign(state.interface, hydrated.interface)
    applyVisual()
    persist()
  }

  function exportSnapshot(): SystemSettings {
    return JSON.parse(JSON.stringify(toRaw(state))) as SystemSettings
  }

  return {
    appearance: state.appearance,
    playback: state.playback,
    audio: state.audio,
    library: state.library,
    ai: state.ai,
    gestures: state.gestures,
    data: state.data,
    interface: state.interface,
    patchAppearance,
    patchPlayback,
    patchAudio,
    patchLibrary,
    patchAI,
    patchGestures,
    setTheme,
    resetSettings,
    replaceAll,
    exportSnapshot,
  }
})
