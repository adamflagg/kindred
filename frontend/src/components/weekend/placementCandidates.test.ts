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
import { candidateFit, placementCandidates } from './placementCandidates'

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

  it('marks a private-bathroom need against a shared bathroom', () => {
    // The NOTE is struck (kindred#2072): the row draws a red bathroom glyph,
    // and a sentence beside it repeating the fact is the "one fact twice" N2
    // removed from the family card. The verdict it feeds is unchanged, and
    // the verdict is what orders the list.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'shared' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
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
    // Struck with the other per-need notes — the glyph carries it.
    expect(result.notes).toEqual([])
  })

  it('softens a power need to partial when SOME rooms have power', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('partial')
    expect(result.notes).toEqual([])
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

  it('takes the WORST verdict across every dimension', () => {
    // `unmet` (bathroom) beats `partial` (some rooms have power). The notes
    // that used to ride along are struck; what survives is the ordering rule,
    // which is what this test was really protecting.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ bathroom: 'shared', power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('still takes the worst when only CAPACITY fails, and keeps its note', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true }, party_size: 6 }),
      unit({ sleeps: 4, power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 6, sleeps 4'])
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

describe('candidateFit — one grading, and the notes the glyphs now carry (kindred#2072)', () => {
  /*
   * This module was the FOURTH table grading these needs, and the survey that
   * planned kindred#2072 counted three. Its own doc had spotted the
   * divergence and said so: fridge and step-free hatched the board mid-drag
   * and annotated `fits` here.
   *
   * What it had right, and what `needGlyphs.ts` therefore had to learn rather
   * than flatten: a CANDIDATE has no placement, so its bathroom must be read
   * off the cabin being considered and never off `party.effective_bathroom`.
   * That is the `prospective` reading.
   */
  it('grades all four ruled needs, not the two it used to', () => {
    const result = candidateFit(
      party({ flags: { needs_fridge: true } }),
      unit({ fridge_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
  })

  it('grades step-free, and SOME rooms is worse than none for it', () => {
    // The `is_accessible` shape: a building advertising two step-free rooms
    // out of ten invites precisely the placement that lands in one of the
    // other eight.
    expect(
      candidateFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'some' }), [])
        .fit
    ).toBe('unmet')
    expect(
      candidateFit(
        party({ flags: { needs_step_free: true } }),
        unit({ ramp_coverage: 'partial' }),
        []
      ).fit
    ).toBe('partial')
  })

  it('reads a candidate bathroom off the CABIN, never off a placement it does not have', () => {
    // Every party in this list is unplaced, so `effective_bathroom` is the
    // wrong question — it would annotate identically on every cabin.
    const unplaced = party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'none' })
    expect(candidateFit(unplaced, unit({ bathroom: 'private' }), []).fit).toBe('fits')
    expect(candidateFit(unplaced, unit({ bathroom: 'shared' }), []).fit).toBe('unmet')
  })

  it('writes NO note for a need — the glyph beside it says the same thing', () => {
    // N2: the glyph takes the warn fill when the room does not meet the need,
    // and a note repeating it states one fact twice — the exact reason
    // `No private bathroom` was struck from the family card. The row draws
    // the same glyphs, so the same rule applies to it.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ bathroom: 'shared', power_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('keeps the CAPACITY note, which no glyph carries', () => {
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: 4 }), [])
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 6, sleeps 4'])
  })
})
