import { describe, expect, it } from 'vitest'

import { frozenFact } from './leadWords'

describe('frozenFact names the version an edit starts (owner 2026-10-14)', () => {
  it('names the number the server says comes next: after v4 was discarded, v3 in effect starts v5, not v4', () => {
    expect(frozenFact('draft', 3, 3, 5)).toBe('frozen · an edit starts v5')
  })

  it('names the version after the draft when no discard spent a number', () => {
    expect(frozenFact('draft', 4, 4, 5)).toBe('frozen · an edit starts v5')
  })
})
