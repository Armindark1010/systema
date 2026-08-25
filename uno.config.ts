// ============================================================
// SYSTEMA — UnoCSS design system
// ============================================================
// UnoCSS is the primary styling and design-token system.
// Every visual property resolves to a semantic CSS variable
// defined in app/assets/css/main.css (per-theme tokens).
// ============================================================

import {
  defineConfig,
  presetUno,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  presets: [
    presetUno({
      // Tailwind preflight is provided by Nuxt UI's CSS pipeline.
      preflight: false,
    }),
  ],

  transformers: [transformerVariantGroup()],

  theme: {
    // ----------------------------------------------------------
    // COLORS — all semantic, all CSS-variable backed.
    // Music tokens (--sys-*) rotate per theme; AI tokens (--ai-*)
    // are fixed and power the Intelligence visual system.
    // ----------------------------------------------------------
    colors: {
      // surfaces
      base: 'var(--sys-bg)',
      surface: 'var(--sys-surface)',
      muted: 'var(--sys-surface-muted)',
      hover: 'var(--sys-surface-hover)',
      secondary: 'var(--sys-secondary)',
      player: 'var(--sys-player-bg)',

      // ink
      fg: 'var(--sys-foreground)',
      'fg-muted': 'var(--sys-foreground-muted)',
      'fg-faint': 'var(--sys-foreground-faint)',

      // brand
      primary: 'var(--sys-primary)',
      'primary-strong': 'var(--sys-primary-strong)',
      'primary-fg': 'var(--sys-primary-foreground)',
      'primary-muted': 'var(--sys-primary-muted)',
      accent: 'var(--sys-accent)',

      // structure
      line: 'var(--sys-border)',
      'line-strong': 'var(--sys-border-strong)',

      // states
      danger: 'var(--sys-danger)',
      success: 'var(--sys-success)',
      warning: 'var(--sys-warning)',

      // ---- immersive player (fixed dark) ----
      'player-bg': 'var(--player-bg)',
      'player-bg-soft': 'var(--player-bg-soft)',
      'player-fg': 'var(--player-fg)',
      'player-fg-muted': 'var(--player-fg-muted)',
      'player-fg-faint': 'var(--player-fg-faint)',
      'player-line': 'var(--player-line)',
      'player-line-strong': 'var(--player-line-strong)',
      'player-control': 'var(--player-control)',
      'player-control-hover': 'var(--player-control-hover)',
      'player-primary': 'var(--player-primary)',
      'player-accent': 'var(--ai-primary)',

      // ---- AI visual system (fixed) ----
      'ai-base': 'var(--ai-bg)',
      'ai-surface': 'var(--ai-surface)',
      'ai-muted': 'var(--ai-surface-muted)',
      'ai-hover': 'var(--ai-surface-hover)',
      'ai-fg': 'var(--ai-foreground)',
      'ai-fg-muted': 'var(--ai-foreground-muted)',
      'ai-fg-faint': 'var(--ai-foreground-faint)',
      'ai-primary': 'var(--ai-primary)',
      'ai-secondary': 'var(--ai-secondary)',
      'ai-accent': 'var(--ai-accent)',
      'ai-cyan': 'var(--ai-cyan)',
      'ai-line': 'var(--ai-border)',
      'ai-line-strong': 'var(--ai-border-strong)',
      'ai-glow': 'var(--ai-glow)',
    },

    // ----------------------------------------------------------
    // SPACING — modular scale (4px base, Swiss discipline)
    // ----------------------------------------------------------
    spacing: {
      0: '0',
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '24px',
      6: '32px',
      7: '48px',
      8: '64px',
      9: '96px',
      10: '128px',
    },

    // ----------------------------------------------------------
    // TYPOGRAPHY — editorial scale
    // ----------------------------------------------------------
    fontSize: {
      micro: ['0.6875rem', { lineHeight: '1rem' }],
      small: ['0.8125rem', { lineHeight: '1.375rem' }],
      body: ['0.9375rem', { lineHeight: '1.625rem' }],
      lead: ['1.0625rem', { lineHeight: '1.75rem' }],
      title: ['1.25rem', { lineHeight: '1.6rem' }],
      h2: ['1.625rem', { lineHeight: '2.05rem' }],
      h1: ['clamp(1.75rem, 3vw, 2.5rem)', { lineHeight: '1.12' }],
      display: ['clamp(2.375rem, 5.5vw, 4.25rem)', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
      'display-xl': ['clamp(2.75rem, 7vw, 5.5rem)', { lineHeight: '0.98', letterSpacing: '-0.03em' }],
    },

    fontFamily: {
      sans: 'var(--sys-font-sans)',
      persian: 'var(--sys-font-persian)',
    },

    fontWeight: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },

    // ----------------------------------------------------------
    // RADII — flat, architectural. Swiss precision over pills.
    // ----------------------------------------------------------
    borderRadius: {
      none: '0',
      1: '2px',
      2: '4px',
      3: '6px',
    },

    // ----------------------------------------------------------
    // SHADOWS — restrained in music UI, deep in AI UI
    // ----------------------------------------------------------
    boxShadow: {
      1: 'var(--sys-shadow-1)',
      2: 'var(--sys-shadow-2)',
      'ai-1': 'var(--ai-shadow-1)',
      'ai-2': 'var(--ai-shadow-2)',
      'ai-glow': '0 0 28px var(--ai-glow)',
      'ai-glow-lg': '0 0 64px var(--ai-glow)',
    },

    transitionDuration: {
      fast: '120ms',
      DEFAULT: '160ms',
      slow: '260ms',
    },

    transitionTimingFunction: {
      sys: 'var(--sys-ease)',
      DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },

  // ----------------------------------------------------------
  // SHORTCUTS — semantic recipes used across every component.
  // This is the single source of truth for how SYSTEMA looks.
  // ----------------------------------------------------------
  shortcuts: {
    // --- typography ---
    label: 'text-micro font-semibold uppercase tracking-[0.14em]',
    'label-muted': 'label text-fg-muted',
    'label-faint': 'label text-fg-faint',
    'label-ai': 'text-micro font-semibold uppercase tracking-[0.18em] text-ai-fg-muted',

    // --- grid system ---
    'sys-container': 'w-full max-w-[1240px] mx-auto px-5 md:px-8 lg:px-10',
    'sys-grid': 'grid grid-cols-12 gap-x-4 md:gap-x-6',
    'sys-rail': 'flex gap-4 overflow-x-auto -mx-5 md:-mx-8 lg:-mx-10 px-5 md:px-8 lg:px-10 snap-x',

    // --- structure ---
    'hairline-t': 'border-t border-line',
    'hairline-b': 'border-b border-line',
    'hairline-l': 'border-l border-line',
    'hairline-r': 'border-r border-line',

    // --- motion ---
    't-all': 'transition-all duration-160 ease-sys',
    't-col': 'transition-colors duration-160 ease-sys',
    't-fast': 'transition-all duration-120 ease-sys',

    // --- interaction ---
    'focus-ring': 'focus-visible:(outline-none ring-1 ring-primary ring-offset-2 ring-offset-base)',
    'focus-ring-ai': 'focus-visible:(outline-none ring-1 ring-ai-primary ring-offset-2 ring-offset-ai-base)',
    'pressable': 'cursor-pointer select-none t-col focus-ring disabled:(opacity-40 pointer-events-none)',

    // --- buttons (music) ---
    'sys-btn': 'inline-flex items-center justify-center gap-2 h-9 px-4 text-small font-semibold t-all focus-ring disabled:(opacity-40 pointer-events-none)',
    'sys-btn-primary': 'sys-btn bg-primary text-primary-fg hover:bg-primary-strong active:bg-primary-strong',
    'sys-btn-outline': 'sys-btn border border-line-strong bg-surface text-fg hover:(border-fg bg-hover)',
    'sys-btn-ghost': 'sys-btn text-fg-muted hover:(text-fg bg-hover)',
    'sys-btn-soft': 'sys-btn bg-primary-muted text-primary hover:bg-primary hover:text-primary-fg',

    // --- buttons (AI) ---
    'ai-btn': 'inline-flex items-center justify-center gap-2 h-9 px-4 text-small font-semibold t-all focus-ring-ai disabled:(opacity-40 pointer-events-none)',
    'ai-btn-primary': 'ai-btn bg-ai-primary text-white hover:bg-ai-secondary shadow-ai-glow',
    'ai-btn-outline': 'ai-btn border border-ai-line-strong text-ai-fg hover:(border-ai-primary text-ai-fg bg-ai-muted)',
    'ai-btn-ghost': 'ai-btn text-ai-fg-muted hover:(text-ai-fg bg-ai-muted)',

    // --- inputs ---
    'sys-input': 'h-10 w-full bg-surface border border-line px-3 text-body placeholder:text-fg-faint t-col focus-ring disabled:(opacity-40 pointer-events-none)',
    'ai-input': 'h-10 w-full bg-ai-surface border border-ai-line px-3 text-body text-ai-fg placeholder:text-ai-fg-faint t-col focus-ring-ai',

    // --- surfaces ---
    'sys-panel': 'bg-surface border border-line',
    'sys-row': 'flex items-center gap-3 w-full text-left t-col pressable',
    'ai-panel': 'bg-ai-surface border border-ai-line backdrop-blur-sm',

    // --- small editorial units ---
    'chip': 'inline-flex items-center gap-1.5 h-6 px-2 text-micro font-semibold uppercase tracking-[0.12em] border border-line text-fg-muted',
    'chip-active': 'chip border-primary text-primary bg-primary-muted',
    'ai-chip': 'inline-flex items-center gap-1.5 h-6 px-2 text-micro font-semibold uppercase tracking-[0.14em] border border-ai-line text-ai-fg-muted hover:(border-ai-primary text-ai-fg) t-col',
  },

  // ----------------------------------------------------------
  // RULES — custom utilities
  // ----------------------------------------------------------
  rules: [
    // Swiss column spans for the 12-column grid: sys-col-3, md:sys-col-6 …
    [/^sys-col-(\d+)$/, ([, d]) => ({ gridColumn: `span ${d} / span ${d}` })],
    ['tnum', { 'font-variant-numeric': 'tabular-nums' }],
    ['text-balance', { 'text-wrap': 'balance' }],
    // explicit easing token (shortcuts can always resolve rules)
    ['ease-sys', { 'transition-timing-function': 'var(--sys-ease)' }],
    ['no-scrollbar', { 'scrollbar-width': 'none' }],
  ],
})
