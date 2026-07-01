import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyImage, classifyPortraitSet, describePortrait, samplerBody, samplerFromSettings } from './ollama'
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

describe('classifyPortraitSet', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (content: string, ok = true) => {
    const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) }))
    vi.stubGlobal('fetch', f)
    return f
  }
  const sets = [
    { id: 'a', name: 'Casual', description: 'jeans and a t-shirt' },
    { id: 'b', name: 'Red dress', description: 'a red evening gown' },
    { id: 'c', name: 'Armor', description: 'steel plate armor' },
  ]

  it('returns null without calling the model when there are fewer than 2 sets', async () => {
    const f = stub('1')
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, [sets[0]], 'a', 'text')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('maps the answered number to that set id', async () => {
    stub('2')
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, sets, 'a', 'she slips into the red dress')).toBe('b')
  })

  it('parses a number out of stray prose', async () => {
    stub('Look 3.')
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, sets, 'a', 'she buckles on her armor')).toBe('c')
  })

  it('returns null on an out-of-range or unparseable answer', async () => {
    stub('9')
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, sets, 'a', 't')).toBeNull()
    stub('none')
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, sets, 'a', 't')).toBeNull()
  })

  it('sends the set list + recent text and uses the intent model', async () => {
    const f = stub('1')
    await classifyPortraitSet('http://x/v1', { name: 'Mara' }, sets, 'b', 'RECENT-STORY-MARKER')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('intent')
    const prompt = body.messages[0].content as string
    expect(prompt).toContain('Red dress')
    expect(prompt).toContain('RECENT-STORY-MARKER')
    expect(prompt).toContain('CURRENTLY SHOWING: look 2')
  })

  it('returns null on a non-ok response (caller keeps the current look)', async () => {
    stub('2', false)
    expect(await classifyPortraitSet('http://x/v1', { name: 'A' }, sets, 'a', 't')).toBeNull()
  })
})

describe('describePortrait', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (content: string, ok = true) => {
    const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('trims quotes/whitespace and collapses runs', async () => {
    stub('  "a red evening gown,   hair down"  ')
    expect(await describePortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('a red evening gown, hair down')
  })

  it('returns empty string on a non-ok response', async () => {
    stub('x', false)
    expect(await describePortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('')
  })
})
