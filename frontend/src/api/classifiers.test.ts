import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyImage,
  classifyPortraitSet,
  describePortrait,
  pickPortrait,
  tagPortrait,
  updateSceneState,
  sceneStateLine,
  EMPTY_SCENE,
} from './classifiers'

afterEach(() => vi.unstubAllGlobals())

// Stub fetch with a fake completion that echoes `content`.
const stub = (content: string, ok = true) => {
  const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) }))
  vi.stubGlobal('fetch', f)
  return f
}

describe('classifyImage', () => {
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
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://x/v1/chat/completions')
    const body = JSON.parse(init.body as string)
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
  it('trims quotes/whitespace and collapses runs', async () => {
    stub('  "a red evening gown,   hair down"  ')
    expect(await describePortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('a red evening gown, hair down')
  })

  it('returns empty string on a non-ok response', async () => {
    stub('x', false)
    expect(await describePortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('')
  })
})

describe('tagPortrait', () => {
  it('flattens newline-separated keywords into one comma list', async () => {
    stub('smiling\nred dress\n  hair down ')
    expect(await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('smiling, red dress, hair down')
  })

  it('uses the vision model, demands colors, and attaches the image', async () => {
    const f = stub('calm, cloak')
    await tagPortrait('http://x/v1', 'data:image/png;base64,ZZZ', 'Mara')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('vision')
    const parts = body.messages[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(parts.find((p) => p.type === 'text')?.text).toContain('COLOR IS CRITICAL')
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,ZZZ')
  })

  it('returns empty string on a non-ok response', async () => {
    stub('x', false)
    expect(await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).toBe('')
  })
})

describe('pickPortrait', () => {
  const entries = [
    { file: 'casual.png', tags: 'relaxed, jeans, t-shirt' },
    { file: 'red-dress.png', tags: 'elegant, red evening gown' },
    { file: 'armor.png', tags: 'fierce, steel plate armor' },
  ]

  it('returns null without calling the model when there are fewer than 2 entries', async () => {
    const f = stub('1')
    expect(await pickPortrait('http://x/v1', { name: 'A' }, [entries[0]], undefined, 'text')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('maps the answered number to that file', async () => {
    stub('2')
    expect(await pickPortrait('http://x/v1', { name: 'A' }, entries, 'casual.png', 'she slips into the red dress')).toBe('red-dress.png')
  })

  it('parses a number out of stray prose', async () => {
    stub('Portrait 3 fits best.')
    expect(await pickPortrait('http://x/v1', { name: 'A' }, entries, undefined, 'battle')).toBe('armor.png')
  })

  it('returns null on an out-of-range or unparseable answer', async () => {
    stub('9')
    expect(await pickPortrait('http://x/v1', { name: 'A' }, entries, undefined, 't')).toBeNull()
    stub('none of these')
    expect(await pickPortrait('http://x/v1', { name: 'A' }, entries, undefined, 't')).toBeNull()
  })

  it('sends the index + current file + scene text to the intent model', async () => {
    const f = stub('1')
    await pickPortrait('http://x/v1', { name: 'Mara' }, entries, 'red-dress.png', 'RECENT-MARKER')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('intent')
    const prompt = body.messages[0].content as string
    expect(prompt).toContain('red evening gown')
    expect(prompt).toContain('RECENT-MARKER')
    expect(prompt).toContain('CURRENTLY SHOWING: 2 (red-dress.png)')
  })

  it('returns null on a non-ok response (caller keeps the current portrait)', async () => {
    stub('2', false)
    expect(await pickPortrait('http://x/v1', { name: 'A' }, entries, undefined, 't')).toBeNull()
  })
})

describe('updateSceneState', () => {
  const prev = { outfit: 'white lingerie', hair: 'hair down', emotion: 'affectionate', pose: 'lounging', props: '', location: 'bedroom' }

  it('parses the returned JSON into a state', async () => {
    stub('{"outfit":"black lace lingerie","hair":"hair down","emotion":"affectionate","pose":"standing","props":"","location":"bedroom"}')
    const s = await updateSceneState('http://x/v1', { name: 'Anya' }, prev, 'put on the black lingerie', '*she changes*')
    expect(s).toEqual({ outfit: 'black lace lingerie', hair: 'hair down', emotion: 'affectionate', pose: 'standing', props: '', location: 'bedroom' })
  })

  it('keeps previous values for missing/non-string fields', async () => {
    stub('{"outfit":"red dress","emotion":"happy"}')
    const s = await updateSceneState('http://x/v1', { name: 'A' }, prev, 'u', 'r')
    expect(s!.outfit).toBe('red dress')
    expect(s!.emotion).toBe('happy')
    expect(s!.hair).toBe('hair down') // carried
    expect(s!.location).toBe('bedroom') // carried
  })

  it('constrains emotion to the 8 labels, keeping the previous one otherwise', async () => {
    stub('{"outfit":"x","emotion":"wry amusement"}')
    const s = await updateSceneState('http://x/v1', { name: 'A' }, prev, 'u', 'r')
    expect(s!.emotion).toBe('affectionate') // "wry amusement" isn't a label → carry previous
  })

  it('sends the previous state and the exchange in the prompt', async () => {
    const f = stub('{}')
    await updateSceneState('http://x/v1', { name: 'Anya' }, prev, 'USER-MARKER', 'REPLY-MARKER')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).messages[0].content as string
    expect(prompt).toContain('white lingerie')
    expect(prompt).toContain('USER-MARKER')
    expect(prompt).toContain('REPLY-MARKER')
  })

  it('returns null on garbage or a non-ok response', async () => {
    stub('no json here at all')
    expect(await updateSceneState('http://x/v1', { name: 'A' }, prev, 'u', 'r')).toBeNull()
    stub('{}', false)
    expect(await updateSceneState('http://x/v1', { name: 'A' }, prev, 'u', 'r')).toBeNull()
  })
})

describe('sceneStateLine', () => {
  it('renders only the filled fields', () => {
    expect(sceneStateLine({ ...EMPTY_SCENE, outfit: 'red dress', emotion: 'happy' })).toBe('wearing: red dress; feeling: happy')
  })
  it('is empty for an empty state', () => {
    expect(sceneStateLine(EMPTY_SCENE)).toBe('')
  })
})
