// ============================================================
// Keeps document appearance attributes in sync on every
// navigation (defense-in-depth beside plugins/theme.client.ts).
// ============================================================

import { applyAppearance, readStoredAppearance } from '~/composables/useAppearance'

export default defineNuxtRouteMiddleware(() => {
  if (import.meta.client) {
    try {
      applyAppearance(readStoredAppearance())
    } catch {
      /* never break navigation on theme sync */
    }
  }
})
