import { describe, expect, it } from 'vitest'
import { withPriorCityRates, withPriorRates } from './retentionCompare'

const bar = (name: string, baseCount = 0, returnedCount = 0) => ({
  name,
  retentionRate: baseCount > 0 ? returnedCount / baseCount : 0,
  baseCount,
  returnedCount,
})

describe('withPriorCityRates', () => {
  it('pairs a city with and without its state when only one side carries a state', () => {
    // CampMinder wrote "Springfield" one year and "Springfield, CA" the next.
    const paired = withPriorCityRates(
      [bar('Springfield, CA', 50, 35)],
      [bar('springfield', 40, 24)]
    )
    expect(paired[0]!.priorRate).toBe(0.6)
    const other = withPriorCityRates([bar('Springfield', 50, 35)], [bar('Springfield, CA', 40, 24)])
    expect(other[0]!.priorRate).toBe(0.6)
  })

  it('keeps same-named cities in different states apart when both years carry a state', () => {
    const paired = withPriorCityRates(
      [bar('Shelby Falls, CA', 50, 35), bar('Shelby Falls, CO', 20, 5)],
      [bar('Shelby Falls, CA', 40, 24), bar('Shelby Falls, CO', 30, 24)]
    )
    expect(paired.map((b) => b.priorRate)).toEqual([0.6, 0.8])
  })

  it('gives a state its own city no prior rate when last year had only another state', () => {
    const paired = withPriorCityRates(
      [bar('Shelby Falls, CA', 50, 35)],
      [bar('Shelby Falls, CO', 30, 24)]
    )
    expect(paired[0]!.priorRate).toBeNull()
  })

  it('does not guess a state for a stateless city when last year held two', () => {
    const ambiguous = withPriorCityRates(
      [bar('Shelby Falls', 50, 35)],
      [bar('Shelby Falls, CA', 40, 24), bar('Shelby Falls, CO', 30, 24)]
    )
    expect(ambiguous[0]!.priorRate).toBeNull()
  })

  it('folds case, runs of spaces and the space before the state', () => {
    const paired = withPriorCityRates(
      [bar(' Shelby  Falls,  CA ', 10, 5)],
      [bar('shelby falls, ca', 10, 7)]
    )
    expect(paired[0]!.priorRate).toBe(0.7)
  })

  it("pools last year's rows of the same city, with and without the state", () => {
    const paired = withPriorCityRates(
      [bar('Springfield, CA', 50, 35)],
      [bar('Springfield, CA', 60, 42), bar('Springfield', 1, 0)]
    )
    expect(paired[0]!.priorRate).toBeCloseTo(42 / 61, 10)
  })
})

describe('withPriorRates', () => {
  it("pools last year's rows that share a key, rather than letting the last one win", () => {
    // One season can hold a city both with and without its state; the rows come largest first,
    // so a last-wins map would pair this year's 60 campers with last year's 1-camper row.
    const paired = withPriorRates(
      [bar('Springfield', 50, 35)],
      [bar('Springfield', 60, 42), bar('Springfield', 1, 0)]
    )
    expect(paired[0]!.priorRate).toBeCloseTo(42 / 61, 10)
  })

  it('keeps a lone row as it is, a rate of 0 included', () => {
    const paired = withPriorRates([bar('Shelbyville', 40, 20)], [bar('Shelbyville', 30, 0)])
    expect(paired[0]!.priorRate).toBe(0)
  })
})
