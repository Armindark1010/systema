// ============================================================
// useAudioEngine — REAL audio for the player (generative)
// ============================================================
// The catalog is a mock archive (no licensed audio files), so
// this engine SYNTHESIZES a deterministic ambient interpretation
// of each track from its seed / mood / energy. The whole
// transport is genuinely audible: play, pause, next/prev,
// volume, mute — everything drives real sound.
// ============================================================

import type { Track } from '~/types'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let level = 0.8

// the currently sounding voice graph
let live: { stop: () => void; seek: (targetStep: number) => void } | null = null

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  penta: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 7, 9],
}

function scaleFor(mood: string): number[] {
  if (mood === 'calm' || mood === 'dreamy') return SCALES.major
  if (mood === 'energetic' || mood === 'focused') return SCALES.dorian
  if (mood === 'melancholic') return SCALES.penta
  return SCALES.minor
}

function ensureCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = level
    master.connect(ctx.destination)
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return ctx
}

/** Build and start the generative voice for one track. */
function start(track: Track) {
  if (!import.meta.client) return
  stop()
  const c = ensureCtx()
  if (c.state === 'suspended') void c.resume()

  const seed = hash(track.id)
  const scale = scaleFor(track.mood)
  const root = 92 * Math.pow(2, (seed % 7) / 12)
  const bpm = 64 + (track.energy % 46) + (track.mood === 'energetic' ? 22 : 0)
  const beat = 60 / bpm
  const chordDur = beat * 8
  const percussive = track.energy >= 50

  // shared pad bus for this track
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 280 + track.energy * 24
  filter.Q.value = 0.7
  const padGain = c.createGain()
  padGain.gain.value = 0.15
  filter.connect(padGain)
  padGain.connect(master!)

  const degrees = [0, (seed >> 3) % scale.length, (seed >> 6) % scale.length, (seed >> 9) % scale.length]

  function chord(degree: number, at: number, dur: number) {
    for (let k = 0; k < 3; k++) {
      const idx = degree + k * 2
      const st = scale[idx % scale.length] + 12 * Math.floor(idx / scale.length)
      for (const det of [-4, 4]) {
        const o = c.createOscillator()
        o.type = 'triangle'
        o.frequency.value = root * Math.pow(2, st / 12)
        o.detune.value = det
        const g = c.createGain()
        g.gain.setValueAtTime(0.0001, at)
        g.gain.linearRampToValueAtTime(1, at + dur * 0.35)
        g.gain.setValueAtTime(1, at + dur * 0.7)
        g.gain.linearRampToValueAtTime(0.0001, at + dur)
        o.connect(g)
        g.connect(filter)
        o.start(at)
        o.stop(at + dur + 0.05)
      }
    }
  }

  function tick(at: number, open: boolean) {
    const src = c.createBufferSource()
    src.buffer = noiseBuf!
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = open ? 7200 : 3200
    bp.Q.value = 1.2
    const g = c.createGain()
    g.gain.setValueAtTime(open ? 0.09 : 0.06, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + (open ? 0.14 : 0.07))
    src.connect(bp)
    bp.connect(g)
    g.connect(master!)
    src.start(at)
    src.stop(at + 0.16)
  }

  // bass pulse each bar
  function bass(at: number, degree: number, dur: number) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = root / 2 * Math.pow(2, scale[degree % scale.length] / 12)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.22, at + 0.06)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g)
    g.connect(master!)
    o.start(at)
    o.stop(at + dur + 0.05)
  }

  // lookahead scheduler
  let nextTime = c.currentTime + 0.06
  let step = 0
  const timer = setInterval(() => {
    while (nextTime < c.currentTime + 1.5) {
      const degree = degrees[step % degrees.length]
      chord(degree, nextTime, chordDur)
      bass(nextTime, degree, chordDur * 0.9)
      if (percussive) {
        for (let b = 0; b < 8; b++) tick(nextTime + b * beat, b % 4 === 2)
      }
      step++
      nextTime += chordDur
    }
  }, 400)

  live = {
    seek(targetStep: number) {
      step = targetStep
      nextTime = c.currentTime + 0.05
    },
    stop() {
      clearInterval(timer)
      try {
        filter.disconnect()
        padGain.disconnect()
      } catch {
        /* already disconnected */
      }
    },
  }
}

function stop() {
  live?.stop()
  live = null
}

function seek(seconds: number) {
  if (!ctx || !live || !Number.isFinite(seconds)) return
  // Beat duration is roughly 0.5s - 1s, chord duration is beat * 8 (~4-8s)
  const targetStep = Math.max(0, Math.floor(seconds / 5))
  live.seek(targetStep)
}

function setPaused(paused: boolean) {
  if (!ctx || !live) return
  if (paused && ctx.state === 'running') void ctx.suspend()
  if (!paused && ctx.state === 'suspended') void ctx.resume()
}

function setLevel(v: number) {
  level = v
  if (ctx && master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
}

export function useAudioEngine() {
  return { start, stop, seek, setPaused, setLevel }
}
