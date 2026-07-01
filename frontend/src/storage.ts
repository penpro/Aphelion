import type { StateStorage } from 'zustand/middleware'

// The persisted store lives in localStorage under this key. It is the single blob the whole app
// rehydrates from, so writing it must never throw (quota) and reading it must never crash (corrupt).
export const STORE_KEY = 'localllm-roleplay-studio'

// --- tiny pub/sub so a persist failure (outside React) can surface a banner inside React ---
type Listener = (message: string | null) => void
let listeners: Listener[] = []
let current: string | null = null

export function subscribeStorageError(fn: Listener): () => void {
  listeners.push(fn)
  fn(current)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}
function emit(message: string | null) {
  current = message
  for (const l of listeners) l(message)
}

const isQuota = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)

/**
 * A localStorage wrapper that never throws:
 *  - setItem quota failure surfaces a user-facing warning instead of silently dropping the write,
 *  - getItem returns null on corrupt/unreadable JSON so the app boots on defaults, not a white screen.
 */
export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const v = localStorage.getItem(name)
      if (v == null) return null
      JSON.parse(v) // validate — corrupt JSON falls through to null (boot on defaults)
      return v
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
      if (current) emit(null) // a previous failure has recovered (user freed space)
    } catch (e) {
      emit(
        isQuota(e)
          ? 'Your data is too large to save — local storage is full. Export a backup, then remove some portrait sets or old chats.'
          : 'Your data could not be saved to local storage.',
      )
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

/** The full persisted blob, for the Export backup button. */
export function exportData(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? '{}'
  } catch {
    return '{}'
  }
}
