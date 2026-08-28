/**
 * A port of ClapAudioEmbeddingModel.StreamingEmbedder and the window
 * budget arithmetic in ClapSession, so the coverage maths can be
 * TESTED rather than reasoned about.
 *
 * The bug this exists to prevent shipped once already: six overlapping
 * 10-second windows cover 35 seconds, not 60, and the UI reported 60.
 * Off-by-one errors in stride arithmetic are invisible in a diff and
 * obvious in a table.
 *
 * Not shipped; never imported by the app.
 */

/** Windows needed to cover `seconds`, given 50% overlap. */
export function windowBudget(
  seconds: number,
  clipSamples: number,
  strideSamples: number,
  rate: number,
): number | null {
  if (seconds <= 0) return null // full track
  const requested = seconds * rate
  if (requested <= clipSamples) return 1
  return Math.floor((requested - clipSamples) / strideSamples) + 1
}

/** Seconds of audio that `windows` overlapping windows actually cover. */
export function coverageSec(
  windows: number,
  clipSamples: number,
  strideSamples: number,
  rate: number,
): number {
  return (clipSamples + (windows - 1) * strideSamples) / rate
}

export interface StreamResult {
  windows: number
  starts: number[]
  seen: number
  peakBufferSamples: number
}

/**
 * Simulates accept()/slide()/finish(). Returns where each window
 * started so coverage and duplication can both be asserted.
 */
export function runStream(
  totalSamples: number,
  clip: number,
  stride: number,
  maxWindows: number | null,
  chunk = 8192,
): StreamResult {
  let filled = 0
  let windows = 0
  let seen = 0
  const starts: number[] = []
  const saturated = () => maxWindows !== null && windows >= maxWindows
  const overlap = clip - stride

  let offset = 0
  outer: while (offset < totalSamples) {
    if (saturated()) break
    const count = Math.min(chunk, totalSamples - offset)
    let o = 0
    while (o < count) {
      if (saturated()) break outer
      const take = Math.min(count - o, clip - filled)
      filled += take
      o += take
      seen += take
      if (filled === clip) {
        starts.push(seen - clip)
        windows++
        filled = overlap > 0 ? overlap : 0
      }
    }
    offset += count
  }

  // finish(): embed a trailing partial window only if it holds audio
  // the previous window did not already cover.
  const hasNew = windows === 0 ? filled > 0 : filled > overlap
  if (hasNew && !saturated()) {
    starts.push(seen - filled)
    windows++
  }

  return { windows, starts, seen, peakBufferSamples: clip }
}
