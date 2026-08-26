// ============================================================
// SYSTEMA — Phase 14: execution environment detection
// ============================================================
// Establishes WHERE a benchmark ran, because that single fact
// determines whether its numbers mean anything (§8).
//
// The hard rule: a desktop browser measurement must never be
// presentable as device performance. A laptop CPU is several times
// faster than a phone's, has no thermal ceiling worth speaking of,
// and runs a completely different JS engine build. Reporting the two
// under one label would make the entire benchmark misleading.
//
// So every run is stamped with a DeviceInfo whose `platform` decides
// the DESKTOP / DEVICE badge, and the comparison engine refuses to
// rank runs from different environments against each other.
// ============================================================

import { Capacitor } from '@capacitor/core'
import type { DeviceInfo } from './types'
import { unknown } from './types'

/** The phone Phase 14 is targeting, for the isTargetDevice flag. */
const TARGET_DEVICE_HINTS = ['poco x7 pro', '24094rad4']

/**
 * Describes the current environment.
 *
 * Everything not actually readable is reported as unknown rather than
 * guessed. The user agent gives a coarse platform and OS version and
 * nothing more — notably it cannot tell us the SoC, the core count in
 * any trustworthy way, or total RAM.
 */
export function detectDevice(): DeviceInfo {
  const isNative = Capacitor.isNativePlatform()
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

  if (!isNative) {
    return {
      label: describeBrowser(ua),
      platform: 'web',
      cpuArchitecture: readArchitecture(ua),
      osVersion: readDesktopOs(ua),
      totalRamMb: unknown('Not exposed to web pages.'),
      isTargetDevice: false,
    }
  }

  const androidVersion = /Android\s+([\d.]+)/i.exec(ua)?.[1] ?? 'unknown'
  const model = readAndroidModel(ua)
  const normalised = model.toLowerCase()

  return {
    label: model,
    platform: 'android',
    cpuArchitecture: readArchitecture(ua),
    osVersion: `Android ${androidVersion}`,
    // deviceMemory is Chrome-only, coarse (rounded to a power of two)
    // and often absent on Android WebView. Reported as ESTIMATED when
    // present, never fabricated when not.
    totalRamMb: readDeviceMemoryMb(),
    isTargetDevice: TARGET_DEVICE_HINTS.some(hint => normalised.includes(hint)),
  }
}

function readAndroidModel(ua: string): string {
  // Android UA form: "... (Linux; Android 15; 24094RAD4 Build/...)"
  const match = /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i.exec(ua)
  const model = match?.[1]?.trim()
  return model && model.length > 0 ? model : 'Android device'
}

function describeBrowser(ua: string): string {
  if (/Firefox\//i.test(ua)) return 'Desktop browser (Firefox)'
  if (/Edg\//i.test(ua)) return 'Desktop browser (Edge)'
  if (/Chrome\//i.test(ua)) return 'Desktop browser (Chrome)'
  if (/Safari\//i.test(ua)) return 'Desktop browser (Safari)'
  return 'Desktop browser'
}

function readDesktopOs(ua: string): string {
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'unknown'
}

function readArchitecture(ua: string): string {
  if (/aarch64|arm64/i.test(ua)) return 'arm64'
  if (/armv7|armeabi/i.test(ua)) return 'arm32'
  if (/x86_64|Win64|x64/i.test(ua)) return 'x86_64'
  return 'unknown'
}

function readDeviceMemoryMb() {
  const nav = globalThis.navigator as unknown as { deviceMemory?: number } | undefined
  const gb = nav?.deviceMemory
  if (typeof gb !== 'number' || !Number.isFinite(gb)) {
    return unknown('navigator.deviceMemory is unavailable in this WebView.')
  }
  return {
    value: gb * 1024,
    confidence: 'ESTIMATED' as const,
    note: 'navigator.deviceMemory is rounded to a power of two and is capped at 8 GB '
      + 'by the browser, so a 12 GB device still reports 8.',
  }
}

/** Short badge text for the UI. */
export function environmentBadge(device: DeviceInfo): string {
  return device.platform === 'android' ? 'DEVICE BENCHMARK' : 'DESKTOP BENCHMARK'
}

/** The warning that must accompany every desktop run. */
export const DESKTOP_WARNING =
  'DESKTOP BENCHMARK — measured in a desktop browser, not on a phone. These numbers '
  + 'say nothing about device performance and must not be quoted as if they did. '
  + 'Run the Android build on real hardware for meaningful figures.'
