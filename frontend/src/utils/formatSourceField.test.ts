import { describe, it, expect } from 'vitest'
import { formatSourceField } from './formatSourceField'

describe('formatSourceField', () => {
  describe('validator stats keys (bunking_validator.py output)', () => {
    it.each([
      ['share_bunk_with', 'Bunk Request Form'],
      ['do_not_share_with', 'Do NOT Share Bunk With'],
      ['bunking_notes', 'Bunking Notes'],
      ['internal_notes', 'Internal Notes'],
      ['socialize_with', 'Social With Checkbox'],
    ])('maps %s -> %s', (input, expected) => {
      expect(formatSourceField(input)).toBe(expected)
    })
  })

  describe('DB wire values (SourceField constants)', () => {
    it.each([
      ['bunk_request_form', 'Bunk Request Form'],
      ['staff_not_bunk_with', 'Do NOT Share Bunk With'],
    ])('maps %s -> %s', (input, expected) => {
      expect(formatSourceField(input)).toBe(expected)
    })
  })

  it('falls through to the raw key for unknown inputs', () => {
    expect(formatSourceField('unknown_field')).toBe('unknown_field')
  })
})
