import { describe, expect, it } from 'vitest'

import type { ApiAidJumpHousehold } from '../../../types/api-types'
import { searchJumpIndex } from './jumpSearch'

const INDEX: ApiAidJumpHousehold[] = [
  {
    household_cm_id: 1000001,
    family_name: 'Johnson',
    people: [
      { person_cm_id: 1000002, name: 'Emma Johnson', role: 'camper' },
      // A parent has no CampMinder id in the real read (person_cm_id is null).
      { person_cm_id: null, name: 'Samuel Johnson', role: 'parent' },
    ],
  },
  {
    household_cm_id: 1000003,
    family_name: 'Garcia',
    people: [{ person_cm_id: 1000004, name: 'Liam Garcia', role: 'camper' }],
  },
  {
    household_cm_id: 1000005,
    family_name: 'Chen',
    people: [{ person_cm_id: 1000006, name: 'Olivia Chen', role: 'camper' }],
  },
]

const families = (query: string) => searchJumpIndex(INDEX, query).map((m) => m.familyName)

describe('searchJumpIndex (§3.5; D13: family, camper or parent name, or a CampMinder id)', () => {
  it('finds a family by its name', () => {
    expect(families('garc')).toEqual(['Garcia'])
  })

  it("finds a family by a camper's or a parent's name, and says which", () => {
    expect(searchJumpIndex(INDEX, 'olivia')[0]).toEqual({
      householdCmId: 1000005,
      familyName: 'Chen',
      lead: 'Olivia Chen',
      detail: '· camper · Chen household',
    })
    expect(searchJumpIndex(INDEX, 'samuel')[0]).toMatchObject({
      lead: 'Samuel Johnson',
      detail: '· parent · Johnson household',
    })
  })

  it('leads with the household on a family-name match, as before', () => {
    expect(searchJumpIndex(INDEX, 'garc')[0]).toEqual({
      householdCmId: 1000003,
      familyName: 'Garcia',
      lead: 'Garcia',
      detail: 'family',
    })
  })

  // Owner ruling 2026-10-03: staff search by camper or requester; a role reads as the server sends it.
  it('renders a role the server sends that the type does not list yet, as sent', () => {
    const withRequester = [
      {
        household_cm_id: 1000009,
        family_name: 'Garcia',
        people: [{ person_cm_id: null, name: 'Olivia Chen', role: 'requester' }],
      },
    ] as unknown as ApiAidJumpHousehold[]
    expect(searchJumpIndex(withRequester, 'olivia')[0]).toMatchObject({
      lead: 'Olivia Chen',
      detail: '· requester · Garcia household',
    })
  })

  it('lists a family once, however many of its people match', () => {
    expect(families('johnson')).toEqual(['Johnson'])
  })

  it('finds a household id exactly, ahead of a prefix', () => {
    expect(searchJumpIndex(INDEX, '1000003')[0]).toEqual({
      householdCmId: 1000003,
      familyName: 'Garcia',
      lead: 'Garcia',
      detail: 'household 1000003',
    })
  })

  it('finds a person id', () => {
    expect(searchJumpIndex(INDEX, '1000006')[0]).toEqual({
      householdCmId: 1000005,
      familyName: 'Chen',
      lead: 'Olivia Chen',
      detail: '· camper · person 1000006 · Chen household',
    })
  })

  it('searches an id past a parent who has none', () => {
    expect(searchJumpIndex(INDEX, '1000002')[0]?.familyName).toBe('Johnson')
  })

  it('ignores accents on either side', () => {
    const accented: ApiAidJumpHousehold[] = [
      {
        household_cm_id: 1000007,
        family_name: 'Núñez',
        people: [{ person_cm_id: 1000008, name: 'José Núñez', role: 'camper' }],
      },
    ]
    expect(searchJumpIndex(accented, 'jose')[0]?.familyName).toBe('Núñez')
    expect(searchJumpIndex(accented, 'nunez')[0]?.familyName).toBe('Núñez')
    expect(searchJumpIndex(INDEX, 'gárcia')[0]?.familyName).toBe('Garcia')
    expect(searchJumpIndex(accented, 'JOSÉ')[0]?.familyName).toBe('Núñez')
  })

  it('finds nothing for nothing, and nothing for a stranger', () => {
    expect(searchJumpIndex(INDEX, '  ')).toEqual([])
    expect(searchJumpIndex(INDEX, 'zzz')).toEqual([])
  })

  it('stops at its limit', () => {
    expect(searchJumpIndex(INDEX, '1000', 2)).toHaveLength(2)
  })
})
