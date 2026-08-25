// ============================================================
// SYSTEMA — Nuxt UI configuration
// ============================================================
// Component-level theming stays minimal: Nuxt UI primitives are
// driven by CSS variables (--ui-*) which we map to SYSTEMA tokens
// per theme in app/assets/css/main.css.
// ============================================================

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'slate',
    },
  },
})
