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

  it('does NOT say a room fits when nobody has recorded its bathroom', () => {
    /*
     * ⚠️ REVERSED 2026-08-20. This used to expect `fits`, on the argument that
     * the absence of evidence is not evidence of absence, so marking an
     * unrecorded room would assert something about a space nobody has
     * measured. True — but `fits` asserts something too, and on a candidate
     * row it is the bolder of the two: a green verdict at the moment of
     * placement, telling staff to go ahead. Owner ruling: *"unknown values
     * should not equal fits, across all surfaces on the glyphs, its
     * unconfirmed information."*
     *
     * `notes` stays empty, because notes are what NO GLYPH can say and the
     * glyph carries this one (N2). The row's own verdict is what changes.
     */
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'unknown' }),
      []
    )
    expect(result.fit).toBe('unmet')
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

  it('annotates a party that does not fit the beds left', () => {
    // ⚠️ THE NOTE NOW COUNTS FREE BEDS, NOT THE ROOM'S WHOLE CAPACITY (owner
    // ruling 2026-08-20 — see the `capacityVerdict` describe below). An empty
    // room's free beds ARE its capacity, so this case reads the same as it
    // always did; only the words changed, and they changed to match the
    // header immediately above these rows, which has said "N of M beds free"
    // since the 2026-08-19 ruling.
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: 4 }), [])
    expect(result.fit).toBe('unmet')
    expect(result.notes).toContain('Over capacity · needs 6, 4 free')
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
    expect(result.notes).toEqual(['Over capacity · needs 6, 4 free'])
  })
})

describe('capacityVerdict — the row grades the beds LEFT (owner ruling 2026-08-20)', () => {
  /*
   * ⚠️ THE DEFECT THIS CLOSES SHIPPED A GREEN `fits` ON A ROW THAT WOULD
   * OVER-FILL THE ROOM, and it was pre-existing rather than introduced by the
   * modal — the review artifact draws it the same way.
   *
   * The header above these rows answers "will they fit in what is LEFT" (the
   * 2026-08-19 ruling: it prints "2 of 4 beds free"). The row graded
   * `partyBeds <= effectiveSleeps` — the room's whole capacity — and never saw
   * the occupants the header had just counted. Aspen sleeps 4 and already
   * holds 2; a three-bed household's row printed a bold green `fits`, and
   * clicking it made the card behind the dialog read 5/4 in red.
   *
   * The 2026-08-19 ruling settled what the HEADER counts and said nothing
   * about what the ROW grades, which is why this went to the owner rather
   * than being decided here. Ruled 2026-08-20: "grade against the remainder,
   * otherwise it makes no sense."
   */
  it('refuses a party that fits the room but not the beds left', () => {
    // 3 ≤ 4, so this row used to say `fits`. 3 > 4 − 2, so it does not.
    const result = candidateFit(party({ party_size: 3 }), unit({ sleeps: 4 }), [], 2)
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 3, 2 free'])
  })

  it('accepts a party that fits what is left', () => {
    const result = candidateFit(party({ party_size: 2 }), unit({ sleeps: 4 }), [], 2)
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('never counts a negative bed, however over-filled the room already is', () => {
    // The header refuses to print a negative remainder for the same reason
    // (`Math.max(0, …)`), and says "Over capacity — 5 placed, sleeps 2"
    // instead. Nothing fits into a room with nothing left.
    const result = candidateFit(party({ party_size: 1 }), unit({ sleeps: 2 }), [], 5)
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 1, 0 free'])
  })

  it('still says nothing about a capacity nobody has recorded', () => {
    // `null` is "nobody has counted", not "sleeps nobody" — occupants cannot
    // turn an unmeasured room into a full one.
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: null }), [], 4)
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('discounts the occupants of a COMBINED house against its whole-house total', () => {
    const house = unit({
      unit_id: 'u9',
      code: 'gt-house',
      name: 'Granite House',
      sleeps: 1,
      is_container: true,
      is_combined: true,
    })
    const rooms = [
      unit({ unit_id: 'u10', code: 'gt-house-a', sleeps: 3, parent_code: 'gt-house' }),
      unit({ unit_id: 'u11', code: 'gt-house-b', sleeps: 3, parent_code: 'gt-house' }),
    ]
    // 7 beds in the house, 4 taken, so a 3-bed household is the last that fits.
    expect(candidateFit(party({ party_size: 3 }), house, [house, ...rooms], 4).fit).toBe('fits')
    expect(candidateFit(party({ party_size: 4 }), house, [house, ...rooms], 4).fit).toBe('unmet')
  })

  it('grades every row in the list against the same remainder', () => {
    const rows = placementCandidates(
      [
        party({ household_cm_id: 1, sort_name: 'Garcia', party_size: 2 }),
        party({ household_cm_id: 2, sort_name: 'Johnson', party_size: 3 }),
      ],
      unit({ sleeps: 4 }),
      [],
      2
    )
    const byId = new Map(rows.map((row) => [row.party.household_cm_id, row]))
    expect(byId.get(1)?.fit).toBe('fits')
    expect(byId.get(2)?.fit).toBe('unmet')
  })

  it('defaults to an EMPTY room when no occupancy is passed', () => {
    // The parameter is optional so no caller is forced to thread a number it
    // does not have; the default has to be the reading this function had
    // before, not a silent zero-capacity room.
    expect(candidateFit(party({ party_size: 4 }), unit({ sleeps: 4 }), []).fit).toBe('fits')
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
    expect(result.notes).toEqual(['Over capacity · needs 6, 4 free'])
  })
})
