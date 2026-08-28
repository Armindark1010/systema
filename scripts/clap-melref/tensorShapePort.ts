/**
 * Ports of OnnxInferenceRuntime.resolveShape() and the labelled lab's
 * fixed-window accounting, so the tensor-shape contract can be TESTED.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * resolveShape divided the buffer length by the fixed dimensions and
 * returned the quotient even when the division was inexact. A
 * 13,840,300-sample track against [-1, 480000] became [28, 480000] =
 * 13,440,000 elements, and ORT rejected the tensor with an arithmetic
 * message that named neither the track nor the cause.
 *
 * Not shipped; never imported by the app.
 */

export class ShapeMismatchError extends Error {}

/** Mirrors resolveShape, including the new exactness requirement. */
export function resolveShape(declared: number[], actualElements: number): number[] {
  if (declared.length === 0) return [actualElements]
  const dynamic = declared.filter(d => d <= 0).length
  if (dynamic === 0) return [...declared]
  if (dynamic > 1) return [actualElements]
  const known = declared.filter(d => d > 0).reduce((a, b) => a * b, 1)
  if (known <= 0) throw new ShapeMismatchError('no usable fixed dimension')
  if (actualElements % known !== 0) {
    throw new ShapeMismatchError(
      `buffer of ${actualElements} does not divide evenly by ${known} ` +
      `(remainder ${actualElements % known})`,
    )
  }
  return declared.map(d => (d <= 0 ? actualElements / known : d))
}

/** Element count a shape demands. */
export function elementCount(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1)
}

/** Mirrors LabeledQualityLab.fixedWindowSamplesFor. */
export function fixedWindowSamplesFor(
  inputShape: number[],
  inputFormat: string,
  minWindow = 8000,
): number | null {
  if (inputFormat !== 'RAW_WAVEFORM') return null
  if (inputShape.length !== 2) return null
  if (inputShape[1]! < minWindow) return null
  return inputShape[1]!
}

/** Mirrors the embedByWindows loop; returns each submitted length. */
export function windowLengths(totalSamples: number, windowSamples: number): number[] {
  const stride = Math.max(1, Math.floor(windowSamples / 2))
  const out: number[] = []
  let start = 0
  while (start < totalSamples) {
    const end = Math.min(start + windowSamples, totalSamples)
    out.push(windowSamples) // always padded to exactly one window
    if (end >= totalSamples) break
    start += stride
  }
  return out
}
