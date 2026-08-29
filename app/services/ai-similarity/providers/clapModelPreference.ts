/**
 * SYSTEMA — remembers WHICH CLAP model the human chose (Phase 23.1).
 *
 * WHY THIS EXISTS
 * ---------------
 * The native CLAP session is deliberately destroyed in two places:
 * the lab's RELEASE button, and the single-track test when it is asked
 * to `releaseAfter` (which the lab always does, because Phase 21.2
 * requires the test to prove the session is released cleanly).
 *
 * So after a normal lab run the model is IMPORTED and CHOSEN but the
 * native session is gone. Anything that wants to embed later has to
 * load it again — and loading needs a modelId.
 *
 * SYSTEMA never picks a model. This stores the id the human explicitly
 * loaded in the lab, so a later analysis can reload THE SAME model
 * rather than guessing one. If nothing is stored, nothing is loaded,
 * and the caller reports that plainly.
 *
 * This is model-specific state and lives with the CLAP provider. The
 * Full Player never sees it.
 */

/** localStorage key, following the existing `systema:*` convention. */
export const CLAP_MODEL_PREFERENCE_KEY = 'systema:ai-similarity:clap-model'

export interface StorageAdapter {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

function createLocalStorageAdapter(): StorageAdapter {
  return {
    get: (k) => {
      if (typeof localStorage === 'undefined') return null
      try { return localStorage.getItem(k) } catch { return null }
    },
    set: (k, v) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.setItem(k, v) } catch { /* quota */ }
    },
    remove: (k) => {
      if (typeof localStorage === 'undefined') return
      try { localStorage.removeItem(k) } catch { /* nothing useful to do */ }
    },
  }
}

let storage: StorageAdapter = createLocalStorageAdapter()

export function setClapPreferenceStorage(adapter: StorageAdapter): void {
  storage = adapter
}

export function resetClapPreferenceStorage(): void {
  storage = createLocalStorageAdapter()
}

/**
 * Records the model the human loaded in the lab.
 *
 * This is NOT a production selection. It only answers "which file did
 * you last deliberately load?", so a later reload uses that same file
 * instead of choosing one.
 */
export function rememberClapModel(modelId: string | null | undefined): void {
  const id = typeof modelId === 'string' ? modelId.trim() : ''
  if (!id) return
  storage.set(CLAP_MODEL_PREFERENCE_KEY, id)
}

/** The remembered model id, or null when the human has never loaded one. */
export function recallClapModel(): string | null {
  const raw = storage.get(CLAP_MODEL_PREFERENCE_KEY)
  const id = typeof raw === 'string' ? raw.trim() : ''
  return id.length > 0 ? id : null
}

export function forgetClapModel(): void {
  storage.remove(CLAP_MODEL_PREFERENCE_KEY)
}
