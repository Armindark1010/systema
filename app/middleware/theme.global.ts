// ============================================================
// Keeps the document theme attributes in sync on every
// navigation (defense-in-depth beside plugins/theme.client.ts
// and composables/useTheme.ts).
// ============================================================

export default defineNuxtRouteMiddleware(() => {
  if (import.meta.client) {
    const stored = localStorage.getItem('systema:theme')
    const theme = stored === 'premium' || stored === 'dark' ? stored : 'default'
    const el = document.documentElement
    el.dataset.theme = theme
    el.classList.toggle('dark', theme === 'dark')
  }
})
