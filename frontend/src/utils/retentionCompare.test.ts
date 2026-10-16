import { describe, expect, it } from 'vitest'
import type { RetentionMetrics, RetentionRateBarItem } from '../types/metrics'
import {
  SMALL_BASE_CAMPERS,
  changeArrow,
  describeRetentionBasis,
  firstSummerPairKeys,
  formatSignedPoints,
  isSmallBase,
  pointsBetween,
  regionPriorBars,
  sessionPairKey,
  withPriorRates,
} from './retentionCompare'

const bar = (name: string, rate: number, base = 100, id?: number): RetentionRateBarItem => ({
  name,
  retentionRate: rate,
  baseCount: base,
  returnedCount: Math.round(rate * base),
  ...(id !== undefined ? { id } : {}),
})

function prior(extra: Partial<RetentionMetrics>): RetentionMetrics {
  return {
    base_year: 2024,
    compare_year: 2025,
    base_year_total: 1801,
    returned_count: 1145,
    overall_retention_rate: 0.636,
    by_gender: [],
    by_grade: [],
    by_session: [],
    by_years_at_camp: [],
    ...extra,
  }
}

describe('the small-row rule (#91)', () => {
  it('is one constant: under 30 base-season campers is small', () => {
    expect(SMALL_BASE_CAMPERS).toBe(30)
    expect(isSmallBase(29)).toBe(true)
    expect(isSmallBase(30)).toBe(false)
  })
})

describe('points', () => {
  it('reads a change of rates in points, one decimal, with a true minus', () => {
    expect(pointsBetween(0.655, 0.636)).toBeCloseTo(1.9, 5)
    expect(pointsBetween(0.6, null)).toBeNull()
    expect(formatSignedPoints(1.94)).toBe('+1.9 pts')
    expect(formatSignedPoints(-6.1)).toBe('−6.1 pts')
    expect(formatSignedPoints(0.04)).toBe('0.0 pts')
    expect(changeArrow(1.9)).toBe('▲ ')
    expect(changeArrow(-0.2)).toBe('▼ ')
    expect(changeArrow(0.04)).toBe('')
  })
})

describe('describeRetentionBasis (#86)', () => {
  it('while live says "vs same point last year", with the computed date in the sentence and note 1', () => {
    const basis = describeRetentionBasis(
      prior({
        prior_basis: 'same_point',
        as_of_date: '2025-10-16',
        day_offset: -27,
        prior_day_offset: -27,
      }),
      { year: 2026, base: 1862, returned: 1220 }
    )!
    expect(basis.live).toBe(true)
    expect(basis.label).toBe('vs same point last year')
    expect(basis.text).toBe(
      'Compared with 2025 as it stood on Oct 16, 2025, the same registration day as today.'
    )
    expect(basis.notes).toHaveLength(1)
    expect(basis.notes[0]!.n).toBe(1)
    expect(basis.notes[0]!.text).toContain(
      'of the 1,862 campers enrolled in 2025, 1,220 are already enrolled for 2026'
    )
    expect(basis.notes[0]!.text).toContain(
      'campers from 2024 who were registered by Oct 16, 2025 and not cancelled by then'
    )
    expect(basis.pending).toBe(false)
  })

  it('adds the priority-day note only when the prior was read through the next day', () => {
    const basis = describeRetentionBasis(
      prior({
        prior_basis: 'same_point',
        as_of_date: '2024-11-13',
        day_offset: 0,
        prior_day_offset: 1,
      }),
      { year: 2026, base: 1862, returned: 40 }
    )!
    expect(basis.notes.map((n) => n.n)).toEqual([1, 2])
    expect(basis.notes[1]!.text).toMatch(/opening day and the next day/)
    expect(basis.pending).toBe(true)
  })

  it('numbers its notes from the first free number', () => {
    const basis = describeRetentionBasis(
      prior({ prior_basis: 'final' }),
      { year: 2026, base: 1862, returned: 1300 },
      3
    )!
    expect(basis.notes[0]!.n).toBe(3)
  })

  it('after registration says "vs last year\'s final"', () => {
    const basis = describeRetentionBasis(prior({ prior_basis: 'final' }), {
      year: 2026,
      base: 1862,
      returned: 1300,
    })!
    expect(basis.live).toBe(false)
    expect(basis.label).toBe("vs last year's final")
    expect(basis.text).toBe("Compared with 2025's final numbers.")
    expect(basis.notes[0]!.text).toMatch(/2024 → 2025/)
  })

  it('is nothing until the comparison has loaded', () => {
    expect(describeRetentionBasis(undefined, { year: 2026, base: 1, returned: 1 })).toBeNull()
    expect(describeRetentionBasis(prior({}), { year: 2026, base: 1, returned: 1 })).toBeNull()
  })
})

describe('pairing rows with last year', () => {
  it('pairs by name, and leaves a row last year did not have without a prior', () => {
    const paired = withPriorRates([bar('5', 0.7), bar('6', 0.6)], [bar('5', 0.65)])
    expect(paired[0]!.priorRate).toBe(0.65)
    expect(paired[1]!.priorRate).toBeNull()
  })

  it('pairs a renamed session through its alias group', () => {
    expect(sessionPairKey('Session 2b')).toBe(sessionPairKey('Taste of Camp 2'))
    const paired = withPriorRates([bar('Taste of Camp 2', 0.7)], [bar('Session 2b', 0.5)], (b) =>
      sessionPairKey(b.name)
    )
    expect(paired[0]!.priorRate).toBe(0.5)
  })

  it("pairs First Summer Year by summers in: this year's first-timers with last year's", () => {
    const { current, prior: priorKey } = firstSummerPairKeys
    const now = [
      bar('2017 or earlier', 0.8, 50, 2017),
      bar('2018', 0.7, 50, 2018),
      bar('2025', 0.5, 50, 2025),
    ]
    const then = [bar('2017 or earlier', 0.75, 50, 2017), bar('2024', 0.45, 50, 2024)]
    const paired = withPriorRates(now, then, current, priorKey)
    // 2025's first-timers against 2024's; the folded bucket against the folded bucket
    expect(paired.find((b) => b.id === 2025)!.priorRate).toBe(0.45)
    expect(paired.find((b) => b.id === 2017)!.priorRate).toBe(0.75)
    // 2018 sits next to the fold last year, so it has no exact match
    expect(paired.find((b) => b.id === 2018)!.priorRate).toBeNull()
  })

  it("aggregates last year's whole city list into regions", () => {
    const rows = regionPriorBars([
      { city: 'Unknown City A', base_count: 10, returned_count: 5, retention_rate: 0.5 },
      { city: 'Unknown City B', base_count: 30, returned_count: 25, retention_rate: 0.8333 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.baseCount).toBe(40)
    expect(rows[0]!.retentionRate).toBeCloseTo(30 / 40, 5)
  })
})
