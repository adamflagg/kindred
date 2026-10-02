import { describe, expect, it } from 'vitest'

import { readCapacity } from './capacityModel'

describe('readCapacity (CapacitySet: 0 to 5,000)', () => {
  it('reads a whole number of places, commas grouping thousands', () => {
    expect(readCapacity(' 120 ')).toEqual({ ok: true, value: 120 })
    expect(readCapacity('1,200')).toEqual({ ok: true, value: 1200 })
    expect(readCapacity('0')).toEqual({ ok: true, value: 0 })
  })

  it("refuses what the server would, in staff's words", () => {
    expect(readCapacity('12.5')).toEqual({ ok: false, reason: 'A whole number of places' })
    expect(readCapacity('1,20')).toEqual({ ok: false, reason: 'A whole number of places' })
    expect(readCapacity('5001')).toEqual({ ok: false, reason: 'At most 5,000' })
  })
})
