// ============================================================
// SYSTEMA — Native library self-diagnostics
// ============================================================
// Runs the entire integration path and reports what actually
// happened, on the device, in the UI. This exists because logcat
// is not always reachable and a silent fallback to mock data is
// otherwise indistinguishable from a working library.
//
// Surfaced in Settings -> Library -> INTEGRATION DIAGNOSTICS.
// ============================================================

import { Capacitor } from '@capacitor/core'
import {
  MusicLibrary,
  PLUGIN_NAME,
  isNativeLibraryAvailable,
} from './musicLibraryPlugin'

export interface DiagnosticLine {
  step: string
  value: string
  ok: boolean | null
}

function line(step: string, value: unknown, ok: boolean | null = null): DiagnosticLine {
  return { step, value: typeof value === 'string' ? value : JSON.stringify(value), ok }
}

/**
 * Walks every link of the chain in order and stops being optimistic:
 * each step reports the real value it observed.
 */
export async function runLibraryDiagnostics(): Promise<DiagnosticLine[]> {
  const out: DiagnosticLine[] = []

  // --- 1. Capacitor runtime -------------------------------------
  let platform = 'unknown'
  let isNative = false
  try {
    platform = Capacitor.getPlatform()
    isNative = Capacitor.isNativePlatform()
    out.push(line('1. Capacitor platform', platform, platform === 'android'))
    out.push(line('2. isNativePlatform()', isNative, isNative))
  } catch (error) {
    out.push(line('1. Capacitor runtime', `UNAVAILABLE ${String(error)}`, false))
    return out
  }

  // --- 2. Plugin registration ------------------------------------
  // The single most common silent failure: Bridge.registerPlugin()
  // swallows PluginLoadException, so an unregistered plugin looks
  // exactly like "running in a browser".
  let registered = false
  try {
    registered = Capacitor.isPluginAvailable(PLUGIN_NAME)
  } catch { /* reported below */ }
  out.push(line(`3. isPluginAvailable("${PLUGIN_NAME}")`, registered, registered))

  const headers = (globalThis as { Capacitor?: { PluginHeaders?: { name: string }[] } })
    .Capacitor?.PluginHeaders
  out.push(line(
    '4. Native PluginHeaders',
    headers ? headers.map(h => h.name).join(', ') || '(empty)' : '(absent — web build)',
    headers ? headers.some(h => h.name === PLUGIN_NAME) : null,
  ))

  const available = isNativeLibraryAvailable()
  out.push(line('5. isNativeLibraryAvailable()', available, available))

  if (!available) {
    out.push(line(
      '=> RESULT',
      isNative
        ? 'Native platform but plugin NOT registered — mock data will show. Check MainActivity.registerPlugin and logcat for PluginLoadException.'
        : 'Browser — mock catalog is correct here.',
      isNative ? false : true,
    ))
    return out
  }

  // --- 3. Permission --------------------------------------------
  try {
    const permission = await MusicLibrary.hasPermission()
    out.push(line('6. hasPermission()', permission, permission.granted))
  } catch (error) {
    out.push(line('6. hasPermission()', `THREW ${String(error)}`, false))
  }

  // --- 4. Index state -------------------------------------------
  try {
    const { count } = await MusicLibrary.getLibraryCount()
    out.push(line('7. getLibraryCount() (Room rows)', count, count > 0))
  } catch (error) {
    out.push(line('7. getLibraryCount()', `THREW ${String(error)}`, false))
  }

  try {
    const status = await MusicLibrary.getScanStatus()
    out.push(line('8. getScanStatus()', {
      state: status.state,
      discovered: status.discovered,
      inserted: status.inserted,
      removed: status.removed,
      total: status.total,
      error: status.errorMessage,
    }, status.state !== 'ERROR'))
  } catch (error) {
    out.push(line('8. getScanStatus()', `THREW ${String(error)}`, false))
  }

  // --- 5. Actual bridge payload ---------------------------------
  try {
    const page = await MusicLibrary.getTracks({ offset: 0, limit: 3 })
    out.push(line('9. getTracks() bridge payload', {
      returned: page.tracks?.length ?? 0,
      total: page.total,
      firstTitle: page.tracks?.[0]?.title ?? '(none)',
    }, (page.tracks?.length ?? 0) > 0))
  } catch (error) {
    out.push(line('9. getTracks()', `THREW ${String(error)}`, false))
  }

  return out
}
