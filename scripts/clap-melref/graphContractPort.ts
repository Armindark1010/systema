/**
 * A port of ClapGraphContract.derive() from Kotlin, so the format
 * decision can be TESTED rather than only reviewed.
 *
 * Getting this wrong is not a crash — it is a finite, L2-normalised,
 * completely meaningless embedding. That is why the branch has
 * executable tests instead of a code read.
 *
 * Not shipped; never imported by the app. scripts/test-clap-infra.ts
 * pins the Kotlin thresholds against this port so they cannot drift.
 */
// Mirror of ClapGraphContract.derive for executable testing.
export type Kind = 'WAVEFORM' | 'LOG_MEL' | 'UNKNOWN'
export interface Sig { name: string, shape: number[], type: string }
const MIN_WAVEFORM = 8000
export function derive(inputs: Sig[], outputs: Sig[], dW = 480000, dM = 64, dF = 1001) {
  const input = inputs[0], output = outputs[0]
  if (!input) return { kind: 'UNKNOWN' as Kind, concrete: null, reason: 'no inputs' }
  if (!output) return { kind: 'UNKNOWN' as Kind, concrete: null, reason: 'no outputs' }
  const shape = input.shape, rank = shape.length
  const embed = output.shape.at(-1)! > 0 ? output.shape.at(-1)! : null
  if (rank === 2) {
    const d = shape[1]!
    if (d > 0 && d < MIN_WAVEFORM) return { kind: 'UNKNOWN' as Kind, concrete: null, reason: 'too short', embed }
    const samples = d > 0 ? d : dW
    return { kind: 'WAVEFORM' as Kind, concrete: [1, samples], samples, embed, reason: 'rank2' }
  }
  if (rank === 3 || rank === 4) {
    const melAxis = shape.at(-1)!, frameAxis = shape.at(-2)!
    if (melAxis > 512) return { kind: 'UNKNOWN' as Kind, concrete: null, reason: 'mel too wide', embed }
    const mels = melAxis > 0 ? melAxis : dM
    const frames = frameAxis > 0 ? frameAxis : dF
    return { kind: 'LOG_MEL' as Kind, concrete: [1, 1, frames, mels], mels, frames, embed, reason: 'rank3/4' }
  }
  return { kind: 'UNKNOWN' as Kind, concrete: null, reason: `rank ${rank}`, embed }
}
