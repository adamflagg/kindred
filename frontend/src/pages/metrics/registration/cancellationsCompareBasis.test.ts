/**
 * What Cancellations says about its comparison year (PM-8 A): "vs same point" while the season is live,
 * "vs final" after, and which figures have no comparison because status history can't rebuild them.
 */
import { describe, it, expect } from 'vitest'
import { describeCancellationsCompareBasis } from './cancellationsCompareBasis'

const samePoint = {
  prior_basis: 'same_point' as const,
  day_offset: 110,
  prior_day_offset: 110,
  as_of_date: '2025-03-02',
  was_enrolled: null,
}

describe('describeCancellationsCompareBasis', () => {
  it('reads "vs same point" in Overview\'s grammar', () => {
    const basis = describeCancellationsCompareBasis(2025, samePoint, 3)
    expect(basis?.label).toBe('vs same point')
    expect(basis?.text).toBe(
      'Compared with 2025 as it stood on Mar 2, 2025, the same registration day as today.'
    )
    expect(basis?.notes[0]?.n).toBe(3)
    expect(basis?.notes[0]?.text).toMatch(/cancellations dated by Mar 2, 2025/)
  })

  it('says the status figures have no comparison when status history cannot rebuild them', () => {
    const basis = describeCancellationsCompareBasis(2025, samePoint, 3)
    expect(basis?.priorStatusComparable).toBe(false)
    expect(basis?.notes).toHaveLength(2)
    expect(basis?.notes[1]?.n).toBe(4)
    expect(basis?.notes[1]?.text).toMatch(
      /^Was Enrolled, Was Waitlisted, .*Re-enrolled have no comparison/
    )
  })

  it('keeps the status figures when the history rebuilt them', () => {
    const basis = describeCancellationsCompareBasis(2025, { ...samePoint, was_enrolled: 4 }, 3)
    expect(basis?.priorStatusComparable).toBe(true)
    expect(basis?.notes).toHaveLength(1)
  })

  it('waits a day on the priority date itself, and adds the two-day note on an opening day', () => {
    const basis = describeCancellationsCompareBasis(
      2025,
      {
        ...samePoint,
        day_offset: 0,
        prior_day_offset: 1,
        as_of_date: '2024-11-13',
        was_enrolled: 0,
      },
      1
    )
    expect(basis?.pending).toBe(true)
    expect(basis?.notes.map((n) => n.n)).toEqual([1, 2])
    expect(basis?.notes[1]?.text).toMatch(/opening day and the next day/)
  })

  it('reads "vs final" once the season is over, every figure compared', () => {
    const basis = describeCancellationsCompareBasis(2025, {
      prior_basis: 'final',
      day_offset: null,
      prior_day_offset: null,
      as_of_date: null,
      was_enrolled: 3,
    })
    expect(basis?.label).toBe('vs final')
    expect(basis?.priorStatusComparable).toBe(true)
    expect(basis?.notes).toEqual([])
  })

  it('says nothing when there is no comparison', () => {
    expect(describeCancellationsCompareBasis(null, samePoint)).toBeNull()
    expect(describeCancellationsCompareBasis(2025, undefined)).toBeNull()
  })
})
