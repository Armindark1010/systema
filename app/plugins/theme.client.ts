// ============================================================
// Apply the persisted SYSTEMA theme before first paint to
// avoid a flash of the wrong theme. Storage is guarded —
// the app must never fail to boot on blocked storage.
// ============================================================

import { applyTheme, readStoredTheme } from '~/composables/useTheme'

export default defineNuxtPlugin(() => {
  try {
    applyTheme(readStoredTheme())
  } catch {
    /* never block app startup on theme application */
  }
})
