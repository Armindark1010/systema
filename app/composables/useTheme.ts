// ============================================================
// useTheme — global theme architecture
// ============================================================
// Theme switching swaps design tokens (data-theme on <html>),
// never components. Appearance (accent, density, motion) lives
// in the Settings Store and is applied through useAppearance.
// ============================================================

import type { Theme } from '~/types'
import { applyAppearance, readStoredAppearance, THEMES } from '~/composables/useAppearance'
import { useSettingsStore } from '~/stores/settings'

/** @deprecated use readStoredAppearance — kept for plugin compatibility */
export function readStoredTheme(): Theme {
  return readStoredAppearance().theme
}

/** Apply a theme to the document — safe to call any number of times. */
export function applyTheme(t: Theme) {
  applyAppearance({ theme: t })
}

export function useTheme() {
  const settings = useSettingsStore()

  if (import.meta.client) applyAppearance(settings.appearance)

  function setTheme(t: Theme) {
    settings.setTheme(t)
  }

  function cycleTheme() {
    const current = settings.appearance.theme
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? 'default'
    setTheme(next)
  }

  return {
    theme: computed(() => settings.appearance.theme),
    themes: THEMES,
    cycleTheme,
    setTheme,
  }
}
