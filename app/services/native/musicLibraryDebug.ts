// ============================================================
// SYSTEMA — Native library diagnostics
// ============================================================
// Capacitor forwards console output to logcat, so these lines are
// visible with:
//
//   adb logcat | grep SYSTEMA/LIB
//
// Every message is prefixed identically so the whole integration
// path can be traced in one filtered stream.
// ============================================================

const PREFIX = 'SYSTEMA/LIB'

/** Flip to false to silence the integration trace in release builds. */
export const LIBRARY_DEBUG = true

export function libLog(stage: string, detail?: unknown): void {
  if (!LIBRARY_DEBUG) return
  if (detail === undefined) console.log(`[${PREFIX}] ${stage}`)
  else console.log(`[${PREFIX}] ${stage}`, detail)
}

export function libWarn(stage: string, detail?: unknown): void {
  if (!LIBRARY_DEBUG) return
  console.warn(`[${PREFIX}] ${stage}`, detail)
}
