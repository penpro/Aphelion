import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyImage,
  classifyPortraitSet,
  describePortrait,
  rankPortraits,
  tagPortrait,
  trackTurn,
  sceneStateLine,
  EMPTY_SCENE,
  DEFAULT_STATS,
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
    expect((await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).tags).toBe('smiling, red dress, hair down')
  })

  it('parses the trailing PAD rating into an expression and strips it from the tags', async () => {
    stub('wry smile, black gown, hair up | P:62 E:41 D:74')
    const r = await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')
    expect(r.tags).toBe('wry smile, black gown, hair up')
    expect(r.expression).toEqual({ pleasure: 62, energy: 41, dominance: 74 })
  })

  it('tolerates a missing PAD rating (expression undefined)', async () => {
    stub('calm, cloak')
    const r = await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')
    expect(r.tags).toBe('calm, cloak')
    expect(r.expression).toBeUndefined()
  })

  it('uses the vision model, demands colors + PAD axes, and attaches the image', async () => {
    const f = stub('calm, cloak | P:50 E:20 D:50')
    await tagPortrait('http://x/v1', 'data:image/png;base64,ZZZ', 'Mara')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('vision')
    const parts = body.messages[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(parts.find((p) => p.type === 'text')?.text).toContain('COLOR IS CRITICAL')
    expect(parts.find((p) => p.type === 'text')?.text).toContain('P:<n> E:<n> D:<n>')
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,ZZZ')
  })

  it('returns empty tags on a non-ok response', async () => {
    stub('x', false)
    expect((await tagPortrait('http://x/v1', 'data:image/png;base64,AAA', 'Mara')).tags).toBe('')
  })
})

