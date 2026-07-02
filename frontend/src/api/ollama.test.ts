import { describe, it, expect } from 'vitest'
import { samplerBody, samplerFromSettings } from './ollama'
import { defaultSettings } from '../seed'

// The one-shot classifier tests live in classifiers.test.ts (they moved with the functions).

describe('samplerBody', () => {
  it('maps camelCase knobs to llama.cpp snake_case', () => {
    expect(samplerBody({ topK: 40, minP: 0.05 })).toEqual({ top_k: 40, min_p: 0.05 })
  })
  it('drops a negative seed (engine randomizes) but keeps a real one', () => {
    expect(samplerBody({ seed: -1 })).toEqual({})
    expect(samplerBody({ seed: 7 })).toEqual({ seed: 7 })
  })
  it('returns an empty object for no params', () => {
    expect(samplerBody(undefined)).toEqual({})
  })
})

describe('samplerFromSettings', () => {
  it('pulls the sampler knobs out of Settings', () => {
    const sp = samplerFromSettings({ ...defaultSettings, topK: 99 })
    expect(sp.topK).toBe(99)
    expect(sp.minP).toBe(defaultSettings.minP)
    expect(sp.seed).toBe(defaultSettings.seed)
  })
})
