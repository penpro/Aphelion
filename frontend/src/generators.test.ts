import { describe, it, expect } from 'vitest'
import { stripCodeFences } from './generators'

describe('stripCodeFences', () => {
  it('leaves plain (unfenced) text untouched', () => {
    expect(stripCodeFences('= Title\n\nbody text')).toBe('= Title\n\nbody text')
  })
  it('extracts the first fenced block, dropping surrounding prose', () => {
    expect(stripCodeFences('Here you go:\n```html\n<p>hi</p>\n```\nEnjoy!')).toBe('<p>hi</p>')
  })
  it('handles an unlabeled fence', () => {
    expect(stripCodeFences('```\nraw content\n```')).toBe('raw content')
  })
})
