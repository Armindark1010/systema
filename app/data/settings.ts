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
    icon: 'lucide:palette',
  },
  {
    id: 'playback',
    index: '02',
    label: 'PLAYBACK',
    kicker: 'Audio & Player',
    description: 'Transport, queue, output engine',
    to: '/settings/playback',
    icon: 'lucide:play',
  },
  {
    id: 'library',
    index: '03',
    label: 'LIBRARY',
    kicker: 'Music & Metadata',
    description: 'Archive, sorting, artwork, scan',
    to: '/settings/library',
    icon: 'lucide:library',
  },
  {
    id: 'ai',
    index: '04',
    label: 'AI',
    kicker: 'Intelligence & Analysis',
    description: 'Engine, analysis, privacy, language',
    to: '/settings/ai',
    icon: 'lucide:sparkles',
  },
  {
    id: 'gestures',
    index: '05',
    label: 'GESTURES',
    kicker: 'Interaction',
    description: 'Swipe, long press, haptics',
    to: '/settings/gestures',
    icon: 'lucide:hand',
  },
  {
    id: 'data',
    index: '06',
    label: 'DATA',
    kicker: 'Import / Export / Storage',
    description: 'Transfer, cache, reset',
    to: '/settings/data',
    icon: 'lucide:hard-drive',
  },
  {
    id: 'about',
    index: '07',
    label: 'ABOUT',
    kicker: 'SYSTEMA',
    description: 'Architecture and version',
    to: '/settings/about',
    icon: 'lucide:info',
  },
]

export interface SettingsSearchEntry {
  id: string
  title: string
  description: string
  category: SettingsCategory['id']
  categoryLabel: string
  to: string
  keywords: string[]
}

