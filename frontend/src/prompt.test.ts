import { describe, it, expect } from 'vitest'
import { substituteMacros, sourcesBlock } from './prompt'

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
