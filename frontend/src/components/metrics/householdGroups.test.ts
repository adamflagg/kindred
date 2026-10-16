/**
 * Household groups for the drill-down lists (epic #3207 PR 6b, decision 39; owner rulings
 * #39, #40, #41, #44, #45, 2026-10-15). The key is the primary childhood household's
 * CampMinder id, never the surname.
 */
import { describe, it, expect } from 'vitest'
import { groupByHousehold, householdCountWords } from './householdGroups'
import type { DrilldownAttendee } from '../../types/metrics'

function row(
  person_id: number,
  last_name: string,
  household_cm_id: number | null,
  extra: Partial<DrilldownAttendee> = {}
): DrilldownAttendee {
  return {
    person_id,
    first_name: 'Test',
    last_name,
    session_name: 'Session 2',
    session_cm_id: 1001,
    status: 'enrolled',
    is_returning: false,
    household_cm_id,
    ...extra,
  }
}

describe('groupByHousehold', () => {
  it('keys on the household id, so one surname in two households is two groups', () => {
    const groups = groupByHousehold([
      row(1, 'Garcia', 5001, { city: 'Hillcrest' }),
      row(2, 'Garcia', 5002, { city: 'Oak Valley' }),
      row(3, 'Garcia', 5001, { city: 'Hillcrest' }),
    ])
    expect(groups.map((g) => g.rows.map((r) => r.person_id))).toEqual([[1, 3], [2]])
  })

  it('#39: orders groups by their first row in the list as it is sorted', () => {
    const groups = groupByHousehold([
      row(1, 'Rossi', 5001),
      row(2, 'Chen', 5002),
      row(3, 'Baker', 5001),
      row(4, 'Adams', 5003),
    ])
    expect(groups.map((g) => g.key)).toEqual(['h5001', 'h5002', 'h5003'])
    expect(groups[0]?.rows.map((r) => r.person_id)).toEqual([1, 3])
  })

  it('#44: names a group for every surname in it, A to Z, joined by " / "', () => {
    const [g] = groupByHousehold([
      row(1, 'Rossi', 5001),
      row(2, 'baker', 5001),
      row(3, 'Rossi', 5001),
    ])
    expect(g?.label).toBe('baker / Rossi')
  })

  it("#45: every group carries its town, the first camper's own city", () => {
    const [a, b] = groupByHousehold([
      row(1, 'Chen', 5001, { city: 'Riverside', state: 'CA' }),
      row(2, 'Baker', 5002),
    ])
    expect(a?.town).toBe('Riverside')
    expect(b?.town).toBeUndefined()
  })

  it('#45: reads the next camper when the first has no city', () => {
    const [g] = groupByHousehold([
      row(1, 'Chen', 5001),
      row(2, 'Chen', 5001, { city: 'Riverside' }),
    ])
    expect(g?.town).toBe('Riverside')
  })

  it('takes its name and town from every row of the household, so a search does not rename it', () => {
    const all = [
      row(1, 'Baker', 5001, { city: 'Riverside' }),
      row(2, 'Rossi', 5001),
      row(3, 'Chen', 5002),
    ]
    const [g] = groupByHousehold([all[1]!], all)
    expect(g?.label).toBe('Baker / Rossi')
    expect(g?.town).toBe('Riverside')
    expect(g?.campers).toBe(1)
  })

  it('#41: a household of one camper is still a group', () => {
    const groups = groupByHousehold([row(1, 'Chen', 5001)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.campers).toBe(1)
  })

  it('a camper with no household gets a group of their own, named for their surname', () => {
    const groups = groupByHousehold([row(1, 'Chen', null), row(2, 'Chen', null)])
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['p1', 'Chen'],
      ['p2', 'Chen'],
    ])
  })

  it('counts campers, not rows: one camper with two enrollments is one camper', () => {
    const [g] = groupByHousehold([
      row(1, 'Baker', 5001),
      row(1, 'Baker', 5001),
      row(2, 'Rossi', 5001),
    ])
    expect(g?.campers).toBe(2)
    expect(g?.rows).toHaveLength(3)
  })
})

describe('householdCountWords (#40)', () => {
  it('reads campers, and adds enrollments only on Enrollments rows when they differ', () => {
    expect(householdCountWords(1, 1, 'campers')).toBe('1 camper')
    expect(householdCountWords(2, 2, 'campers')).toBe('2 campers')
    expect(householdCountWords(2, 3, 'enrollments')).toBe('2 campers · 3 enrollments')
    expect(householdCountWords(2, 2, 'enrollments')).toBe('2 campers')
  })
})
