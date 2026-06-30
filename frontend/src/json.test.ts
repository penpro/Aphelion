import { describe, it, expect } from 'vitest'
import { extractJSON } from './json'

describe('extractJSON', () => {
  it('parses plain JSON', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 })
  })
  it('extracts JSON from a code fence', () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('ignores leading and trailing prose', () => {
    expect(extractJSON('Sure!\n{"a":[1,2]}\nDone.')).toEqual({ a: [1, 2] })
  })
  it('handles closing braces inside strings', () => {
    expect(extractJSON('{"k":"a } b"}')).toEqual({ k: 'a } b' })
  })
  it('returns null on non-JSON / empty input', () => {
    expect(extractJSON('no json here')).toBeNull()
    expect(extractJSON('')).toBeNull()
  })
})
