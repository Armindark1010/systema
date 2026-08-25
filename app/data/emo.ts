import type { EmoExpression, EmoPrototypeTrack } from '~/types/emo'

export const emoExpressionOptions: ReadonlyArray<{ value: EmoExpression; label: string }> = [
  { value: 'idle', label: 'IDLE' },
  { value: 'happy', label: 'HAPPY' },
  { value: 'excited', label: 'EXCITED' },
  { value: 'curious', label: 'CURIOUS' },
  { value: 'focused', label: 'FOCUSED' },
  { value: 'thinking', label: 'THINKING' },
  { value: 'sleepy', label: 'SLEEPY' },
  { value: 'surprised', label: 'SURPRISED' },
  { value: 'confused', label: 'CONFUSED' },
  { value: 'sad', label: 'SAD' },
  { value: 'listening', label: 'LISTENING' },
  { value: 'dancing', label: 'DANCING' },
  { value: 'analyzing', label: 'ANALYZING' },
]

export const emoPrototypeTracks: ReadonlyArray<EmoPrototypeTrack> = [
  {
    id: 'emo-structure',
    title: 'STRUCTURE & RHYTHM',
    artist: 'SYSTEMA',
    bpm: 118,
    energy: 0.72,
    mood: 'FOCUSED',
    duration: 222,
  },
  {
    id: 'emo-signal',
    title: 'SIGNAL GRID',
    artist: 'SYSTEMA',
    bpm: 132,
    energy: 0.88,
    mood: 'ENERGETIC',
    duration: 204,
  },
  {
    id: 'emo-night',
    title: 'LOW ORBIT',
    artist: 'SYSTEMA',
    bpm: 84,
    energy: 0.28,
    mood: 'CALM',
    duration: 268,
  },
]

export const emoBehavior = {
  blink: {
    idleMin: 2800,
    idleMax: 5200,
    excitedMin: 1500,
    excitedMax: 2800,
    sleepyMin: 4200,
    sleepyMax: 7000,
    specialMin: 3200,
    specialMax: 5600,
    normalDuration: 110,
    sleepyDuration: 340,
    doubleGap: 120,
    doubleChance: 0.18,
  },
  gaze: {
    idleMin: 2400,
    idleMax: 5200,
    hold: 900,
  },
  interaction: {
    curiousDuration: 700,
    happyDuration: 1800,
  },
  music: {
    startedDuration: 1100,
    trackChangedDuration: 900,
    lowEnergy: 0.35,
    highEnergy: 0.78,
    minimumBpm: 40,
    secondsPerMinute: 60,
    slowBeatMultiplier: 2,
    equalizerPhaseTwo: -0.33,
    equalizerPhaseThree: -0.66,
    tick: 1000,
  },
  thinking: {
    analyzingDuration: 2400,
    foundDuration: 1700,
  },
} as const
