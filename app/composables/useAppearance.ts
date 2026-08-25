// ============================================================
// useAppearance — apply theme / accent / density / motion
// ============================================================
// Document-level token application. Components never hardcode
// colors. Safe when storage or color-mode is unavailable.
// ============================================================

import type { Theme } from '~/types'
import type { AppearanceSettings, MotionId } from '~/types/settings'
import { DEFAULT_SETTINGS } from '~/data/settings'
import { normalizeAppearance } from '~/services/persistence/settingsHydrate'
import { LEGACY_THEME_KEY, SETTINGS_STORAGE_KEY, readJSON } from '~/services/persistence/storageAdapter'

export { normalizeAppearance } from '~/services/persistence/settingsHydrate'

export const THEMES: Theme[] = ['default', 'premium', 'dark', 'midcentury', 'bauhaus']

const THEME_SET = new Set<string>(THEMES)

export const THEME_META: Record<Theme, { name: string; tag: string; desc: string; swatch: [string, string, string, string] }> = {
  default: {
    name: 'DEFAULT LIGHT',
    tag: 'WHITE / STEEL',
    desc: 'A WHITE DIAL — QUIET GENEVA STEEL BLUE ON PURE WHITE.',
    swatch: ['#ffffff', '#1e3a66', '#10141c', '#e6e9ee'],
  },
  dark: {
    name: 'DARK MODE',
    tag: 'ONYX / SILVER',
    desc: 'AN ONYX DIAL — APPLIED SILVER INDICES, NOTHING ELSE.',
    swatch: ['#0a0b0e', '#dde3ea', '#edf0f4', '#22262e'],
  },
  premium: {
    name: 'PREMIUM',
    tag: 'IVORY / GOLD',
    desc: 'DEEP CHAMPAGNE GOLD ON IVORY ENAMEL — MINIMAL LUXURY.',
    swatch: ['#fcfbf7', '#8a6d2c', '#181510', '#e8e3d3'],
  },
  midcentury: {
    name: 'MID-CENTURY',
    tag: 'TEAK / OLIVE',
    desc: 'WARM TEAK AND OLIVE ON CREAM — EAMES DISCIPLINE.',
    swatch: ['#f4efe4', '#6b4f2a', '#3d4a32', '#d9cbb3'],
  },
  bauhaus: {
    name: 'BAUHAUS',
    tag: 'PRIMARY GRID',
    desc: 'BLACK, WHITE, AND PRIMARY PLANES — GEOMETRIC, STRICT.',
    swatch: ['#f7f7f5', '#c1121f', '#111111', '#f2c94c'],
  },
}

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_SET.has(value)
}

export function readStoredAppearance(): AppearanceSettings {
  const blob = readJSON<{ appearance?: Partial<AppearanceSettings> }>(SETTINGS_STORAGE_KEY)
  if (blob?.appearance) return normalizeAppearance(blob.appearance)

  try {
    if (import.meta.client) {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY)
      if (isTheme(legacy)) return normalizeAppearance({ theme: legacy })
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS.appearance }
}

function resolveMotion(preferred: MotionId): MotionId {
  if (preferred === 'off') return 'off'
  if (!import.meta.client) return preferred
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced'
  } catch {
    /* matchMedia unavailable */
  }
  return preferred
}

export function applyAppearance(partial?: Partial<AppearanceSettings>) {
  if (!import.meta.client) return
  const next = normalizeAppearance({ ...readStoredAppearance(), ...partial })
  const motion = resolveMotion(next.motion)
  const el = document.documentElement
  el.setAttribute('data-theme', next.theme)
  el.setAttribute('data-accent', next.accent)
  el.setAttribute('data-density', next.density)
  el.setAttribute('data-motion', motion)
  el.classList.toggle('dark', next.theme === 'dark')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const bg = getComputedStyle(el).getPropertyValue('--sys-bg').trim() || '#ffffff'
    meta.setAttribute('content', bg)
  }

  try {
    const cm = useColorMode()
    if (cm) cm.preference = next.theme === 'dark' ? 'dark' : 'light'
  } catch {
    /* color-mode not ready */
  }
}
