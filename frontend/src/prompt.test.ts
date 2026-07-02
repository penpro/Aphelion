import { describe, it, expect } from 'vitest'
import { substituteMacros, sourcesBlock, statsBlock, autonomyBlock, buildSystemPrompt } from './prompt'
import { DEFAULT_STATS, EMPTY_SCENE } from './api/classifiers'
import type { Character } from './types'

describe('substituteMacros', () => {
  it('replaces {{char}} / {{user}} (case-insensitive) and <BOT>/<USER>', () => {
    expect(substituteMacros('Hi {{char}}, I am {{user}}.', 'Aria', 'Wes')).toBe('Hi Aria, I am Wes.')
    expect(substituteMacros('{{CHAR}} <BOT> meets <USER>', 'Aria', 'Wes')).toBe('Aria Aria meets Wes')
  })
  it('returns empty string for empty input', () => {
    expect(substituteMacros('', 'A', 'B')).toBe('')
  })
})

describe('sourcesBlock', () => {
  it('returns empty when there are no sources', () => {
    expect(sourcesBlock()).toBe('')
    expect(sourcesBlock([])).toBe('')
  })
  it('skips sources whose text is blank', () => {
    expect(sourcesBlock([{ id: '1', name: 'X', text: '   ' }])).toBe('')
  })
  it('formats sources under a Reference material header', () => {
    const out = sourcesBlock([{ id: '1', name: 'Lore', text: 'A fact.' }])
    expect(out).toContain('# Reference material')
    expect(out).toContain('### Lore')
    expect(out).toContain('A fact.')
  })
})

const char = (partial: Partial<Character>): Character => ({
  id: 'c1',
  name: 'Anya',
  avatar: '🙂',
  color: '#7c5cff',
  description: '',
  personality: 'wry, guarded',
  scenario: '',
  exampleDialogue: '',
  systemPrompt: '',
  createdAt: 1,
  ...partial,
})
const persona = { name: 'Wes', description: '' }

describe('statsBlock', () => {
  it('renders all ten levers as percentages with the anchor rules', () => {
    const b = statsBlock('Anya', { ...DEFAULT_STATS, arousal: 65, anger: 10 })
    expect(b).toContain('arousal 65%')
    expect(b).toContain('anger 10%')
    expect(b).toContain('EARNED')
    expect(b).toContain('not absent')
  })
  it('is empty without stats', () => {
    expect(statsBlock('Anya', undefined)).toBe('')
  })
})

describe('autonomyBlock', () => {
  it('is empty when off and names both parties when on', () => {
    expect(autonomyBlock('Anya', 'Wes', false)).toBe('')
    const b = autonomyBlock('Anya', 'Wes', true)
    expect(b).toContain('Wes does not control Anya')
    expect(b).toContain('until Anya does it')
  })
})

describe('buildSystemPrompt wiring', () => {
  it('includes scene state, stats, and autonomy blocks when provided', () => {
    const sys = buildSystemPrompt([char({})], persona, {
      sceneState: { ...EMPTY_SCENE, outfit: 'black lace lingerie' },
      stats: { ...DEFAULT_STATS, arousal: 65 },
      autonomy: true,
    })
    expect(sys).toContain('Wearing: black lace lingerie')
    expect(sys).toContain('arousal 65%')
    expect(sys).toContain('does not control Anya')
  })
  it('omits them all by default', () => {
    const sys = buildSystemPrompt([char({})], persona, {})
    expect(sys).not.toContain('internal state')
    expect(sys).not.toContain('does not control')
    expect(sys).not.toContain('Live scene state')
  })
})
