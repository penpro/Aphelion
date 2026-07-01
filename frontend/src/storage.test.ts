import { describe, it, expect, beforeEach } from 'vitest'
import { safeStorage, subscribeStorageError } from './storage'

// Minimal in-memory localStorage so this runs in the default (node) env — no jsdom dependency.
// DOMException is a Node global (v17+), so the quota path exercises the real instanceof check.
function mockLocalStorage(overrides: Partial<Storage> = {}) {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
    ...overrides,
  } as unknown as Storage
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = ls
  return ls
}

const quotaError = () => new DOMException('quota', 'QuotaExceededError')

describe('safeStorage', () => {
  beforeEach(() => mockLocalStorage())

  it('round-trips valid JSON', () => {
    localStorage.setItem('k', '{"a":1}')
    expect(safeStorage.getItem('k')).toBe('{"a":1}')
  })

  it('returns null for corrupt JSON instead of throwing (app boots on defaults)', () => {
    localStorage.setItem('k', '{not valid json')
    expect(safeStorage.getItem('k')).toBeNull()
  })

  it('returns null for a missing key', () => {
    expect(safeStorage.getItem('nope')).toBeNull()
  })

  it('surfaces a warning on quota-exceeded instead of throwing', () => {
    mockLocalStorage({ setItem: () => { throw quotaError() } })
    let msg: string | null = null
    const unsub = subscribeStorageError((m) => (msg = m))
    expect(() => safeStorage.setItem('k', 'v')).not.toThrow()
    expect(String(msg)).toContain('full')
    unsub()
  })

  it('clears the warning once a write succeeds again', () => {
    let failing = true
    mockLocalStorage({
      setItem: () => {
        if (failing) throw quotaError()
      },
    })
    let msg: string | null = null
    const unsub = subscribeStorageError((m) => (msg = m))
    safeStorage.setItem('k', 'v') // fails → warning
    expect(msg).toBeTruthy()
    failing = false
    safeStorage.setItem('k', 'v') // succeeds → warning cleared
    expect(msg).toBeNull()
    unsub()
  })
})
