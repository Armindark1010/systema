// ============================================================
// Apply the persisted SYSTEMA theme before first paint to
// avoid a flash of the wrong theme.
// ============================================================

export default defineNuxtPlugin(() => {
  const stored = localStorage.getItem('systema:theme')
  const theme = stored === 'premium' || stored === 'dark' ? stored : 'default'
  const el = document.documentElement
  el.dataset.theme = theme
  el.classList.toggle('dark', theme === 'dark')
})
