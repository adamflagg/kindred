import { describe, expect, it } from 'vitest'
import { cityPairKey, withPriorRates } from './retentionCompare'

const bar = (name: string, baseCount = 0, returnedCount = 0) => ({
  name,
  retentionRate: baseCount > 0 ? returnedCount / baseCount : 0,
  baseCount,
  returnedCount,
})

describe('cityPairKey', () => {
  it('pairs a city with and without its state (CampMinder wrote cities both ways across years)', () => {
    expect(cityPairKey(bar('Springfield, CA'))).toBe(cityPairKey(bar('Springfield')))
    const paired = withPriorRates(
      [{ name: 'Springfield, CA', retentionRate: 0.7, baseCount: 50, returnedCount: 35 }],
      [{ name: 'springfield', retentionRate: 0.6, baseCount: 40, returnedCount: 24 }],
      cityPairKey
    )
    expect(paired[0]!.priorRate).toBe(0.6)
  })

  it('strips the state after surrounding whitespace, and folds runs of spaces', () => {
    expect(cityPairKey(bar(' Springfield,  CA '))).toBe(cityPairKey(bar('Springfield')))
    expect(cityPairKey(bar('Shelby  Falls'))).toBe(cityPairKey(bar('shelby falls')))
  })
})

describe('withPriorRates', () => {
  it("pools last year's rows that share a key, rather than letting the last one win", () => {
    // One season can hold a city both with and without its state; the rows come largest first,
    // so a last-wins map would pair this year's 60 campers with last year's 1-camper row.
    const paired = withPriorRates(
      [bar('Springfield, CA', 50, 35)],
      [bar('Springfield, CA', 60, 42), bar('Springfield', 1, 0)],
      cityPairKey
    )
    expect(paired[0]!.priorRate).toBeCloseTo(42 / 61, 10)
  })

  it('keeps a lone row as it is, a rate of 0 included', () => {
    const paired = withPriorRates([bar('Shelbyville', 40, 20)], [bar('Shelbyville', 30, 0)])
    expect(paired[0]!.priorRate).toBe(0)
  })
})