export const SETTINGS_INDEX: SettingsSearchEntry[] = [
  { id: 'theme', title: 'Theme', description: 'Default Light, Dark, Mid-Century, Bauhaus, Premium', category: 'appearance', categoryLabel: 'APPEARANCE', to: '/settings/appearance#theme', keywords: ['theme', 'dark', 'light', 'bauhaus', 'mid-century', 'premium', 'appearance'] },
  { id: 'accent', title: 'Accent', description: 'Primary signal color for the whole interface', category: 'appearance', categoryLabel: 'APPEARANCE', to: '/settings/appearance#accent', keywords: ['accent', 'color', 'blue', 'gold', 'green', 'red', 'mono'] },
  { id: 'density', title: 'Interface Density', description: 'Compact, default, or comfortable spacing', category: 'appearance', categoryLabel: 'APPEARANCE', to: '/settings/appearance#density', keywords: ['density', 'compact', 'comfortable', 'spacing'] },
  { id: 'motion', title: 'Motion', description: 'Full, reduced, or off', category: 'appearance', categoryLabel: 'APPEARANCE', to: '/settings/appearance#motion', keywords: ['motion', 'animation', 'reduced'] },
  { id: 'autoplay', title: 'Autoplay', description: 'Continue with related music after the queue ends', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#autoplay', keywords: ['autoplay', 'continue', 'queue'] },
  { id: 'gapless', title: 'Gapless Playback', description: 'Reduce silence between consecutive tracks', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#gapless', keywords: ['gapless', 'silence'] },
  { id: 'crossfade', title: 'Crossfade', description: 'Overlap between tracks: off, 2, 4, 6, 8, 10 seconds', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#crossfade', keywords: ['crossfade', 'fade', 'overlap', 'seconds'] },
  { id: 'replay-gain', title: 'Replay Gain', description: 'Normalize loudness: off, track, album', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#replay-gain', keywords: ['replay', 'gain', 'loudness', 'normalize'] },
  { id: 'resume', title: 'Resume Playback', description: 'Restore last position on launch', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#resume', keywords: ['resume', 'position'] },
  { id: 'queue-behavior', title: 'Queue Behavior', description: 'Replace or append when a playlist starts', category: 'playback', categoryLabel: 'PLAYBACK', to: '/settings/playback#queue-behavior', keywords: ['queue', 'replace', 'append'] },
  { id: 'auto-scan', title: 'Auto Scan', description: 'Detect new music files when native scan exists', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#auto-scan', keywords: ['scan', 'auto', 'library'] },
  { id: 'scan-startup', title: 'Scan on Startup', description: 'Resync the index when SYSTEMA opens', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#scan-startup', keywords: ['scan', 'startup'] },
  { id: 'subdirectories', title: 'Include Subdirectories', description: 'Walk nested folders during a native scan', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#subdirectories', keywords: ['subdirectories', 'folders'] },
  { id: 'default-sort', title: 'Default Sort', description: 'Initial library order', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#default-sort', keywords: ['sort', 'order', 'alphabetical'] },
  { id: 'embedded-metadata', title: 'Embedded Metadata', description: 'Read ID3 and related tags', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#embedded-metadata', keywords: ['metadata', 'id3', 'tags', 'embedded'] },
  { id: 'auto-artwork', title: 'Auto Artwork', description: 'Network fallback for missing covers', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#auto-artwork', keywords: ['artwork', 'cover'] },
  { id: 'preserve-edits', title: 'Preserve User Edits', description: 'Never overwrite manual metadata', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#preserve-edits', keywords: ['edits', 'metadata'] },
  { id: 'scan-library', title: 'Scan Music Library', description: 'Requires the native MediaStore adapter', category: 'library', categoryLabel: 'LIBRARY', to: '/settings/library#scan-library', keywords: ['scan', 'library', 'mediastore'] },
  { id: 'ai-enabled', title: 'AI Enabled', description: 'Turn intelligence interactions on or off', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#ai-enabled', keywords: ['ai', 'enabled', 'intelligence'] },
  { id: 'auto-analysis', title: 'Automatic Analysis', description: 'Analyze newly discovered music', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#auto-analysis', keywords: ['ai', 'analysis', 'automatic'] },
  { id: 'analyze-charging', title: 'Analyze While Charging', description: 'Prepared for a native background worker', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#analyze-charging', keywords: ['ai', 'charging', 'background'] },
  { id: 'charging-required', title: 'Charging Required', description: 'Only schedule analysis while plugged in', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#charging-required', keywords: ['ai', 'charging'] },
  { id: 'wifi-required', title: 'Wi-Fi Required', description: 'Reserved for optional cloud analysis', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#wifi-required', keywords: ['ai', 'wifi', 'network'] },
  { id: 'battery-threshold', title: 'Battery Threshold', description: 'Do not start background analysis below this level', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#battery-threshold', keywords: ['ai', 'battery'] },
  { id: 'ai-language', title: 'AI Language', description: 'Auto, Persian, or English', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#ai-language', keywords: ['ai', 'language', 'persian', 'farsi', 'english'] },
  { id: 'analysis-depth', title: 'Analysis Depth', description: 'Quick, standard, or deep', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#analysis-depth', keywords: ['ai', 'depth', 'quick', 'deep'] },
  { id: 'ai-model', title: 'AI Model', description: 'No on-device model is configured in this build', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#ai-model', keywords: ['ai', 'model', 'onnx'] },
  { id: 'ai-privacy', title: 'AI Privacy', description: 'Local only, allow cloud, or ask first', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#ai-privacy', keywords: ['ai', 'privacy', 'local', 'cloud'] },
  { id: 'ai-cache', title: 'AI Cache', description: 'Session analyses and clear action', category: 'ai', categoryLabel: 'AI', to: '/settings/ai#ai-cache', keywords: ['ai', 'cache', 'clear'] },
  { id: 'swipe-player', title: 'Player Swipe', description: 'Swipe the player to change tracks', category: 'gestures', categoryLabel: 'GESTURES', to: '/settings/gestures#swipe-player', keywords: ['swipe', 'player', 'gesture'] },
  { id: 'swipe-queue', title: 'Queue Swipe', description: 'Swipe down to dismiss the queue', category: 'gestures', categoryLabel: 'GESTURES', to: '/settings/gestures#swipe-queue', keywords: ['swipe', 'queue'] },
  { id: 'long-press', title: 'Long Press', description: 'Track, queue, or playlist actions', category: 'gestures', categoryLabel: 'GESTURES', to: '/settings/gestures#long-press', keywords: ['long', 'press', 'gesture'] },
  { id: 'double-tap', title: 'Double Tap', description: 'Double tap artwork to like', category: 'gestures', categoryLabel: 'GESTURES', to: '/settings/gestures#double-tap', keywords: ['double', 'tap'] },
  { id: 'haptics', title: 'Haptic Feedback', description: 'Prepared for native haptics', category: 'gestures', categoryLabel: 'GESTURES', to: '/settings/gestures#haptics', keywords: ['haptic', 'vibration'] },
  { id: 'storage', title: 'Storage', description: 'Music, playlists, analysis, cache', category: 'data', categoryLabel: 'DATA', to: '/settings/data#storage', keywords: ['storage', 'size', 'cache', 'music'] },
  { id: 'import-playlist', title: 'Import Playlist', description: 'Existing playlist import pipeline', category: 'data', categoryLabel: 'DATA', to: '/settings/data#import-playlist', keywords: ['import', 'playlist'] },
  { id: 'export-playlist', title: 'Export Playlist', description: 'Existing playlist export pipeline', category: 'data', categoryLabel: 'DATA', to: '/settings/data#export-playlist', keywords: ['export', 'playlist'] },
  { id: 'reset', title: 'Reset', description: 'Settings, AI data, library index, everything', category: 'data', categoryLabel: 'DATA', to: '/settings/data#reset', keywords: ['reset', 'danger', 'clear'] },
  { id: 'about-systema', title: 'About SYSTEMA', description: 'Build information, licenses, privacy', category: 'about', categoryLabel: 'ABOUT', to: '/settings/about#about', keywords: ['about', 'version', 'license', 'privacy', 'terms'] },
]

export function searchSettings(query: string): SettingsSearchEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return SETTINGS_INDEX.filter((entry) => {
    const haystack = [entry.title, entry.description, entry.categoryLabel, ...entry.keywords].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

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
