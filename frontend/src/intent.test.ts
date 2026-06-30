import { describe, it, expect } from 'vitest'
import {
  looksActionable,
  buildClassifierPrompt,
  parseClassification,
  isActionable,
  describeIntent,
  normalizeDocFormat,
  INTENTS,
  MIN_CONFIDENCE,
  type Classification,
} from './intent'

describe('looksActionable (Quick-mode gate)', () => {
  it('flags tool-like phrasing', () => {
    expect(looksActionable('search my folder for cats and make a pdf')).toBe(true)
    expect(looksActionable('open index.html and fix the header')).toBe(true)
    expect(looksActionable('generate a python script')).toBe(true)
  })
  it('ignores ordinary chat', () => {
    expect(looksActionable('what is the capital of France?')).toBe(false)
    expect(looksActionable('explain how photosynthesis works')).toBe(false)
  })
  it('is empty-safe', () => {
    expect(looksActionable('')).toBe(false)
  })
})

describe('buildClassifierPrompt', () => {
  it('lists every intent id and embeds the user text + JSON contract', () => {
    const p = buildClassifierPrompt('find cats')
    for (const i of INTENTS) expect(p).toContain(i.id)
    expect(p).toContain('find cats')
    expect(p).toContain('"intent"')
    expect(p).toContain('"confidence"')
  })
  it('neutralizes triple quotes in the user text', () => {
    expect(() => buildClassifierPrompt('a """ b')).not.toThrow()
    expect(buildClassifierPrompt('a """ b')).toContain('User message:')
  })
})

describe('parseClassification', () => {
  it('parses a clean object', () => {
    const c = parseClassification('{"intent":"find_images_pdf","confidence":0.9,"params":{"criterion":"cats"},"clarify":""}')
    expect(c).toEqual({ intent: 'find_images_pdf', confidence: 0.9, params: { criterion: 'cats' }, clarify: '' })
  })
  it('tolerates a code fence and surrounding prose', () => {
    const raw = 'Sure!\n```json\n{"intent":"generate_document","confidence":0.7,"params":{"format":"pdf"}}\n```'
    const c = parseClassification(raw)
    expect(c?.intent).toBe('generate_document')
    expect(c?.params.format).toBe('pdf')
  })
  it('rejects an unknown intent', () => {
    expect(parseClassification('{"intent":"launch_missiles","confidence":1}')).toBeNull()
  })
  it('rejects non-JSON (caller falls back to chat)', () => {
    expect(parseClassification('I think you want to find cats.')).toBeNull()
  })
  it('clamps confidence and coerces params to strings', () => {
    const c = parseClassification('{"intent":"chat","confidence":5,"params":{"n":3}}')
    expect(c?.confidence).toBe(1)
    expect(c?.params.n).toBe('3')
  })
  it('defaults confidence to 0 and params to {} when missing', () => {
    const c = parseClassification('{"intent":"chat"}')
    expect(c?.confidence).toBe(0)
    expect(c?.params).toEqual({})
    expect(c?.clarify).toBe('')
  })
})

describe('isActionable (suggestion gate)', () => {
  const mk = (over: Partial<Classification>): Classification => ({
    intent: 'find_images_pdf',
    confidence: 0.9,
    params: {},
    clarify: '',
    ...over,
  })
  it('is true for a confident non-chat intent', () => {
    expect(isActionable(mk({}))).toBe(true)
  })
  it('is false for chat, low confidence, or null', () => {
    expect(isActionable(mk({ intent: 'chat' }))).toBe(false)
    expect(isActionable(mk({ confidence: MIN_CONFIDENCE - 0.01 }))).toBe(false)
    expect(isActionable(null)).toBe(false)
  })
})

describe('describeIntent', () => {
  it('includes the label and the primary extracted param', () => {
    const s = describeIntent({ intent: 'find_images_pdf', confidence: 1, params: { criterion: 'cats' }, clarify: '' })
    expect(s).toContain('Find images')
    expect(s).toContain('cats')
  })
})

describe('normalizeDocFormat', () => {
  it('maps format words and aliases to ids', () => {
    expect(normalizeDocFormat('PDF')).toBe('pdf')
    expect(normalizeDocFormat('a python script')).toBe('py')
    expect(normalizeDocFormat('markdown')).toBe('md')
    expect(normalizeDocFormat('an HTML page')).toBe('html')
    expect(normalizeDocFormat('JavaScript')).toBe('js')
  })
  it('returns undefined for unknown or empty input', () => {
    expect(normalizeDocFormat('hieroglyphics')).toBeUndefined()
    expect(normalizeDocFormat('')).toBeUndefined()
    expect(normalizeDocFormat(undefined)).toBeUndefined()
  })
})
