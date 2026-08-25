// ============================================================
// useTheme — global theme architecture
// ============================================================
// Theme switching swaps design tokens (data-theme on <html>),
// never components. The AI visual system is fixed and applied
// by AI pages themselves via the AIStage component.
//
// Application is DETERMINISTIC: setTheme / cycleTheme apply the
// tokens directly — no reliance on component-scoped watchers.
// Storage access is guarded: the app must keep working when
// localStorage is unavailable (sandboxed iframes, private mode).
// ============================================================

import type { Theme } from '~/types'

const THEMES: Theme[] = ['default', 'premium', 'dark']
const STORAGE_KEY = 'systema:theme'

/** Read the persisted theme; falls back to 'default' when unavailable. */
export function readStoredTheme(): Theme {
  try {
    if (import.meta.client) {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'default' || stored === 'premium' || stored === 'dark') return stored
    }
  } catch {
    /* storage unavailable */
  }
  return 'default'
}

/** Apply a theme to the document — safe to call any number of times. */
export function applyTheme(t: Theme) {
  if (!import.meta.client) return
  const el = document.documentElement
  el.setAttribute('data-theme', t)
  // Keep Nuxt UI primitives in sync (their dark variant keys off `.dark`)
  el.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* storage unavailable — theme applies for this session only */
  }
  // color-mode module follows SYSTEMA themes; never let it break application
  try {
    const cm = useColorMode()
    if (cm) cm.preference = t === 'dark' ? 'dark' : 'light'
  } catch {
    /* color-mode state not ready / unavailable */
  }
}

const theme = ref<Theme>('default')

// restore persisted theme at module init (client build only)
if (import.meta.client) theme.value = readStoredTheme()

export function useTheme() {
  // ensure the document matches state whenever the composable is used
  if (import.meta.client) applyTheme(theme.value)

  function setTheme(t: Theme) {
    theme.value = t
    applyTheme(t)
  }

  function cycleTheme() {
    setTheme(THEMES[(THEMES.indexOf(theme.value) + 1) % THEMES.length])
  }

  return {
    theme: readonly(theme),
    themes: THEMES,
    cycleTheme,
    setTheme,
  }
}
