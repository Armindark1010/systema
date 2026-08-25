// ============================================================
// SYSTEMA — Settings catalog & defaults
// ============================================================

import type {
  AccentId,
  SettingsCategory,
  SystemSettings,
} from '~/types/settings'

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'appearance',
    index: '01',
    label: 'APPEARANCE',
    kicker: 'Theme',
    description: 'Theme, accent, density, motion',
    to: '/settings/appearance',
  },
  {
    id: 'playback',
    index: '02',
    label: 'PLAYBACK',
    kicker: 'Audio & Player',
    description: 'Transport, queue, output engine',
    to: '/settings/playback',
  },
  {
    id: 'library',
    index: '03',
    label: 'LIBRARY',
    kicker: 'Music & Metadata',
    description: 'Archive, sorting, artwork, scan',
    to: '/settings/library',
  },
  {
    id: 'ai',
    index: '04',
    label: 'AI',
    kicker: 'Intelligence & Analysis',
    description: 'Engine, analysis, privacy, language',
    to: '/settings/ai',
  },
  {
    id: 'gestures',
    index: '05',
    label: 'GESTURES',
    kicker: 'Interaction',
    description: 'Swipe, long press, haptics',
    to: '/settings/gestures',
  },
  {
    id: 'data',
    index: '06',
    label: 'DATA',
    kicker: 'Import / Export / Storage',
    description: 'Transfer, cache, reset',
    to: '/settings/data',
  },
  {
    id: 'about',
    index: '07',
    label: 'ABOUT',
    kicker: 'SYSTEMA',
    description: 'Architecture and version',
    to: '/settings/about',
  },
]

export const ACCENT_SWATCHES: { id: AccentId; label: string; sample: string }[] = [
  { id: 'blue', label: 'BLUE', sample: '#1e3a66' },
  { id: 'gold', label: 'GOLD', sample: '#8a6d2c' },
  { id: 'green', label: 'GREEN', sample: '#1f6b45' },
  { id: 'red', label: 'RED', sample: '#9b2c2c' },
  { id: 'mono', label: 'MONOCHROME', sample: '#3a3f48' },
]

export const DEFAULT_SETTINGS: SystemSettings = {
  appearance: {
    theme: 'default',
    accent: 'blue',
    density: 'default',
    motion: 'full',
  },
  playback: {
    autoplay: false,
    gapless: true,
    crossfade: 0,
    replayGain: 'off',
    resumePlayback: true,
    queueAfterPlaylist: 'replace',
  },
  audio: {
    output: 'system',
    volumeNormalization: false,
    quality: 'lossless',
    engine: 'web',
  },
  library: {
    autoScan: false,
    scanOnStartup: false,
    includeSubdirectories: true,
    defaultSort: 'recently-added',
    readEmbeddedMetadata: true,
    autoFetchArtwork: false,
    preserveUserEdits: true,
    artworkPreference: 'embedded',
  },
  ai: {
    enabled: true,
    autoAnalysis: false,
    analyzeWhileCharging: true,
    chargingRequired: true,
    wifiRequired: false,
    batteryThreshold: 30,
    language: 'auto',
    depth: 'standard',
    privacy: 'local-only',
    keepAnalysis: true,
    deleteAnalysisAfterReset: false,
  },
  gestures: {
    swipePlayer: true,
    swipeQueue: true,
    longPress: 'track',
    doubleTap: true,
    hapticFeedback: false,
  },
  data: {
    lastResetAt: null,
  },
  interface: {
    showSectionIndexes: true,
  },
}
