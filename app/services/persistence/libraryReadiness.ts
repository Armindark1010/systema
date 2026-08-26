// ============================================================
// SYSTEMA — library readiness (Phase 4.1)
// ============================================================
// One small question, asked in one place: is the track index in a
// state where "this id does not resolve" actually means the track is
// gone?
//
// This exists because playback restoration got that question wrong. It
// read `library.tracks` during a cold start, found an empty array, and
// concluded every saved track had been deleted — then cleared the
// saved session. The library was simply still loading.
//
// The three states below are deliberately distinct, because the
// correct response to each is different:
//
//   LOADING  -> wait. Say nothing about whether tracks exist.
//   READY    -> answers are trustworthy; a missing id really is gone.
//   FAILED   -> we know nothing. Never destroy anything on this basis.
//
// Pure and dependency-free so the restore rules can be unit-tested
// without Vue, Capacitor or a device.
// ============================================================

export type LibraryReadiness = 'loading' | 'ready' | 'failed'

/** Mirrors the value held by the library store. */
export type LibraryPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'prompt-with-rationale'

export interface LibraryReadinessInput {
  /** False in the browser: the mock catalog is present from the start. */
  isNativeLibrary: boolean
  /** True while the store is fetching (scan or first page). */
  isLoading: boolean
  /** True once a native page has actually been written into the store. */
  nativeDataLoaded: boolean
  /** Set when init or a scan failed. */
  hasError: boolean
  /**
   * The library store's permission verdict, verbatim:
   * 'unknown' | 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'.
   * Pass null in the browser.
   */
  permissionStatus?: LibraryPermissionStatus | null
}

/**
 * Classifies the library.
 *
 * Order matters. A permission denial and an error are both terminal —
 * they are reported before "loading", because a store that failed can
 * sit with `isLoading: false` forever and waiting on it would hang.
 */
export function classifyLibraryReadiness(input: LibraryReadinessInput): LibraryReadiness {
  // The browser's mock catalog is synchronously available.
  if (!input.isNativeLibrary) return 'ready'

  // A denied permission is not transient: the library will never
  // populate until the user changes it in Settings. Classified FAILED
  // rather than READY so nothing concludes "the tracks are gone" and
  // deletes a session over it — and rather than LOADING, which would
  // leave the restore waiting forever.
  if (input.permissionStatus === 'denied') return 'failed'

  if (input.hasError) return 'failed'

  // 'unknown' means the check has not returned yet, and the two
  // 'prompt' values mean the user has not answered. Both are genuinely
  // in-progress, so wait rather than guess — waiting is always safe
  // because it never deletes anything.
  if (
    input.permissionStatus === 'unknown'
    || input.permissionStatus === 'prompt'
    || input.permissionStatus === 'prompt-with-rationale'
  ) {
    // Unless data already landed, in which case the library is usable
    // regardless of what the permission ref currently says.
    if (!input.nativeDataLoaded) return 'loading'
  }

  // A native page has landed. Note this stays true even if that page
  // came back empty — an empty device really is an empty library.
  if (input.nativeDataLoaded) return 'ready'

  if (input.isLoading) return 'loading'

  // Not loading, no data, no error: init has not started yet (the
  // plugin hook runs after the store is constructed). Still loading
  // from the caller's point of view.
  return 'loading'
}

/** True only when a "no such track" answer can be trusted. */
export function isLibraryAuthoritative(readiness: LibraryReadiness): boolean {
  return readiness === 'ready'
}
