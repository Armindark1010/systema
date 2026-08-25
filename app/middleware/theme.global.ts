// ============================================================
// Keeps the document theme attributes in sync on every
// navigation (defense-in-depth beside plugins/theme.client.ts
// and composables/useTheme.ts).
// ============================================================

import { applyTheme, readStoredTheme } from '~/composables/useTheme'

export default defineNuxtRouteMiddleware(() => {
  if (import.meta.client) {
    try {
      applyTheme(readStoredTheme())
    } catch {
      /* never break navigation on theme sync */
    }
  }
})
