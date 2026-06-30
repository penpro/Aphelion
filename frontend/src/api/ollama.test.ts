import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyImage, samplerBody, samplerFromSettings } from './ollama'
import { defaultSettings } from '../seed'

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

describe('classifyImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Stub fetch with a fake completion that echoes `content`.
  const stub = (content: string, ok = true) => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ choices: [{ message: { content } }] }),
    }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('returns true when the model answers yes', async () => {
    stub('Yes, it does.')
    expect(await classifyImage('http://x/v1', 'data:image/png;base64,AAA', 'a cat')).toBe(true)
  })

  it('returns false when the model answers no', async () => {
    stub('No.')
    expect(await classifyImage('http://x/v1', 'data:image/png;base64,AAA', 'a cat')).toBe(false)
  })

  it('sends the question and image data URL to /chat/completions', async () => {
    const f = stub('yes')
    await classifyImage('http://x/v1', 'data:image/png;base64,ZZZ', 'a red car')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://x/v1/chat/completions')
    const body = JSON.parse(init!.body as string)
    const parts = body.messages[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(parts.find((p) => p.type === 'text')?.text).toContain('a red car')
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,ZZZ')
  })

  it('throws on a non-ok response', async () => {
    stub('', false)
    await expect(classifyImage('http://x/v1', 'data:image/png;base64,AAA', 'x')).rejects.toThrow(/HTTP 500/)
  })
})
