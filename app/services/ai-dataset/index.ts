/**
 * SYSTEMA — AI dataset entry point (Phase 28).
 *
 * Picks the persistence backend once, at startup:
 *
 *   · On device, Room via the AiDataset plugin — the source of truth.
 *   · Everywhere else (web dev, tests), the in-memory gateway, which
 *     reports `durable: false` so the UI can warn that nothing is
 *     being saved.
 *
 * The fallback is explicit and visible. Silently degrading to a
 * volatile store would let someone spend an hour labeling tracks in a
 * browser and lose all of it on refresh.
 */

import type { DatasetGateway } from './datasetGateway'
import { setDatasetGateway } from './datasetService'
import { MemoryDatasetGateway } from './memoryGateway'
import { NativeDatasetGateway, isNativeDatasetAvailable } from './nativeGateway'

let initialised = false
let active: DatasetGateway | null = null

/**
 * Selects and installs the gateway.
 *
 * Safe to call repeatedly; only the first call decides.
 */
export async function initDataset(): Promise<DatasetGateway> {
  if (initialised && active) return active

  let gateway: DatasetGateway = new MemoryDatasetGateway()

  if (isNativeDatasetAvailable()) {
    const native = new NativeDatasetGateway()
    // Ask the plugin rather than trusting the platform check alone: an
    // older APK may not carry the dataset table yet.
    if (await native.isAvailable()) gateway = native
  }

  setDatasetGateway(gateway)
  active = gateway
  initialised = true
  return gateway
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
