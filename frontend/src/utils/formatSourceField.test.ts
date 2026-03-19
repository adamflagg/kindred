import { describe, it, expect } from 'vitest'
import { formatSourceField } from './formatSourceField'

describe('formatSourceField', () => {
  it.each([
    ['bunk_with', 'Bunk With'],
    ['not_bunk_with', 'Not Bunk With'],
    ['bunking_notes', 'Bunking Notes'],
    ['internal_notes', 'Internal Notes'],
    ['socialize_with', 'Socialize With'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatSourceField(input)).toBe(expected)
  })

  it('passes through unknown values', () => {
    expect(formatSourceField('unknown_field')).toBe('unknown_field')
  })
})