describe('rankPortraits', () => {
  const entries = [
    { file: 'casual.png', tags: 'relaxed, jeans, t-shirt', expression: { pleasure: 55, energy: 30, dominance: 45 } },
    { file: 'red-dress.png', tags: 'elegant, red evening gown', expression: { pleasure: 65, energy: 50, dominance: 60 } },
    { file: 'armor.png', tags: 'fierce, steel plate armor' },
  ]

  it('returns null without calling the model when there are fewer than 2 entries', async () => {
    const f = stub('1 | relaxed')
    expect(await rankPortraits('http://x/v1', { name: 'A' }, [entries[0]], undefined, 'text', undefined, undefined)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('parses the ranked answer into ordered files + driving tags', async () => {
    stub('2,3,1 | red evening gown, elegant')
    const r = await rankPortraits('http://x/v1', { name: 'A' }, entries, 'casual.png', 'she slips into the red dress', undefined, undefined)
    expect(r!.files).toEqual(['red-dress.png', 'armor.png', 'casual.png'])
    expect(r!.drivers).toEqual(['red evening gown', 'elegant'])
  })

  it('dedupes repeats, drops out-of-range numbers, tolerates a missing drivers part', async () => {
    stub('2, 2, 9, 3')
    const r = await rankPortraits('http://x/v1', { name: 'A' }, entries, undefined, 't', undefined, undefined)
    expect(r!.files).toEqual(['red-dress.png', 'armor.png'])
    expect(r!.drivers).toEqual([])
  })

  it('returns null when no valid number appears', async () => {
    stub('none of these fit')
    expect(await rankPortraits('http://x/v1', { name: 'A' }, entries, undefined, 't', undefined, undefined)).toBeNull()
  })

  it('sends PAD axes, the moment expression, trained bias, and the ranked rules', async () => {
    const f = stub('1 | relaxed')
    await rankPortraits(
      'http://x/v1',
      { name: 'Mara' },
      entries,
      'red-dress.png',
      'RECENT-MARKER',
      { pleasure: 50, energy: 85, dominance: 80 },
      { avoid: ['fierce'], favor: ['wry smile'] },
    )
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('intent')
    const prompt = body.messages[0].content as string
    expect(prompt).toContain('[P:65 E:50 D:60]') // per-portrait axes
    expect(prompt).toContain('pleasure 50, energy 85, dominance 80') // the moment
    expect(prompt).toContain('DO NOT let these tags drive the choice')
    expect(prompt).toContain('fierce')
    expect(prompt).toContain('favor portraits whose match rests on: wry smile')
    expect(prompt).toContain('CURRENTLY SHOWING: 2 (red-dress.png)')
    expect(prompt).toContain('RECENT-MARKER')
    // ranked rules, in priority order, axes-first
    expect(prompt).toContain('1. EXPRESSION AXES')
    expect(prompt).toContain('anger requires LOW')
    expect(prompt).toContain('MAKE SENSE for the location')
    expect(prompt.indexOf('1. EXPRESSION AXES')).toBeLessThan(prompt.indexOf('2. OUTFIT'))
    expect(prompt.indexOf('2. OUTFIT')).toBeLessThan(prompt.indexOf('4. POSE'))
  })

  it('returns null on a non-ok response (caller keeps the current portrait)', async () => {
    stub('2 | x', false)
    expect(await rankPortraits('http://x/v1', { name: 'A' }, entries, undefined, 't', undefined, undefined)).toBeNull()
  })
})

describe('trackTurn', () => {
  const prevScene = { outfit: 'white lingerie', hair: 'hair down', emotion: 'affectionate', pose: 'lounging', props: '', location: 'bedroom' }
  const prevStats = { ...DEFAULT_STATS, arousal: 40, trust: 60 }

  it('parses the combined JSON into scene + stats', async () => {
    stub(
      '{"scene":{"outfit":"black lace lingerie","hair":"hair down","emotion":"affectionate","pose":"standing","props":"","location":"bedroom"},' +
        '"stats":{"arousal":55,"affection":50,"trust":60,"anger":0,"fear":5,"joy":45,"sadness":0,"confidence":60,"openness":35,"energy":60}}',
    )
    const r = await trackTurn('http://x/v1', { name: 'Anya' }, prevScene, prevStats, 'put on the black lingerie', '*she changes*')
    expect(r!.scene.outfit).toBe('black lace lingerie')
    expect(r!.scene.pose).toBe('standing')
    expect(r!.stats.arousal).toBe(55)
    expect(r!.stats.openness).toBe(35)
  })

  it('carries previous values for missing scene fields and missing stats', async () => {
    stub('{"scene":{"outfit":"red dress","emotion":"happy"},"stats":{"arousal":70}}')
    const r = await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')
    expect(r!.scene.outfit).toBe('red dress')
    expect(r!.scene.hair).toBe('hair down') // carried
    expect(r!.stats.arousal).toBe(70)
    expect(r!.stats.trust).toBe(60) // carried
  })

  it('clamps stats to 0-100 integers and constrains emotion to the 8 labels', async () => {
    stub('{"scene":{"emotion":"wry amusement"},"stats":{"arousal":250,"anger":-5,"joy":33.7}}')
    const r = await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')
    expect(r!.scene.emotion).toBe('affectionate') // not a label → carry previous
    expect(r!.stats.arousal).toBe(100)
    expect(r!.stats.anger).toBe(0)
    expect(r!.stats.joy).toBe(34)
  })

  it('parses the moment expression (PAD), leaving it undefined when absent or partial', async () => {
    stub('{"scene":{},"stats":{},"expression":{"pleasure":48,"energy":85,"dominance":77}}')
    const r = await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')
    expect(r!.expression).toEqual({ pleasure: 48, energy: 85, dominance: 77 })
    stub('{"scene":{},"stats":{},"expression":{"pleasure":48}}')
    const r2 = await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')
    expect(r2!.expression).toBeUndefined()
  })

  it('sends personality, both previous states, the exchange, and the anti-puppeting rule', async () => {
    const f = stub('{}')
    await trackTurn('http://x/v1', { name: 'Anya', personality: 'PERSONA-MARKER' }, prevScene, prevStats, 'USER-MARKER', 'REPLY-MARKER')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).messages[0].content as string
    expect(prompt).toContain('PERSONA-MARKER')
    expect(prompt).toContain('white lingerie')
    expect(prompt).toContain('"trust":60')
    expect(prompt).toContain('USER-MARKER')
    expect(prompt).toContain('REPLY-MARKER')
    expect(prompt).toContain('ground truth')
  })

  it('returns null on garbage or a non-ok response', async () => {
    stub('no json here at all')
    expect(await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')).toBeNull()
    stub('{}', false)
    expect(await trackTurn('http://x/v1', { name: 'A' }, prevScene, prevStats, 'u', 'r')).toBeNull()
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
