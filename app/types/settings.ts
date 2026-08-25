// ============================================================
// SYSTEMA — Settings contracts
// ============================================================
// Single source of truth for system configuration.
// The UI and future native adapters (Capacitor Preferences,
// Media3, WorkManager) consume these shapes only.
// ============================================================

export type AccentId = 'blue' | 'gold' | 'green' | 'red' | 'mono'
export type DensityId = 'compact' | 'default' | 'comfortable'
export type MotionId = 'full' | 'reduced' | 'off'

export type CrossfadeSeconds = 0 | 2 | 4 | 6 | 8 | 10
export type ReplayGainMode = 'off' | 'track' | 'album'
export type QueueAfterPlaylist = 'replace' | 'append'

export type AudioOutput = 'system'
export type AudioQualityPref = 'lossless' | 'high' | 'standard'
export type PlaybackEngine = 'web'

export type LibraryDefaultSort = 'recently-added' | 'alphabetical' | 'artist' | 'album' | 'duration'
export type ArtworkPreference = 'embedded' | 'external' | 'placeholder'

export type AILanguage = 'auto' | 'fa' | 'en'
export type AnalysisDepth = 'quick' | 'standard' | 'deep'
export type AIPrivacyMode = 'local-only' | 'allow-cloud' | 'ask'
export type BatteryThreshold = 20 | 30 | 40 | 50

export type LongPressTarget = 'track' | 'queue' | 'playlist'

export interface AppearanceSettings {
  theme: 'default' | 'premium' | 'dark' | 'midcentury' | 'bauhaus'
  accent: AccentId
  density: DensityId
  motion: MotionId
}

export interface PlaybackSettingsState {
  autoplay: boolean
  gapless: boolean
  crossfade: CrossfadeSeconds
  replayGain: ReplayGainMode
  resumePlayback: boolean
  queueAfterPlaylist: QueueAfterPlaylist
}

export interface AudioSettingsState {
  output: AudioOutput
  volumeNormalization: boolean
  quality: AudioQualityPref
  engine: PlaybackEngine
}

export interface LibrarySettingsState {
  autoScan: boolean
  scanOnStartup: boolean
  includeSubdirectories: boolean
  defaultSort: LibraryDefaultSort
  readEmbeddedMetadata: boolean
  autoFetchArtwork: boolean
  preserveUserEdits: boolean
  artworkPreference: ArtworkPreference
}

export interface AISettingsState {
  enabled: boolean
  autoAnalysis: boolean
  analyzeWhileCharging: boolean
  chargingRequired: boolean
  wifiRequired: boolean
  batteryThreshold: BatteryThreshold
  language: AILanguage
  depth: AnalysisDepth
  privacy: AIPrivacyMode
  keepAnalysis: boolean
  deleteAnalysisAfterReset: boolean
}

export interface GestureSettingsState {
  swipePlayer: boolean
  swipeQueue: boolean
  longPress: LongPressTarget
  doubleTap: boolean
  hapticFeedback: boolean
}

export interface DataSettingsState {
  /** Reserved for future native telemetry — never invent numbers. */
  lastResetAt: string | null
}

export interface InterfaceSettingsState {
  showSectionIndexes: boolean
}

export interface SystemSettings {
  appearance: AppearanceSettings
  playback: PlaybackSettingsState
  audio: AudioSettingsState
  library: LibrarySettingsState
  ai: AISettingsState
  gestures: GestureSettingsState
  data: DataSettingsState
  interface: InterfaceSettingsState
}

export type SettingsCategoryId =
  | 'appearance'
  | 'playback'
  | 'library'
  | 'ai'
  | 'gestures'
  | 'data'
  | 'about'

export interface SettingsCategory {
  id: SettingsCategoryId
  index: string
  label: string
  kicker: string
  description: string
  to: string
}
