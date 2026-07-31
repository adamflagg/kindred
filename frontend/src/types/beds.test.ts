/**
 * Beds are inventory; `sleeps` stays the number consumers read.
 *
 * The arithmetic here only ever produces a SUGGESTION. Capacity depends on bed
 * size and on who can share a bed, which is a judgement staff make — so nothing
 * in this module writes `sleeps`.
 */
import { describe, expect, it } from 'vitest'

import { BED_TYPES, normaliseBeds, suggestedSleeps, totalBedCount } from './beds'

describe('BED_TYPES', () => {
  it('gives every type a label and a positive sleeps-per-bed', () => {
    expect(BED_TYPES.length).toBeGreaterThan(0)
    for (const entry of BED_TYPES) {
      expect(entry.label).not.toBe('')
      expect(entry.sleeps).toBeGreaterThan(0)
    }
  })

  it('has unique ids', () => {
    const ids = BED_TYPES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('suggestedSleeps', () => {
  it('is zero for no beds, which reads as UNKNOWN not as zero capacity', () => {
    expect(suggestedSleeps([])).toBe(0)
  })

  it('counts a twin as one person and a queen as two', () => {
    expect(suggestedSleeps([{ type: 'twin', count: 1 }])).toBe(1)
    expect(suggestedSleeps([{ type: 'queen', count: 1 }])).toBe(2)
  })

  it('counts a bunk as two people, not one bed', () => {
    expect(suggestedSleeps([{ type: 'twin_bunk', count: 1 }])).toBe(2)
  })

  it('sums across mixed types', () => {
    expect(
      suggestedSleeps([
        { type: 'twin', count: 4 },
        { type: 'queen', count: 1 },
      ])
    ).toBe(6)
  })

  it('ignores an unknown type rather than throwing on stale data', () => {
    expect(suggestedSleeps([{ type: 'waterbed' as never, count: 3 }])).toBe(0)
  })
})

describe('totalBedCount', () => {
  it('counts beds, not sleepers', () => {
    expect(
      totalBedCount([
        { type: 'twin_bunk', count: 2 },
        { type: 'queen', count: 1 },
      ])
    ).toBe(3)
  })
})

describe('normaliseBeds', () => {
  it('turns null from a pre-migration row into an empty inventory', () => {
    expect(normaliseBeds(null)).toEqual([])
    expect(normaliseBeds(undefined)).toEqual([])
  })

  it('drops entries that are not a known type or have a non-positive count', () => {
    expect(
      normaliseBeds([
        { type: 'twin', count: 2 },
        { type: 'twin', count: 0 },
        { type: 'nope', count: 2 },
        'garbage',
      ])
    ).toEqual([{ type: 'twin', count: 2 }])
  })

  it('parses a JSON string, because PocketBase may return the column as text', () => {
    expect(normaliseBeds('[{"type":"queen","count":1}]')).toEqual([{ type: 'queen', count: 1 }])
  })

  it('returns an empty inventory for unparseable text rather than throwing', () => {
    expect(normaliseBeds('{oh no')).toEqual([])
  })
})
