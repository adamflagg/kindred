/**
 * The picker's list: every unplaced party, annotated and ordered, never cut.
 *
 * The rule these tests pin is an owner ruling (2026-08-07, restated
 * 2026-08-09) and it is the OPPOSITE of the instinct: 6 of 118 units carry a
 * private bathroom against 63 parties asking for one, so a hide-filter would
 * empty the list. `placementCandidates` must therefore return exactly as many
 * rows as it was given, every time.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { candidateFit, candidateSearchText, placementCandidates } from './placementCandidates'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    power_coverage: 'unknown',
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'shareable',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('candidateFit', () => {
  it('reports a party with no recorded needs as fitting, with nothing to say', () => {
    const result = candidateFit(party(), unit(), [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('annotates a private-bathroom need against a shared bathroom', () => {
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'shared' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toContain('No private bathroom')
  })

  it('says nothing when the space HAS a private bathroom', () => {
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'private' }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('says nothing when nobody has recorded the bathroom', () => {
    // The absence of evidence is not evidence of absence — the same bar
    // `needsFit`'s `unknown` coverage and `rosterAttention`'s `is_confirmed`
    // gate already apply. Marking an unrecorded room would assert something
    // about a space nobody has measured.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'unknown' }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('annotates a power need against a building where no room has power', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toContain('No power')
  })

  it('softens a power need to partial when SOME rooms have power', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('partial')
    expect(result.notes).toContain('Some rooms have power')
  })

  it('reads power off the leaf-resolved coverage, never the container row own flag', () => {
    // Twelve of the fourteen 2026 family-pool containers record
    // `has_power = 0` while every leaf beneath them has power. Judging by the
    // raw flag would mark twelve entirely-powered buildings unpowered.
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ has_power: false, power_coverage: 'all', is_container: true, is_combined: true }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('annotates a party that does not fit the recorded capacity', () => {
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: 4 }), [])
    expect(result.fit).toBe('unmet')
    expect(result.notes).toContain('Over capacity · needs 6, sleeps 4')
  })

  it('says nothing about capacity nobody has recorded', () => {
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: null }), [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('measures a combined house by its whole-house capacity, not its own row', () => {
    // `effectiveSleeps`: a container's own `sleeps` is the delta for space
    // belonging to no single room, PLUS its rooms. Reading the house row
    // alone would call a 7-bed house a 1-bed one.
    const house = unit({
      unit_id: 'u9',
      code: 'gt-house',
      name: 'Granite House',
      sleeps: 1,
      is_container: true,
      is_combined: true,
    })
    const rooms = [
      unit({
        unit_id: 'u10',
        code: 'gt-house-a',
        name: 'Granite A',
        sleeps: 3,
        parent_code: 'gt-house',
      }),
      unit({
        unit_id: 'u11',
        code: 'gt-house-b',
        name: 'Granite B',
        sleeps: 3,
        parent_code: 'gt-house',
      }),
    ]
    const result = candidateFit(party({ party_size: 6 }), house, [house, ...rooms])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('takes the WORST verdict and keeps every note', () => {
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ bathroom: 'shared', power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['No private bathroom', 'Some rooms have power'])
  })
})

describe('placementCandidates', () => {
  it('never drops a party, however badly it fits', () => {
    // The ruling, stated as arithmetic: filtering to "what fits" would leave
    // staff unable to place anybody.
    const parties = [
      party({ household_cm_id: 1, sort_name: 'Garcia', flags: { needs_private_bathroom: true } }),
      party({ household_cm_id: 2, sort_name: 'Johnson', flags: { needs_power: true } }),
      party({ household_cm_id: 3, sort_name: 'Nguyen', party_size: 99 }),
    ]
    const rows = placementCandidates(
      parties,
      unit({ bathroom: 'shared', power_coverage: 'none' }),
      []
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.fit === 'unmet')).toBe(true)
  })

  it('orders the best fit first, then partial, then unmet', () => {
    const fitting = party({ household_cm_id: 1, sort_name: 'Zimmerman' })
    const partial = party({ household_cm_id: 2, sort_name: 'Adams', flags: { needs_power: true } })
    const unmet = party({
      household_cm_id: 3,
      sort_name: 'Baker',
      flags: { needs_private_bathroom: true },
    })
    const rows = placementCandidates(
      [unmet, partial, fitting],
      unit({ bathroom: 'shared', power_coverage: 'some' }),
      []
    )
    expect(rows.map((row) => row.fit)).toEqual(['fits', 'partial', 'unmet'])
    expect(rows.map((row) => row.party.household_cm_id)).toEqual([1, 2, 3])
  })

  it('breaks a tie on sort_name, so the order is stable rather than payload order', () => {
    const rows = placementCandidates(
      [
        party({ household_cm_id: 1, sort_name: 'Rodriguez' }),
        party({ household_cm_id: 2, sort_name: 'Garcia' }),
        party({ household_cm_id: 3, sort_name: 'Nguyen' }),
      ],
      unit(),
      []
    )
    expect(rows.map((row) => row.party.sort_name)).toEqual(['Garcia', 'Nguyen', 'Rodriguez'])
  })
})

describe('candidateSearchText', () => {
  it('finds a household by any member, adult or child', () => {
    const text = candidateSearchText(
      party({
        adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
        children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
      })
    ).toLowerCase()
    expect(text).toContain('emma johnson')
    expect(text).toContain('noah johnson')
  })

  it('leads with the identity the card shows, not CampMinder salutation', () => {
    // kindred#2084: `display_name` is the mailing_title salutation and
    // disagreed with the attending-adult list on 26.7% of 2026 households.
    // Searching for the stale wording must not resurrect it here.
    const text = candidateSearchText(
      party({
        display_name: 'The Garcia Family',
        adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
        children: [],
      })
    )
    expect(text).toContain('Liam Garcia')
    expect(text).not.toContain('The Garcia Family')
  })
})
