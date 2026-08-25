import assert from 'node:assert/strict'
import { hydrateSettings } from '../app/services/persistence/settingsHydrate.ts'
import { DEFAULT_SETTINGS } from '../app/data/settings.ts'

const merged = hydrateSettings({
  appearance: { theme: 'dark', accent: 'gold' },
  playback: { autoplay: true, crossfade: 6 },
  ai: { enabled: false, language: 'fa' },
  unknown: true,
})

assert.equal(merged.appearance.theme, 'dark')
assert.equal(merged.appearance.accent, 'gold')
assert.equal(merged.appearance.density, 'default')
assert.equal(merged.playback.autoplay, true)
assert.equal(merged.playback.crossfade, 6)
assert.equal(merged.playback.gapless, DEFAULT_SETTINGS.playback.gapless)
assert.equal(merged.ai.enabled, false)
assert.equal(merged.ai.language, 'fa')
assert.equal(merged.ai.privacy, 'local-only')

const invalid = hydrateSettings({
  appearance: { theme: 'neon', accent: 'purple', density: 'huge', motion: 'wild' },
})
assert.equal(invalid.appearance.theme, 'default')
assert.equal(invalid.appearance.accent, 'blue')
assert.equal(invalid.appearance.density, 'default')
assert.equal(invalid.appearance.motion, 'full')

const empty = hydrateSettings(null)
assert.deepEqual(empty.gestures, DEFAULT_SETTINGS.gestures)

console.log('settings hydration ok')
