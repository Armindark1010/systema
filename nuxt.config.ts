// ============================================================
// SYSTEMA — Nuxt 4 configuration
// ============================================================
// Nuxt 4 architecture (app/ directory) with:
//   · Nuxt UI 3.x      — interaction primitives (command palette, drawers, modals, sliders…)
//   · UnoCSS           — primary styling & design-token system (uno.config.ts)
//   · VueUse           — utilities
//   · Lucide           — icon set (via @nuxt/icon)
// ============================================================

export default defineNuxtConfig({
  compatibilityDate: '2025-08-25',

  modules: [
    '@nuxt/ui',
    '@unocss/nuxt',
    '@vueuse/nuxt',
    '@nuxt/fonts',
    '@nuxt/icon',
  ],

  // ---- global styles -------------------------------------------------
  css: ['~/assets/css/main.css'],

  // ---- app shell -----------------------------------------------------
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'SYSTEMA',
      titleTemplate: (t) => (t && !t.includes('SYSTEMA') ? `${t} — SYSTEMA` : t),
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#ffffff' },
        { name: 'description', content: 'SYSTEMA — a precise, intelligent music system.' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
    // Subtle functional transitions for the music interface.
    pageTransition: { name: 'sys-page', mode: 'out-in' },
    layoutTransition: { name: 'sys-page', mode: 'out-in' },
  },

  // ---- color mode (Nuxt UI) -------------------------------------------
  // SYSTEMA themes are driven by data-theme + design tokens (useTheme).
  // The `dark` class is toggled by useTheme so Nuxt UI primitives stay in sync.
  colorMode: {
    preference: 'light',
    fallback: 'light',
    storageKey: 'systema:color-mode',
  },

  // ---- icons ------------------------------------------------------------
  icon: {
    clientBundle: { scan: true },
  },

  // ---- fonts (Inter + Vazirmatn for Persian strings) --------------------
  fonts: {
    google: {
      families: [
        'Inter:wght@400;500;600;700',
        'Vazirmatn:wght@400;500;600;700',
      ],
    },
  },

  // Nuxt UI: we ship our own typography; disable its font presets.
  ui: {
    fonts: false,
  },

  // ---- SSR / prerender -------------------------------------------------
  nitro: {
    prerender: { crawlLinks: false, routes: ['/'] },
  },

  // ---- TS ----------------------------------------------------------------
  typescript: {
    strict: true,
    typeCheck: false, // IDE-level checking; keeps dev/build lean
  },

  // CSS minification via esbuild: cssnano (the default) requires Node 22+
  // (Set.prototype.difference) — esbuild keeps builds portable on Node 20.
  vite: {
    build: {
      cssMinify: 'esbuild',
    },
    server: {
      allowedHosts: true,
    },
  },
  postcss: {
    plugins: {
      cssnano: false,
    },
  },

  devtools: { enabled: false },

  // Flat component naming — components/player/MiniPlayer.vue → <MiniPlayer>
  components: [{ path: '~/components', pathPrefix: false }],
})
