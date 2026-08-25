import type { Theme } from '../../types'
import type {
  AccentId,
  AppearanceSettings,
  DensityId,
  MotionId,
  SystemSettings,
} from '../../types/settings'
import { DEFAULT_SETTINGS } from '../../data/settings'

const THEMES = new Set<Theme>(['default', 'premium', 'dark', 'midcentury', 'bauhaus'])
const ACCENTS = new Set<AccentId>(['blue', 'gold', 'green', 'red', 'mono'])
const DENSITIES = new Set<DensityId>(['compact', 'default', 'comfortable'])
const MOTIONS = new Set<MotionId>(['full', 'reduced', 'off'])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeSection<T extends Record<string, unknown>>(base: T, incoming: unknown): T {
  if (!isObject(incoming)) return { ...base }
  const next = { ...base }
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (incoming[key as string] !== undefined) {
      next[key] = incoming[key as string] as T[keyof T]
    }
  }
  return next
}

export function normalizeAppearance(input?: Partial<AppearanceSettings> | null): AppearanceSettings {
  const base = DEFAULT_SETTINGS.appearance
  return {
    theme: input && THEMES.has(input.theme as Theme) ? input.theme as Theme : base.theme,
    accent: input && ACCENTS.has(input.accent as AccentId) ? input.accent as AccentId : base.accent,
    density: input && DENSITIES.has(input.density as DensityId) ? input.density as DensityId : base.density,
    motion: input && MOTIONS.has(input.motion as MotionId) ? input.motion as MotionId : base.motion,
  }
}

export function hydrateSettings(raw: unknown): SystemSettings {
  const incoming = isObject(raw) ? raw : {}
  return {
    appearance: normalizeAppearance(incoming.appearance as Partial<AppearanceSettings> | undefined),
    playback: mergeSection(DEFAULT_SETTINGS.playback, incoming.playback),
    audio: mergeSection(DEFAULT_SETTINGS.audio, incoming.audio),
    library: mergeSection(DEFAULT_SETTINGS.library, incoming.library),
    ai: mergeSection(DEFAULT_SETTINGS.ai, incoming.ai),
    gestures: mergeSection(DEFAULT_SETTINGS.gestures, incoming.gestures),
    data: mergeSection(DEFAULT_SETTINGS.data, incoming.data),
    interface: mergeSection(DEFAULT_SETTINGS.interface, incoming.interface),
  }
}
