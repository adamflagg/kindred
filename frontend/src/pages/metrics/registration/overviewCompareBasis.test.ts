/**
 * What Overview says about its comparison year (decision 7, PR 7): "vs same point" while the
 * season is live, "vs final" after. Numbered notes, never hover text (decision 11).
 */
import { describe, it, expect } from 'vitest'
import { describeCompareBasis } from './overviewCompareBasis'

const samePoint = {
  prior_basis: 'same_point' as const,
  day_offset: 110,
  prior_day_offset: 110,
  as_of_date: '2025-03-02',
  total_waitlisted: null,
}

describe('describeCompareBasis', () => {
  it('reads "vs same point" with the day the compare year was read through', () => {
    const basis = describeCompareBasis(2025, samePoint)
    expect(basis?.label).toBe('vs same point')
    expect(basis?.text).toContain('2025 as it stood on Mar 2, 2025')
    expect(basis?.pending).toBe(false)
    expect(basis?.waitlistComparable).toBe(false)
  })

  it('notes that the compare year is rebuilt from registration dates and has no waitlist', () => {
    const basis = describeCompareBasis(2025, samePoint)
    expect(basis?.notes).toHaveLength(1)
    expect(basis?.notes[0]?.text).toMatch(/registered by Mar 2, 2025 and not cancelled by then/)
    expect(basis?.notes[0]?.text).toMatch(/waitlist/i)
  })

  it('adds the two-day note on an opening day, where the prior is read through the next day', () => {
    const basis = describeCompareBasis(2025, {
      ...samePoint,
      day_offset: 7,
      prior_day_offset: 8,
      as_of_date: '2024-11-27',
    })
    expect(basis?.notes).toHaveLength(2)
    expect(basis?.notes[1]?.text).toMatch(/opening day and the next day/)
    expect(basis?.pending).toBe(false)
  })

  it('waits a day on the priority date itself (ruling 9)', () => {
    const basis = describeCompareBasis(2025, {
      ...samePoint,
      day_offset: 0,
      prior_day_offset: 1,
      as_of_date: '2024-11-13',
    })
    expect(basis?.pending).toBe(true)
  })

  it('reads "vs final" once the season is over', () => {
    const basis = describeCompareBasis(2025, {
      prior_basis: 'final',
      day_offset: null,
      prior_day_offset: null,
      as_of_date: null,
      total_waitlisted: 40,
    })
    expect(basis?.label).toBe('vs final')
    expect(basis?.text).toContain("2025's final numbers")
    expect(basis?.notes).toEqual([])
    expect(basis?.waitlistComparable).toBe(true)
  })

  it('says nothing when there is no comparison', () => {
    expect(describeCompareBasis(null, samePoint)).toBeNull()
    expect(describeCompareBasis(2025, undefined)).toBeNull()
  })
})
