/**
 * SYSTEMA — AI dataset entry point (Phase 28).
 *
 * Picks the persistence backend once, at startup. The rule differs by
 * platform, deliberately:
 *
 *   · On device, Room via the AiDataset plugin — the source of truth.
 *     If that plugin is missing, the app does NOT quietly substitute a
 *     map; it installs UnavailableDatasetGateway, which fails every
 *     write. On a device, persistence was promised.
 *   · In a browser or a test, the in-memory gateway, which reports
 *     `durable: false` so the UI warns that nothing is being saved.
 *     Nobody expects a device database in `npm run dev`.
 *
 * WHY NOT ONE FALLBACK EVERYWHERE
 * -------------------------------
 * The in-memory gateway accepts writes and returns success. On device
 * that is indistinguishable from working: a user could label their
 * whole library, see SAVED every time, restart the app and find
 * nothing. The point of this phase is collecting data, so a silent
 * write-to-nowhere is the single worst failure mode available. Better
 * to refuse and say why.
 */

import type { DatasetGateway } from './datasetGateway'
import { setDatasetGateway } from './datasetService'
import { MemoryDatasetGateway } from './memoryGateway'
import { NativeDatasetGateway, isNativePlatform, isNativeDatasetAvailable } from './nativeGateway'
import { UnavailableDatasetGateway } from './unavailableGateway'

let initialised = false
let active: DatasetGateway | null = null

/**
 * Selects and installs the gateway.
 *
 * Safe to call repeatedly; only the first call decides.
 */
export async function initDataset(): Promise<DatasetGateway> {
  if (initialised && active) return active

  const gateway = await selectGateway()

  setDatasetGateway(gateway)
  active = gateway
  initialised = true
  return gateway
}

async function selectGateway(): Promise<DatasetGateway> {
  // Not a device: a volatile store is the honest, expected answer.
  if (!isNativePlatform()) return new MemoryDatasetGateway()

  // On a device, Room is the only acceptable backend.
  if (!isNativeDatasetAvailable()) {
    return new UnavailableDatasetGateway(
      'The AiDataset plugin is not registered with the native bridge.',
    )
  }

  const native = new NativeDatasetGateway()
  // Ask the plugin rather than trusting the platform check alone: an
  // older APK may carry the bridge but not the dataset table.
  try {
    if (await native.isAvailable()) return native
  } catch {
    // Fall through to the failure gateway below.
  }

  return new UnavailableDatasetGateway(
    'The AiDataset plugin did not report a usable database.',
  )
}

/**
 * Why persistence is unavailable, or null when it is fine.
 *
 * The page shows this so a broken build is diagnosable without adb.
 */
export function datasetUnavailableReason(): string | null {
  return active instanceof UnavailableDatasetGateway ? active.reason : null
}

/** The active gateway, or null before initDataset() has run. */
export function activeGateway(): DatasetGateway | null {
  return active
}

/** True when writes are being persisted to a real database. */
export function isDatasetDurable(): boolean {
  return active?.durable === true
}

/** Test seam. */
export function __resetDatasetInit(): void {
  initialised = false
  active = null
}

export * from './datasetGateway'
export * from './datasetRecord'
export * from './datasetService'
export * from './datasetStats'
export * from './datasetExport'
export * from './labels'
export * from './unavailableGateway'
