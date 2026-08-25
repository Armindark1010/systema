// ============================================================
// Apply persisted appearance before first paint to avoid a
// flash of the wrong theme. Storage is guarded — the app
// must never fail to boot on blocked storage.
// ============================================================

import { applyAppearance, readStoredAppearance } from '~/composables/useAppearance'

export default defineNuxtPlugin(() => {
  try {
    applyAppearance(readStoredAppearance())
  } catch {
    /* never block app startup on theme application */
  }
})
