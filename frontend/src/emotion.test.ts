import { describe, it, expect } from 'vitest'
import { detectEmotion, buildEmotionArtPrompts, EMOTIONS } from './emotion'

describe('detectEmotion', () => {
  it('returns neutral for empty or toneless text', () => {
    expect(detectEmotion('')).toBe('neutral')
    expect(detectEmotion('The map shows three roads leading north from the village.')).toBe('neutral')
  })

  it('reads happiness', () => {
    expect(detectEmotion('*She smiles warmly and laughs.* "Wonderful to see you!"')).toBe('happy')
  })

  it('reads anger from action beats', () => {
    expect(detectEmotion('*He glares, jaw clenched.* "Get out."')).toBe('angry')
  })

  it('reads sadness', () => {
    expect(detectEmotion('Tears slid down her cheeks as she wept quietly.')).toBe('sad')
  })

  it('reads embarrassment', () => {
    expect(detectEmotion("*Her cheeks flush and she blushes.* \"I-I didn't mean that...\"")).toBe('embarrassed')
  })

  it('weights *action* cues above dialogue', () => {
    // the words say "happy", but the action is angry → the action should win
    expect(detectEmotion('"I\'m so happy," *he snarled, glaring at the door.*')).toBe('angry')
  })
})

describe('buildEmotionArtPrompts', () => {
  it('includes the name, a consistency instruction, and every emotion label', () => {
    const out = buildEmotionArtPrompts({ name: 'Seraphina', description: 'a half-elf ranger with moss-green eyes' })
    expect(out).toContain('Seraphina')
    expect(out).toContain('moss-green eyes')
    expect(out.toUpperCase()).toContain('IDENTICAL')
    for (const e of EMOTIONS) expect(out).toContain(e.label)
  })

  it('handles a missing description without throwing', () => {
    const out = buildEmotionArtPrompts({ name: 'Nyx' })
    expect(out).toContain('Nyx')
    expect(out).toContain('Neutral')
  })

  it('weaves a set name into the prompt as a named look, and omits it when absent', () => {
    const out = buildEmotionArtPrompts({ name: 'Seraphina', description: 'a half-elf ranger' }, 'Hair up')
    expect(out).toContain('Hair up')
    expect(out.toLowerCase()).toContain('look')
    const plain = buildEmotionArtPrompts({ name: 'Seraphina', description: 'a half-elf ranger' })
    expect(plain).not.toContain('VARIANT')
  })
})
