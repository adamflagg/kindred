import { describe, it, expect } from 'vitest'
import { filterToEnrolled } from './enrollment'

/**
 * Staff hold `bunk_assignments` rows (assigned to a cabin) but have no
 * `attendees` row, so they are not enrolled campers. Camper counts and scenario
 * comparisons derived from raw assignments must intersect against the enrolled
 * person set to exclude staff (#1787, #1747, #1791). `filterToEnrolled` is the
 * single place that intersection lives on the frontend.
 */
describe('filterToEnrolled', () => {
  it('drops records whose person is not in the enrolled set (staff)', () => {
    const assignments = [
      { person: 'p1' }, // enrolled camper
      { person: 'p2' }, // enrolled camper
      { person: 'staff1' }, // staff: has an assignment, no attendee row
    ]
    const enrolled = new Set(['p1', 'p2'])

    const result = filterToEnrolled(assignments, (a) => a.person, enrolled)

    expect(result).toHaveLength(2)
    expect(result.map((a) => a.person)).toEqual(['p1', 'p2'])
  })

  it('matches on numeric cm_id keys too', () => {
    const campers = [{ personCmId: 100 }, { personCmId: 200 }, { personCmId: 999 }]
    const enrolled = new Set<number>([100, 200])

    expect(filterToEnrolled(campers, (c) => c.personCmId, enrolled)).toHaveLength(2)
  })

  it('treats null/undefined person keys as not-enrolled', () => {
    const rows = [{ person: null }, { person: undefined }, { person: 'p1' }]
    const enrolled = new Set(['p1'])

    expect(filterToEnrolled(rows, (r) => r.person, enrolled)).toEqual([{ person: 'p1' }])
  })

  it('returns empty when the enrolled set is empty', () => {
    expect(filterToEnrolled([{ person: 'p1' }], (r) => r.person, new Set())).toEqual([])
  })

  it('preserves input order', () => {
    const rows = [{ id: 3 }, { id: 1 }, { id: 2 }]
    const enrolled = new Set<number>([1, 2, 3])

    expect(filterToEnrolled(rows, (r) => r.id, enrolled).map((r) => r.id)).toEqual([3, 1, 2])
  })
})
