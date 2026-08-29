// ============================================================
// SYSTEMA — Persistence adapter
// ============================================================
// Centralized storage. Components never touch localStorage.
// Future Capacitor Preferences / native storage implements
// the same StorageAdapter contract.
// ============================================================

export interface StorageAdapter {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const probe = '__systema:probe'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

export function createLocalStorageAdapter(): StorageAdapter {
  return {
    get(key) {
      const storage = safeLocalStorage()
      if (!storage) return null
      try {
        return storage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      const storage = safeLocalStorage()
      if (!storage) return
      try {
        storage.setItem(key, value)
      } catch {
        /* quota / private mode */
      }
    },
    remove(key) {
      const storage = safeLocalStorage()
      if (!storage) return
      try {
        storage.removeItem(key)
      } catch {
        /* ignore */
      }
    },
  }
}

export const SETTINGS_STORAGE_KEY = 'systema:settings'
export const LEGACY_THEME_KEY = 'systema:theme'
export const PLAYLISTS_STORAGE_KEY = 'systema:playlists'
export const FAVORITES_STORAGE_KEY = 'systema:favorites'
/** AI companion conversations. Replaced later by the native AI database. */
export const AI_CONVERSATIONS_STORAGE_KEY = 'systema:ai-conversations'

const memory = new Map<string, string>()

/** In-memory fallback when local storage is blocked. Session only. */
export function createMemoryAdapter(): StorageAdapter {
  return {
    get: key => memory.get(key) ?? null,
    set: (key, value) => { memory.set(key, value) },
    remove: key => { memory.delete(key) },
  }
}

let adapter: StorageAdapter | null = null

export function setStorageAdapter(custom: StorageAdapter | null) {
  adapter = custom
}

export function getStorageAdapter(): StorageAdapter {
  if (adapter) return adapter
  adapter = createLocalStorageAdapter()
  return adapter
}

export function readJSON<T>(key: string): T | null {
  const raw = getStorageAdapter().get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    getStorageAdapter().set(key, JSON.stringify(value))
  } catch {
    /* never throw from persistence */
  }
}

export function removeKey(key: string) {
  getStorageAdapter().remove(key)
}
