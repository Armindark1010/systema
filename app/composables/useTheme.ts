// ============================================================
// useTheme — global theme architecture
// ============================================================
// Theme switching swaps design tokens (data-theme on <html>),
// never components. The AI visual system is fixed and applied
// by AI pages themselves via the AIStage component.
// ============================================================

import type { Theme } from '~/types'

const THEMES: Theme[] = ['default', 'premium', 'dark']

function readStoredTheme(): Theme {
  if (import.meta.client) {
    const stored = localStorage.getItem('systema:theme')
    if (stored === 'default' || stored === 'premium' || stored === 'dark') return stored
  }
  return 'default'
}

const theme = ref<Theme>('default')

// restore persisted theme at module init (client build only)
if (import.meta.client) theme.value = readStoredTheme()

/** Apply theme to the document (also synced pre-paint by plugins/theme.client.ts). */
function applyTheme(t: Theme) {
  const el = document.documentElement
  el.dataset.theme = t
  // Keep Nuxt UI primitives in sync (its dark variant keys off `.dark`)
  el.classList.toggle('dark', t === 'dark')
  // color-mode module follows SYSTEMA themes
  const cm = useColorMode()
  cm.preference = t === 'dark' ? 'dark' : 'light'
}

export function useTheme() {
  watchEffect(() => {
    if (import.meta.client) {
      applyTheme(theme.value)
      localStorage.setItem('systema:theme', theme.value)
    }
  })

  function cycleTheme() {
    theme.value = THEMES[(THEMES.indexOf(theme.value) + 1) % THEMES.length]
  }

  function setTheme(t: Theme) {
    theme.value = t
  }

  return {
    theme: readonly(theme),
    themes: THEMES,
    cycleTheme,
    setTheme,
  }
}
