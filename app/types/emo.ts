export type EmoExpression =
  | 'idle'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'focused'
  | 'thinking'
  | 'sleepy'
  | 'surprised'
  | 'confused'
  | 'sad'
  | 'listening'
  | 'dancing'
  | 'analyzing'

export type EmoGaze = 'center' | 'left' | 'right' | 'up' | 'down' | 'user'

export type EmoMusicState =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'music-started'
  | 'high-energy'
  | 'low-energy'
  | 'track-changed'

export interface EmoPrototypeTrack {
  id: string
  title: string
  artist: string
  bpm: number
  energy: number
  mood: string
  duration: number
}
