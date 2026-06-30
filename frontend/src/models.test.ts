import { describe, it, expect } from 'vitest'
import { friendlyModelName } from './models'

describe('friendlyModelName', () => {
  it('falls back when empty / null', () => {
    expect(friendlyModelName(null)).toBe('the model')
    expect(friendlyModelName('')).toBe('the model')
  })
  it('cleans a raw gguf filename (path, extension, quant + noise tags)', () => {
    const n = friendlyModelName('/x/y/my-cool-model-7b-instruct-Q4_K_M.gguf')
    expect(n).not.toMatch(/gguf/i)
    expect(n).not.toMatch(/q4/i)
    expect(n).not.toMatch(/instruct/i)
    expect(n).toContain('Cool')
  })
})
