import { describe, expect, it } from 'vitest'
import { cityPairKey, withPriorRates } from './retentionCompare'

describe('cityPairKey', () => {
  it('pairs a city with and without its state (CampMinder wrote cities both ways across years)', () => {
    expect(
      cityPairKey({ name: 'Springfield, CA', retentionRate: 0, baseCount: 0, returnedCount: 0 })
    ).toBe(cityPairKey({ name: 'Springfield', retentionRate: 0, baseCount: 0, returnedCount: 0 }))
    const paired = withPriorRates(
      [{ name: 'Springfield, CA', retentionRate: 0.7, baseCount: 50, returnedCount: 35 }],
      [{ name: 'springfield', retentionRate: 0.6, baseCount: 40, returnedCount: 24 }],
      cityPairKey
    )
    expect(paired[0]!.priorRate).toBe(0.6)
  })
})
